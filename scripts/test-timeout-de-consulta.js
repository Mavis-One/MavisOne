// TODA CONSULTA TEM TETO DE TEMPO — e a migração é a única isenta.
//
// O DEFEITO: o pool tinha `connectionTimeoutMillis`, que limita PEGAR uma
// conexão, e nada limitando a consulta depois de pegá-la. Uma consulta que
// nunca volta — banco sobrecarregado, lock esperando outra transação, índice
// faltando numa tabela que cresceu — segurava a conexão para sempre.
//
// Dez delas assim e o pool acaba (são 10 conexões). Daí em diante TODA
// requisição fica na fila do connectionTimeoutMillis, leva 10s e responde erro:
// o sistema inteiro para por causa de uma consulta, e nada no log diz qual.
//
// Provado com pg_sleep contra o banco real, com o teto em 1s:
//
//   pg_sleep(0.2) ..... completa em 207 ms
//   pg_sleep(10) ...... cancelada em 1.007 ms, código 57014 (query_canceled)
//   12 consultas depois do cancelamento ..... 12 de 12 respondem
//
// As 12 importam mais que o cancelamento: são mais que as 10 conexões do pool.
// Se a consulta cancelada tivesse ficado presa, travariam.
//
// SÃO DOIS TETOS, E O PRIMEIRO NÃO BASTA. `statement_timeout` é imposto pelo
// POSTGRES — com o container pausado não há quem aborte, e a consulta fica
// pendurada com o teto configurado e tudo. Medido em 28/09/2026 com
// `docker pause`: teto do banco em 2s, e a consulta passou de 15s sem resposta.
// Foi o que me escapou na primeira versão desta correção. `query_timeout` é o
// Node desistindo, e fecha esse caso: "Query read timeout" em 3.001 ms.
//
// A ORDEM É DELIBERADA: o do driver (35s) fica ACIMA do do banco (30s). Com o
// banco vivo, quem cancela deve ser o Postgres, porque o erro dele nomeia o
// comando e traz o código 57014; o do driver é genérico. Medido com 1s/5s: o
// erro veio do banco, em 1.035 ms.
//
// A ISENÇÃO DA MIGRAÇÃO precisa dos DOIS, e é a parte que merece guarda própria.
// `create index` sobre tabela grande passa de 30s sem nada estar errado, e ser
// cancelado no meio é exatamente o que scripts/aplicar-migracoes.js existe para
// evitar. No banco a isenção é `set local` (morre com a transação) e não `set` —
// provado que o teto volta: depois da transação, 12 de 12 consultas longas foram
// canceladas, ou seja, nenhuma conexão voltou ao pool sem limite. No driver não
// existe comando SQL que desligue, então é variável de ambiente, e o pool a lê
// porque nasce preguiçoso. Provado: com os dois desligados uma transação de 8s
// passa; com só o do banco desligado, o driver corta.
//
// SEM BANCO: este teste lê fonte. O efeito foi medido à parte, contra o
// Postgres local, e os números estão acima.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const conexao = semComentarios(ler('lib/db/conexao.js'));
const migrar = semComentarios(ler('scripts/aplicar-migracoes.js'));

console.log('--- o pool põe teto em toda consulta ---');
check('statement_timeout está na configuração do pool',
  /statement_timeout: Number\(process\.env\.DATABASE_STATEMENT_TIMEOUT_MS \|\| 30000\)/.test(conexao));
// O padrão NÃO pode ser zero nem ausente: seria o defeito de volta, com uma
// chave de configuração dando a impressão de que há proteção.
check('  com padrão diferente de zero', !/DATABASE_STATEMENT_TIMEOUT_MS \|\| 0\b/.test(conexao));
// E tem de continuar sendo o pool, num lugar só: um `set statement_timeout`
// espalhado por rota protegeria as rotas que alguém lembrou de proteger.
const setsSoltos = (conexao.match(/set statement_timeout/g) || []).length;
check('  e não há set solto em lib/db/conexao.js', setsSoltos === 0, `${setsSoltos} encontrado(s)`);

console.log('\n--- e o teto do DRIVER, porque o do banco nao cobre banco congelado ---');
// `statement_timeout` e imposto pelo POSTGRES. Container pausado, maquina
// travada ou rede que engole pacote sem fechar o socket: nao ha quem aborte, e
// a consulta fica pendurada com o teto configurado e tudo.
//
// Medido em 28/09/2026 com `docker pause` e uma conexao JA OCIOSA no pool --
// o caso ruim, porque numa conexao nova o connectionTimeoutMillis pegaria:
//
//   so com statement_timeout (2s) ..... passou de 15s sem resposta
//   com query_timeout (3s) ............ "Query read timeout" em 3.001 ms
//
// E o banco voltou a responder normalmente depois do `unpause` nos dois casos.
check('query_timeout esta na configuracao do pool',
  /query_timeout: Number\(process\.env\.DATABASE_QUERY_TIMEOUT_MS \|\| 35000\)/.test(conexao));
// ACIMA do teto do banco, de proposito. Com o banco vivo, quem cancela tem de
// ser o Postgres: o erro dele nomeia o comando e traz o codigo 57014, e o do
// driver e generico ("Query read timeout") porque ele nao sabe o que houve.
// Invertida, a ordem trocaria todo erro bom por um erro generico.
const tetoBanco = Number((conexao.match(/DATABASE_STATEMENT_TIMEOUT_MS \|\| (\d+)/) || [])[1]);
const tetoDriver = Number((conexao.match(/DATABASE_QUERY_TIMEOUT_MS \|\| (\d+)/) || [])[1]);
check('  e o do driver e MAIOR que o do banco', tetoDriver > tetoBanco,
  `banco ${tetoBanco} ms, driver ${tetoDriver} ms`);
// Provado: com banco vivo e teto de 1s/5s, o erro veio do banco (57014) em
// 1.035 ms -- nao do driver.
check('  com padrao diferente de zero', !/DATABASE_QUERY_TIMEOUT_MS \|\| 0\b/.test(conexao));

console.log('\n--- e o de pegar conexão continua lá: são coisas diferentes ---');
check('connectionTimeoutMillis não foi substituído',
  /connectionTimeoutMillis: Number\(process\.env\.DATABASE_TIMEOUT_MS \|\| 10000\)/.test(conexao),
  'um limita pegar a conexão, o outro limita a consulta');
check('o ouvinte de erro do cliente ocioso continua',
  /pool\.on\('error'/.test(conexao),
  'sem ele, o Node cai quando o banco reinicia');

console.log('\n--- a migração é isenta, e a isenção morre com a transação ---');
check('a migração desliga o teto', /set local statement_timeout = 0/.test(migrar));
// `set local` e não `set`: com `set`, a conexão volta ao pool SEM limite, e a
// próxima rota que a pegasse ficaria desprotegida sem ninguém saber.
check('  com set LOCAL, não set global',
  /set local statement_timeout = 0/.test(migrar) && !/query\('set statement_timeout/.test(migrar));
// Dentro da transação da migração, e antes do SQL dela: depois não adiantaria.
const posSet = migrar.indexOf('set local statement_timeout = 0');
const posSql = migrar.indexOf('cliente.query(migracao.sql)');
const posTransacao = migrar.indexOf('await emTransacao(');
check('  dentro da transação da migração', posTransacao > -1 && posSet > posTransacao,
  `transação ${posTransacao}, set ${posSet}`);
check('  e ANTES do SQL da migração', posSet > -1 && posSql > posSet, `sql ${posSql}`);
// A ISENCAO PRECISA DOS DOIS TETOS, e este e o que me escapou na primeira
// versao: `set local` fala com o Postgres e nao alcanca o driver. Com o driver
// em 35s, um `create index` de dois minutos morreria aos 35s por decisao do
// Node -- e nao existe comando SQL que o desligue.
check('a migração também desliga o teto do driver',
  /process\.env\.DATABASE_QUERY_TIMEOUT_MS = '0';/.test(migrar));
// Antes do require do pool, porque o pool nasce PREGUICOSO e le process.env na
// primeira consulta. Depois do require ainda funcionaria; antes deixa claro.
const posEnv = migrar.indexOf("DATABASE_QUERY_TIMEOUT_MS = '0'");
const posRequire = migrar.indexOf("require('../lib/db/conexao')");
check('  antes de exigir o pool', posEnv > -1 && posRequire > posEnv,
  `env ${posEnv}, require ${posRequire}`);
// Provado: com os dois desligados, uma transacao de 8s passa; com so o do banco
// desligado, o driver corta e devolve "Query read timeout".

console.log('\n--- e ninguém mais se isenta ---');
// A isenção é da migração, e de mais ninguém. Um `statement_timeout = 0` em
// server.js ou numa lib seria o teto desligado para tráfego normal.
const FONTES = ['server.js'].concat(
  fs.readdirSync(path.join(RAIZ, 'lib')).filter((f) => f.endsWith('.js')).map((f) => `lib/${f}`),
  fs.readdirSync(path.join(RAIZ, 'lib/db')).filter((f) => f.endsWith('.js')).map((f) => `lib/db/${f}`)
);
const isentos = FONTES.filter((f) => /statement_timeout\s*=\s*0/.test(ler(f)));
check('nenhum fonte de lib/ ou server.js desliga o teto', isentos.length === 0,
  isentos.length ? isentos.join(', ') : `${FONTES.length} conferidos`);

console.log('\n--- a variável está documentada ---');
const exemplo = ler('.env.example');
check('DATABASE_STATEMENT_TIMEOUT_MS aparece no .env.example',
  /DATABASE_STATEMENT_TIMEOUT_MS=30000/.test(exemplo));
check('DATABASE_QUERY_TIMEOUT_MS também',
  /DATABASE_QUERY_TIMEOUT_MS=35000/.test(exemplo));
check('  explicando a diferença do outro timeout',
  /limita PEGAR a conex/.test(exemplo) && /esgotam o/.test(exemplo));

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
process.exit(falhas === 0 ? 0 : 1);
