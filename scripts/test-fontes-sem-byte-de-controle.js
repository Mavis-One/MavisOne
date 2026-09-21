// NENHUM FONTE CARREGA BYTE DE CONTROLE CRU.
//
// O DEFEITO QUE ORIGINOU ESTE TESTE: lib/zip.js nasceu com a classe de
// caracteres de `nomeSeguro` escrita com os bytes CRUS no lugar dos escapes — um
// 0x00 e um 0x1f dentro de uma expressão regular. O JavaScript aceita: a
// expressão funcionava, e o teste do acervo passava.
//
// O estrago é em volta do código, não nele:
//
//   1. o git declara o arquivo BINÁRIO por causa do 0x00. `git diff` passa a
//      dizer "Bin 7249 bytes" em vez de mostrar a mudança, `git blame` não
//      responde, e a revisão daquele arquivo deixa de existir;
//   2. o caractere é INVISÍVEL no editor. Quem lesse a classe não tinha como
//      saber que ali estava escrito "de NUL até US";
//   3. ferramenta que assume texto (busca, lint, formatador, patch) pode
//      truncar no 0x00 e devolver meio arquivo. Este próprio teste não pôde ser
//      criado por linha de comando: o shell recusou o texto por conter controle.
//
// A regra: tabulação, LF e CR são os únicos controles admitidos num fonte. Todo
// o resto se escreve com escape. O que se ganha é que o fonte continua legível e
// o git continua sabendo diferenciá-lo.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');

let falhas = 0;
const check = (n, c, d) => { console.log(`${c ? '  OK ' : '  XX '} ${n}${d ? ' -> ' + d : ''}`); if (!c) falhas++; };

// Os fontes versionados, perguntados ao git: assim a lista não precisa ser
// mantida à mão e nada que entre no repo escapa por não estar num array aqui.
// Sem rede e sem banco — `git ls-files` lê o índice, que é um arquivo local.
const EXTENSOES = ['.js', '.json', '.sql', '.html', '.css', '.md', '.txt', '.yml', '.yaml'];
const NUL = String.fromCharCode(0);

let arquivos;
try {
  arquivos = execFileSync('git', ['ls-files', '-z'], { cwd: RAIZ, encoding: 'utf8' })
    .split(NUL)
    .filter(Boolean)
    .filter((p) => EXTENSOES.includes(path.extname(p).toLowerCase()));
} catch (erro) {
  console.log(`  XX  nao deu para listar os fontes com git -> ${erro.message}`);
  process.exit(1);
}

check('o git respondeu com fontes', arquivos.length > 100, `${arquivos.length} arquivos`);

// 0x09 tabulação, 0x0a LF, 0x0d CR. Todo o resto de 0x00 a 0x1f é defeito, e o
// 0x7f (DEL) também: nenhum deles tem razão de estar cru num fonte.
const PERMITIDOS = new Set([0x09, 0x0a, 0x0d]);
const eProibido = (b) => (b < 0x20 && !PERMITIDOS.has(b)) || b === 0x7f;

const culpados = [];
for (const relativo of arquivos) {
  let bytes;
  try {
    bytes = fs.readFileSync(path.join(RAIZ, relativo));
  } catch {
    continue; // no índice mas ausente do disco: não é assunto deste teste.
  }
  for (let i = 0; i < bytes.length; i += 1) {
    if (!eProibido(bytes[i])) continue;
    const linha = bytes.subarray(0, i).toString('latin1').split('\n').length;
    const codigo = `0x${bytes[i].toString(16).padStart(2, '0')}`;
    culpados.push(`${relativo}:${linha} tem ${codigo}`);
    break; // um por arquivo basta para apontar o dedo.
  }
}

check('nenhum fonte tem byte de controle cru',
  culpados.length === 0,
  culpados.length ? culpados.slice(0, 10).join(' | ') : `${arquivos.length} conferidos`);

// O arquivo que originou a regra, conferido pelo nome: o check de cima pega a
// volta do defeito, e este diz POR QUE ele existe — e que a intenção de
// `nomeSeguro` (recortar de NUL a US) continua escrita lá, em escape.
const zipSrc = fs.readFileSync(path.join(RAIZ, 'lib/zip.js'), 'utf8');
check('lib/zip.js escreve a faixa de controle com escape',
  /\\u0000-\\u001f/.test(zipSrc),
  'nomeSeguro recorta de NUL a US');

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
process.exit(falhas === 0 ? 0 : 1);
