// RELATÓRIO DE VENDAS — o cálculo, em um lugar só.
//
// Este arquivo recebe as vendas já lidas e devolve TUDO que o relatório mostra:
// os indicadores do topo, a tabela, o agrupamento por vendedor e as linhas do
// CSV. Não fala com banco, não fala com rede e não sabe o que é uma requisição.
//
// POR QUE UM ARQUIVO SÓ, E POR QUE PURO
// -------------------------------------
// O documento que originou esta tela pede, em letras maiúsculas, que os cards,
// a tabela, os gráficos e o Excel mostrem exatamente o mesmo universo de dados.
// A maneira de garantir isso não é lembrar de aplicar o mesmo filtro em quatro
// lugares — é ter um lugar só. Aqui o conjunto é filtrado UMA vez, e os quatro
// saem do mesmo array. Um card que soma o que a tabela não lista deixa de ser
// possível por construção, e não por disciplina.
//
// Sendo puro, os oito testes de segurança do documento rodam sem servidor: dá
// para provar que o vendedor comum não vê a venda do colega passando dois
// objetos para uma função.
//
// A LINHA É O ITEM, NÃO O PEDIDO
// ------------------------------
// A tabela pedida tem Produto, Código do produto, Quantidade e Valor unitário —
// ou seja, uma linha por ITEM vendido, não por pedido. Um pedido com três
// produtos vira três linhas.
//
// Isso decide como o dinheiro é contado, e a decisão importa:
//
//   faturamento = soma das LINHAS que estão na tela
//
// e não o `totalAmount` do pedido. Os dois divergem, e de propósito: o total do
// pedido inclui frete, despesas e serviços, que não pertencem a produto nenhum.
// Se o card usasse o total do pedido, filtrar por um produto mostraria a tabela
// com uma linha de R$ 500 e o card com os R$ 3.200 do pedido inteiro — o
// descasamento exato que o documento manda evitar.
//
// O DESCONTO É RATEADO
// --------------------
// Desconto é combinado no PEDIDO (em R$ e/ou em %), não no item. Para a linha
// ter um "Valor total" que some com as outras, o desconto do pedido é dividido
// entre as linhas na proporção do que cada uma representa. Somando todas as
// linhas de um pedido, volta o valor dos produtos com o desconto aplicado.

const SalesStatus = require('../public/modules/shared/sales_status');
const escopoLib = require('./relatorios-escopo');

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const cent = (v) => Math.round(n(v) * 100) / 100;
const texto = (v) => String(v === null || v === undefined ? '' : v).trim();
const semAcento = (v) => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Uma opção de status a mais do que o catálogo tem, e a mais importante delas:
// venda cancelada continua no banco e não pode entrar no faturamento sem que
// ninguém tenha pedido. O padrão exclui cancelada E DIZ ISSO no rótulo — filtro
// que esconde dado sem avisar é o que faz relatório e banco discordarem.
const STATUS_PADRAO = 'ativos';

const ORDENACOES = {
  data: (a, b) => texto(a.data).localeCompare(texto(b.data)),
  pedido: (a, b) => n(a.pedidoCodigo) - n(b.pedidoCodigo),
  vendedor: (a, b) => texto(a.vendedorNome).localeCompare(texto(b.vendedorNome), 'pt-BR'),
  cliente: (a, b) => texto(a.clienteNome).localeCompare(texto(b.clienteNome), 'pt-BR'),
  produto: (a, b) => texto(a.produtoNome).localeCompare(texto(b.produtoNome), 'pt-BR'),
  quantidade: (a, b) => n(a.quantidade) - n(b.quantidade),
  valor: (a, b) => n(a.valorTotal) - n(b.valorTotal),
  status: (a, b) => texto(a.statusRotulo).localeCompare(texto(b.statusRotulo), 'pt-BR')
};

/**
 * As linhas de um registro de venda — uma por item.
 *
 * Cada linha carrega os ids (pedido, cliente, produto, vendedor) porque a
 * tabela é clicável: clicar no pedido abre o pedido que já existe no ERP, e sem
 * o id a tela teria de adivinhar pelo nome.
 */
function linhasDoRegistro(registro) {
  const itens = Array.isArray(registro.items) ? registro.items : [];
  const bruto = itens.reduce((soma, item) => soma + n(item.quantity) * n(item.unitPrice), 0);

  // Desconto do pedido, em reais. O percentual incide sobre o valor dos
  // produtos — é assim que a tela de venda calcula, e relatório que calcula
  // desconto de outro jeito passa a discordar do pedido que ele mesmo lista.
  const descontoTotal = Math.min(bruto, n(registro.discountAmount) + (bruto * n(registro.discountPercent)) / 100);

  const statusNormalizado = SalesStatus.normalizar(registro.status);
  const meta = SalesStatus.meta ? SalesStatus.meta(statusNormalizado) : null;

  return itens.map((item, i) => {
    const valorBruto = cent(n(item.quantity) * n(item.unitPrice));
    // Rateio proporcional. Sem produtos (bruto 0), não há o que ratear.
    const desconto = bruto > 0 ? cent((valorBruto / bruto) * descontoTotal) : 0;
    return {
      linhaId: `${registro.id}:${i}`,
      pedidoId: registro.id,
      pedidoCodigo: registro.code || '',
      tipo: registro.type === 'quote' ? 'quote' : 'order',
      data: registro.date || '',
      vendedorId: texto(registro.sellerId),
      vendedorNome: texto(registro.sellerName) || 'Sem vendedor',
      clienteId: texto(registro.clientSupplierId),
      clienteNome: texto(registro.clientSupplierName) || 'Sem cliente',
      produtoId: texto(item.productId),
      produtoNome: texto(item.name),
      produtoCodigo: texto(item.sku),
      cor: texto(item.classValueName),
      chassi: texto(item.chassi),
      quantidade: n(item.quantity),
      valorUnitario: n(item.unitPrice),
      desconto,
      valorTotal: cent(valorBruto - desconto),
      status: statusNormalizado,
      statusRotulo: (meta && meta.label) || SalesStatus.rotulo(statusNormalizado),
      cancelada: SalesStatus.ehCancelado(statusNormalizado)
    };
  });
}

/**
 * Aplica ESCOPO e filtros. O escopo vem primeiro e não é negociável: os filtros
 * só conseguem estreitar o que o escopo já permitiu, nunca alargar.
 */
function filtrar(linhas, filtros, escopo) {
  const permitidos = escopoLib.vendedoresPermitidos(escopo, filtros.vendedorId);
  const de = texto(filtros.dataDe);
  const ate = texto(filtros.dataAte);
  const cliente = texto(filtros.clienteId);
  const produto = texto(filtros.produtoId);
  const status = texto(filtros.status) || STATUS_PADRAO;
  const tipo = texto(filtros.tipo) || 'order';
  const busca = semAcento(filtros.busca);

  return linhas.filter((linha) => {
    // 1. o escopo — sempre primeiro, sempre por cima do que a tela pediu.
    if (permitidos !== null && !permitidos.includes(linha.vendedorId)) return false;

    if (tipo !== 'todos' && linha.tipo !== tipo) return false;
    if (de && linha.data < de) return false;
    if (ate && linha.data > ate) return false;
    if (cliente && linha.clienteId !== cliente) return false;
    if (produto && linha.produtoId !== produto) return false;

    if (status === STATUS_PADRAO) {
      if (linha.cancelada) return false;
    } else if (status !== 'todos' && linha.status !== status) {
      return false;
    }

    if (busca) {
      const alvo = semAcento([
        linha.pedidoCodigo, linha.clienteNome, linha.produtoNome,
        linha.produtoCodigo, linha.vendedorNome, linha.chassi
      ].join(' '));
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/**
 * Os indicadores do topo, calculados SOBRE O CONJUNTO FILTRADO INTEIRO — nunca
 * sobre a página. Card que só somasse a página mostraria um faturamento que
 * muda ao virar de página, e ninguém confiaria no número de novo.
 */
function indicadoresDe(linhas) {
  const pedidos = new Set();
  const clientes = new Set();
  const produtos = new Set();
  let faturamento = 0;
  let itens = 0;
  let desconto = 0;

  for (const linha of linhas) {
    pedidos.add(linha.pedidoId);
    if (linha.clienteId) clientes.add(linha.clienteId);
    if (linha.produtoId) produtos.add(linha.produtoId);
    faturamento += linha.valorTotal;
    desconto += linha.desconto;
    itens += linha.quantidade;
  }

  const totalPedidos = pedidos.size;
  return {
    faturamento: cent(faturamento),
    pedidos: totalPedidos,
    clientes: clientes.size,
    produtos: produtos.size,
    itens: cent(itens),
    desconto: cent(desconto),
    // Ticket médio é por PEDIDO, não por linha: é quanto vale uma venda, que é
    // a pergunta que se faz. Dividir por linha responderia "quanto vale um item
    // de uma venda", que não interessa a ninguém.
    ticketMedio: totalPedidos ? cent(faturamento / totalPedidos) : 0
  };
}

/**
 * O agrupamento por vendedor. Sai dos DADOS, nunca de uma lista escrita à mão:
 * vendedor novo que fecha a primeira venda aparece aqui na mesma hora, e
 * vendedor que não vendeu no período simplesmente não aparece.
 */
function agruparPorVendedor(linhas) {
  const mapa = new Map();
  for (const linha of linhas) {
    const chave = linha.vendedorId || '';
    if (!mapa.has(chave)) {
      mapa.set(chave, { vendedorId: chave, vendedorNome: linha.vendedorNome, linhas: [] });
    }
    mapa.get(chave).linhas.push(linha);
  }
  return [...mapa.values()]
    .map((grupo) => ({ ...grupo, indicadores: indicadoresDe(grupo.linhas) }))
    .sort((a, b) => b.indicadores.faturamento - a.indicadores.faturamento);
}

function ordenar(linhas, ordem, direcao) {
  const comparador = ORDENACOES[ordem] || ORDENACOES.data;
  const sinal = direcao === 'asc' ? 1 : -1;
  // slice() antes de sort(): sort ordena no lugar, e ordenar o array recebido
  // mexeria no conjunto de onde os indicadores acabaram de sair.
  return linhas.slice().sort((a, b) => {
    const r = comparador(a, b);
    // Empate cai para o pedido, para a ordem não dançar entre dois carregamentos
    // com os mesmos dados.
    return r !== 0 ? r * sinal : n(a.pedidoCodigo) - n(b.pedidoCodigo);
  });
}

/**
 * O relatório inteiro. Uma chamada, um conjunto de dados, quatro saídas.
 */
function montarRelatorio({ registros, filtros = {}, escopo }) {
  const todas = (Array.isArray(registros) ? registros : []).flatMap(linhasDoRegistro);
  const filtradas = filtrar(todas, filtros, escopo);

  const ordenadas = ordenar(filtradas, filtros.ordem, filtros.direcao);
  const porPagina = Math.min(200, Math.max(1, n(filtros.porPagina) || 25));
  const paginas = Math.max(1, Math.ceil(ordenadas.length / porPagina));
  const pagina = Math.min(paginas, Math.max(1, n(filtros.pagina) || 1));
  const inicio = (pagina - 1) * porPagina;

  return {
    escopo: {
      tipo: escopo.tipo,
      rotulo: escopo.rotulo,
      podeEscolherVendedor: escopo.podeEscolherVendedor,
      motivo: escopo.motivo
    },
    indicadores: indicadoresDe(filtradas),
    // A tabela é a página; tudo o mais é o conjunto inteiro.
    linhas: ordenadas.slice(inicio, inicio + porPagina),
    porVendedor: agruparPorVendedor(filtradas),
    // Os gráficos saem de `filtradas`, o MESMO array dos indicadores e do
    // agrupamento. É a diferença entre um gráfico que ilustra o relatório e um
    // que contradiz o card logo acima dele.
    serie: serieMensal(filtradas),
    topProdutos: ranking(filtradas, 'produtoId', 'produtoNome'),
    topClientes: ranking(filtradas, 'clienteId', 'clienteNome'),
    paginacao: { pagina, paginas, porPagina, total: ordenadas.length },
    // As opções dos filtros saem do que o usuário PODE ver — um vendedor comum
    // não recebe a lista de clientes dos colegas nem para preencher um <select>.
    opcoes: opcoesDe(todas, escopo)
  };
}

/**
 * Faturamento mês a mês, para o gráfico de evolução.
 *
 * A data vem como 'AAAA-MM-DD', então o mês é um corte de string — nada de
 * `new Date()`, que interpretaria a data no fuso do servidor e jogaria a venda
 * do dia 1º para o mês anterior em metade do planeta.
 */
function serieMensal(linhas) {
  const meses = new Map();
  for (const linha of linhas) {
    const mes = texto(linha.data).slice(0, 7);
    if (!mes) continue;
    meses.set(mes, (meses.get(mes) || 0) + linha.valorTotal);
  }
  return [...meses.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mes, valor]) => ({
      label: `${mes.slice(5, 7)}/${mes.slice(0, 4)}`,
      faturamento: cent(valor)
    }));
}

/** Os maiores por faturamento — produtos, clientes, o que for. */
function ranking(linhas, chaveId, chaveNome, limite = 8) {
  const mapa = new Map();
  for (const linha of linhas) {
    const id = linha[chaveId];
    if (!id) continue;
    const atual = mapa.get(id) || { id, label: linha[chaveNome], valor: 0, quantidade: 0 };
    atual.valor = cent(atual.valor + linha.valorTotal);
    atual.quantidade += linha.quantidade;
    mapa.set(id, atual);
  }
  return [...mapa.values()].sort((a, b) => b.valor - a.valor).slice(0, limite);
}

/**
 * As listas que alimentam os <select> da barra de filtros.
 *
 * Saem do universo PERMITIDO (todas as linhas que o escopo deixa ver), e não do
 * conjunto já filtrado — senão escolher um cliente esvaziaria a lista de
 * clientes e não daria para trocar de escolha sem limpar tudo.
 */
function opcoesDe(todas, escopo) {
  const permitidas = todas.filter((linha) => escopoLib.vendaVisivel(escopo, linha.vendedorId));
  const unicos = (chaveId, chaveNome) => {
    const mapa = new Map();
    for (const linha of permitidas) {
      const id = linha[chaveId];
      if (!id || mapa.has(id)) continue;
      mapa.set(id, { id, nome: linha[chaveNome] });
    }
    return [...mapa.values()].sort((a, b) => texto(a.nome).localeCompare(texto(b.nome), 'pt-BR'));
  };
  return {
    vendedores: unicos('vendedorId', 'vendedorNome'),
    clientes: unicos('clienteId', 'clienteNome'),
    produtos: unicos('produtoId', 'produtoNome'),
    status: [...new Set(permitidas.map((l) => l.status))]
      .map((s) => ({ id: s, nome: SalesStatus.rotulo(s) }))
      .sort((a, b) => texto(a.nome).localeCompare(texto(b.nome), 'pt-BR'))
  };
}

// O terceiro campo diz o TIPO da coluna, e ele muda a formatacao: dinheiro sai
// sempre com dois decimais (planilha de venda sem centavo nao serve para
// conferir), quantidade sai como esta' (3 pecas nao e' "3,00 pecas").
const COLUNAS_CSV = [
  ['Data', (l) => l.data, 'texto'],
  ['Pedido', (l) => l.pedidoCodigo, 'texto'],
  ['Vendedor', (l) => l.vendedorNome, 'texto'],
  ['Cliente', (l) => l.clienteNome, 'texto'],
  ['Produto', (l) => l.produtoNome, 'texto'],
  ['Código do produto', (l) => l.produtoCodigo, 'texto'],
  ['Quantidade', (l) => l.quantidade, 'numero'],
  ['Valor unitário', (l) => l.valorUnitario, 'dinheiro'],
  ['Desconto', (l) => l.desconto, 'dinheiro'],
  ['Valor total', (l) => l.valorTotal, 'dinheiro'],
  ['Status', (l) => l.statusRotulo, 'texto']
];

/**
 * CSV que o Excel abre com duplo clique, sem passar pelo assistente de
 * importação. Três detalhes fazem isso funcionar, e nenhum é decorativo:
 *
 *   1. separador PONTO-E-VÍRGULA — no Windows em português, o Excel usa a
 *      vírgula como separador DECIMAL e só reconhece `;` entre colunas;
 *   2. vírgula decimal nos números, pelo mesmo motivo: "1.234.56" com ponto
 *      chega como texto e não soma;
 *   3. BOM no início — sem ele o Excel lê UTF-8 como ANSI e todo "Orçamento"
 *      vira "OrÃ§amento".
 *
 * As linhas que entram aqui são as que a função acima já filtrou pelo escopo.
 * O CSV não tem caminho próprio até os dados, e é isso que impede a exportação
 * de trazer o que a tela não mostrava.
 */
function montarCsv(linhas) {
  const numero = (v) => String(cent(v)).replace('.', ',');

  const celula = (v) => {
    const s = texto(v);
    // Aspas dobradas: é como o formato escapa aspas dentro de um campo.
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const corpo = linhas.map((linha) => COLUNAS_CSV.map(([rotulo, ler, tipo]) => {
    const valor = ler(linha);
    if (tipo === 'dinheiro') return cent(valor).toFixed(2).replace('.', ',');
    if (tipo === 'numero') return numero(valor);
    return celula(valor);
  }).join(';'));
  return '﻿' + [COLUNAS_CSV.map(([rotulo]) => rotulo).join(';'), ...corpo].join('\r\n') + '\r\n';
}

module.exports = {
  STATUS_PADRAO,
  ORDENACOES,
  COLUNAS_CSV,
  linhasDoRegistro,
  filtrar,
  indicadoresDe,
  agruparPorVendedor,
  serieMensal,
  ranking,
  ordenar,
  montarRelatorio,
  montarCsv
};
