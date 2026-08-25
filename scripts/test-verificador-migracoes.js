#!/usr/bin/env node
// O verificador de migrações precisa estar certo sobre o que ele NÃO sabe.
//
// O defeito que este teste existe para pegar já aconteceu: o regex que lê as
// migrações exigia "alter table IF EXISTS <t> add column", e a fase-v escreve
// "alter table regra_fiscal add column". Resultado em cadeia:
//
//   1. a fase-v não declarava coluna nenhuma aos olhos do script;
//   2. sem estrutura declarada, ela caía em "sem estrutura a conferir";
//   3. esse estado não entrava na lista de pendentes;
//   4. o script imprimia "BANCO EM DIA" — com as duas colunas do DIFAL
//      faltando, a tela Regras Fiscais dando erro em toda gravação e a emissão
//      de NF-e bloqueada por baixo.
//
// Um verificador que erra para MAIS é pior do que não ter verificador: ele é
// consultado justamente antes de subir versão, e devolve uma garantia que não
// tem. Por isso os dois lados viram teste — o que ele lê e o que ele afirma.
//
// Não precisa de banco: lê o próprio fonte do script.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const src = ler('scripts/verificar-migracoes.js');

console.log('--- o regex enxerga as duas formas de alterar tabela ---');
// Extrai o regex do próprio fonte e roda contra SQL de verdade: assim o teste
// verifica o COMPORTAMENTO da leitura, não a presença de um texto.
const linhaColunas = src.match(/const colunas = \[\.\.\.sql\.matchAll\((\/.+\/gi)\)\]/);
check('o script declara o regex de colunas', Boolean(linhaColunas), linhaColunas ? 'achado' : 'NÃO ACHADO');

if (linhaColunas) {
  const corpo = linhaColunas[1].replace(/^\//, '').replace(/\/gi$/, '');
  const regex = new RegExp(corpo, 'gi');
  const casar = (sql) => [...sql.matchAll(new RegExp(regex.source, 'gi'))].map((m) => `${m[1]}.${m[2]}`);

  check('pega a forma COM "if exists"',
    casar('alter table if exists pedidos add column if not exists frete numeric;')[0] === 'pedidos.frete');
  check('pega a forma SEM "if exists" (a que escondia a fase-v)',
    casar('alter table regra_fiscal add column if not exists aliquota_fcp_uf_destino numeric(5,2);')[0] === 'regra_fiscal.aliquota_fcp_uf_destino');
  check('pega também sem "if not exists"',
    casar('alter table produtos add column ncm text;')[0] === 'produtos.ncm');

  // A prova final: o arquivo real da fase-v tem que render as duas colunas.
  const faseV = ler('supabase/migrations/fase-v-difal-e-pagamento.sql');
  const achadas = casar(faseV);
  check('a fase-v real declara as 2 colunas do DIFAL', achadas.length === 2, achadas.join(', '));
  check('inclusive a que quebrava as Regras Fiscais',
    achadas.includes('regra_fiscal.aliquota_fcp_uf_destino'));
}

console.log('\n--- "não sei conferir" não pode se parecer com "está certo" ---');
check('existe o estado NÃO CONFERIDA', /'NÃO CONFERIDA'/.test(src));
check('e ele não é mais chamado de "sem estrutura a conferir"', !/sem estrutura a conferir/.test(src));
check('as não conferidas são acumuladas à parte', /const naoConferidas = \[\]/.test(src));
check('e listadas com nome no fim', /naoConferidas\.forEach/.test(src));
// O ponto todo: quando sobra algo por conferir, o veredito precisa dizer que
// foi parcial — e o "BANCO EM DIA" limpo tem que ficar no outro ramo.
check('existe um veredito parcial', /EM DIA no que dá para conferir/.test(src));
check('e o "BANCO EM DIA" limpo é o outro ramo do mesmo ternário',
  /:\s*'===== BANCO EM DIA =====/.test(src));

console.log('\n--- a trava de deploy continua de pé ---');
// Migração que só insere dado ou cria índice não tem coluna a conferir e isso
// não é erro: a ressalva aparece, mas a saída segue 0. Só pendente derruba.
check('pendente ainda sai com código 1', /pendentes\.length[\s\S]{0,600}process\.exit\(1\)/.test(src));
check('e a ressalva sozinha sai com 0', /naoConferidas\.length[\s\S]{0,200}process\.exit\(0\)/.test(src));

console.log('\n--- o pacote para colar no SQL Editor é fiel às fases ---');
// A primeira versão deste bloco cobrava uma fase POR NOME ("o pacote traz a
// fase-v"). Envelheceu em um dia: a fase-v foi aplicada, saiu do pacote — como
// devia — e o teste passou a acusar o comportamento CERTO. O que não envelhece
// é a relação entre o pacote e os arquivos de fase.
const pacote = ler('supabase/migrations/PENDENTES-rodar-agora.sql');
check('o verificador continua ignorando o pacote', /^--\s*CONSOLIDADO/im.test(pacote));

const comandos = (texto) => [...texto.matchAll(/^\s*alter\s+table[^;]+;/gim)].map((m) => m[0].replace(/\s+/g, ' ').trim());
const doPacote = comandos(pacote);
const fasesCitadas = [...pacote.matchAll(/^--\s*>>>\s*(\S+\.sql)/gm)].map((m) => m[1]);

// "Nada pendente" é estado legítimo, e este bloco não previa: exigia fase
// citada sempre. Quando a fase-ae foi aplicada e saiu do pacote — como devia —
// o teste passaria a acusar o comportamento CERTO, pelo mesmo motivo que a
// versão anterior cobrava a fase-v pelo nome. O que vale é a coerência: pacote
// sem fase citada não pode ter SQL solto, senão manda rodar no banco algo que
// ninguém sabe de onde veio.
if (!fasesCitadas.length) {
  check('pacote sem fase citada está vazio de SQL', doPacote.length === 0, doPacote.slice(0, 2).join(' | ') || undefined);
  check('e diz, em texto, que não há nada pendente', /NADA PENDENTE/i.test(pacote));
} else {
  check('o pacote diz de quais fases veio', true, fasesCitadas.join(', '));
}

// Um pacote que inventa SQL, ou que cita arquivo inexistente, manda rodar no
// banco algo que não está versionado em lugar nenhum.
const dasFases = fasesCitadas.flatMap((nome) => {
  const caminho = path.join(RAIZ, 'supabase', 'migrations', nome);
  return fs.existsSync(caminho) ? comandos(ler(`supabase/migrations/${nome}`)) : [`ARQUIVO INEXISTENTE: ${nome}`];
});
fasesCitadas.forEach((nome) => {
  check(`  ${nome} existe`, fs.existsSync(path.join(RAIZ, 'supabase', 'migrations', nome)));
});
const inventados = doPacote.filter((c) => !dasFases.includes(c));
check('nenhum comando do pacote foi inventado', inventados.length === 0, inventados.slice(0, 2).join(' | ') || undefined);
const esquecidos = dasFases.filter((c) => !doPacote.includes(c));
check('e nenhum comando das fases citadas ficou de fora', esquecidos.length === 0, esquecidos.slice(0, 2).join(' | ') || undefined);

// ---------------------------------------------------------------------------
// RECRIAR O BANCO DO ZERO — a ordem das fases não é a ordem alfabética.
//
// Esta é a regra que, quebrada, só aparece como "relation does not exist" no
// meio de um arquivo de 4 mil linhas, num banco novo, provavelmente no dia em
// que alguém está com pressa. 'fase-aa' vem antes de 'fase-h' em qualquer
// listagem de pasta — e rodar nessa ordem tenta alterar tabela que ainda não
// foi criada.
// ---------------------------------------------------------------------------
console.log('\n--- a recriação do zero sai na ordem das FASES, não da pasta ---');
const { ordenarPorFase } = require('./gerar-sql-do-zero');
const nomes = fs.readdirSync(path.join(RAIZ, 'supabase', 'migrations'))
  .filter((n) => n.endsWith('.sql') && !n.startsWith('PENDENTES'));
const ordenados = ordenarPorFase(nomes);
const fase = (n) => (/^fase-([a-z]+)-/i.exec(n) || [])[1] || '';
check('uma letra vem antes de duas (z antes de aa)',
  ordenados.findIndex((n) => fase(n) === 'z') < ordenados.findIndex((n) => fase(n) === 'aa'),
  `z na posição ${ordenados.findIndex((n) => fase(n) === 'z')}, aa na ${ordenados.findIndex((n) => fase(n) === 'aa')}`);
check('  e a ordem alfabética crua faria o contrário',
  nomes.slice().sort().findIndex((n) => fase(n) === 'aa') < nomes.slice().sort().findIndex((n) => fase(n) === 'z'));
check('dentro do mesmo tamanho, é alfabética',
  ordenados.findIndex((n) => fase(n) === 'ak') < ordenados.findIndex((n) => fase(n) === 'al'));
check('nenhuma migração fica de fora do arquivo do zero', ordenados.length === nomes.length,
  `${ordenados.length} de ${nomes.length}`);
// O arquivo gerado precisa existir e citar as mesmas fases, senão quem recriar
// o banco vai colar uma versão velha sem saber.
const zero = path.join(RAIZ, 'supabase', 'RECRIAR-DO-ZERO.sql');
if (fs.existsSync(zero)) {
  const conteudo = ler('supabase/RECRIAR-DO-ZERO.sql');
  const faltando = ordenados.filter((n) => !conteudo.includes(n));
  check('o arquivo gerado traz todas as migrações', faltando.length === 0, faltando.slice(0, 3).join(', ') || undefined);
  check('  e o schema.sql vem primeiro',
    conteudo.indexOf('supabase/schema.sql') < conteudo.indexOf(`supabase/migrations/${ordenados[0]}`));
  check('  e avisa que a senha semente é pública', /senha/i.test(conteudo) && /p[úu]blic/i.test(conteudo));
} else {
  check('o arquivo do zero existe (rode: npm run zero)', false, 'supabase/RECRIAR-DO-ZERO.sql não encontrado');
}

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
