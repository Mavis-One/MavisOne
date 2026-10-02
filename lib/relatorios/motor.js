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
 *     periodoPadrao: 'mes' | 'ano',            período quando nada foi pedido
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
    vendedorId: texto(bruto.vendedorId),
    filial: texto(bruto.filial)
  };
}

const centavos = (n) => Math.round(Number(n || 0) * 100) / 100;

function camposDeTotal(def, colunas) {
  if (def.totais === 'numericas') {
    return colunas.filter((c) => TIPOS_NUMERICOS.has(c.tipo) && c.tipo !== 'percentual' && !c.semTotal).map((c) => c.campo);
  }
  return Array.isArray(def.totais) ? def.totais : [];
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
function nomeDoArquivo(resultado) {
  const base = String(resultado.titulo || resultado.key)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${base}-${resultado.filtros.hoje}.csv`;
}

module.exports = { normalizarFiltros, executar, paraCsv, nomeDoArquivo, hojeNoBrasil, TIPOS_NUMERICOS };
