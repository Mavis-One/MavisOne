/**
 * Painel "Atenção" do hub.
 *
 * O PROBLEMA QUE ELE RESOLVE
 * --------------------------
 * Tudo o que está errado no sistema já está gravado em algum lugar — só que
 * espalhado por seis telas diferentes. Uma conta venceu no Financeiro, uma
 * NF-e foi rejeitada no Fiscal, um pedido está faturado sem nota, um produto
 * furou o mínimo no Estoque. Ninguém descobre isso navegando: descobre quando
 * o cliente liga.
 *
 * Este módulo NÃO inventa dado novo. Ele varre o que já existe e devolve
 * apenas as ocorrências que exigem alguém fazer alguma coisa hoje.
 *
 * SEVERIDADE, e por que ela importa
 * ---------------------------------
 *   'alta'  — já causou dano ou está bloqueando dinheiro/expedição.
 *   'media' — vai causar dano se ninguém agir esta semana.
 *   'baixa' — precisa de atenção, mas nada quebra hoje.
 *
 * Sem a distinção, tudo vira vermelho e o painel deixa de ser lido — que é o
 * modo mais comum de um alerta falhar.
 *
 * Puro de propósito: recebe os dados prontos e não conhece banco nem HTTP. É o
 * que permite testar cada regra sem subir servidor.
 */

function num(valor) {
  return Number(valor || 0);
}

function hojeISO(referencia) {
  return (referencia || new Date().toISOString()).slice(0, 10);
}

function diasEntre(deISO, ateISO) {
  const de = new Date(`${deISO}T00:00:00`);
  const ate = new Date(`${ateISO}T00:00:00`);
  return Math.round((ate - de) / 86400000);
}

// Um lançamento em aberto é o que ainda não foi pago nem cancelado. Os dois
// vocabulários convivem no sistema ('pending' do Supabase, 'pendente' da tela).
function emAberto(entrada) {
  const status = String(entrada.status || '').toLowerCase();
  return status === 'pending' || status === 'pendente' || status === 'parcial';
}

/**
 * Contas vencidas — dinheiro que já deveria ter entrado ou saído.
 *
 * Severidade alta sempre: vencido não é aviso de prazo, é fato consumado.
 */
function contasVencidas(entradas, hoje) {
  const vencidas = (entradas || []).filter((e) => emAberto(e) && e.dueDate && e.dueDate < hoje);
  if (!vencidas.length) return null;
  const total = vencidas.reduce((soma, e) => soma + num(e.amount), 0);
  // A mais antiga é o que dá a dimensão do problema: cinco títulos de ontem é
  // uma coisa, um de noventa dias é outra.
  const maisAntiga = vencidas.reduce((pior, e) => (e.dueDate < pior.dueDate ? e : pior), vencidas[0]);
  const dias = diasEntre(maisAntiga.dueDate, hoje);
  return {
    id: 'contas-vencidas',
    severidade: 'alta',
    titulo: 'Contas vencidas',
    detalhe: `${formatarBRL(total)} · a mais antiga há ${dias} dia${dias === 1 ? '' : 's'}`,
    contagem: vencidas.length,
    modulo: 'finance',
    sub: 'lancamentos'
  };
}

/**
 * Contas a vencer nos próximos 7 dias. Severidade média: ainda dá para agir.
 * Fica de fora quando não há nenhuma — painel com linha "0" é ruído.
 */
function contasAVencer(entradas, hoje, dias = 7) {
  const limite = new Date(`${hoje}T00:00:00`);
  limite.setDate(limite.getDate() + dias);
  const limiteISO = limite.toISOString().slice(0, 10);
  const proximas = (entradas || []).filter((e) => emAberto(e) && e.dueDate && e.dueDate >= hoje && e.dueDate <= limiteISO);
  if (!proximas.length) return null;
  const total = proximas.reduce((soma, e) => soma + num(e.amount), 0);
  return {
    id: 'contas-a-vencer',
    severidade: 'media',
    titulo: `Vencem em ${dias} dias`,
    detalhe: formatarBRL(total),
    contagem: proximas.length,
    modulo: 'finance',
    sub: 'lancamentos'
  };
}

/**
 * NF-e que a SEFAZ recusou.
 *
 * Alta: nota rejeitada trava expedição — a mercadoria não pode sair sem
 * documento, e o pedido fica parado sem ninguém saber por quê.
 */
function nfeComErro(notas, hoje) {
  const comErro = (notas || []).filter((n) => {
    const s = String(n.status || '').toUpperCase();
    return s === 'ERRO' || s === 'DENEGADO' || s === 'REJEITADA';
  });
  if (!comErro.length) return null;
  return {
    id: 'nfe-erro',
    severidade: 'alta',
    titulo: 'NF-e rejeitadas',
    detalhe: 'bloqueiam a expedição até serem corrigidas',
    contagem: comErro.length,
    modulo: 'fiscal',
    sub: 'nfe_emitidas'
  };
}

/**
 * NF-e presa em PROCESSANDO há mais de um dia.
 *
 * É o sintoma de webhook que não chegou: a SEFAZ já respondeu e o sistema não
 * soube. Sem este alerta a nota fica em limbo indefinidamente, e quem olha a
 * lista acha que ainda está em trânsito.
 */
function nfeTravada(notas, hoje) {
  const travadas = (notas || []).filter((n) => {
    if (String(n.status || '').toUpperCase() !== 'PROCESSANDO') return false;
    const data = String(n.dataEmissao || n.criadoEm || '').slice(0, 10);
    return data && diasEntre(data, hoje) >= 1;
  });
  if (!travadas.length) return null;
  return {
    id: 'nfe-processando',
    severidade: 'media',
    titulo: 'NF-e sem retorno da SEFAZ',
    detalhe: 'há mais de um dia em processamento — use "Consultar status"',
    contagem: travadas.length,
    modulo: 'fiscal',
    sub: 'nfe_emitidas'
  };
}

/**
 * Pedidos faturados que não geraram nota.
 *
 * `faturado` diz que a venda se concretizou; sem NF-e, ela se concretizou sem
 * documento fiscal. É o alerta mais caro da lista se ficar sem resposta.
 */
function pedidosSemNota(pedidos, statusQueFaturam, hoje, diasTolerancia = 1) {
  const pendentes = (pedidos || []).filter((p) => {
    if (p.nfeId) return false;
    if (!statusQueFaturam.includes(String(p.status || '').toLowerCase())) return false;
    const data = String(p.date || p.createdAt || '').slice(0, 10);
    return !data || diasEntre(data, hoje) >= diasTolerancia;
  });
  if (!pendentes.length) return null;
  const total = pendentes.reduce((soma, p) => soma + num(p.totalAmount ?? p.total), 0);
  return {
    id: 'pedidos-sem-nota',
    severidade: 'alta',
    titulo: 'Pedidos faturados sem NF-e',
    detalhe: `${formatarBRL(total)} sem documento fiscal`,
    contagem: pendentes.length,
    modulo: 'sales',
    sub: 'orders_quotes'
  };
}

/**
 * Produtos no ou abaixo do mínimo.
 *
 * Baixa: nada quebra hoje, mas é o que vira "não temos" na próxima venda. O
 * mínimo só conta quando foi configurado — sem isso, todo produto com pouco
 * saldo viraria alerta.
 */
function estoqueAbaixoDoMinimo(produtos) {
  const abaixo = (produtos || []).filter((p) => p.situation === 'abaixo-minimo' || p.situation === 'zerado');
  if (!abaixo.length) return null;
  const zerados = abaixo.filter((p) => p.situation === 'zerado').length;
  return {
    id: 'estoque-minimo',
    severidade: zerados ? 'media' : 'baixa',
    titulo: 'Produtos abaixo do mínimo',
    detalhe: zerados ? `${zerados} com saldo zerado` : 'reposição recomendada',
    contagem: abaixo.length,
    modulo: 'stock',
    sub: 'products'
  };
}

function formatarBRL(valor) {
  return `R$ ${num(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const PESO = { alta: 0, media: 1, baixa: 2 };

/**
 * Monta o painel.
 *
 * `permissoes` decide o que entra: mostrar uma pendência de um módulo que a
 * pessoa não pode abrir é oferecer um beco sem saída — ela clica e leva "Sem
 * permissão".
 */
function montarAtencao({ entradas, notasFiscais, pedidos, produtos, statusQueFaturam = [], permissoes = {}, agora } = {}) {
  const hoje = hojeISO(agora);
  const itens = [];

  if (permissoes.finance) {
    itens.push(contasVencidas(entradas, hoje));
    itens.push(contasAVencer(entradas, hoje));
  }
  if (permissoes.fiscal) {
    itens.push(nfeComErro(notasFiscais, hoje));
    itens.push(nfeTravada(notasFiscais, hoje));
  }
  if (permissoes.sales) {
    itens.push(pedidosSemNota(pedidos, statusQueFaturam, hoje));
  }
  if (permissoes.stock) {
    itens.push(estoqueAbaixoDoMinimo(produtos));
  }

  // Ordena por severidade e, dentro dela, pelo volume: o que é mais grave
  // primeiro, e entre iguais o que afeta mais registros.
  const lista = itens.filter(Boolean).sort((a, b) => (PESO[a.severidade] - PESO[b.severidade]) || (b.contagem - a.contagem));

  return {
    itens: lista,
    // Contadores para o sino da barra superior e para os badges da sidebar.
    total: lista.reduce((soma, i) => soma + i.contagem, 0),
    criticos: lista.filter((i) => i.severidade === 'alta').reduce((soma, i) => soma + i.contagem, 0),
    porModulo: lista.reduce((mapa, i) => {
      mapa[i.modulo] = (mapa[i.modulo] || 0) + i.contagem;
      return mapa;
    }, {})
  };
}

module.exports = {
  montarAtencao,
  contasVencidas,
  contasAVencer,
  nfeComErro,
  nfeTravada,
  pedidosSemNota,
  estoqueAbaixoDoMinimo,
  emAberto,
  diasEntre
};
