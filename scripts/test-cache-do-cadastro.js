// AS TRÊS LISTAS DO CADASTRO FICAM EM MEMÓRIA — e o que faz isso ser seguro.
//
// O PROBLEMA, MEDIDO
// ------------------
// `syncCadastroData` lê people + cnpjs + deposits, e é chamada por quase toda
// rota do sistema. O peso está em `people.extra`, um jsonb de ~887 bytes por
// pessoa — 5,6 MB nas 6.492 desta base, 25 chaves cada.
//
//     select * de people (6.492 linhas) ..... 93,7 ms
//
// Pagos de novo a cada requisição, para dado que muda quando alguém cadastra um
// cliente. Guardando as linhas e remapeando: 1,9 ms — 48x.
//
// O QUE NÃO FOI FEITO, E POR QUÊ
// ------------------------------
// A tentativa óbvia é cortar `extra` do select para quem só precisa do nome.
// Sem ela: 30 ms. Medido, e descartado.
//
// `mapPersonRow` faz `...(row.extra || {})`: as 25 chaves ficam no PRIMEIRO
// NÍVEL do objeto, indistinguíveis de coluna real. Cortar `extra` transforma
// cada uma em `undefined` — sem erro e sem aviso. E não dá para saber quem as
// lê: varri lib/, public/ e server.js e 36 chaves têm leitor espalhado por 20
// arquivos, com nomes genéricos (`notes`, `roles`, `paymentMethod`, `country`)
// que aparecem em adquirentes, categorias de venda, equipamentos, origens,
// permissões de usuário e lançamentos financeiros. Nenhuma análise estática
// separa. E `test-sync-obrigatorio.js` não protegeria: ele vigia COLEÇÃO lida
// sem sync, não coluna ausente do recorte.
//
// O cache não tem esse risco: o dado é o mesmo, completo. Só não é buscado de
// novo.
//
// O QUE FOI PROVADO À PARTE, contra o banco real (17 checks):
//
//     1ª leitura 293 ms · 2ª 2 ms · 3ª 2 ms ............ 147x
//     JSON byte a byte igual ao do banco ............... 6.492 pessoas
//     as chaves do extra continuam lá ................. 54 campos, ibgeCityCode
//     mutação numa chamada NÃO vaza para a seguinte
//     cadastrar aparece na hora ....................... 6.492 -> 6.493
//     editar e excluir também
//     4 leituras simultâneas com cache frio ........... 103 ms (uma: 293 ms)
//
// E o efeito nas rotas, mediana de seis:
//
//     Financeiro: lançamentos ..... 106 ms -> 16 ms
//     Compras: painel .............. 139 ms -> 15 ms
//     Vendas: pedidos .............. 154 ms -> 53 ms
//     Estoque: produtos ............ 333 ms -> 149 ms
//     Painel ....................... 296 ms -> 215 ms
//
// SEM BANCO: este teste lê fonte. É o comportamento que foi medido à parte.
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

const cadastros = semComentarios(ler('lib/db/cadastros.js'));

console.log('--- o cache existe, com TTL configurável ---');
check('o TTL sai de variável de ambiente',
  /const CADASTRO_CACHE_MS = Number\(process\.env\.DATABASE_CADASTRO_CACHE_MS \|\| 30000\);/.test(cadastros));
check('  e está documentado no .env.example',
  /DATABASE_CADASTRO_CACHE_MS=30000/.test(ler('.env.example')));
// Zero desliga, e a nota do .env.example diz isso. Eu tinha escrito o
// contrário, e a medição me corrigiu: com 0, as leituras voltam a 94-101 ms.
check('  e a nota diz que zero DESLIGA', /Zero DESLIGA o cache/.test(ler('.env.example')));
check('as três leituras passam pelo cache',
  /async function getPeople\(\) \{\s*\n\s*return lerComCache\('people', mapPersonRow\);/.test(cadastros)
  && /async function getCnpjs\(\) \{\s*\n\s*return lerComCache\('cnpjs', mapCnpjRow\);/.test(cadastros)
  && /async function getDeposits\(\) \{\s*\n\s*return lerComCache\('deposits', mapDepositRow\);/.test(cadastros));

console.log('\n--- REMAPEIA, e não devolve o array guardado ---');
// Devolvendo o mesmo array, um `pessoa.nome = x` em qualquer rota entraria no
// cache e apareceria para todas as outras — o tipo de defeito que não se acha
// procurando. Remapear custa 1,9 ms e dá objetos novos a cada chamada.
check('o cache guarda LINHA CRUA e mapeia na saída',
  /return \(await guardado\.linhas\)\.map\(mapear\);/.test(cadastros)
  && /return \(await promessa\)\.map\(mapear\);/.test(cadastros));
check('  e não guarda o resultado já mapeado',
  !/cacheDoCadastro\.set\(tabela, \{ em: Date\.now\(\), dados:/.test(cadastros),
  'objeto compartilhado entre rotas seria mutável por qualquer uma');

console.log('\n--- uma rajada com cache frio = UMA ida ao banco ---');
// A promessa entra no cache ANTES de resolver. Sem isso, a rajada que abre uma
// tela (várias rotas ao mesmo tempo) dispararia vários `select *` de 93 ms.
const posSet = cadastros.indexOf('cacheDoCadastro.set(tabela');
const posAwait = cadastros.indexOf('return (await promessa)');
check('a promessa é guardada antes de ser esperada',
  posSet > -1 && posAwait > posSet, `guarda ${posSet}, espera ${posAwait}`);
check('  e falha NÃO fica guardada',
  /cacheDoCadastro\.delete\(tabela\);\s*\n\s*throw erro;/.test(cadastros),
  'senão o erro se repetiria por 30 segundos');

console.log('\n--- TODA escrita invalida (é isto que faz o cache ser correto) ---');
// Cadastrou um cliente e ele não aparece na lista: é o defeito que este cache
// pode causar, e a única defesa é nenhuma escrita escapar.
const ESCRITAS = ['createPerson', 'updatePerson', 'deletePerson',
  'createCnpj', 'updateCnpj', 'deleteCnpj',
  'createDeposit', 'updateDeposit', 'deleteDeposit'];
for (const fn of ESCRITAS) {
  const ini = cadastros.indexOf(`async function ${fn}(`);
  const corpo = ini > -1 ? cadastros.slice(ini, cadastros.indexOf('\n}', ini)) : '';
  check(`  ${fn.padEnd(14)} esquece o cache`, /esquecerCadastro\('(people|cnpjs|deposits)'\)/.test(corpo));
}
const invalidacoes = (cadastros.match(/esquecerCadastro\('(people|cnpjs|deposits)'\)/g) || []).length;
check('são nove invalidações, uma por escrita', invalidacoes === 9, `${invalidacoes}`);
check('e o esquecimento é exportado', /esquecerCadastro\s*\n?\s*\};/.test(cadastros)
  || /  esquecerCadastro/.test(cadastros), 'quem escreve por fora precisa poder avisar');

console.log('\n--- e NINGUÉM escreve nessas tabelas por fora ---');
// ESTE é o guarda que importa para o futuro. Uma rota nova que insira ou altere
// essas tabelas pela camada de consulta, sem passar pelas funções deste arquivo,
// deixa o cache velho por até 30s — e o sintoma é "cadastrei e não apareceu":
// intermitente, sem erro, impossível de reproduzir sob demanda.
//
// SEM ESCREVER A CADEIA DE EXEMPLO AQUI, de propósito. scripts/test-sql-compat.js
// varre `scripts/` procurando métodos encadeados num `from(...)` e lê o fonte CRU,
// cometários inclusive — uma cadeia escrita em prosa abre uma janela que varre
// até o próximo `;` e colhe os métodos do código abaixo. Foi o que aconteceu: ele
// acusou um operador `filter` inexistente, que era o `Array.filter` de três
// linhas adiante. O padrão está na constante ESCREVE, que é código de verdade.
//
// Scripts ficam de fora de propósito: rodam em OUTRO processo, com pool e cache
// próprios, e não têm como sujar o cache do servidor.
const FONTES = ['server.js'].concat(
  fs.readdirSync(path.join(RAIZ, 'lib')).filter((f) => f.endsWith('.js')).map((f) => `lib/${f}`),
  fs.readdirSync(path.join(RAIZ, 'lib/db')).filter((f) => f.endsWith('.js')).map((f) => `lib/db/${f}`)
).filter((f) => f !== 'lib/db/cadastros.js');

const ESCREVE = /from\('(people|cnpjs|deposits)'\)\s*\.\s*(insert|update|delete|upsert)|\b(insert into|update|delete from)\s+(people|cnpjs|deposits)\b/i;
const forasteiros = FONTES.filter((f) => ESCREVE.test(ler(f)));
check('nenhum fonte de lib/ ou server.js escreve direto', forasteiros.length === 0,
  forasteiros.length ? forasteiros.join(', ') : `${FONTES.length} conferidos`);

console.log('\n--- e o custo em memória está anotado onde a decisão mora ---');
// O cache só é seguro porque o processo é UM. ecosystem.config.js já explicava
// por que fork/1 (o contador de tentativas de login); agora explica dois.
const eco = ler('ecosystem.config.js');
check('ecosystem.config.js fixa uma instância', /instances: 1,/.test(eco) && /exec_mode: 'fork'/.test(eco));
check('  e diz que o cache do cadastro depende disso',
  /cache do cadastro/.test(eco),
  'em cluster, a escrita de um trabalhador não avisaria os outros');

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
process.exit(falhas === 0 ? 0 : 1);
