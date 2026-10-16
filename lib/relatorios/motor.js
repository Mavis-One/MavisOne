/**
 * O MOTOR DOS RELATÓRIOS DO CATÁLOGO.
 *
 * O módulo Relatórios tinha quatro telas, cada uma montada à mão. O Viper tem
 * ~110, em 13 grupos, e o usuário pediu os grupos (02/10/2026). Escrever 60
 * telas à mão daria 60 jeitos de filtrar, totalizar e exportar — e o que a
 * exportação mostra discordaria da tela em algum deles, em silêncio.
 *
 * Então um relatório é uma DEFINIÇÃO (lib/relatorios/<grupo>.js):
 *
 *   {
 *     key, grupo, titulo,
 *     filtros: ['periodo', 'deposito', ...],   o que a tela oferece
 *     periodoPadrao: 'mes' | 'ano' | '12meses', período quando nada foi pedido
 *     escolhas: [{ campo, rotulo, itens: [[valor, rotulo], ...] }],
 *                                              listas fixas do próprio relatório
 *                                              ("Filtrar por", "Situação"...)
 *     colunas: [{ campo, rotulo, tipo }],      tipo diz formato e alinhamento
 *     totais: ['campo', ...] | 'numericas',    o que a linha de total soma
 *     executar: async (ctx) => linhas | { colunas, linhas }
 *   }
 *
 * e este arquivo é o resto: normaliza os filtros, roda, soma e gera o CSV. A
 * tela e o arquivo saem da MESMA execução, com os mesmos filtros.
 *
 * Puro: não conhece banco nem HTTP. O `sql` chega pronto no contexto.
 */

const csv = require('../csv');
const { criarPlanilha } = require('../xlsx');

const TIPOS_NUMERICOS = new Set(['moeda', 'numero', 'quantidade', 'percentual', 'inteiro']);

/** A data de hoje no Brasil. O VPS roda em UTC: às 22h de lá já é amanhã. */
function hojeNoBrasil(agora) {
  const base = agora ? new Date(agora) : new Date();
  return new Date(base.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function dataIso(valor) {
  const s = String(valor || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function texto(valor) {
  return String(valor ?? '').trim();
}

/**
 * As escolhas do relatório. Só passa valor que está na lista: o que vem da
 * tela vai parar dentro de um CASE no SQL, e um valor fora dela tem de virar o
 * padrão (o primeiro da lista), não um erro nem um texto livre.
 */
function escolhasDe(def, bruto) {
  const saida = {};
  for (const e of def.escolhas || []) {
    const valores = e.itens.map(([valor]) => valor);
    const pedido = texto(bruto[e.campo]);
    saida[e.campo] = valores.includes(pedido) ? pedido : valores[0];
  }
  return saida;
}

/** O 1º dia do mês, `meses` meses antes do mês de `hoje`. */
function inicioDoMes(hoje, meses) {
  const d = new Date(`${hoje.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - meses);
  return d.toISOString().slice(0, 10);
}

function inteiro(valor, padrao, minimo, maximo) {
  const n = Math.trunc(Number(valor));
  if (!Number.isFinite(n) || n <= 0) return padrao;
  return Math.min(Math.max(n, minimo), maximo);
}

/**
 * Os filtros que chegam da tela, já conferidos. Data inválida vira vazia, e
 * não erro: um parâmetro torto na URL não pode derrubar o relatório.
 */
function normalizarFiltros(def, bruto = {}, agora) {
  const hoje = hojeNoBrasil(agora);
  const usa = (f) => (def.filtros || []).includes(f);
  let de = dataIso(bruto.de);
  let ate = dataIso(bruto.ate);
  if (usa('periodo') && !de && !ate) {
    if (def.periodoPadrao === 'mes') { de = `${hoje.slice(0, 8)}01`; ate = hoje; }
    if (def.periodoPadrao === 'ano') { de = `${hoje.slice(0, 4)}-01-01`; ate = hoje; }
    // Os últimos 12 meses com o atual: em outubro de 2026, de novembro de 2025
    // até hoje — e não o ano civil, que em janeiro teria um mês só.
    if (def.periodoPadrao === '12meses') { de = inicioDoMes(hoje, 11); ate = hoje; }
  }
  if (de && ate && de > ate) [de, ate] = [ate, de];
  const anoPedido = Number(bruto.ano);
  return {
    hoje,
    de,
    ate,
    ano: Number.isInteger(anoPedido) && anoPedido >= 2000 && anoPedido <= 2100 ? anoPedido : Number(hoje.slice(0, 4)),
    data: dataIso(bruto.data) || hoje,
    dias: inteiro(bruto.dias, def.diasPadrao || 90, 1, 3650),
    depositoId: texto(bruto.depositoId),
    contaId: texto(bruto.contaId),
    // O banco é o NOME que lib/banco-da-conta.js deduz ("Itaú", "Sicoob").
    banco: texto(bruto.banco),
    vendedorId: texto(bruto.vendedorId),
    filial: texto(bruto.filial),
    estabelecimentoId: texto(bruto.estabelecimentoId),
    ...escolhasDe(def, bruto)
  };
}

/** Nomes que as escolhas não podem usar: são os filtros comuns. */
const CAMPOS_RESERVADOS = new Set(['hoje', 'de', 'ate', 'ano', 'data', 'dias', 'depositoId', 'contaId', 'banco', 'vendedorId', 'filial', 'estabelecimentoId']);

const centavos = (n) => Math.round(Number(n || 0) * 100) / 100;

function camposDeTotal(def, colunas) {
  if (def.totais === 'numericas') {
    return colunas.filter((c) => TIPOS_NUMERICOS.has(c.tipo) && c.tipo !== 'percentual' && !c.semTotal).map((c) => c.campo);
  }
  // Coluna que a execução não devolveu (a escolha trocou as colunas) não tem
  // total: somaria um campo que nenhuma linha traz.
  return Array.isArray(def.totais) ? def.totais.filter((campo) => colunas.some((c) => c.campo === campo)) : [];
}

/**
 * Roda um relatório. `ctx` traz o que a definição precisa: `sql(texto,
 * parametros)` que devolve linhas, o `escopo` de vendas, `data` (o db.json, para
 * as poucas coleções que ainda moram lá) e as listas de apoio.
 */
async function executar(def, filtros, ctx = {}) {
  const saida = await def.executar({ ...ctx, f: filtros });
  const colunas = (saida && !Array.isArray(saida) && saida.colunas) || def.colunas;
  const linhas = (Array.isArray(saida) ? saida : (saida && saida.linhas)) || [];
  const totais = {};
  for (const campo of camposDeTotal(def, colunas)) {
    totais[campo] = centavos(linhas.reduce((soma, l) => soma + Number(l[campo] || 0), 0));
  }
  return { key: def.key, grupo: def.grupo, titulo: def.titulo, colunas, linhas, totais, filtros };
}

function dataBr(iso) {
  const s = String(iso || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : String(iso || '');
}

function celulaCsv(coluna, valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (coluna.tipo === 'moeda' || coluna.tipo === 'percentual') return csv.numero(valor, 2);
  if (coluna.tipo === 'inteiro') return csv.numero(valor, 0);
  if (coluna.tipo === 'quantidade' || coluna.tipo === 'numero') return csv.numero(valor);
  if (coluna.tipo === 'data') return csv.celula(dataBr(valor));
  return csv.celula(valor);
}

/** O arquivo: as mesmas colunas da tela, todas as linhas, e a linha de total. */
function paraCsv(resultado) {
  const { colunas, linhas, totais } = resultado;
  const corpo = linhas.map((l) => colunas.map((c) => celulaCsv(c, l[c.campo])));
  if (Object.keys(totais || {}).length) {
    corpo.push(colunas.map((c, i) => {
      if (Object.prototype.hasOwnProperty.call(totais, c.campo)) return celulaCsv(c, totais[c.campo]);
      return i === 0 ? csv.celula('Total') : '';
    }));
  }
  return csv.documento(colunas.map((c) => c.rotulo), corpo);
}

/** Nome do arquivo exportado: o título sem acento, e a data. */
function nomeDoArquivo(resultado, extensao = 'csv') {
  const base = String(resultado.titulo || resultado.key)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${base}-${resultado.filtros.hoje}.${extensao}`;
}

// O TIPO DA COLUNA DO RELATÓRIO -> o tipo da célula no Excel (lib/xlsx.js).
// Código fica texto: "0007" não pode virar 7.
const TIPO_NA_PLANILHA = {
  moeda: 'moeda', percentual: 'percentual', inteiro: 'inteiro',
  quantidade: 'numero', numero: 'numero', data: 'data'
};

// A largura que faz o dado aparecer inteiro: o maior entre o título e o que as
// primeiras linhas trazem, com folga. Texto muito longo fica em ~50 e quebra
// dentro da célula (a linha cresce), em vez de esticar a folha.
function larguraDaColuna(coluna, linhas) {
  const amostra = linhas.slice(0, 500).map((l) => l[coluna.campo]);
  const tamanho = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    if (coluna.tipo === 'data') return 10;
    if (coluna.tipo === 'moeda') return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).length + 3;
    if (TIPOS_NUMERICOS.has(coluna.tipo)) return String(Number(v).toLocaleString('pt-BR')).length + 1;
    return String(v).length;
  };
  const maior = Math.max(String(coluna.rotulo || '').length, ...amostra.map(tamanho));
  const minimo = TIPOS_NUMERICOS.has(coluna.tipo) ? 12 : 8;
  return Math.min(50, Math.max(minimo, maior + 2));
}

/**
 * A PLANILHA DO RELATÓRIO (16/10/2026, pedido do usuário: "um relatório que eu
 * baixei direto do sistema ainda está desconfigurado, gostaria de ter um padrão
 * aonde os dados estejam todos visíveis"). O CSV abria com as colunas estreitas
 * e os números sem formato. A planilha leva as MESMAS colunas, linhas e total
 * do CSV, mas formatada (lib/xlsx.js): cada coluna na largura do que traz,
 * texto longo quebrando na célula, R$, datas e percentuais com o formato
 * deles, cabeçalho fixo e filtro, e a folha pronta para imprimir — deitada, na
 * largura da página, com o nome do relatório e o período no alto e "Emitido
 * em ... · Página X de Y" no pé. Vale para todos os relatórios do catálogo e
 * para o Personalizado.
 */
function paraXlsx(resultado, { emitidoEm = '' } = {}) {
  const { colunas, linhas, totais, filtros = {} } = resultado;
  const temTotal = Object.keys(totais || {}).length > 0;
  const periodo = filtros.de && filtros.ate ? `Período: ${dataBr(filtros.de)} a ${dataBr(filtros.ate)}` : '';
  return criarPlanilha([{
    nome: String(resultado.titulo || resultado.key || 'Relatório'),
    colunas: colunas.map((c) => ({
      titulo: c.rotulo,
      tipo: TIPO_NA_PLANILHA[c.tipo] || 'texto',
      largura: larguraDaColuna(c, linhas),
      somar: temTotal && Object.prototype.hasOwnProperty.call(totais, c.campo)
    })),
    linhas: linhas.map((l) => colunas.map((c) => l[c.campo])),
    total: temTotal ? 'Total' : '',
    impressao: {
      titulo: String(resultado.titulo || resultado.key || 'Relatório'),
      altoDireita: periodo,
      rodapeEsquerda: emitidoEm ? `Emitido em ${emitidoEm}` : '',
      paginas: true
    }
  }]);
}

module.exports = { normalizarFiltros, executar, paraCsv, paraXlsx, nomeDoArquivo, hojeNoBrasil, TIPOS_NUMERICOS, CAMPOS_RESERVADOS };
