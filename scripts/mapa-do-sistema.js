#!/usr/bin/env node
/**
 * Gera MAPA-DO-SISTEMA.txt — o inventário do ERP.
 *
 * POR QUE É UM GERADOR, E NÃO UM DOCUMENTO ESCRITO À MÃO
 * ------------------------------------------------------
 * Documento de inventário escrito à mão envelhece na primeira tela nova, e
 * envelhece em silêncio: continua parecendo verdade. Este script LÊ o código —
 * o catálogo de telas, os renderizadores registrados, as rotas do servidor, as
 * migrações e os testes — e escreve o que encontrou. Rodar de novo depois de
 * qualquer mudança devolve o mapa atualizado.
 *
 * O que ele NÃO faz: julgar se a funcionalidade é boa, ou inventar descrição
 * para o que não tem. Onde o código não diz, o texto diz "(sem descrição)".
 *
 * Uso:  node scripts/mapa-do-sistema.js
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');
const existe = (p) => fs.existsSync(path.join(RAIZ, p));

const appSrc = ler('public/app.js');
const serverSrc = ler('server.js');
const htmlSrc = ler('public/index.html');

// ---------------------------------------------------------------- utilidades

/** Extrai o corpo de um objeto literal de nível superior pelo nome. */
function blocoDoObjeto(fonte, nome) {
  const inicio = fonte.indexOf(`const ${nome} = {`);
  if (inicio < 0) return '';
  let i = fonte.indexOf('{', inicio);
  let nivel = 0;
  for (let j = i; j < fonte.length; j += 1) {
    if (fonte[j] === '{') nivel += 1;
    else if (fonte[j] === '}') {
      nivel -= 1;
      if (nivel === 0) return fonte.slice(i + 1, j);
    }
  }
  return '';
}

const alinhar = (texto, largura) => String(texto).padEnd(largura);
const titulo = (t) => `\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`;
const subtitulo = (t) => `\n${t}\n${'-'.repeat(t.length)}`;

// ------------------------------------------------------------------- módulos

const labelsBloco = blocoDoObjeto(appSrc, 'moduleLabels');
const MODULOS = [...labelsBloco.matchAll(/^\s*(\w+):\s*'([^']+)'/gm)].map((m) => ({ chave: m[1], nome: m[2] }));

/** Telas declaradas no menu, por módulo. */
function telasDoCatalogo() {
  const bloco = blocoDoObjeto(appSrc, 'moduleSubItems');
  const porModulo = {};
  // Conta colchetes em vez de casar o fechamento por regex: `dashboard: [],`
  // fecha na mesma linha, e um regex que espera "]" numa linha própria pulava
  // esse módulo e engolia o conteúdo do seguinte — foi assim que as telas de
  // Vendas apareceram listadas sob Dashboard.
  const re = /^  (\w+):\s*\[/gm;
  let achado;
  while ((achado = re.exec(bloco))) {
    let nivel = 0;
    let fim = achado.index + achado[0].length - 1;
    for (let i = fim; i < bloco.length; i += 1) {
      if (bloco[i] === '[') nivel += 1;
      else if (bloco[i] === ']') {
        nivel -= 1;
        if (nivel === 0) { fim = i; break; }
      }
    }
    const corpo = bloco.slice(achado.index + achado[0].length, fim);
    porModulo[achado[1]] = [...corpo.matchAll(/\{\s*key:\s*'([^']+)',\s*label:\s*'([^']*)'(?:,\s*desc:\s*'([^']*)')?/g)]
      .map((t) => ({ key: t[1], label: t[2], desc: t[3] || '' }));
  }
  return porModulo;
}

/**
 * Telas desenhadas direto no app.js, sem passar pelo registro de sub-telas.
 *
 * São as mais antigas do sistema (Vendas, Pessoas, Depósitos, Configurações):
 * nasceram antes de os módulos existirem como arquivos separados. Sem contá-las
 * aqui, o mapa as marcaria como "não implementadas" — e elas funcionam.
 */
function telasLegadasNoApp() {
  const chaves = new Set();
  for (const m of appSrc.matchAll(/sub === '(\w+)'/g)) chaves.add(m[1]);
  for (const m of appSrc.matchAll(/activeSub === '(\w+)'/g)) chaves.add(m[1]);
  // O módulo Cadastros nomeia as legadas numa lista própria.
  const legadasCadastros = ler('public/modules/cadastros/index.js')
    .match(/CADASTROS_LEGACY_SUBS = \[([^\]]+)\]/);
  if (legadasCadastros) {
    for (const m of legadasCadastros[1].matchAll(/'(\w+)'/g)) chaves.add(m[1]);
  }
  return chaves;
}

/** Renderizadores realmente registrados, varrendo public/modules. */
function renderizadoresRegistrados() {
  const registro = {};
  const varrer = (dir) => {
    for (const entrada of fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
      const alvo = `${dir}/${entrada.name}`;
      if (entrada.isDirectory()) varrer(alvo);
      else if (entrada.name.endsWith('.js')) {
        const src = ler(alvo);
        for (const m of src.matchAll(/MavisSubscreenRegistry\.(\w+)\.(\w+)\s*=/g)) {
          (registro[m[1]] = registro[m[1]] || new Set()).add(m[2]);
        }
        for (const m of src.matchAll(/MavisSubscreenRegistry\.(\w+)\[['"](\w+)['"]\]\s*=/g)) {
          (registro[m[1]] = registro[m[1]] || new Set()).add(m[2]);
        }
        // Frota, RH, PCP e Contratos guardam o registro num atalho antes de
        // preencher (`const R = window.MavisSubscreenRegistry.fleet;` e depois
        // `R.veiculos = ...`). Sem ler o atalho, as 38 telas desses quatro
        // módulos apareceriam como não implementadas — e todas funcionam.
        const atalho = src.match(/const (\w+) = window\.MavisSubscreenRegistry\.(\w+);/);
        if (atalho) {
          const [, apelido, modulo] = atalho;
          for (const m of src.matchAll(new RegExp(`\\b${apelido}\\.(\\w+)\\s*=\\s*[A-Za-z]`, 'g'))) {
            (registro[modulo] = registro[modulo] || new Set()).add(m[1]);
          }
        }
      }
    }
  };
  varrer('public/modules');
  return registro;
}

// --------------------------------------------------------------------- rotas

/**
 * Rotas do servidor.
 *
 * Lê as comparações literais de `pathname` e os regex de rota. Não é um
 * roteador de verdade — é o que dá para afirmar lendo o texto —, então rotas
 * montadas dinamicamente não aparecem. Melhor listar de menos do que inventar.
 */
function rotas() {
  const achadas = new Map();
  const registra = (caminho, metodo) => {
    if (!achadas.has(caminho)) achadas.set(caminho, new Set());
    if (metodo) achadas.get(caminho).add(metodo);
  };
  for (const m of serverSrc.matchAll(/pathname === '([^']+)'(?:\s*&&\s*req\.method === '(\w+)')?/g)) {
    registra(m[1], m[2]);
  }
  for (const m of serverSrc.matchAll(/pathname\.startsWith\('([^']+)'\)/g)) {
    registra(`${m[1]}…`, '');
  }
  for (const m of serverSrc.matchAll(/pathname\.match\(\/\^\\\/([^/]+?)\$?\/\)/g)) {
    registra(`/${m[1].replace(/\\\//g, '/')}`, '');
  }
  return [...achadas.entries()]
    .filter(([caminho]) => caminho.startsWith('/api'))
    .sort(([a], [b]) => a.localeCompare(b));
}

// ------------------------------------------------------------ camada de dados

function tabelasSupabase() {
  const tabelas = new Set();
  for (const arquivo of fs.readdirSync(path.join(RAIZ, 'lib/db'))) {
    if (!arquivo.endsWith('.js')) continue;
    for (const m of ler(`lib/db/${arquivo}`).matchAll(/\.from\('([a-z_]+)'\)/g)) tabelas.add(m[1]);
    for (const m of ler(`lib/db/${arquivo}`).matchAll(/tabela:\s*'([a-z_]+)'/g)) tabelas.add(m[1]);
  }
  return [...tabelas].sort();
}

/** Primeira frase do comentário de cabeçalho — a explicação que o arquivo dá de si. */
function resumoDoArquivo(caminho) {
  const linhas = ler(caminho).split('\n');
  const texto = [];
  for (const linha of linhas) {
    const cru = linha.trim();
    // Shebang não é descrição — sem esta linha, todo teste começava com
    // "#!/usr/bin/env node" no lugar do que ele explica.
    if (cru.startsWith('#!')) continue;
    if (/^(const|let|var|function|window|module|\(function|require|'use)/.test(cru)) break;
    const limpa = linha.replace(/^\s*(\/\*\*?|\*\/|\*|\/\/)\s?/, '').trim();
    // Régua de comentário ("---", "===") separa seções; entra como fim do
    // resumo, não como texto.
    if (/^[-=]{3,}$/.test(limpa)) { if (texto.length) break; else continue; }
    if (limpa) texto.push(limpa);
    if (texto.join(' ').length > 200) break;
  }
  const frase = texto.join(' ').split(/(?<=\.)\s/)[0] || '(sem descrição)';
  return frase.length > 190 ? `${frase.slice(0, 187)}...` : frase;
}

// ------------------------------------------------------------------ montagem

const catalogo = telasDoCatalogo();
const registrados = renderizadoresRegistrados();
const legadas = telasLegadasNoApp();
const linhas = [];
const escrever = (t = '') => linhas.push(t);

const agora = new Date().toISOString().slice(0, 16).replace('T', ' ');
escrever('MAVISONE — MAPA DO SISTEMA');
escrever(`Gerado em ${agora} por scripts/mapa-do-sistema.js, lendo o código-fonte.`);
escrever('Rode o script de novo depois de qualquer mudança para atualizar este arquivo.');
escrever();
escrever('Como ler:');
escrever('  [ok]  a tela tem renderizador próprio (public/modules/<mod>/subs/)');
escrever('  [app] a tela é desenhada direto no app.js — das mais antigas do sistema');
escrever('  [--]  a tela está no menu e NADA a implementa (isso é um defeito)');
escrever('  [+]   existe renderizador, mas a tela não está no menu: só se chega a ela');
escrever('        por navegação interna (um botão de outra tela)');

// ---- 1. módulos e telas
escrever(titulo('1. MÓDULOS E TELAS'));
let totalTelas = 0;
let totalSemRender = 0;
const semRender = [];
for (const modulo of MODULOS) {
  const telas = catalogo[modulo.chave] || [];
  const temRender = registrados[modulo.chave] || new Set();
  escrever(subtitulo(`${modulo.nome}  (${modulo.chave})  —  ${telas.length} tela(s) no menu`));
  if (!telas.length) {
    escrever('  (sem sub-telas: o módulo é uma tela única)');
  }
  for (const tela of telas) {
    const marca = temRender.has(tela.key) ? '[ok] ' : (legadas.has(tela.key) ? '[app]' : '[--] ');
    if (marca === '[--] ') { totalSemRender += 1; semRender.push(`${modulo.chave}.${tela.key}`); }
    totalTelas += 1;
    escrever(`  ${marca} ${alinhar(tela.label, 34)} ${tela.desc || '(sem descrição)'}`);
  }
  const extras = [...temRender].filter((k) => !telas.some((t) => t.key === k)).sort();
  for (const extra of extras) {
    escrever(`  [+]  ${alinhar(extra, 34)} (tela interna, fora do menu)`);
  }
}
escrever();
escrever(`TOTAL: ${MODULOS.length} módulos, ${totalTelas} telas no menu.`);
escrever(totalSemRender
  ? `ATENÇÃO: ${totalSemRender} tela(s) no menu sem implementação: ${semRender.join(', ')}`
  : 'Nenhuma tela do menu ficou sem implementação.');

// ---- 2. regras de negócio
escrever(titulo('2. REGRAS DE NEGÓCIO (lib/)'));
escrever('Cada arquivo abaixo concentra uma decisão do sistema. A descrição é a que');
escrever('o próprio arquivo dá de si, no comentário de cabeçalho.');
escrever();
for (const arquivo of fs.readdirSync(path.join(RAIZ, 'lib')).filter((f) => f.endsWith('.js')).sort()) {
  escrever(`  lib/${arquivo}`);
  escrever(`      ${resumoDoArquivo(`lib/${arquivo}`)}`);
}

escrever(subtitulo('Módulos compartilhados entre navegador e servidor (public/modules/shared)'));
escrever('Carregados por <script> no navegador E por require() no server.js — uma');
escrever('regra só, para tela e servidor nunca discordarem.');
escrever();
const compartilhados = fs.readdirSync(path.join(RAIZ, 'public/modules/shared')).filter((f) => f.endsWith('.js')).sort();
for (const arquivo of compartilhados) {
  const caminho = `public/modules/shared/${arquivo}`;
  const noServidor = serverSrc.includes(`shared/${arquivo.replace('.js', '')}`);
  escrever(`  ${arquivo}${noServidor ? '   [também no servidor]' : ''}`);
  escrever(`      ${resumoDoArquivo(caminho)}`);
}

// ---- 3. acesso a dados
escrever(titulo('3. CAMADA DE DADOS'));
escrever('Produtos, pedidos, notas e cadastros ficam no Supabase (PostgreSQL).');
escrever('O razão de estoque, os metadados de produto e a auditoria local ficam em');
escrever('data/db.json — arquivo fora do controle de versão.');
escrever();
escrever(subtitulo('Arquivos de acesso (lib/db)'));
for (const arquivo of fs.readdirSync(path.join(RAIZ, 'lib/db')).filter((f) => f.endsWith('.js')).sort()) {
  const caminho = `lib/db/${arquivo}`;
  const src = ler(caminho);
  const doArquivo = new Set();
  for (const m of src.matchAll(/\.from\('([a-z_]+)'\)/g)) doArquivo.add(m[1]);
  for (const m of src.matchAll(/tabela:\s*'([a-z_]+)'/g)) doArquivo.add(m[1]);
  const resumo = resumoDoArquivo(caminho);
  escrever(`  lib/db/${arquivo}`);
  // Vários destes arquivos não têm comentário de cabeçalho. Em vez de repetir
  // "(sem descrição)", o mapa diz o que dá para afirmar lendo o código: quais
  // tabelas ele toca.
  if (resumo !== '(sem descrição)') escrever(`      ${resumo}`);
  if (doArquivo.size) escrever(`      tabelas: ${[...doArquivo].sort().join(', ')}`);
  else if (resumo === '(sem descrição)') escrever('      (sem descrição e sem tabela própria)');
}
const tabelas = tabelasSupabase();
escrever(subtitulo(`Tabelas usadas (${tabelas.length})`));
for (let i = 0; i < tabelas.length; i += 3) {
  escrever(`  ${tabelas.slice(i, i + 3).map((t) => alinhar(t, 24)).join('')}`.trimEnd());
}

// ---- 4. rotas
const listaRotas = rotas();
escrever(titulo(`4. ROTAS DA API (${listaRotas.length} encontradas no server.js)`));
escrever('Lidas do texto do server.js. Rotas com padrão (":id", prefixos) aparecem');
escrever('com reticências. Métodos em branco = a rota trata mais de um verbo.');
escrever();
for (const [caminho, metodos] of listaRotas) {
  const verbos = [...metodos].filter(Boolean).sort().join(' ');
  escrever(`  ${alinhar(caminho, 52)} ${verbos}`);
}

// ---- 5. migrações
escrever(titulo('5. MIGRAÇÕES DE BANCO'));
if (existe('supabase/migrations')) {
  const migracoes = fs.readdirSync(path.join(RAIZ, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  escrever(`${migracoes.length} arquivo(s) em supabase/migrations, em ordem de fase:`);
  escrever();
  for (const m of migracoes) escrever(`  ${m}`);
} else {
  escrever('  (pasta supabase/migrations não encontrada)');
}

// ---- 6. testes
escrever(titulo('6. TESTES'));
const testes = fs.readdirSync(path.join(RAIZ, 'scripts')).filter((f) => f.startsWith('test-') && f.endsWith('.js')).sort();
const pkg = JSON.parse(ler('package.json'));
const noNpmTest = (arquivo) => (pkg.scripts.test || '').includes(arquivo);
escrever(`${testes.length} arquivo(s) de teste. Rodam sem banco e sem rede: leem o código-fonte`);
escrever('e verificam regras puras. "[npm test]" = entra na suíte principal.');
escrever();
for (const t of testes) {
  escrever(`  ${noNpmTest(t) ? '[npm test]' : '[avulso] '} ${alinhar(t, 34)} ${resumoDoArquivo(`scripts/${t}`).slice(0, 110)}`);
}

// ---- 7. carregamento
escrever(titulo('7. CARREGAMENTO DO NAVEGADOR'));
const scripts = [...htmlSrc.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
escrever(`${scripts.length} arquivos JS carregados por public/index.html, nesta ordem.`);
escrever('A ordem importa: módulos compartilhados vêm antes de quem os usa.');
escrever();
for (const s of scripts) escrever(`  ${s}`);

escrever();
escrever('='.repeat(78));
escrever('FIM DO MAPA');
escrever('='.repeat(78));

const destino = path.join(RAIZ, 'MAPA-DO-SISTEMA.txt');
fs.writeFileSync(destino, `${linhas.join('\n')}\n`, 'utf8');
console.log(`MAPA-DO-SISTEMA.txt gerado — ${linhas.length} linhas.`);
console.log(`  ${MODULOS.length} módulos · ${totalTelas} telas · ${listaRotas.length} rotas · ${tabelas.length} tabelas · ${testes.length} testes`);
console.log(totalSemRender
  ? `  ATENÇÃO: ${totalSemRender} tela(s) sem implementação: ${semRender.join(', ')}`
  : '  Nenhuma tela do menu ficou sem implementação.');
