// MEU PAINEL — as vendas de quem está logado, e só delas.
//
// Uma tela por usuário, sem seletor de vendedor: o painel responde "o que EU
// vendi". O escopo vem de escopoPessoal() (lib/relatorios-escopo.js), que é a
// única função autorizada a dizer de quem são as vendas — e que, ao contrário
// de escopoDeVendas(), nunca devolve "sem restrição" nem para administrador.
//
// POR QUE É UM ARQUIVO PURO, DE NOVO
// ----------------------------------
// Mesmo motivo de lib/relatorios-vendas.js: sendo puro, dá para provar num
// teste — sem servidor, sem banco — que não existe combinação de parâmetros que
// faça um vendedor ver a venda do colega. Controle de acesso que só é
// verificável abrindo a tela não é verificável.
//
// A LINHA É O PEDIDO, NÃO O ITEM
// ------------------------------
// Aqui é o oposto do Relatório de Vendas, e de propósito. O que foi pedido é
// "pedido / cliente / número da NF que aquele pedido gerou" — as três colunas
// vivem no PEDIDO, não no item. Um pedido com três produtos é uma linha só, com
// uma nota só.
//
// A consequência é que o valor da linha é o total do pedido (`amount`), que
// inclui frete, despesas e serviços. O Relatório de Vendas soma item a item e
// NÃO inclui essas parcelas — então os dois números divergem, e isso é
// correto: são perguntas diferentes ("quanto o cliente pagou neste pedido" x
// "quanto saiu de produto"). O rótulo do card diz "Total vendido", que é o
// mesmo nome e a mesma conta do Painel Vendedor.
//
// ORÇAMENTO NÃO ENTRA
// -------------------
// "Venda realizada" é pedido. Orçamento é proposta, não gera NF-e e encheria a
// tabela de linhas com a coluna NF-e vazia para sempre. Quem quer ver os
// orçamentos tem a tela Pedidos e Orçamentos, que mostra os dois.
//
// CANCELADO APARECE E NÃO SOMA
// ----------------------------
// Pedido cancelado continua no banco e continua sendo um fato — sumir com ele
// da tabela faria a pessoa procurar um pedido que existe. Ele aparece, com o
// selo vermelho, e fica FORA dos totais. Para os dois lados fecharem, existe um
// card próprio de cancelados: soma dos ativos mais soma dos cancelados dá a
// soma da coluna Valor. Card que não reconcilia com a tabela embaixo dele é o
// defeito que esta separação existe para impedir.

const SalesStatus = require('../public/modules/shared/sales_status');
const escopoLib = require('./relatorios-escopo');

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const cent = (v) => Math.round(n(v) * 100) / 100;
const texto = (v) => String(v === null || v === undefined ? '' : v).trim();
const dia = (v) => texto(v).slice(0, 10);

/**
 * Um pedido serializado (serializeSalesRecord) vira uma linha da tabela.
 *
 * `nfeNumero` já vem resolvido de lá: o registro guarda o id da nota, que é um
 * uuid e não diz nada a quem lê. Aqui só se decide o que fazer quando ele está
 * vazio — e a resposta é string vazia, nunca "0" nem "-", porque a tela precisa
 * conseguir distinguir "sem nota" de "nota de número zero".
 */
function linhaDoPedido(registro) {
  const status = SalesStatus.normalizar(registro.status, registro.type);
  const numero = texto(registro.nfeNumero);
  return {
    id: texto(registro.id),
    pedido: texto(registro.code),
    cliente: texto(registro.customer) || '-',
    // Duas informações, e não uma: o número é o que a pessoa lê, o id é o que a
    // tela usa para abrir a nota quando se clica na linha.
    nfeNumero: numero,
    nfeId: texto(registro.nfeId),
    temNota: Boolean(numero || texto(registro.nfeId)),
    valor: cent(registro.amount),
    data: dia(registro.date),
    status,
    statusRotulo: SalesStatus.rotulo(status, registro.type),
    cancelado: SalesStatus.ehCancelado(status, registro.type),
    faturado: SalesStatus.geraFinanceiro(status, registro.type)
  };
}

/**
 * O RECORTE DE ACESSO, e ele acontece antes de qualquer outra coisa.
 *
 * Fica dentro desta função — e não no chamador — para que não exista caminho
 * para a tabela, para os cards ou para uma exportação futura que não passe por
 * `vendaVisivel`. Esquecer de filtrar deixa de ser possível: não há por onde
 * pegar as linhas sem antes passar o escopo.
 */
function linhasVisiveis(registros, escopo) {
  return (Array.isArray(registros) ? registros : [])
    .filter((r) => texto(r.type) === 'order')
    .filter((r) => escopoLib.vendaVisivel(escopo, r.sellerId))
    .map(linhaDoPedido);
}

/** Período. Vazio dos dois lados = tudo; um lado só = aberto para aquele lado. */
function filtrarPeriodo(linhas, filtros = {}) {
  const de = dia(filtros.dataDe);
  const ate = dia(filtros.dataAte);
  return linhas.filter((l) => {
    if (de && (!l.data || l.data < de)) return false;
    if (ate && (!l.data || l.data > ate)) return false;
    return true;
  });
}

/** Mais recente primeiro; empate desempatado pelo número do pedido, decrescente. */
function ordenar(linhas) {
  return linhas.slice().sort((a, b) => {
    const porData = texto(b.data).localeCompare(texto(a.data));
    if (porData !== 0) return porData;
    return n(b.pedido) - n(a.pedido);
  });
}

/**
 * Os cards, tirados DAS MESMAS LINHAS que a tabela recebe.
 *
 * A conta de reconciliação que o desenho promete:
 *   valorTotal (ativos) + valorCancelado = soma da coluna Valor da tabela
 */
function indicadores(linhas) {
  const ativos = linhas.filter((l) => !l.cancelado);
  const cancelados = linhas.filter((l) => l.cancelado);
  const valorTotal = cent(ativos.reduce((s, l) => s + l.valor, 0));
  const faturados = ativos.filter((l) => l.faturado);
  const comNota = ativos.filter((l) => l.temNota);
  return {
    pedidos: ativos.length,
    valorTotal,
    ticketMedio: ativos.length ? cent(valorTotal / ativos.length) : 0,
    faturados: faturados.length,
    valorFaturado: cent(faturados.reduce((s, l) => s + l.valor, 0)),
    comNota: comNota.length,
    semNota: ativos.length - comNota.length,
    cancelados: cancelados.length,
    valorCancelado: cent(cancelados.reduce((s, l) => s + l.valor, 0)),
    // Data da venda mais recente que entrou na conta. É o que responde à
    // pergunta "o painel está zerado por defeito ou eu não vendo desde maio".
    ultimaVenda: ativos.length ? ordenar(ativos)[0].data : ''
  };
}

/**
 * O painel inteiro.
 *
 * @param registros  pedidos e orçamentos JÁ serializados (serializeSalesRecord)
 * @param escopo     saída de escopoLib.escopoPessoal(usuario)
 * @param filtros    { dataDe, dataAte }
 */
function montarPainel({ registros, escopo, filtros = {} }) {
  const linhas = ordenar(filtrarPeriodo(linhasVisiveis(registros, escopo), filtros));
  return {
    escopo: {
      tipo: escopo ? escopo.tipo : escopoLib.NENHUM,
      rotulo: (escopo && escopo.rotulo) || 'Nenhuma venda',
      motivo: (escopo && escopo.motivo) || '',
      // Um booleano só para a tela não ter que reimplementar a comparação com
      // NENHUM e errar o sinal.
      temAcesso: Boolean(escopo && escopo.tipo !== escopoLib.NENHUM)
    },
    filtros: { dataDe: dia(filtros.dataDe), dataAte: dia(filtros.dataAte) },
    indicadores: indicadores(linhas),
    vendas: linhas
  };
}

module.exports = {
  linhaDoPedido,
  linhasVisiveis,
  filtrarPeriodo,
  ordenar,
  indicadores,
  montarPainel
};
