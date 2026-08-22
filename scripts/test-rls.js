// RLS: toda tabela do schema precisa estar na fase-af.
//
// O ponto deste teste não é a fase-af de hoje — é a tabela que alguém vai criar
// amanhã. RLS é do tipo de proteção que ninguém percebe faltando: a tela
// funciona igual (o app usa service_role, que ignora RLS), e a tabela nova
// fica legível para qualquer um com a chave `anon`, que é pública por natureza.
//
// Conferido em 22/08/2026: o schema não tinha um único `enable row level
// security`. Ou seja, users, people, orders, nfe e certificado_digital estavam
// abertos no PostgREST.
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
const comRls = new Set([...rls.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z_0-9]*)\s+enable\s+row\s+level\s+security/gi)]
  .map((m) => m[1].toLowerCase()));

console.log(`    tabelas declaradas no schema: ${declaradas.size}`);
console.log(`    tabelas com RLS na fase-af  : ${comRls.size}`);
const semRls = [...declaradas].filter((t) => !comRls.has(t)).sort();
check('nenhuma tabela declarada ficou sem RLS', semRls.length === 0,
  semRls.length ? 'FALTANDO: ' + semRls.join(', ') : 'ok');

// O contrário também importa: RLS numa tabela que não existe é comando que
// falha no SQL Editor e faz a pessoa achar que a migração está quebrada.
const inexistentes = [...comRls].filter((t) => !declaradas.has(t)).sort();
check('e a fase-af não cita tabela que ninguém cria', inexistentes.length === 0,
  inexistentes.length ? 'INVENTADAS: ' + inexistentes.join(', ') : 'ok');

console.log('\n--- o app não depende de RLS para separar empresa ---');
// Se alguém trocar a service_role por anon achando que "agora tem RLS", tudo
// para de funcionar de uma vez. A chave continua sendo a de serviço.
const cliente = ler('lib/db/client.js');
check('o cliente usa a service_role', /SUPABASE_SERVICE_ROLE_KEY/.test(cliente));
check('e não há cliente Supabase no navegador',
  !/createClient\s*\(/.test(ler('public/app.js')));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
