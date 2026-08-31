// A CAMADA COMPATÍVEL — o dialeto do supabase-js virando SQL, provado sem banco.
//
// Este teste é o que compra o direito de trocar o Supabase por um Postgres em
// Docker sem reescrever os 15 módulos de lib/db. A troca inteira se apoia numa
// afirmação só — "a camada gera o SQL certo" — e é ela que está aqui.
//
// Roda sem banco, sem rede e sem Docker: montarSql() é pura, recebe um catálogo
// de mentira com os fatos REAIS deste schema e devolve texto e parâmetros.
//
// O que este teste guarda, em ordem de quanto dói errar:
//
//   1. IN com lista VAZIA vira "false", nunca some do WHERE. Um IN esquecido
//      devolve a tabela inteira, e neste sistema isso é um vendedor lendo a
//      venda do colega — o escopo de lib/relatorios-escopo.js passa lista vazia
//      justamente para dizer "nenhuma venda";
//   2. coluna jsonb recebendo array JavaScript vira JSON, não array literal do
//      Postgres. É users.dashboard_pins, orders.items, orders.payments;
//   3. UPDATE e DELETE sem filtro são RECUSADOS, como o PostgREST recusava;
//   4. os operadores que a camada aceita cobrem os que o código realmente usa —
//      conferido lendo lib/, não por memória.

const fs = require('fs');
const path = require('path');
const { Consulta, montarSql } = require('../lib/db/consulta');

const RAIZ = path.join(__dirname, '..');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// O catálogo de mentira carrega fatos VERDADEIROS deste schema: se um deles
// deixar de valer, o teste passa a mentir junto. Por isso a última seção volta
// no banco/schema.sql e confere cada um contra o arquivo.
const catalogo = {
  tipos: new Map([
    ['users.dashboard_pins', 'jsonb'],
    ['users.preferences', 'jsonb'],
    ['users.allowed_modules', '_text'],
    ['users.name', 'text'],
    ['orders.items', 'jsonb'],
    ['orders.payments', 'jsonb'],
    ['orders.amount', 'numeric'],
    ['nfe_arquivos.conteudo', 'bytea']
  ]),
  primarias: new Map([
    ['users', ['id']],
    ['settings', ['id']],
    ['nfe_arquivos', ['id']],
    ['sem_pk', []]
  ]),
  ligacoes: new Map([
    ['nfe_eventos->nfe', { coluna: 'nfe_id', colunaDestino: 'id' }],
    ['nfe_itens->nfe', { coluna: 'nfe_id', colunaDestino: 'id' }]
  ])
};

const sql = (construir) => {
  const c = construir(new Consulta('orders'));
  return montarSql(c.estado, catalogo);
};
const sqlDe = (tabela, construir) => {
  const c = construir(new Consulta(tabela));
  return montarSql(c.estado, catalogo);
};
const lanca = (fn) => {
  try { fn(); return null; } catch (erro) { return erro.message; }
};
const normal = (texto) => texto.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
console.log('--- 1. o SELECT básico ---');

let r = sql((c) => c.select('*'));
check('select() vira SELECT com alias', normal(r.texto) === 'select "t".* from "orders" as "t"', normal(r.texto));
check('  e não leva nenhum parâmetro', r.valores.length === 0);

r = sql((c) => c.select('*').eq('seller_id', 'v-1'));
check('eq() vira = com parâmetro ligado', normal(r.texto).endsWith('where "t"."seller_id" = $1'), normal(r.texto));
check('  e o valor vai no array, não no texto', r.valores[0] === 'v-1' && !r.texto.includes('v-1'));

r = sql((c) => c.select('*').eq('a', 1).eq('b', 2));
check('dois eq() viram AND', normal(r.texto).includes('"t"."a" = $1 and "t"."b" = $2'));

r = sql((c) => c.select('id, code, amount'));
check('lista de colunas é citada uma a uma', normal(r.texto).startsWith('select "t"."id", "t"."code", "t"."amount"'), normal(r.texto));

r = sql((c) => c.select('*').order('created_at', { ascending: false }));
check('order({ascending:false}) vira DESC', normal(r.texto).endsWith('order by "t"."created_at" desc'), normal(r.texto));

r = sql((c) => c.select('*').order('name'));
check('order() sem opção vira ASC', normal(r.texto).endsWith('order by "t"."name" asc'));

r = sql((c) => c.select('*').order('x', { ascending: true, nullsFirst: false }));
check('nullsFirst:false vira NULLS LAST', normal(r.texto).endsWith('"t"."x" asc nulls last'), normal(r.texto));

r = sql((c) => c.select('*').limit(10));
check('limit() vira LIMIT', normal(r.texto).endsWith('limit 10'));

// ---------------------------------------------------------------------------
console.log('\n--- 2. range() é inclusivo nas duas pontas (erro de 1 mora aqui) ---');

r = sql((c) => c.select('*').range(0, 9));
check('range(0,9) são 10 linhas, não 9', normal(r.texto).includes('limit 10'), normal(r.texto));
check('  e offset 0 não é escrito à toa', !normal(r.texto).includes('offset'));

r = sql((c) => c.select('*').range(20, 39));
check('range(20,39) = limit 20 offset 20', normal(r.texto).endsWith('limit 20 offset 20'), normal(r.texto));

// ---------------------------------------------------------------------------
console.log('\n--- 3. IN com lista vazia: o check que separa "nenhuma venda" de "todas" ---');

r = sql((c) => c.select('*').in('seller_id', ['a', 'b']));
check('in() com valores vira = any()', normal(r.texto).endsWith('where "t"."seller_id" = any($1)'), normal(r.texto));
check('  e a lista vai como UM parâmetro', Array.isArray(r.valores[0]) && r.valores[0].length === 2);

r = sql((c) => c.select('*').in('seller_id', []));
check('in() com lista VAZIA vira "false"', normal(r.texto).endsWith('where false'), normal(r.texto));
check('  ou seja: zero linhas, NÃO a tabela inteira', !normal(r.texto).endsWith('from "orders" as "t"'));

r = sql((c) => c.select('*').not('product_id', 'is', null));
check('not(col,"is",null) vira IS NOT NULL', normal(r.texto).endsWith('where "t"."product_id" is not null'), normal(r.texto));

r = sql((c) => c.select('*').eq('cadastro_id', null));
check('eq(col, null) vira IS NULL, não "= null"', normal(r.texto).endsWith('where "t"."cadastro_id" is null'), normal(r.texto));

r = sql((c) => c.select('*').ilike('action', '%login%'));
check('ilike() vira ILIKE com parâmetro', normal(r.texto).endsWith('where "t"."action" ilike $1') && r.valores[0] === '%login%');

r = sql((c) => c.select('*').lte('valido_ate', '2026-01-01'));
check('lte() vira <=', normal(r.texto).endsWith('where "t"."valido_ate" <= $1'));

// ---------------------------------------------------------------------------
console.log('\n--- 4. jsonb x text[]: quem decide é a COLUNA, não o valor ---');

r = sqlDe('users', (c) => c.update({ dashboard_pins: ['vendas', 'fiscal'] }).eq('id', 'u1'));
check('array JS numa coluna jsonb vira JSON', r.valores[0] === '["vendas","fiscal"]', JSON.stringify(r.valores[0]));
check('  (sem isto o driver gravaria {vendas,fiscal}, array literal do Postgres)', typeof r.valores[0] === 'string');

r = sqlDe('users', (c) => c.update({ allowed_modules: ['sales', 'stock'] }).eq('id', 'u1'));
check('array JS numa coluna text[] passa como ARRAY', Array.isArray(r.valores[0]), JSON.stringify(r.valores[0]));

r = sqlDe('users', (c) => c.update({ preferences: { tela: { colunas: ['a'] } } }).eq('id', 'u1'));
check('objeto numa coluna jsonb vira JSON', r.valores[0] === '{"tela":{"colunas":["a"]}}', String(r.valores[0]));

r = sqlDe('users', (c) => c.update({ name: 'Maria' }).eq('id', 'u1'));
check('texto comum passa intacto', r.valores[0] === 'Maria');

r = sqlDe('nfe_arquivos', (c) => c.insert({ conteudo: '\\x4d5a' }));
check('bytea vai como a string \\x que o código já monta', r.valores[0] === '\\x4d5a', String(r.valores[0]));

// ---------------------------------------------------------------------------
console.log('\n--- 5. INSERT ---');

r = sql((c) => c.insert({ id: 'o1', amount: 10 }));
check('insert() vira INSERT com colunas citadas', normal(r.texto).startsWith('insert into "orders" as "t" ("id", "amount") values ($1, $2)'), normal(r.texto));
check('  e SEM returning quando não pediram select()', !normal(r.texto).includes('returning'));

r = sql((c) => c.insert({ id: 'o1' }).select().single());
check('insert().select() acrescenta RETURNING', normal(r.texto).endsWith('returning "t".*'), normal(r.texto));
check('  select() depois de escrita NÃO vira um SELECT novo', normal(r.texto).startsWith('insert into'));

r = sql((c) => c.insert([{ a: 1, b: 2 }, { a: 3, b: 4 }]));
check('insert() com lista vira multi-linha', normal(r.texto).includes('values ($1, $2), ($3, $4)'), normal(r.texto));
check('  com os 4 valores ligados', r.valores.length === 4);

r = sql((c) => c.insert([{ a: 1, b: 2 }, { a: 3 }]));
check('coluna faltando numa linha vira DEFAULT, não NULL', normal(r.texto).includes('($3, default)'), normal(r.texto));

r = sql((c) => c.insert({ a: 1, b: undefined }));
check('chave undefined é descartada (como o JSON.stringify fazia)', normal(r.texto).includes('("a") values ($1)'), normal(r.texto));

r = sql((c) => c.insert({ a: null }));
check('null EXPLÍCITO é gravado (diferente de undefined)', r.valores.length === 1 && r.valores[0] === null);

// ---------------------------------------------------------------------------
console.log('\n--- 6. UPDATE e DELETE recusam rodar sem filtro ---');

r = sql((c) => c.update({ status: 'x' }).eq('id', 'o1'));
check('update().eq() vira UPDATE ... WHERE', normal(r.texto) === 'update "orders" as "t" set "status" = $1 where "t"."id" = $2', normal(r.texto));

r = sql((c) => c.update({ status: 'x' }).eq('id', 'o1').select().single());
check('update().select() acrescenta RETURNING', normal(r.texto).endsWith('returning "t".*'));

let erro = lanca(() => sql((c) => c.update({ status: 'x' })));
check('update() SEM filtro é recusado', Boolean(erro) && /sem nenhum filtro/.test(erro), erro);

erro = lanca(() => sql((c) => c.delete()));
check('delete() SEM filtro é recusado', Boolean(erro) && /sem nenhum filtro/.test(erro), erro);

r = sql((c) => c.delete().eq('id', 'o1'));
check('delete().eq() vira DELETE ... WHERE', normal(r.texto) === 'delete from "orders" as "t" where "t"."id" = $1', normal(r.texto));

erro = lanca(() => sql((c) => c.update({}).eq('id', 'x')));
check('update() sem nenhuma coluna é recusado', Boolean(erro) && /sem nenhuma coluna/.test(erro), erro);

// ---------------------------------------------------------------------------
console.log('\n--- 7. UPSERT: o conflito sai da chave primária, ou do onConflict ---');

r = sqlDe('settings', (c) => c.upsert({ id: 1, company_name: 'Acme' }));
check('upsert() sem opção usa a PK do catálogo', normal(r.texto).includes('on conflict ("id") do update set'), normal(r.texto));
check('  e a coluna do conflito fica FORA do SET', normal(r.texto).includes('set "company_name" = excluded."company_name"') && !normal(r.texto).includes('"id" = excluded."id"'));

r = sqlDe('nfe_arquivos', (c) => c.upsert({ nfe_id: 'n1', tipo: 'xml', conteudo: '\\x00' }, { onConflict: 'nfe_id,tipo' }).select().single());
check('onConflict com duas colunas é respeitado', normal(r.texto).includes('on conflict ("nfe_id", "tipo") do update set "conteudo" = excluded."conteudo"'), normal(r.texto));
check('  e o RETURNING vem junto', normal(r.texto).endsWith('returning "t".*'));

r = sqlDe('users', (c) => c.upsert({ id: 'u1' }));
check('upsert só com a PK vira DO NOTHING (não há o que atualizar)', normal(r.texto).endsWith('on conflict ("id") do nothing'), normal(r.texto));

erro = lanca(() => sqlDe('sem_pk', (c) => c.upsert({ a: 1 })));
check('upsert em tabela sem PK e sem onConflict é recusado com erro claro', Boolean(erro) && /onConflict/.test(erro), erro);

// ---------------------------------------------------------------------------
console.log('\n--- 8. o select com relacionamento embutido ---');

r = sqlDe('nfe_eventos', (c) => c.select('*, nfe(referencia, numero)').order('criado_em', { ascending: false }).limit(200));
check('muitos-para-um vira subconsulta com json_build_object',
  normal(r.texto).includes('(select json_build_object(\'referencia\', "nfe"."referencia", \'numero\', "nfe"."numero") from "nfe" where "nfe"."id" = "t"."nfe_id") as "nfe"'),
  normal(r.texto));
check('  o * da tabela base continua junto', normal(r.texto).startsWith('select "t".*,'));
check('  e a ordenação/limite não entram na subconsulta', normal(r.texto).endsWith('order by "t"."criado_em" desc limit 200'));

r = sqlDe('nfe', (c) => c.select('*, nfe_itens(id)'));
check('um-para-muitos vira json_agg (lista, não objeto)', normal(r.texto).includes('coalesce(json_agg('), normal(r.texto));
check('  com lista vazia em vez de null', normal(r.texto).includes(`'[]'::json`));

erro = lanca(() => sqlDe('orders', (c) => c.select('*, inexistente(id)')));
check('embutido sem FK falha ALTO, não devolve dado errado', Boolean(erro) && /chave estrangeira/.test(erro), erro);

// ---------------------------------------------------------------------------
console.log('\n--- 9. nome de coluna nunca é interpolado sem peneira ---');

erro = lanca(() => sql((c) => c.select('*').eq('id; drop table users --', 1)));
check('identificador com ";" é recusado', Boolean(erro) && /Identificador inválido/.test(erro), erro);

erro = lanca(() => sql((c) => c.order('created_at desc, x')));
check('identificador com espaço é recusado', Boolean(erro) && /Identificador inválido/.test(erro));

erro = lanca(() => sqlDe('orders; delete from users', (c) => c.select('*')));
check('nome de TABELA também passa pela peneira', Boolean(erro) && /Identificador inválido/.test(erro));

r = sql((c) => c.select('*').eq('id', "'; drop table users --"));
check('mas o VALOR perigoso passa ileso, como parâmetro', r.valores[0] === "'; drop table users --" && !r.texto.includes('drop'));

// ---------------------------------------------------------------------------
console.log('\n--- 10. a camada cobre o que o código realmente usa ---');
// Lê lib/ e scripts/ e confere que todo método encadeado num banco.from()
// existe na classe. Um operador novo que ninguém implementou falha AQUI, e não
// em produção devolvendo linha demais.
const metodosDaClasse = new Set(Object.getOwnPropertyNames(Consulta.prototype));
const arquivos = [];
for (const dir of ['lib', 'lib/db', 'lib/openfinance', 'scripts']) {
  const abs = path.join(RAIZ, dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) {
    // Este arquivo fica de fora: ele CONTÉM a expressão que procura chamadas, e
    // se varrer a si mesmo acha os próprios métodos de teste.
    if (f.endsWith('.js') && f !== path.basename(__filename)) arquivos.push(path.join(abs, f));
  }
}
arquivos.push(path.join(RAIZ, 'server.js'));

// O VOCABULÁRIO do supabase-js: filtros, modificadores e comandos. Conferir
// contra esta lista, em vez de contra uma lista de nomes a ignorar, é o que
// torna o check preciso — `toString` e `map` nunca casam, e `overlaps` casa.
//
// Uma lista de ignorados faria o contrário: cresceria a cada método novo do
// JavaScript que aparecesse perto de uma consulta, e o dia em que alguém
// acrescentasse um operador de verdade, ele seria só mais um nome para ignorar.
const VOCABULARIO = new Set([
  'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'not', 'or', 'and', 'match', 'filter',
  'contains', 'containedBy', 'overlaps', 'textSearch', 'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte', 'rangeAdjacent',
  'order', 'limit', 'range', 'single', 'maybeSingle', 'csv', 'explain', 'returns', 'abortSignal', 'geojson'
]);
const usados = new Set();
const colher = (trecho) => {
  for (const chamada of trecho.match(/\.\s*([a-zA-Z]+)\s*\(/g) || []) {
    const nome = chamada.replace(/[.\s(]/g, '');
    if (VOCABULARIO.has(nome)) usados.add(nome);
  }
};
for (const arquivo of arquivos) {
  const src = fs.readFileSync(arquivo, 'utf8');
  // (a) a cadeia escrita de uma vez: banco.from('x').select().eq()...
  const cadeia = /banco\s*\.\s*from\([\s\S]{0,600}?;/g;
  let m;
  while ((m = cadeia.exec(src))) colher(m[0]);

  // (b) a cadeia montada aos poucos numa variável — é como lib/db/rbac.js e
  // lib/db/fiscal.js montam filtro condicional ("consulta = consulta.ilike()").
  // Sem este segundo passe, ilike() e outros ficariam de fora da conferência e
  // o teste diria "tudo coberto" sem ter olhado para eles.
  const variaveis = new Set([...src.matchAll(/(?:let|const|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*banco\s*\.\s*from\(/g)].map((v) => v[1]));
  for (const nomeVar of variaveis) {
    const uso = new RegExp(`\\b${nomeVar}\\s*(?:=\\s*${nomeVar}\\s*)?((?:\\.\\s*[a-zA-Z]+\\s*\\([^;]*?\\))+)`, 'g');
    let u;
    while ((u = uso.exec(src))) colher(u[1]);
  }
}
console.log(`    métodos encadeados encontrados no código: ${[...usados].sort().join(', ')}`);
const semImplementacao = [...usados].filter((m) => !metodosDaClasse.has(m));
check('todo método usado no código existe na camada', semImplementacao.length === 0,
  semImplementacao.length ? 'FALTAM: ' + semImplementacao.join(', ') : `${usados.size} conferidos`);

// ---------------------------------------------------------------------------
console.log('\n--- 11. o catálogo de mentira deste teste bate com o schema real ---');
// Sem esta seção o teste vira uma conversa consigo mesmo: ele provaria que a
// camada trata jsonb direito usando um jsonb que talvez não exista no banco.
const schema = fs.readFileSync(path.join(RAIZ, 'banco/schema.sql'), 'utf8');
check('users.dashboard_pins é jsonb de verdade', /dashboard_pins jsonb/.test(schema));
check('users.preferences é jsonb de verdade', /preferences jsonb/.test(schema) || fs.existsSync(path.join(RAIZ, 'banco/migrations/fase-ag-preferencias-do-usuario.sql')));
check('users.allowed_modules é text[] de verdade', /allowed_modules text\[\]/.test(schema));
check('orders.items é jsonb de verdade', /orders add column if not exists items jsonb/.test(schema));
check('nfe_arquivos.conteudo é bytea de verdade', /conteudo bytea/.test(schema));
check('settings tem id como PK', /create table if not exists settings[\s\S]{0,200}id .*primary key/.test(schema));
check('nfe_eventos aponta para nfe (a FK do select embutido)', /nfe_eventos[\s\S]{0,600}nfe_id[\s\S]{0,120}references nfe/.test(schema));

// A camada não pode ter deixado nenhum vestígio de rede.
const consultaSrc = fs.readFileSync(path.join(RAIZ, 'lib/db/consulta.js'), 'utf8');
const clientSrc = fs.readFileSync(path.join(RAIZ, 'lib/db/client.js'), 'utf8');
check('a camada não fala HTTP em lugar nenhum', !/require\('https?'\)|fetch\(/.test(consultaSrc + clientSrc));
check('e não sobrou createClient do supabase-js', !/createClient/.test(clientSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
