/**
 * O GERADOR DO ARQUIVO DA EFD-ICMS/IPI — e o leitor, que é a prova dele.
 *
 * O QUE ELE FAZ, E O QUE ELE DEIXA PARA QUEM CHAMA
 * ------------------------------------------------
 * Recebe o CONTEÚDO de cada bloco — os registros de dados, já na ordem
 * hierárquica (C100, os C110/C170/C190 dele, o próximo C100…) — e devolve o
 * texto do arquivo. O que é ESTRUTURA ele escreve sozinho, e só ele:
 *
 *   - a abertura de cada bloco (0001, B001, C001…) com o IND_MOV certo
 *   - o encerramento de cada bloco (0990, C990…) com a contagem de linhas
 *   - o Bloco 9 inteiro: um 9900 por registro usado, o 9990 e o 9999
 *
 * É a parte que mais rejeita arquivo no validador e a que ninguém confere a
 * olho: um 9900 que esquece de contar a si mesmo, um 0990 que não conta o
 * 0000. Por isso ela não aceita valor de fora — se o chamador mandar um C990,
 * é erro, não sobrescrita.
 *
 * O que ele NÃO faz: decidir o conteúdo. Qual nota entra, qual CST, quanto é o
 * E110 — isso é de quem monta a escrituração (lib/sped-apuracao.js para a
 * conta, o banco para o dado). Separar assim é o que permite provar o gerador
 * HOJE, sem nota nenhuma no banco: os dez SPEDs que o sistema antigo gerou
 * (dez/2025 a set/2026) são lidos por `lerEfd`, devolvidos a `gerarEfd`, e o
 * resultado tem de ser o mesmo arquivo. Ver scripts/test-sped-gerador.js.
 *
 * O FORMATO, segundo o Guia Prático (lib/sped-leiaute.js)
 * -------------------------------------------------------
 *   - um registro por linha, começando e terminando em "|"
 *   - quebra de linha CR+LF? NÃO: os dez arquivos aceitos usam LF, e o PVA
 *     aceita os dois. Fica LF, que é o que a SEFAZ já recebeu desta empresa.
 *   - numérico com decimais: vírgula, sem separador de milhar, com TODAS as
 *     casas do leiaute ("17,00", não "17"). O sistema antigo escrevia "282" num
 *     VL_ITEM de duas casas; o PVA tolera, o Guia não pede isso.
 *   - campo vazio é "||" — e vazio NÃO é zero: "0,00" declara valor, "" declara
 *     ausência. `null`/`undefined`/'' viram vazio; 0 vira "0,00".
 *   - CODIFICAÇÃO: ISO 8859-1, como o Guia manda. O sistema antigo gravava
 *     UTF-8 (medido nos dez arquivos em 01/10/2026), e o "ã" chegava ao PVA como
 *     "Ã£". Caractere que não existe em Latin-1 (travessão, aspas curvas, emoji)
 *     é trocado por "?" em `paraLatin1` — e CONTADO, para a tela poder avisar.
 */

const leiaute = require('./sped-leiaute');

// A ordem dos blocos no arquivo. O Bloco 9 é do gerador e não entra aqui.
const ORDEM_DOS_BLOCOS = ['0', 'B', 'C', 'D', 'E', 'G', 'H', 'K', '1'];

// O C170 tem dois campos chamados ALIQ_PIS e dois chamados ALIQ_COFINS — no
// próprio Guia (lib/sped-leiaute.js, DUPLICADOS_LEGITIMOS). Num objeto não cabem
// duas chaves iguais, então a SEGUNDA ocorrência — a alíquota em REAIS, que
// acompanha QUANT_BC_PIS — atende por este outro nome.
const SEGUNDO_NOME = { C170: { ALIQ_PIS: 'ALIQ_PIS_REAIS', ALIQ_COFINS: 'ALIQ_COFINS_REAIS' } };

function blocoDe(reg) {
  return String(reg).charAt(0);
}

/**
 * Os campos de um registro com o nome pelo qual o objeto os entrega — igual ao
 * do Guia, exceto a segunda ocorrência de um nome repetido.
 */
const cacheDeCampos = new Map();
function camposComChave(reg) {
  if (cacheDeCampos.has(reg)) return cacheDeCampos.get(reg);
  const campos = leiaute.camposDe(reg);
  if (!campos) return null;
  const vistos = new Set();
  const lista = campos.map((c) => {
    let chave = c.nome;
    if (vistos.has(c.nome)) {
      chave = (SEGUNDO_NOME[reg] && SEGUNDO_NOME[reg][c.nome]) || null;
      if (!chave) throw new Error(`${reg}: campo ${c.nome} repetido sem segundo nome declarado`);
    }
    vistos.add(c.nome);
    return { ...c, chave };
  });
  cacheDeCampos.set(reg, lista);
  return lista;
}

function dataEfd(d) {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}${mm}${d.getUTCFullYear()}`;
}

/**
 * UM CAMPO, formatado pelo tipo que o leiaute dá a ele.
 *
 * Erro em vez de conserto: valor que não é número num campo numérico, ou "|"
 * dentro de texto, derruba a geração com o registro e o campo no recado. Um
 * gerador que "conserta" em silêncio produz arquivo que valida e declara outra
 * coisa.
 */
function formatarCampo(reg, campo, valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const onde = `${reg}.${campo.chave}`;

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) throw new Error(`${onde}: data inválida`);
    return dataEfd(valor);
  }

  // Numérico com casas decimais: o único caso em que o gerador reescreve o
  // valor, porque é o único em que o leiaute diz exatamente como ele se escreve.
  if (campo.tipo === 'N' && campo.dec !== null) {
    // Texto com vírgula é o formato brasileiro ("1.234,56"); sem vírgula, o
    // ponto é decimal ("17.5"). Tirar o ponto de "17.5" daria 175.
    const bruto = String(valor).trim();
    const n = typeof valor === 'number' ? valor
      : Number(bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.') : bruto);
    if (!Number.isFinite(n)) throw new Error(`${onde}: "${valor}" não é número`);
    const texto = Math.abs(n).toFixed(campo.dec).replace('.', ',');
    // -0,00 não existe: o arredondamento de um negativo minúsculo não pode
    // virar sinal no arquivo.
    return n < 0 && /[1-9]/.test(texto) ? `-${texto}` : texto;
  }

  // Todo o resto vai como texto: código, data já em ddmmaaaa, CNPJ, CST com o
  // zero à esquerda. Por isso quem chama manda CÓDIGO COMO TEXTO: o número 61
  // sairia "61", e o CST é "061".
  const texto = String(valor);
  if (/[|\r\n]/.test(texto)) throw new Error(`${onde}: o texto contém "|" ou quebra de linha`);
  return texto.trim();
}

/** UMA LINHA do arquivo, a partir do objeto { REG, CAMPO: valor, … }. */
function linhaDoRegistro(registro) {
  const reg = registro && registro.REG;
  const campos = camposComChave(reg);
  if (!campos) throw new Error(`registro desconhecido no leiaute: ${reg}`);

  // Chave que não é campo do registro é erro de digitação de quem chamou — e o
  // erro de digitação aqui é um campo que sai vazio sem ninguém saber.
  const conhecidas = new Set(campos.map((c) => c.chave));
  for (const k of Object.keys(registro)) {
    if (!conhecidas.has(k)) throw new Error(`${reg}: campo desconhecido "${k}"`);
  }

  const valores = campos.map((c) => (c.chave === 'REG' ? reg : formatarCampo(reg, c, registro[c.chave])));
  return `|${valores.join('|')}|`;
}

// Os registros que o gerador escreve sozinho. Recebê-los de fora é erro.
function eEstrutural(reg) {
  return /^.(001|990)$/.test(reg) || /^9/.test(reg);
}

/**
 * O ARQUIVO.
 *
 *   gerarEfd({
 *     registro0000: { REG: '0000', COD_VER: '020', … },
 *     blocos: { '0': [ …0005, 0100, 0150… ], C: [ …C100, C190… ], E: [ … ], '1': [ …1010 ] }
 *   })
 *
 * Bloco ausente ou vazio sai com abertura IND_MOV=1 e encerramento 2 — que é o
 * que o Guia pede e o que os arquivos do sistema antigo têm em B, D, G e H.
 *
 * Devolve o texto (com LF no fim da última linha, como os arquivos aceitos), as
 * linhas, e a contagem por registro — a mesma que vai no 9900, para a tela.
 */
function gerarEfd({ registro0000, blocos = {} } = {}) {
  if (!registro0000 || registro0000.REG !== '0000') throw new Error('falta o registro 0000');

  for (const bloco of Object.keys(blocos)) {
    if (!ORDEM_DOS_BLOCOS.includes(bloco)) throw new Error(`bloco desconhecido: ${bloco}`);
    for (const r of blocos[bloco] || []) {
      if (!r || !r.REG) throw new Error(`bloco ${bloco}: registro sem REG`);
      if (blocoDe(r.REG) !== bloco) throw new Error(`o registro ${r.REG} não pertence ao bloco ${bloco}`);
      if (eEstrutural(r.REG) || r.REG === '0000') {
        throw new Error(`${r.REG} é escrito pelo gerador e não pode vir de fora`);
      }
    }
  }

  const linhas = [];
  const regs = [];
  const emitir = (registro) => { linhas.push(linhaDoRegistro(registro)); regs.push(registro.REG); };

  for (const bloco of ORDEM_DOS_BLOCOS) {
    const conteudo = blocos[bloco] || [];
    const inicio = linhas.length;
    if (bloco === '0') emitir(registro0000);
    // IND_MOV: 0 = bloco com dados, 1 = sem dados. O Bloco 0 sempre tem. O
    // nome vem do leiaute porque não é o mesmo em todos: no B001 é IND_DAD.
    const campoInd = leiaute.camposDe(`${bloco}001`)[1].nome;
    emitir({ REG: `${bloco}001`, [campoInd]: bloco === '0' || conteudo.length ? '0' : '1' });
    for (const r of conteudo) emitir(r);
    // A contagem do encerramento inclui a abertura e o próprio encerramento —
    // e, no Bloco 0, o 0000.
    const campoQtd = leiaute.camposDe(`${bloco}990`)[1].nome;
    emitir({ REG: `${bloco}990`, [campoQtd]: String(linhas.length - inicio + 1) });
  }

  // BLOCO 9. Um 9900 por registro, na ordem em que apareceu — inclusive o 9001,
  // o próprio 9900, o 9990 e o 9999, que ainda não foram escritos e por isso
  // entram contados à mão.
  const contagem = new Map();
  for (const r of regs) contagem.set(r, (contagem.get(r) || 0) + 1);
  contagem.set('9001', 1);
  const qtd9900 = contagem.size + 3; // + 9900, 9990, 9999
  contagem.set('9900', qtd9900);
  contagem.set('9990', 1);
  contagem.set('9999', 1);

  emitir({ REG: '9001', IND_MOV: '0' });
  for (const [reg, qtd] of contagem) emitir({ REG: '9900', REG_BLC: reg, QTD_REG_BLC: String(qtd) });
  // 9990 conta do 9001 até ele mesmo e o 9999: 9001 + os 9900 + 9990 + 9999.
  emitir({ REG: '9990', QTD_LIN_9: String(1 + qtd9900 + 2) });
  emitir({ REG: '9999', [leiaute.camposDe('9999')[1].nome]: String(linhas.length + 1) });

  return {
    texto: linhas.join('\n') + '\n',
    linhas,
    contagem: Object.fromEntries(contagem)
  };
}

/**
 * TEXTO -> BYTES em ISO 8859-1. Caractere fora do Latin-1 vira "?" e é contado:
 * a tela precisa poder dizer "3 caracteres foram trocados", senão o nome de um
 * cliente com travessão sai diferente no fisco e ninguém sabe por quê.
 */
function paraLatin1(texto) {
  const trocados = [];
  let saida = '';
  for (const ch of String(texto)) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xff) saida += ch;
    else { saida += '?'; trocados.push(ch); }
  }
  return { buffer: Buffer.from(saida, 'latin1'), trocados };
}

/**
 * O LEITOR — o inverso do gerador, e a prova dele.
 *
 * Lê um arquivo da EFD e devolve os registros como objetos { REG, CAMPO: valor },
 * com o numérico de casas decimais virado número e todo o resto como texto,
 * exatamente como `gerarEfd` os recebe. Serve a duas coisas:
 *
 *   1. o teste: arquivo do sistema antigo -> lerEfd -> gerarEfd -> o mesmo
 *      arquivo, campo por campo;
 *   2. o saldo credor do período anterior (campo 14 do E110 do mês passado) e
 *      a continuidade com o sistema antigo saem do arquivo que ele gerou.
 *
 * Aceita texto (string) ou bytes; bytes são decodificados como UTF-8 quando
 * válidos (o sistema antigo) e como Latin-1 quando não (o Guia, este gerador).
 */
function lerEfd(entrada) {
  let texto = entrada;
  if (Buffer.isBuffer(entrada)) {
    try { texto = new TextDecoder('utf-8', { fatal: true }).decode(entrada); }
    catch { texto = entrada.toString('latin1'); }
  }
  const registros = [];
  const linhas = String(texto).split(/\r?\n/);
  linhas.forEach((linha, i) => {
    if (!linha) return;
    if (!linha.startsWith('|') || !linha.endsWith('|')) throw new Error(`linha ${i + 1}: não começa e termina em "|"`);
    const partes = linha.slice(1, -1).split('|');
    const reg = partes[0];
    const campos = camposComChave(reg);
    if (!campos) throw new Error(`linha ${i + 1}: registro desconhecido ${reg}`);
    if (partes.length !== campos.length) {
      throw new Error(`linha ${i + 1}: ${reg} tem ${partes.length} campos e o leiaute tem ${campos.length}`);
    }
    const obj = {};
    campos.forEach((c, j) => {
      const v = partes[j];
      if (c.chave === 'REG') { obj.REG = v; return; }
      if (v === '') return;
      obj[c.chave] = c.tipo === 'N' && c.dec !== null ? Number(v.replace(',', '.')) : v;
    });
    registros.push(obj);
  });
  return registros;
}

/**
 * Os registros lidos, de volta no formato de entrada do gerador: o 0000 à parte
 * e o conteúdo de cada bloco sem as aberturas, encerramentos e o Bloco 9.
 */
function separarEmBlocos(registros) {
  const registro0000 = registros.find((r) => r.REG === '0000');
  const blocos = {};
  for (const r of registros) {
    if (r.REG === '0000' || eEstrutural(r.REG)) continue;
    const b = blocoDe(r.REG);
    (blocos[b] = blocos[b] || []).push(r);
  }
  return { registro0000, blocos };
}

module.exports = {
  ORDEM_DOS_BLOCOS,
  formatarCampo,
  linhaDoRegistro,
  gerarEfd,
  paraLatin1,
  lerEfd,
  separarEmBlocos,
  camposComChave
};
