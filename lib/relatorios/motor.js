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
const { montarPdfDoRelatorio } = require('../../public/modules/shared/pdf_relatorio');

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

/** Nomes que as escolhas não podem usar: são os filtros comuns e os da visão. */
const CAMPOS_RESERVADOS = new Set(['hoje', 'de', 'ate', 'ano', 'data', 'dias', 'depositoId', 'contaId', 'banco', 'vendedorId', 'filial', 'estabelecimentoId',
  'procurar', 'ordenarPor', 'sentido', 'separarPor']);

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

// ---------------------------------------------------------------------------
// A VISÃO DA TABELA (04/11/2026, pedido do usuário: os relatórios "completos em
// questão de ordenação, filtragem, separação, download"). Três coisas sobre o
// resultado JÁ executado — e por isso iguais para os 84 do catálogo e para o
// Personalizado, sem tocar em definição nenhuma:
//
//   procurar    — fica a linha em que alguma coluna contém o texto (sem acento
//                 nem caixa; data também como dd/mm/aaaa, número também com
//                 vírgula). Os totais passam a ser só das linhas que ficaram.
//   ordenarPor  — a coluna e o `sentido` (asc|desc). Vazio sempre no fim.
//   separarPor  — a coluna de texto ou de data (`campo:mes` = pelo mês) que
//                 separa as linhas em grupos, cada um com o seu subtotal.
//
// O servidor aplica DEPOIS de tirar o custo de quem não é administrador: não
// se ordena nem se separa por coluna que a pessoa não vê. A tela e os três
// arquivos (CSV, planilha, PDF) saem do mesmo resultado com a visão.
// ---------------------------------------------------------------------------
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const vazio = (v) => v === null || v === undefined || v === '';
const COLACAO = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** O que a busca enxerga numa célula: o valor e o jeito que a tela o mostra. */
function textoParaProcurar(coluna, valor) {
  if (vazio(valor)) return '';
  if (coluna.tipo === 'data') return `${String(valor).slice(0, 10)} ${dataBr(valor)}`;
  if (TIPOS_NUMERICOS.has(coluna.tipo)) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return String(valor);
    return `${n} ${n.toFixed(2).replace('.', ',')} ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return String(valor);
}

/** Compara duas linhas pela coluna: número como número, data como data, texto em português. */
function compararPor(coluna, sentido) {
  const fator = sentido === 'desc' ? -1 : 1;
  return (a, b) => {
    const va = a[coluna.campo];
    const vb = b[coluna.campo];
    if (vazio(va) || vazio(vb)) return vazio(va) === vazio(vb) ? 0 : (vazio(va) ? 1 : -1);
    if (TIPOS_NUMERICOS.has(coluna.tipo)) return fator * (Number(va) - Number(vb));
    if (coluna.tipo === 'data') return fator * String(va).slice(0, 10).localeCompare(String(vb).slice(0, 10));
    return fator * COLACAO.compare(String(va), String(vb));
  };
}

/** As separações que as colunas permitem: texto pelo valor; data pelo mês ou pelo dia. */
function separacoesDe(colunas) {
  const saida = [];
  for (const c of colunas || []) {
    if (TIPOS_NUMERICOS.has(c.tipo)) continue;
    if (c.tipo === 'data') {
      saida.push({ valor: `${c.campo}:mes`, rotulo: `${c.rotulo} (mês)` });
      saida.push({ valor: c.campo, rotulo: `${c.rotulo} (dia)` });
    } else {
      saida.push({ valor: c.campo, rotulo: c.rotulo });
    }
  }
  return saida;
}

function grupoDoValor(coluna, porMes, valor) {
  if (vazio(valor)) return { chave: '', rotulo: '(sem valor)' };
  if (coluna.tipo === 'data') {
    const iso = String(valor).slice(0, 10);
    if (porMes && /^\d{4}-\d{2}/.test(iso)) return { chave: iso.slice(0, 7), rotulo: `${MESES[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}` };
    return { chave: iso, rotulo: dataBr(iso) };
  }
  return { chave: semAcento(valor).trim(), rotulo: String(valor).trim() };
}

/**
 * Devolve o resultado com a visão: `linhas` filtradas e na ordem (agrupadas,
 * quando há separação — cada grupo inteiro, em seguida), `totais` das linhas
 * que ficaram, `grupos` [{ rotulo, quantidade, totais }] na ordem das linhas,
 * `visao` (o que foi aplicado, já conferido) e `separacoes` (as opções).
 */
function aplicarVisao(resultado, pedido = {}) {
  const colunas = resultado.colunas || [];
  const procurar = texto(pedido.procurar).slice(0, 100);
  const ordenarPor = colunas.find((c) => c.campo === texto(pedido.ordenarPor)) || null;
  const sentido = pedido.sentido === 'desc' ? 'desc' : 'asc';
  const [campoSeparar, modo] = texto(pedido.separarPor).split(':');
  const colunaSeparar = colunas.find((c) => c.campo === campoSeparar && !TIPOS_NUMERICOS.has(c.tipo)) || null;
  const porMes = Boolean(colunaSeparar && colunaSeparar.tipo === 'data' && modo === 'mes');
  const visao = {
    procurar,
    ordenarPor: ordenarPor ? ordenarPor.campo : '',
    sentido,
    separarPor: colunaSeparar ? (porMes ? `${colunaSeparar.campo}:mes` : colunaSeparar.campo) : ''
  };
  const separacoes = separacoesDe(colunas);
  if (!procurar && !ordenarPor && !colunaSeparar) return { ...resultado, grupos: null, visao, separacoes };

  let linhas = resultado.linhas || [];
  if (procurar) {
    const alvo = semAcento(procurar);
    linhas = linhas.filter((l) => colunas.some((c) => semAcento(textoParaProcurar(c, l[c.campo])).includes(alvo)));
  }
  if (ordenarPor) linhas = linhas.slice().sort(compararPor(ordenarPor, sentido));

  const camposDoTotal = Object.keys(resultado.totais || {});
  const somar = (lista) => Object.fromEntries(camposDoTotal.map((campo) => [campo, centavos(lista.reduce((s, l) => s + Number(l[campo] || 0), 0))]));
  const totais = procurar ? somar(linhas) : (resultado.totais || {});

  let grupos = null;
  if (colunaSeparar) {
    const porChave = new Map();
    for (const l of linhas) {
      const g = grupoDoValor(colunaSeparar, porMes, l[colunaSeparar.campo]);
      if (!porChave.has(g.chave)) porChave.set(g.chave, { ...g, linhas: [] });
      porChave.get(g.chave).linhas.push(l);
    }
    // Os grupos na ordem da própria coluna (o sentido dela, quando é ela a
    // ordenada); "(sem valor)" por último. Dentro do grupo, a ordem pedida.
    const fator = ordenarPor && ordenarPor.campo === colunaSeparar.campo && sentido === 'desc' ? -1 : 1;
    const lista = [...porChave.values()].sort((a, b) => {
      if (!a.chave || !b.chave) return !a.chave === !b.chave ? 0 : (!a.chave ? 1 : -1);
      return fator * COLACAO.compare(a.chave, b.chave);
    });
    linhas = lista.flatMap((g) => g.linhas);
    grupos = lista.map((g) => ({ rotulo: g.rotulo, quantidade: g.linhas.length, totais: somar(g.linhas) }));
  }
  return { ...resultado, linhas, totais, grupos, visao, separacoes };
}

/** "Procurando "x" · separado por Cliente · ordenado por Valor (maior primeiro)" — para o alto do arquivo. */
function descricaoDaVisao(resultado) {
  const v = resultado.visao || {};
  const colunas = resultado.colunas || [];
  const rotulo = (campo) => (colunas.find((c) => c.campo === campo) || {}).rotulo || campo;
  const partes = [];
  if (v.procurar) partes.push(`Procurando "${v.procurar}"`);
  if (v.separarPor) {
    const [campo, modo] = v.separarPor.split(':');
    partes.push(`separado por ${rotulo(campo)}${modo === 'mes' ? ' (mês)' : ''}`);
  }
  if (v.ordenarPor) {
    const col = colunas.find((c) => c.campo === v.ordenarPor) || {};
    const desc = v.sentido === 'desc';
    const como = TIPOS_NUMERICOS.has(col.tipo) ? (desc ? 'maior primeiro' : 'menor primeiro')
      : col.tipo === 'data' ? (desc ? 'mais recente primeiro' : 'mais antiga primeiro') : (desc ? 'Z a A' : 'A a Z');
    partes.push(`ordenado por ${rotulo(v.ordenarPor)} (${como})`);
  }
  const frase = partes.join(' · ');
  return frase ? frase.charAt(0).toUpperCase() + frase.slice(1) : '';
}

/**
 * As linhas na ordem do arquivo, com o subtotal de cada grupo depois dele:
 * [{ linha }] e [{ subtotal: { rotulo, quantidade, totais }, de, ate }] (de/ate
 * são as posições, nas linhas de dado, do primeiro e do último do grupo).
 */
function linhasComSubtotais(resultado) {
  const linhas = resultado.linhas || [];
  if (!Array.isArray(resultado.grupos) || !resultado.grupos.length) return linhas.map((linha) => ({ linha }));
  const saida = [];
  let i = 0;
  for (const g of resultado.grupos) {
    const de = i;
    for (let k = 0; k < g.quantidade && i < linhas.length; k += 1, i += 1) saida.push({ linha: linhas[i] });
    saida.push({ subtotal: g, de, ate: i - 1 });
  }
  return saida;
}

const rotuloDoSubtotal = (g) => `Subtotal — ${g.rotulo} (${g.quantidade} ${g.quantidade === 1 ? 'linha' : 'linhas'})`;

function celulaCsv(coluna, valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (coluna.tipo === 'moeda' || coluna.tipo === 'percentual') return csv.numero(valor, 2);
  if (coluna.tipo === 'inteiro') return csv.numero(valor, 0);
  if (coluna.tipo === 'quantidade' || coluna.tipo === 'numero') return csv.numero(valor);
  if (coluna.tipo === 'data') return csv.celula(dataBr(valor));
  return csv.celula(valor);
}

/** O arquivo: as mesmas colunas da tela, todas as linhas (com o subtotal de cada grupo), e a linha de total. */
function paraCsv(resultado) {
  const { colunas, totais } = resultado;
  const corpo = linhasComSubtotais(resultado).map((item) => {
    if (!item.subtotal) return colunas.map((c) => celulaCsv(c, item.linha[c.campo]));
    return colunas.map((c, i) => {
      if (Object.prototype.hasOwnProperty.call(item.subtotal.totais, c.campo)) return celulaCsv(c, item.subtotal.totais[c.campo]);
      return i === 0 ? csv.celula(rotuloDoSubtotal(item.subtotal)) : '';
    });
  });
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
  // O SUBTOTAL DE CADA GRUPO (04/11/2026) é uma fórmula SUBTOTAL() sobre as
  // linhas dele — e o total do pé, SUBTOTAL() também, não conta os
  // subtotais: o Excel soma o que é dado, e o filtro da planilha continua
  // valendo.
  const itens = linhasComSubtotais(resultado);
  const posicao = [];
  itens.forEach((item, i) => { if (!item.subtotal) posicao.push(i); });
  return criarPlanilha([{
    nome: String(resultado.titulo || resultado.key || 'Relatório'),
    colunas: colunas.map((c) => ({
      titulo: c.rotulo,
      tipo: TIPO_NA_PLANILHA[c.tipo] || 'texto',
      largura: larguraDaColuna(c, linhas),
      somar: temTotal && Object.prototype.hasOwnProperty.call(totais, c.campo)
    })),
    linhas: itens.map((item) => (item.subtotal
      ? { subtotal: rotuloDoSubtotal(item.subtotal), de: posicao[item.de], ate: posicao[item.ate] }
      : colunas.map((c) => item.linha[c.campo]))),
    total: temTotal ? 'Total' : '',
    impressao: {
      titulo: String(resultado.titulo || resultado.key || 'Relatório'),
      altoDireita: [descricaoDaVisao(resultado), periodo].filter(Boolean).join(' · '),
      rodapeEsquerda: emitidoEm ? `Emitido em ${emitidoEm}` : '',
      paginas: true
    }
  }]);
}

/**
 * O PDF do relatório (17/10/2026, pedido do usuário: salvar em PDF "com o
 * mesmo formato que aparece atualmente, porém só salva em Excel"). Mesmo
 * resultado da planilha — todas as linhas, colunas e totais —, desenhado por
 * public/modules/shared/pdf_relatorio.js.
 */
function paraPdf(resultado, { emitidoEm = '' } = {}) {
  const { colunas, totais, filtros = {} } = resultado;
  const periodo = filtros.de && filtros.ate ? `Período: ${dataBr(filtros.de)} a ${dataBr(filtros.ate)}` : '';
  // O subtotal do grupo vai como linha destacada (`__destaque` é o texto da
  // primeira coluna; pdf_relatorio.js desenha em negrito, com fundo).
  const linhas = linhasComSubtotais(resultado).map((item) => (item.subtotal
    ? { ...item.subtotal.totais, __destaque: rotuloDoSubtotal(item.subtotal) }
    : item.linha));
  return Buffer.from(montarPdfDoRelatorio({
    titulo: String(resultado.titulo || resultado.key || 'Relatório'),
    subtitulo: [periodo, descricaoDaVisao(resultado)].filter(Boolean).join('   ·   '),
    emitidoEm,
    colunas,
    linhas,
    totais: totais || {}
  }));
}

module.exports = {
  normalizarFiltros, executar, aplicarVisao, descricaoDaVisao, paraCsv, paraXlsx, paraPdf, nomeDoArquivo, hojeNoBrasil,
  TIPOS_NUMERICOS, CAMPOS_RESERVADOS
};
