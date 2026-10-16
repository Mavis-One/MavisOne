/**
 * UMA PLANILHA DO EXCEL (.xlsx), ESCRITA À MÃO (16/10/2026).
 *
 * Pedido do usuário: "um botão para baixar uma planilha já formatada" nas
 * Notas de Entrada. O CSV que o sistema já exporta (lib/csv.js) é dado puro:
 * abre sem cabeçalho destacado, sem largura de coluna, e o Excel adivinha o
 * tipo de cada célula — a chave de acesso de 44 dígitos vira 3,52E+43. Formatar
 * exige o formato do próprio Excel.
 *
 * Mesmo motivo de lib/zip.js para não trazer biblioteca: o .xlsx é um ZIP de
 * meia dúzia de XMLs (Office Open XML, ECMA-376), e a parte usada aqui é
 * pequena. O que sai:
 *   · cabeçalho em negrito, fundo escuro, primeira linha congelada e filtro;
 *   · largura por coluna;
 *   · cada célula com o tipo dela: texto (inline, nunca vira número nem
 *     fórmula), número, moeda em R$, data e data com hora;
 *   · linha de total opcional com SUBTOTAL(109), que soma só o que o filtro
 *     deixa à vista.
 *
 * Texto vai como inlineStr, sem tabela de strings compartilhadas: o arquivo
 * fica um pouco maior, e o deflate do ZIP recupera quase tudo.
 */
'use strict';

const { criarZip } = require('./zip');

// Formatos de número próprios (numFmtId a partir de 164; os menores são os
// embutidos do Excel).
const FORMATOS = {
  texto: { numFmtId: 0 },
  inteiro: { numFmtId: 1 },
  decimal: { numFmtId: 164, codigo: '#,##0.00##' },
  moeda: { numFmtId: 165, codigo: '"R$" #,##0.00' },
  moedaUnitaria: { numFmtId: 166, codigo: '"R$" #,##0.00##' },
  data: { numFmtId: 167, codigo: 'dd/mm/yyyy' },
  dataHora: { numFmtId: 168, codigo: 'dd/mm/yyyy hh:mm' }
};
const TIPOS = Object.keys(FORMATOS);
// Índices em cellXfs: 0 é o padrão, 1 o cabeçalho; depois um estilo normal e
// um em negrito (linha de total) por tipo.
const ESTILO_CABECALHO = 1;
const estiloDe = (tipo, negrito = false) => 2 + TIPOS.indexOf(tipo) * 2 + (negrito ? 1 : 0);

const escapar = (texto) => String(texto)
  // Caracteres de controle não existem em XML 1.0: o Excel recusaria o arquivo
  // inteiro por um deles vindo de um XML de fornecedor.
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function letraDaColuna(indice) {
  let n = indice + 1;
  let letras = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - 1) / 26);
  }
  return letras;
}

const DIA_ZERO_DO_EXCEL = Date.UTC(1899, 11, 30);

/**
 * Data para o número de série do Excel (dias desde 30/12/1899).
 * 'AAAA-MM-DD' é o dia como está. Data com hora (ISO ou Date) é convertida
 * para o horário de Brasília: o servidor guarda em UTC, e uma nota lançada às
 * 22h sairia no dia seguinte.
 */
function serialDaData(valor, comHora) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor).trim();
  // Só o dia puro vai direto. Com hora, mesmo em coluna de data, passa pelo
  // fuso: 01:30 UTC do dia 15 ainda é dia 14 em Brasília.
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    const [a, m, d] = texto.split('-').map(Number);
    return (Date.UTC(a, m - 1, d) - DIA_ZERO_DO_EXCEL) / 86400000;
  }
  const momento = valor instanceof Date ? valor : new Date(texto);
  if (Number.isNaN(momento.getTime())) return null;
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(momento).map((p) => [p.type, p.value]));
  const local = Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day),
    comHora ? Number(partes.hour) : 0, comHora ? Number(partes.minute) : 0, comHora ? Number(partes.second) : 0);
  return (local - DIA_ZERO_DO_EXCEL) / 86400000;
}

function celula(ref, tipo, valor, negrito = false) {
  if (valor === null || valor === undefined || valor === '') return '';
  const comoTexto = () => {
    const texto = escapar(valor);
    const preservar = /^\s|\s$/.test(texto) ? ' xml:space="preserve"' : '';
    return `<c r="${ref}" s="${estiloDe('texto', negrito)}" t="inlineStr"><is><t${preservar}>${texto}</t></is></c>`;
  };
  if (tipo === 'texto') return comoTexto();
  const numero = tipo === 'data' || tipo === 'dataHora'
    ? serialDaData(valor, tipo === 'dataHora')
    : (typeof valor === 'number' ? valor : (/^\s*-?\d+(\.\d+)?\s*$/.test(String(valor)) ? Number(valor) : NaN));
  // O que não é do tipo da coluna (nº de nota manual com letra) sai como texto,
  // em vez de sumir.
  if (numero === null || !Number.isFinite(numero)) return comoTexto();
  return `<c r="${ref}" s="${estiloDe(tipo, negrito)}"><v>${numero}</v></c>`;
}

// Nome de aba: até 31 caracteres, sem []:*?/\ — é o que o Excel aceita.
const nomeDaAba = (nome, i) => (String(nome || '').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Planilha${i + 1}`);

// Cabeçalho e rodapé DA FOLHA IMPRESSA (não aparecem na planilha). Nos códigos
// do Excel, "&" abre um comando (&C centro, &L esquerda, &R direita, &B
// negrito, &14 tamanho, &P página, &N total de páginas): o "&" do texto vira
// "&&". O Excel aceita até 255 caracteres em cada um.
function xmlDaImpressao(impressao) {
  if (!impressao) return '';
  const texto = (v) => String(v || '').replace(/&/g, '&&');
  const alto = impressao.titulo ? `&C&B&14${texto(impressao.titulo)}` : '';
  const pe = `${impressao.rodapeEsquerda ? `&L${texto(impressao.rodapeEsquerda)}` : ''}${impressao.paginas ? '&RPágina &P de &N' : ''}`;
  if (!alto && !pe) return '';
  return '<headerFooter>'
    + (alto ? `<oddHeader>${escapar(alto.slice(0, 255))}</oddHeader>` : '')
    + (pe ? `<oddFooter>${escapar(pe.slice(0, 255))}</oddFooter>` : '')
    + '</headerFooter>';
}

function xmlDaAba({ colunas, linhas, total, impressao }) {
  const ultimaColuna = letraDaColuna(colunas.length - 1);
  const ultimaLinha = linhas.length + 1;
  const cols = colunas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Number(c.largura) || 14}" customWidth="1"/>`).join('');
  // Altura fixa de duas linhas: o Excel não reajusta sozinho a altura de
  // arquivo gerado, e título que quebra ("Movimentou estoque") sairia cortado.
  const cabecalho = `<row r="1" ht="32" customHeight="1">${colunas.map((c, i) => `<c r="${letraDaColuna(i)}1" s="${ESTILO_CABECALHO}" t="inlineStr"><is><t>${escapar(c.titulo)}</t></is></c>`).join('')}</row>`;
  const corpo = linhas.map((linha, l) => {
    const r = l + 2;
    return `<row r="${r}">${colunas.map((c, i) => celula(`${letraDaColuna(i)}${r}`, c.tipo || 'texto', linha[i])).join('')}</row>`;
  }).join('');
  let rodape = '';
  if (total && linhas.length) {
    const r = ultimaLinha + 1;
    rodape = `<row r="${r}">${colunas.map((c, i) => {
      const ref = `${letraDaColuna(i)}${r}`;
      if (i === 0) return `<c r="${ref}" s="${estiloDe('texto', true)}" t="inlineStr"><is><t>${escapar(total)}</t></is></c>`;
      if (!c.somar) return '';
      const letra = letraDaColuna(i);
      return `<c r="${ref}" s="${estiloDe(c.tipo || 'decimal', true)}"><f>SUBTOTAL(109,${letra}2:${letra}${ultimaLinha})</f></c>`;
    }).join('')}</row>`;
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    // Impressão: deitada e na largura de uma folha (fitToHeight 0 = quantas
    // folhas precisar na altura). Sem isto, 18 colunas saíam em 9 folhas.
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    + `<dimension ref="A1:${ultimaColuna}${Math.max(ultimaLinha, 1)}"/>`
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + `<cols>${cols}</cols>`
    + `<sheetData>${cabecalho}${corpo}${rodape}</sheetData>`
    + `<autoFilter ref="A1:${ultimaColuna}${ultimaLinha}"/>`
    + '<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
    + '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
    + xmlDaImpressao(impressao)
    + '</worksheet>';
}

function xmlDosEstilos() {
  const proprios = TIPOS.map((t) => FORMATOS[t]).filter((f) => f.codigo);
  const numFmts = `<numFmts count="${proprios.length}">${proprios.map((f) => `<numFmt numFmtId="${f.numFmtId}" formatCode="${escapar(f.codigo)}"/>`).join('')}</numFmts>`;
  // Fontes: 0 normal, 1 cabeçalho (negrito branco), 2 negrito (total).
  const fonts = '<fonts count="3">'
    + '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>'
    + '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
    + '</fonts>';
  // Preenchimentos: os dois primeiros são obrigatórios; 2 é o do cabeçalho.
  const fills = '<fills count="3">'
    + '<fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF14202B"/><bgColor indexed="64"/></patternFill></fill>'
    + '</fills>';
  // Bordas: 0 nenhuma, 1 fina cinza-clara (dados), 2 fina com a de cima mais
  // escura (linha de total).
  const fina = (cor) => `style="thin"><color rgb="${cor}"/>`;
  const borders = '<borders count="3">'
    + '<border><left/><right/><top/><bottom/><diagonal/></border>'
    + `<border><left ${fina('FFD9D9D9')}</left><right ${fina('FFD9D9D9')}</right><top ${fina('FFD9D9D9')}</top><bottom ${fina('FFD9D9D9')}</bottom><diagonal/></border>`
    + `<border><left ${fina('FFD9D9D9')}</left><right ${fina('FFD9D9D9')}</right><top style="medium"><color rgb="FF14202B"/></top><bottom ${fina('FFD9D9D9')}</bottom><diagonal/></border>`
    + '</borders>';
  const xf = (numFmtId, fontId, fillId, borderId, alinhamento = '') => `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"`
    + `${numFmtId ? ' applyNumberFormat="1"' : ''}${fontId ? ' applyFont="1"' : ''}${fillId ? ' applyFill="1"' : ''}${borderId ? ' applyBorder="1"' : ''}`
    + (alinhamento ? ` applyAlignment="1">${alinhamento}</xf>` : '/>');
  const cellXfs = [
    xf(0, 0, 0, 0),
    xf(0, 1, 2, 0, '<alignment vertical="center" wrapText="1"/>'),
    // Texto QUEBRA dentro da célula, e a linha cresce: impresso, um nome
    // maior que a coluna sairia cortado ("SAL INFINITY PLUS COMERCIO L").
    // Tudo alinhado ao topo, para a linha de duas alturas continuar legível.
    // Na linha de total, não: o rótulo ("Total (2 lançamentos)") se estende
    // pelas células vazias ao lado, em vez de dobrar a altura da linha.
    ...TIPOS.flatMap((t) => {
      const alinhamento = t === 'texto' ? '<alignment vertical="top" wrapText="1"/>' : '<alignment vertical="top"/>';
      return [xf(FORMATOS[t].numFmtId, 0, 0, 1, alinhamento), xf(FORMATOS[t].numFmtId, 2, 0, 2, '<alignment vertical="top"/>')];
    })
  ];
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + numFmts + fonts + fills + borders
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${cellXfs.length}">${cellXfs.join('')}</cellXfs>`
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';
}

/**
 * abas: [{ nome, colunas: [{ titulo, tipo, largura, somar }], linhas: [[...]], total, impressao }]
 *   impressao (opcional): { titulo, rodapeEsquerda, paginas } — o alto e o pé
 *   de cada folha impressa (ver xmlDaImpressao).
 *   tipo: texto | inteiro | decimal | moeda | moedaUnitaria | data | dataHora
 *   total: rótulo da linha de total (na 1ª coluna); soma as colunas com `somar`.
 * Devolve o Buffer do .xlsx.
 */
function criarPlanilha(abas) {
  return criarZip(partesDaPlanilha(abas));
}

// Os arquivos de dentro do .xlsx, antes do ZIP. Separado para os testes lerem
// o XML como ficou.
function partesDaPlanilha(abas) {
  if (!Array.isArray(abas) || !abas.length) throw new Error('A planilha precisa de ao menos uma aba.');
  abas.forEach((aba) => (aba.colunas || []).forEach((c) => {
    if (c.tipo && !TIPOS.includes(c.tipo)) throw new Error(`Tipo de coluna desconhecido: ${c.tipo}`);
  }));
  const nomes = abas.map((a, i) => nomeDaAba(a.nome, i));
  // O Excel guarda o intervalo do filtro como nome definido; sem ele, abre
  // com o filtro mas "conserta" o arquivo ao salvar.
  const filtros = abas.map((a, i) => {
    const coluna = letraDaColuna(a.colunas.length - 1);
    const linha = a.linhas.length + 1;
    const aba = escapar(nomes[i].replace(/'/g, "''"));
    return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${aba}'!$A$1:$${coluna}$${linha}</definedName>`
      // O cabeçalho se repete no alto de cada folha impressa.
      + `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${aba}'!$1:$1</definedName>`;
  }).join('');
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets>${nomes.map((nome, i) => `<sheet name="${escapar(nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
    + `<definedNames>${filtros}</definedNames>`
    // As fórmulas do total vão sem valor calculado: o Excel calcula ao abrir.
    + '<calcPr calcId="0" fullCalcOnLoad="1"/>'
    + '</workbook>';
  const relsDoWorkbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + nomes.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${nomes.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + '</Relationships>';
  const tipos = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + nomes.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '</Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>';
  return [
    { nome: '[Content_Types].xml', conteudo: tipos },
    { nome: '_rels/.rels', conteudo: rels },
    { nome: 'xl/workbook.xml', conteudo: workbook },
    { nome: 'xl/_rels/workbook.xml.rels', conteudo: relsDoWorkbook },
    { nome: 'xl/styles.xml', conteudo: xmlDosEstilos() },
    ...abas.map((aba, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, conteudo: xmlDaAba(aba) }))
  ];
}

module.exports = { criarPlanilha, partesDaPlanilha, letraDaColuna, serialDaData, TIPOS };
