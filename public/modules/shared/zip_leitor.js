// LEITOR DE .ZIP NO NAVEGADOR (19/11/2026).
//
// Para a importação de XMLs antigos em Fiscal › Notas contra CNPJ: o Viper e o
// contador costumam entregar as notas num .zip. O arquivo é aberto AQUI, no
// navegador, e só os XMLs seguem para o servidor, em lotes — um .zip de
// centenas de notas não cabe numa requisição só, e o servidor não precisa de
// biblioteca nova (o projeto tem três dependências).
//
// Lê o diretório central (onde ficam os tamanhos certos, mesmo quando o
// arquivo usou "data descriptor") e descomprime com o DecompressionStream do
// próprio navegador ('deflate-raw', o método 8 do zip). Também roda no Node 18+,
// que tem o mesmo DecompressionStream — é assim que o teste o exercita.
//
// Recusa, dizendo o porquê: ZIP64 (zip acima de 4 GB ou de 65 mil arquivos),
// arquivo protegido por senha e método de compressão que não seja 0 ou 8.
(function (raiz) {
  const FIM_DO_DIRETORIO = 0x06054b50;
  const ENTRADA_CENTRAL = 0x02014b50;
  const CABECALHO_LOCAL = 0x04034b50;
  // Um XML de NF-e passa pouco de 1 MB; o teto do conjunto evita que um zip
  // malicioso ("zip bomb") ocupe a memória da aba.
  const LIMITE_POR_ARQUIVO = 8 * 1024 * 1024;
  const LIMITE_TOTAL = 400 * 1024 * 1024;
  const LIMITE_DE_ARQUIVOS = 20000;

  async function inflarRaw(bytes) {
    const fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(fluxo).arrayBuffer());
  }

  function erro(mensagem) {
    return new Error(mensagem);
  }

  /**
   * ArrayBuffer/Uint8Array do .zip -> [{ nome, bytes }] (só arquivos, sem as
   * pastas), e [{ nome, erro }] para o que não deu para abrir.
   */
  async function lerZip(conteudo) {
    const bytes = conteudo instanceof Uint8Array ? conteudo : new Uint8Array(conteudo);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 22) throw erro('Arquivo .zip vazio ou corrompido.');

    // O fim do diretório central fica nos últimos 22 bytes + o comentário (até 64 KB).
    let fim = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
      if (dv.getUint32(i, true) === FIM_DO_DIRETORIO) { fim = i; break; }
    }
    if (fim < 0) throw erro('Não é um .zip válido (ou está corrompido).');
    const total = dv.getUint16(fim + 10, true);
    const inicio = dv.getUint32(fim + 16, true);
    if (total === 0xffff || inicio === 0xffffffff) {
      throw erro('Este .zip é grande demais (ZIP64). Divida em arquivos menores.');
    }
    if (total > LIMITE_DE_ARQUIVOS) throw erro(`O .zip tem ${total} arquivos; o máximo é ${LIMITE_DE_ARQUIVOS}.`);

    const utf8 = new TextDecoder('utf-8');
    // Nome sem a marca de UTF-8 (bit 11) é CP437 pelo padrão; latin1 acerta as
    // letras sem acento, que é o que nome de XML de nota costuma ter.
    const latin1 = new TextDecoder('latin1');
    const arquivos = [];
    let somados = 0;
    let p = inicio;
    for (let n = 0; n < total; n += 1) {
      if (p + 46 > bytes.length || dv.getUint32(p, true) !== ENTRADA_CENTRAL) throw erro('O diretório do .zip está corrompido.');
      const flags = dv.getUint16(p + 8, true);
      const metodo = dv.getUint16(p + 10, true);
      const tamanhoComprimido = dv.getUint32(p + 20, true);
      const tamanhoOriginal = dv.getUint32(p + 24, true);
      const tamanhoNome = dv.getUint16(p + 28, true);
      const tamanhoExtra = dv.getUint16(p + 30, true);
      const tamanhoComentario = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const nomeBytes = bytes.subarray(p + 46, p + 46 + tamanhoNome);
      const nome = ((flags & 0x800) ? utf8 : latin1).decode(nomeBytes);
      p += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;

      if (nome.endsWith('/')) continue; // pasta
      if (flags & 0x1) { arquivos.push({ nome, erro: 'Protegido por senha.' }); continue; }
      if (metodo !== 0 && metodo !== 8) { arquivos.push({ nome, erro: `Compressão não suportada (método ${metodo}).` }); continue; }
      if (tamanhoOriginal > LIMITE_POR_ARQUIVO) { arquivos.push({ nome, erro: 'Arquivo grande demais para ser uma NF-e.' }); continue; }
      somados += tamanhoOriginal;
      if (somados > LIMITE_TOTAL) throw erro('O conteúdo do .zip passa de 400 MB. Divida em arquivos menores.');

      if (local + 30 > bytes.length || dv.getUint32(local, true) !== CABECALHO_LOCAL) {
        arquivos.push({ nome, erro: 'Entrada corrompida no .zip.' });
        continue;
      }
      const dados = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const comprimido = bytes.subarray(dados, dados + tamanhoComprimido);
      try {
        const conteudoDoArquivo = metodo === 0 ? comprimido.slice() : await inflarRaw(comprimido);
        if (conteudoDoArquivo.length > LIMITE_POR_ARQUIVO) { arquivos.push({ nome, erro: 'Arquivo grande demais para ser uma NF-e.' }); continue; }
        arquivos.push({ nome, bytes: conteudoDoArquivo });
      } catch (e) {
        arquivos.push({ nome, erro: 'Não consegui descomprimir este arquivo.' });
      }
    }
    return arquivos;
  }

  const api = { lerZip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisZip = api;
})(typeof window !== 'undefined' ? window : globalThis);
