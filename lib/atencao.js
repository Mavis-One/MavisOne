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

// ---------------------------------------------------------------------------
// PENDÊNCIA É O QUE NASCEU AQUI (fase CO)
//
// O QUE O PAINEL MOSTRAVA, medido em 21/09/2026 com os dados reais:
//
//   Pedidos faturados sem NF-e ..... 13.325   R$ 24.809.929,55
//   Produtos abaixo do mínimo ....... 5.476   (5.476 "com saldo zerado")
//   Contas vencidas ................... 152   a mais antiga há 320 dias
//
// Nenhum desses três é tarefa de alguém. A importação do ViperERP trouxe 14.864
// pedidos, e 13.320 deles estão como `pedido-faturado` sem `nfe_id` — porque a
// nota foi emitida no sistema ANTIGO. Os outros 5 não têm nem `code`. Pedidos
// nascidos aqui: ZERO (a sequence está em 15.999; o próximo será o 16.000).
//
// Ou seja: o painel de pendências era 100% histórico. E painel de pendência que
// nunca zera deixa de ser lido — o que custa caro no dia em que aparecer a
// pendência de verdade no meio dos treze mil.
//
// O CORTE USA O PISO QUE JÁ EXISTE. A fase CG decidiu que a numeração própria
// começa em 16.000 justamente para separar o que nasceu aqui do histórico
// importado (1 a 15.525). Não inventamos data de corte configurável: o número
// do documento já diz de onde ele veio, e é uma regra só, testada, que ninguém
// precisa manter atualizada.
//
// O HISTÓRICO NÃO É APAGADO. Ele continua inteiro nas listas de Vendas,
// Financeiro e Estoque — só deixa de ser cobrado como tarefa. Documento fiscal
// neste sistema nunca é apagado (ver a regra de cancelamento da NF-e).
// ---------------------------------------------------------------------------
const PRIMEIRO_NUMERO_PROPRIO = 16000;

/**
 * O documento foi criado por ESTE sistema?
 *
 * Sem `code` conta como importado: todo documento que nasce aqui recebe número
 * da sequence (getNextSalesCode), então ausência de número é marca de linha que
 * entrou por fora.
 */
function nasceuAqui(registro) {
  const code = Number(registro && registro.code);
  return Number.isFinite(code) && code >= PRIMEIRO_NUMERO_PROPRIO;
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
    // Histórico importado não é tarefa: a nota daqueles pedidos foi emitida no
    // sistema antigo. Ver o bloco PENDÊNCIA É O QUE NASCEU AQUI, acima —
    // eram 13.325 linhas aqui, e nenhuma acionável.
    if (!nasceuAqui(p)) return false;
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
  // "ZERADO" SÓ É PENDÊNCIA SE ALGUÉM DISSE QUE DEVIA TER ESTOQUE.
  //
  // `productStockSituation` devolve 'zerado' para todo saldo <= 0, e neste banco
  // os 5.475 produtos estão em zero: o razão de estoque nunca foi carregado, e
  // `productMeta` está vazio (nenhum mínimo configurado). O painel acusava os
  // 5.476 como "abaixo do mínimo" — que não é falta de mercadoria, é ausência de
  // dado. São coisas diferentes, e só uma é tarefa.
  //
  // 'abaixo-minimo' entra sempre: por definição ele só acontece quando o mínimo
  // foi configurado (> 0). 'zerado' entra quando há mínimo declarado — aí o
  // sistema tem base para dizer que falta.
  //
  // O QUE SE PERDE, e é escolha: produto que zerou de verdade e não tem mínimo
  // cadastrado deixa de alertar. É o preço de não gritar 5.476 vezes por dia; o
  // caminho é cadastrar o mínimo do que importa, e aí o alerta volta com sentido.
  const abaixo = (produtos || []).filter((p) => (
    p.situation === 'abaixo-minimo' || (p.situation === 'zerado' && p.temMinimo === true)
  ));
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

  // O TÍTULO QUE NASCEU DE UM PEDIDO IMPORTADO TAMBÉM É HISTÓRICO.
  //
  // `referenceId` é o que amarra a parcela ao pedido que a gerou (ver a criação
  // em server.js). Título de pedido do ViperERP é a mesma coisa que o pedido:
  // fato registrado, não conta a cobrar por este sistema — e era o que punha
  // "a mais antiga há 320 dias" no painel.
  //
  // Título SEM referência de pedido continua contando. É a despesa digitada à
  // mão, o aluguel, o imposto: nasceu aqui, alguém precisa pagar. Só o que tem
  // origem comprovadamente importada sai da conta.
  const pedidosImportados = new Set(
    (pedidos || []).filter((p) => !nasceuAqui(p)).map((p) => String(p.id))
  );
  const entradasProprias = (entradas || []).filter((e) => (
    !e.referenceId || !pedidosImportados.has(String(e.referenceId))
  ));

  if (permissoes.finance) {
    itens.push(contasVencidas(entradasProprias, hoje));
    itens.push(contasAVencer(entradasProprias, hoje));
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
