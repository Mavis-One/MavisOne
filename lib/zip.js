/**
 * UM ZIP, ESCRITO À MÃO (fase CN).
 *
 * POR QUE NÃO UMA BIBLIOTECA
 * --------------------------
 * Este projeto tem três dependências — bcryptjs, dotenv e pg — e isso é
 * decisão, não acaso: o cliente do banco é um shim próprio em vez de um ORM, o
 * servidor é `http` puro em vez de Express. Trazer `archiver` ou `jszip` por
 * causa de um botão de download significa uma árvore de dependências (e as
 * atualizações de segurança dela) para um formato que cabe neste arquivo.
 *
 * O ZIP é um formato aberto e velho, e a parte que interessa são três blocos:
 * um cabeçalho antes de cada arquivo, os dados, e um índice no fim que diz onde
 * cada arquivo começou. Nada aqui é esperto — é transcrição de especificação.
 *
 * O QUE ELE FAZ E O QUE NÃO FAZ
 * -----------------------------
 * Faz: deflate (método 8) por arquivo, nomes em UTF-8, pastas por prefixo no
 * nome ("entradas/123.xml" basta, não precisa entrada de diretório).
 *
 * Não faz: ZIP64 (arquivo individual ou total acima de 4 GB), senha, atributos
 * de sistema. Um mês de XML de NF-e são alguns megabytes; se algum dia um lote
 * passar de 4 GB, este arquivo precisa de ZIP64 e o lugar de descobrir isso é
 * aqui, com o `assertCabe` abaixo, e não num zip corrompido na mão do contador.
 *
 * DEFLATE, E NÃO "STORED": XML comprime ~10x (a mesma razão do gzip nas
 * respostas de API, fase CM). Mil notas de 8 KB saem de 8 MB para ~800 KB, e a
 * diferença é sentida por quem baixa.
 */
'use strict';

const zlib = require('zlib');

// CRC-32 (o mesmo polinômio do gzip). Tabela montada uma vez.
const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// O ZIP guarda data e hora no formato do MS-DOS: 16 bits cada, com o ano
// contado a partir de 1980 e o segundo dividido por 2. Não é nostalgia, é o que
// o formato pede — e data zerada faz alguns extratores reclamarem.
function dataDos(d) {
  const ano = Math.max(1980, d.getFullYear());
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)),
    data: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

const LIMITE_32 = 0xffffffff;
function assertCabe(valor, oque) {
  if (valor > LIMITE_32) {
    throw new Error(`Este zip passou de 4 GB em ${oque}, e lib/zip.js não implementa ZIP64. `
      + 'Gere o arquivo em pedaços (por mês, por estabelecimento) ou implemente ZIP64 aqui.');
  }
}

/**
 * Monta o zip inteiro na memória e devolve o Buffer.
 *
 * `arquivos`: [{ nome, conteudo (Buffer|string), data? }]
 *
 * Na memória, e não em fluxo, de propósito: quem chama precisa do
 * Content-Length para o navegador mostrar barra de progresso, e um mês de XML
 * cabe folgado. Se algum dia não couber, o erro do assertCabe aponta para cá.
 */
function criarZip(arquivos) {
  const entradas = [];
  const pedacos = [];
  let posicao = 0;

  for (const arquivo of arquivos) {
    const nome = Buffer.from(String(arquivo.nome), 'utf8');
    const cru = Buffer.isBuffer(arquivo.conteudo) ? arquivo.conteudo : Buffer.from(String(arquivo.conteudo), 'utf8');
    const comprimido = zlib.deflateRawSync(cru, { level: 6 });
    const { hora, data } = dataDos(arquivo.data instanceof Date ? arquivo.data : new Date());
    const crc = crc32(cru);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // assinatura do cabeçalho local
    local.writeUInt16LE(20, 4);           // versão mínima para extrair (2.0)
    // bit 11 = nome em UTF-8. Sem ele, acento em nome de arquivo vira ruído no
    // Windows — e "NOTA SÃO BENTO.xml" é nome plausível aqui.
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);            // método: deflate
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(data, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(cru.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);           // sem campo extra

    entradas.push({ nome, crc, tamComprimido: comprimido.length, tamCru: cru.length, hora, data, offset: posicao });
    pedacos.push(local, nome, comprimido);
    posicao += local.length + nome.length + comprimido.length;
    assertCabe(posicao, 'tamanho acumulado');
  }

  // O ÍNDICE CENTRAL. É por ele que o extrator lê o zip: ele começa pelo FIM do
  // arquivo, acha este índice e só então sabe onde cada arquivo está. Um zip
  // sem ele abre em nenhum lugar, mesmo com todos os dados presentes.
  const inicioIndice = posicao;
  for (const e of entradas) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // assinatura do índice
    central.writeUInt16LE(20, 4);         // versão de quem escreveu
    central.writeUInt16LE(20, 6);         // versão mínima para extrair
    central.writeUInt16LE(0x0800, 8);     // nome em UTF-8, como no local
    central.writeUInt16LE(8, 10);         // deflate
    central.writeUInt16LE(e.hora, 12);
    central.writeUInt16LE(e.data, 14);
    central.writeUInt32LE(e.crc, 16);
    central.writeUInt32LE(e.tamComprimido, 20);
    central.writeUInt32LE(e.tamCru, 24);
    central.writeUInt16LE(e.nome.length, 28);
    central.writeUInt16LE(0, 30);         // extra
    central.writeUInt16LE(0, 32);         // comentário
    central.writeUInt16LE(0, 34);         // disco
    central.writeUInt16LE(0, 36);         // atributos internos
    central.writeUInt32LE(0, 38);         // atributos externos
    central.writeUInt32LE(e.offset, 42);  // onde o cabeçalho local está
    pedacos.push(central, e.nome);
    posicao += central.length + e.nome.length;
  }
  const tamanhoIndice = posicao - inicioIndice;
  assertCabe(posicao, 'tamanho total');

  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);       // fim do índice central
  fim.writeUInt16LE(0, 4);                // disco atual
  fim.writeUInt16LE(0, 6);                // disco do índice
  fim.writeUInt16LE(entradas.length, 8);  // entradas neste disco
  fim.writeUInt16LE(entradas.length, 10); // entradas no total
  fim.writeUInt32LE(tamanhoIndice, 12);
  fim.writeUInt32LE(inicioIndice, 16);
  fim.writeUInt16LE(0, 20);               // sem comentário
  pedacos.push(fim);

  return Buffer.concat(pedacos);
}

/**
 * Nome de arquivo que sobrevive a Windows, macOS e Linux.
 *
 * Chave de NF-e são 44 dígitos, então na prática nada aqui é exercitado — mas
 * esta função também nomeia com razão social e número de nota, e "NF 123/2026
 * — CLIENTE & CIA.xml" tem barra, que no Windows é separador de pasta.
 */
function nomeSeguro(texto, reserva = 'arquivo') {
  const limpo = String(texto || '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[-. ]+|[-. ]+$/g, '')
    .slice(0, 120);
  return limpo || reserva;
}

module.exports = { criarZip, crc32, nomeSeguro };
