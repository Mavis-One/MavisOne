// RLS: toda tabela do schema precisa estar na fase-af.
//
// O ponto deste teste não é a fase-af de hoje — é a tabela que alguém vai criar
// amanhã. RLS é do tipo de proteção que ninguém percebe faltando: a tela
// funciona igual, e a tabela nova é a que fica aberta.
//
// A HISTÓRIA, porque ela muda o que este teste significa hoje:
//
//   22/08/2026 — o schema não tinha um único `enable row level security`, e o
//   Supabase publicava o PostgREST na internet com a chave `anon`, que é
//   pública por natureza. users, people, orders, nfe e certificado_digital
//   estavam legíveis para qualquer um com aquela chave. A fase-af fechou.
//
//   31/08/2026 — o banco saiu do Supabase e virou Postgres em Docker. Não há
//   PostgREST, não há chave anon, e a porta fica presa em 127.0.0.1: a porta
//   que a RLS trancava deixou de existir.
//
// Então por que o teste continua? Porque "a porta não existe" é uma propriedade
// da INFRAESTRUTURA de hoje, e infraestrutura muda por decisão de uma pessoa
// numa tarde. A RLS é a camada que continua de pé se alguém publicar este banco
// de novo — e manter todas as tabelas no mesmo padrão é o que faz a proteção
// valer sem depender de ninguém lembrar. As últimas seções conferem a
// infraestrutura nova; as primeiras continuam conferindo a camada de baixo.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const DIR = path.join(RAIZ, 'supabase', 'migrations');
const ARQ_RLS = 'supabase/migrations/fase-af-rls-fechar-porta-publica.sql';
const rls = ler(ARQ_RLS);

console.log('--- a fase-af existe e não inventa política ---');
check('a migração existe', rls.length > 0);
// Política permissiva para anon reabriria exatamente o que a fase fecha.
//
// Sem comentários: a primeira versão deste check acusou o próprio comentário
// que EXPLICA a decisão (a frase "zero create policy no schema"). Teste que
// reclama de texto em vez de comando ensina a esconder a palavra.
const semComentario = (sql) => sql.replace(/--.*$/gm, '');
check('nenhuma policy permissiva foi criada', !/create\s+policy/i.test(semComentario(rls)));
check('e explica por que RLS aqui não filtra empresa', /IGNORA RLS/.test(rls));
check('diz como voltar atrás', /disable row level security/.test(rls));

console.log('\n--- toda tabela declarada no schema tem RLS ligada ---');
// A lista de tabelas sai do que as migrações e o schema DECLARAM criar. Assim,
// tabela nova entra na conta sozinha, sem ninguém lembrar de atualizar aqui.
const arquivos = fs.readdirSync(DIR).filter((n) => n.endsWith('.sql') && !n.startsWith('PENDENTES'));
const fontes = ['supabase/schema.sql', ...arquivos.map((n) => `supabase/migrations/${n}`)];
const declaradas = new Set();
for (const rel of fontes) {
  const sql = ler(rel);
  // Só CREATE TABLE: `alter table` casaria com texto de comentário — foi assim
  // que uma "tabela" chamada `em` entrou num levantamento anterior, vinda de
  // "ALTER TABLE em nfe_itens" escrito em português.
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z_0-9]*)/gi)) {
    declaradas.add(m[1].toLowerCase());
  }
}
// O RLS de uma tabela mora na migração que a CRIA, e não retroativamente na
// fase-af: a fase-af fechou as 77 que existiam quando ela foi escrita. Tabela
// criada depois liga a própria — procurar só na fase-af acusaria falta de RLS
// numa tabela que já está fechada.
const comRls = new Set();
for (const rel of fontes) {
  for (const m of ler(rel).matchAll(/alter\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z_0-9]*)\s+enable\s+row\s+level\s+security/gi)) {
    comRls.add(m[1].toLowerCase());
  }
}

console.log(`    tabelas declaradas no schema: ${declaradas.size}`);
console.log(`    tabelas com RLS declarada   : ${comRls.size}`);
const semRls = [...declaradas].filter((t) => !comRls.has(t)).sort();
check('nenhuma tabela declarada ficou sem RLS', semRls.length === 0,
  semRls.length ? 'FALTANDO: ' + semRls.join(', ') : 'ok');

// O contrário também importa: RLS numa tabela que não existe é comando que
// falha no SQL Editor e faz a pessoa achar que a migração está quebrada.
const inexistentes = [...comRls].filter((t) => !declaradas.has(t)).sort();
check('e nenhuma migração cita tabela que ninguém cria', inexistentes.length === 0,
  inexistentes.length ? 'INVENTADAS: ' + inexistentes.join(', ') : 'ok');

console.log('\n--- a porta que a fase-af fechava não existe mais (Docker) ---');
// A fase-af ligou RLS para tapar o PostgREST, que o Supabase publica na
// internet com uma chave "anon" que é pública por natureza. Com o banco em
// Docker, não há PostgREST, não há chave anon e não há API HTTP nenhuma na
// frente do Postgres: a porta que a RLS trancava foi removida junto com o
// Supabase. A RLS fica ligada assim mesmo — ver o comentário da fase-am.
const cliente = ler('lib/db/client.js');
const conexao = ler('lib/db/conexao.js');
check('o cliente não fala HTTP com o banco', !/https?:\/\/|fetch\(|createClient/.test(cliente));
check('a conexão é por DATABASE_URL, uma só', /process\.env\.DATABASE_URL/.test(conexao));
check('e não sobrou chave do Supabase sendo lida', !/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_URL/.test(cliente + conexao));

// A razão de tudo continuar funcionando com RLS ligada: o app conecta como
// DONO das tabelas, e dono passa por cima de RLS. Se alguém escrever "force row
// level security" numa migração, o sistema inteiro para de ler o próprio banco
// — e o erro seria "0 linhas", não uma exceção, que é o pior tipo de quebra.
// Sem os comentários: a própria fase-am EXPLICA por escrito que não existe
// "force row level security" em lugar nenhum, e a frase da explicação casaria
// com a busca. Comentário citando um comando não executa comando — é o mesmo
// cuidado que scripts/verificar-migracoes.js já toma para não inventar tabela.
const migracoes = fs.readdirSync(path.join(RAIZ, 'supabase', 'migrations'))
  .filter((n) => n.endsWith('.sql'))
  .map((n) => fs.readFileSync(path.join(RAIZ, 'supabase', 'migrations', n), 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*--.*$/gm, '');
check('nenhuma migração usa "force row level security"', !/force\s+row\s+level\s+security/i.test(migracoes));

// O compose não pode publicar o Postgres na rede. No Linux o Docker escreve
// direto no iptables e passa por cima do firewall do sistema: "5432:5432" põe
// o banco na internet sem que nenhuma regra de firewall avise.
const compose = ler('docker-compose.yml');
check('a porta do banco está presa em 127.0.0.1', /"127\.0\.0\.1:\$\{POSTGRES_PORT:-5432\}:5432"/.test(compose),
  (compose.match(/^\s*-\s*"[^"]*:5432"/m) || ['(não achei o mapeamento)'])[0].trim());

check('e não há cliente de banco no navegador',
  !/createClient\s*\(|DATABASE_URL/.test(ler('public/app.js')));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
