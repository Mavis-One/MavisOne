/**
 * LEITOR MÍNIMO DE .xlsx — só o que o Node já traz (zlib), sem dependência.
 *
 * Existe para a importação das NF-e do sistema anterior (fase DX): a relação
 * veio em planilha do Excel, e trazer uma biblioteca de planilha inteira para
 * ler texto de células seria dependência nova para um uso de uma vez. Pelo
 * mesmo motivo o zip do acervo (fase CN) foi escrito à mão.
 *
 * O QUE ELE LÊ: o texto e o número de cada célula, por aba. Não lê fórmula
 * (lê o valor que o Excel guardou), estilo, data formatada (devolve o número
 * serial — ver dataDoExcel) nem célula mesclada.
 *
 * O QUE ELE RECUSA: zip com criptografia ou com método de compressão que não
 * seja "guardado" (0) ou deflate (8), e qualquer entrada que descompacte para
 * mais de 200 MB — planilha de NF-e tem poucos MB, e um arquivo que diz ter
 * mais é defeituoso ou malicioso.
 */
const fs = require('fs');
const zlib = require('zlib');

const LIMITE_DESCOMPACTADO = 200 * 1024 * 1024;

function entradasDoZip(buf) {
  let fim = buf.length - 22;
  while (fim >= 0 && buf.readUInt32LE(fim) !== 0x06054b50) fim -= 1;
  if (fim < 0) throw new Error('O arquivo não é uma planilha .xlsx (zip sem diretório central).');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const entradas = {};
  for (let i = 0; i < total; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Planilha .xlsx corrompida (diretório central inválido).');
    const flags = buf.readUInt16LE(p + 8);
    const metodo = buf.readUInt16LE(p + 10);
    const compactado = buf.readUInt32LE(p + 20);
    const tamanho = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28);
    const el = buf.readUInt16LE(p + 30);
    const cl = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + nl);
    if (flags & 0x1) throw new Error('Planilha protegida por senha não é suportada.');
    if (![0, 8].includes(metodo)) throw new Error(`Compressão não suportada na planilha (método ${metodo}).`);
    if (tamanho > LIMITE_DESCOMPACTADO) throw new Error(`Parte da planilha grande demais: ${nome}.`);
    const lnl = buf.readUInt16LE(local + 26);
    const lel = buf.readUInt16LE(local + 28);
    const inicio = local + 30 + lnl + lel;
    const dados = buf.subarray(inicio, inicio + compactado);
    entradas[nome] = () => (metodo === 8
      ? zlib.inflateRawSync(dados, { maxOutputLength: LIMITE_DESCOMPACTADO })
      : dados).toString('utf8');
    p += 46 + nl + el + cl;
  }
  return entradas;
}

const desescapar = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&');

function indiceDaColuna(ref) {
  let n = 0;
  for (const c of ref.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Lê a planilha. Devolve `[{ nome, linhas }]`, uma entrada por aba, na ordem do
 * arquivo; `linhas` é uma matriz de textos ('' na célula vazia).
 */
function lerXlsx(caminhoOuBuffer) {
  const buf = Buffer.isBuffer(caminhoOuBuffer) ? caminhoOuBuffer : fs.readFileSync(caminhoOuBuffer);
  const zip = entradasDoZip(buf);
  if (!zip['xl/workbook.xml']) throw new Error('O arquivo não é uma planilha do Excel (.xlsx).');
  const compartilhados = zip['xl/sharedStrings.xml']
    ? [...zip['xl/sharedStrings.xml']().matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map((m) => desescapar([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')))
    : [];
  const livro = zip['xl/workbook.xml']();
  const rels = zip['xl/_rels/workbook.xml.rels'] ? zip['xl/_rels/workbook.xml.rels']() : '';
  const alvos = new Map([...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [
    (/\bId="([^"]+)"/.exec(m[1]) || [])[1], (/\bTarget="([^"]+)"/.exec(m[1]) || [])[1]
  ]));

  return [...livro.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => {
    const nome = desescapar((/\bname="([^"]*)"/.exec(m[1]) || [])[1] || '');
    const rid = (/\br:id="([^"]+)"/.exec(m[1]) || [])[1];
    const alvo = String(alvos.get(rid) || '').replace(/^\/?(xl\/)?/, '');
    const parte = zip['xl/' + alvo];
    if (!parte) return { nome, linhas: [] };
    const linhas = [];
    for (const r of parte().matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const linha = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = (/\br="([A-Z]+\d+)"/.exec(c[1]) || [])[1];
        if (!ref) continue;
        const tipo = (/\bt="([^"]+)"/.exec(c[1]) || [])[1];
        const corpo = c[2] || '';
        const v = (/<v>([\s\S]*?)<\/v>/.exec(corpo) || [])[1];
        let valor = '';
        if (tipo === 's') valor = compartilhados[Number(v)] ?? '';
        else if (tipo === 'inlineStr') valor = desescapar([...corpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
        else if (v !== undefined) valor = desescapar(v);
        linha[indiceDaColuna(ref)] = valor;
      }
      linhas.push(Array.from(linha, (x) => (x === undefined ? '' : String(x))));
    }
    return { nome, linhas };
  });
}

/**
 * Data e hora do número serial do Excel (dias desde 30/12/1899), como texto
 * 'AAAA-MM-DD' e 'HH:MM'. O serial guarda a HORA DE PAREDE de quem gerou a
 * planilha, sem fuso — por isso a conta é feita em UTC e não converte nada.
 */
function dataDoExcel(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(Math.round((n - 25569) * 86400) * 1000);
  return { data: d.toISOString().slice(0, 10), hora: d.toISOString().slice(11, 16) };
}

module.exports = { lerXlsx, dataDoExcel };
