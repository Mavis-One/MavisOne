#!/usr/bin/env node
/**
 * A PROVA CONTRA O BANCO DE VERDADE.
 *
 *   docker compose up -d
 *   node scripts/prova-banco.js
 *
 * NÃO entra em `npm test`: precisa do Postgres no ar.
 *
 * POR QUE ELE EXISTE, SE JÁ HÁ O test-sql-compat
 * ----------------------------------------------
 * Porque os dois provam coisas diferentes, e a diferença é exatamente onde uma
 * troca de banco costuma dar errado.
 *
 *   test-sql-compat  prova o TEXTO do SQL. Roda em milissegundos, sem banco, e
 *                    pega erro de tradução: filtro que sumiu, IN vazio virando
 *                    "todas as linhas", jsonb tratado como array.
 *
 *   este aqui        prova que o Postgres ACEITA aquele texto, e que o dado
 *                    VOLTA na mesma forma em que voltava do PostgREST. Nenhum
 *                    teste estático pode responder isso: o parser de tipo do
 *                    driver só se manifesta com um servidor do outro lado.
 *
 * A metade dos checks abaixo é sobre TIPO, e não sobre consulta. É de propósito:
 * numa migração de banco, a consulta que quebra dá erro e alguém conserta; o
 * TIPO que volta diferente não dá erro nenhum — vira uma data um dia atrás, um
 * XML corrompido ou um jsonb gravado como texto, e aparece semanas depois.
 *
 * Ele limpa o que escreve. Os ids começam com `zz-prova-`.
 */
require('dotenv').config();
const { supabase, fecharPool } = require('../lib/db/client');
const { consultar } = require('../lib/db/conexao');
const { esquecerCatalogo } = require('../lib/db/catalogo');

let falhas = 0;
const check = (ok, t, d) => { console.log(`  ${ok ? 'OK ' : 'XX '} ${t}${d !== undefined ? ' -> ' + d : ''}`); if (!ok) falhas++; };
const MARCA = `zz-prova-${Date.now()}`;

(async () => {
  console.log('--- 0. o banco responde ---');
  try {
    const { rows } = await consultar('select version() as v');
    check(true, 'conectou', rows[0].v.split(',')[0]);
  } catch (erro) {
    console.error(`  XX  não consegui conectar -> ${erro.message}`);
    console.error('\n  O banco está no ar?  docker compose up -d');
    console.error('  A DATABASE_URL está certa?  veja .env.example');
    process.exit(1);
  }

  const { rows: tabelas } = await consultar(`select count(*)::int as n from information_schema.tables where table_schema='public'`);
  check(tabelas[0].n > 70, 'o schema foi criado inteiro', `${tabelas[0].n} tabelas`);
  if (tabelas[0].n < 70) {
    console.error('\n  O banco subiu vazio. O initdb só roda com o volume VAZIO:');
    console.error('    docker compose down -v && docker compose up -d');
    await fecharPool();
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  console.log('\n--- 1. TIPOS: o dado volta na mesma forma que voltava do PostgREST ---');
  await consultar(`
    create table if not exists zz_prova_tipos (
      id text primary key,
      um_jsonb jsonb, uma_lista text[], uns_bytes bytea,
      uma_data date, um_instante timestamptz, um_dinheiro numeric(14,2), um_grande bigint
    )`);
  // O catálogo foi lido na subida e não conhece a tabela recém-criada.
  esquecerCatalogo();

  const bytesOriginais = Buffer.from('MZ\x00\x01 çãõ', 'utf8');
  const gravou = await supabase.from('zz_prova_tipos').insert({
    id: MARCA,
    um_jsonb: ['vendas', { fiscal: true }],
    uma_lista: ['sales', 'stock'],
    uns_bytes: `\\x${bytesOriginais.toString('hex')}`,
    uma_data: '2026-08-31',
    um_instante: '2026-08-31T15:00:00.000Z',
    um_dinheiro: 100.5,
    um_grande: 9007199254740990
  }).select().single();
  check(!gravou.error, 'gravou uma linha com todos os tipos', gravou.error && gravou.error.message);

  const lido = gravou.data || {};
  // jsonb: tem que voltar ARRAY/OBJETO, não a string "{vendas,...}" que seria o
  // sinal de que o driver montou array literal do Postgres.
  check(Array.isArray(lido.um_jsonb) && lido.um_jsonb[1] && lido.um_jsonb[1].fiscal === true,
    'jsonb volta como estrutura, não como texto', JSON.stringify(lido.um_jsonb));
  check(Array.isArray(lido.uma_lista) && lido.uma_lista.join(',') === 'sales,stock',
    'text[] volta como array', JSON.stringify(lido.uma_lista));
  // bytea: o código de lib/db/fiscal.js faz String(row.conteudo).replace(/^\\x/,'')
  // e lê hexadecimal. Um Buffer aqui viraria lixo em UTF-8 e o XML da NF-e
  // sairia corrompido — sem erro nenhum.
  check(typeof lido.uns_bytes === 'string' && lido.uns_bytes.startsWith('\\x'),
    'bytea volta como a string \\x (não como Buffer)', String(lido.uns_bytes).slice(0, 24));
  check(Buffer.from(String(lido.uns_bytes).replace(/^\\x/, ''), 'hex').equals(bytesOriginais),
    '  e os bytes são exatamente os mesmos');
  // date: um Date aqui viraria a meia-noite LOCAL, que a oeste de Greenwich é o
  // dia ANTERIOR. Vencimento de parcela andaria um dia.
  check(lido.uma_data === '2026-08-31', 'date volta "AAAA-MM-DD", sem virar Date', String(lido.uma_data));
  check(typeof lido.um_instante === 'string' && lido.um_instante === '2026-08-31T15:00:00.000Z',
    'timestamptz volta em ISO com Z', String(lido.um_instante));
  // numeric: o driver devolve string por padrão, e "100.50" + 50 daria
  // "100.5050" numa soma de valores.
  check(typeof lido.um_dinheiro === 'number' && lido.um_dinheiro === 100.5,
    'numeric volta como número', `${typeof lido.um_dinheiro} ${lido.um_dinheiro}`);
  check(typeof lido.um_grande === 'number' && lido.um_grande === 9007199254740990,
    'bigint volta como número', `${typeof lido.um_grande} ${lido.um_grande}`);

  // -------------------------------------------------------------------------
  console.log('\n--- 2. os operadores que o sistema usa, contra o Postgres ---');
  await supabase.from('zz_prova_tipos').insert([
    { id: MARCA + '-b', um_dinheiro: 20 },
    { id: MARCA + '-c', um_dinheiro: 30 }
  ]);

  const ordenado = await supabase.from('zz_prova_tipos').select('id, um_dinheiro')
    .in('id', [MARCA + '-b', MARCA + '-c']).order('um_dinheiro', { ascending: false });
  check(!ordenado.error && ordenado.data.length === 2 && ordenado.data[0].um_dinheiro === 30,
    'in() + order() desc', ordenado.error ? ordenado.error.message : JSON.stringify(ordenado.data.map((r) => r.um_dinheiro)));

  // O check que mais importa da migração inteira: lista vazia é ZERO linhas.
  const vazio = await supabase.from('zz_prova_tipos').select('id').in('id', []);
  check(!vazio.error && vazio.data.length === 0, 'in([]) devolve ZERO linhas, não a tabela',
    vazio.error ? vazio.error.message : `${vazio.data.length} linha(s)`);

  const paginado = await supabase.from('zz_prova_tipos').select('id', { count: 'exact' })
    .in('id', [MARCA, MARCA + '-b', MARCA + '-c']).order('id').range(0, 1);
  check(!paginado.error && paginado.data.length === 2 && paginado.count === 3,
    'range() pagina e count:exact conta o TOTAL', `${paginado.data.length} de ${paginado.count}`);

  const nulo = await supabase.from('zz_prova_tipos').select('id').eq('id', MARCA + '-b').not('um_dinheiro', 'is', null);
  check(!nulo.error && nulo.data.length === 1, 'not(is null)', nulo.error && nulo.error.message);

  const atualizou = await supabase.from('zz_prova_tipos').update({ um_dinheiro: 99 }).eq('id', MARCA + '-b').select().single();
  check(!atualizou.error && atualizou.data.um_dinheiro === 99, 'update().select().single()', atualizou.error && atualizou.error.message);

  const subiu = await supabase.from('zz_prova_tipos').upsert({ id: MARCA + '-b', um_dinheiro: 77 }).select().single();
  check(!subiu.error && subiu.data.um_dinheiro === 77, 'upsert() acha a PK sozinho e atualiza', subiu.error && subiu.error.message);

  const nada = await supabase.from('zz_prova_tipos').select('id').eq('id', 'nao-existe').maybeSingle();
  check(!nada.error && nada.data === null, 'maybeSingle() sem linha devolve null, sem erro');

  const exigente = await supabase.from('zz_prova_tipos').select('id').eq('id', 'nao-existe').single();
  check(Boolean(exigente.error) && exigente.error.code === 'PGRST116', 'single() sem linha devolve erro de cardinalidade',
    exigente.error && exigente.error.code);

  // -------------------------------------------------------------------------
  console.log('\n--- 3. os CÓDIGOS DE ERRO que o sistema trata continuam chegando ---');
  // lib/db/classes.js, fiscal.js, estoque.js e rbac.js decidem a mensagem da
  // tela a partir destes códigos. Se o driver entregasse outro, a tela passaria
  // a dizer "erro ao gravar" em vez de "já existe um cadastro com este CNPJ".
  const duplicada = await supabase.from('zz_prova_tipos').insert({ id: MARCA });
  check(duplicada.error && duplicada.error.code === '23505', '23505 — chave única violada',
    duplicada.error && duplicada.error.code);

  const semTabela = await supabase.from('zz_tabela_que_nao_existe').select('*').limit(1);
  check(semTabela.error && semTabela.error.code === '42P01', '42P01 — tabela não existe',
    semTabela.error && semTabela.error.code);
  check(/does not exist/i.test((semTabela.error || {}).message || ''),
    '  e a mensagem diz "does not exist" (é o que verificar-migracoes.js procura)');

  const semColuna = await supabase.from('zz_prova_tipos').select('coluna_que_nao_existe').limit(1);
  check(semColuna.error && semColuna.error.code === '42703', '42703 — coluna não existe',
    semColuna.error && semColuna.error.code);

  // -------------------------------------------------------------------------
  console.log('\n--- 4. contra o schema REAL do sistema ---');
  const codigo = await supabase.rpc('next_cadastro_code');
  check(!codigo.error && typeof codigo.data === 'string', 'a função next_cadastro_code devolve o VALOR, não uma linha',
    codigo.error ? codigo.error.message : JSON.stringify(codigo.data));

  // O jsonb de verdade que motivou metade desta camada.
  const usuario = await supabase.from('users').select('id, dashboard_pins, allowed_modules').eq('username', 'admin').maybeSingle();
  check(!usuario.error && usuario.data, 'o usuário admin está lá', usuario.error && usuario.error.message);
  if (usuario.data) {
    const pinsOriginais = usuario.data.dashboard_pins;
    check(Array.isArray(usuario.data.allowed_modules), 'allowed_modules (text[]) volta como array',
      JSON.stringify(usuario.data.allowed_modules).slice(0, 60));
    const gravouPins = await supabase.from('users').update({ dashboard_pins: ['zz-prova'] }).eq('id', usuario.data.id).select().single();
    check(!gravouPins.error && Array.isArray(gravouPins.data.dashboard_pins) && gravouPins.data.dashboard_pins[0] === 'zz-prova',
      'dashboard_pins (jsonb) grava array JS e relê como array',
      gravouPins.error ? gravouPins.error.message : JSON.stringify(gravouPins.data.dashboard_pins));
    await supabase.from('users').update({ dashboard_pins: pinsOriginais }).eq('id', usuario.data.id);
  }

  // O único select com relacionamento embutido do sistema. Tabela vazia é
  // resultado válido: o que se prova aqui é que o Postgres ACEITA a subconsulta.
  const embutido = await supabase.from('nfe_eventos')
    .select('*, nfe(referencia, numero, serie, chave_acesso, status)').limit(5);
  check(!embutido.error, 'o select embutido de nfe_eventos → nfe é aceito',
    embutido.error ? embutido.error.message : `${(embutido.data || []).length} evento(s)`);

  // -------------------------------------------------------------------------
  console.log('\n--- 5. limpeza ---');
  await supabase.from('zz_prova_tipos').delete().in('id', [MARCA, MARCA + '-b', MARCA + '-c']);
  await consultar('drop table if exists zz_prova_tipos');
  esquecerCatalogo();
  check(true, 'tabela de prova removida');

  await fecharPool();
  console.log(falhas
    ? `\n===== ${falhas} FALHA(S) — a camada NÃO está pronta =====`
    : '\n===== O BANCO EM DOCKER RESPONDE COMO O SUPABASE RESPONDIA =====');
  process.exit(falhas ? 1 : 0);
})().catch(async (erro) => {
  console.error('EXPLODIU:', erro.message);
  await fecharPool().catch(() => {});
  process.exit(1);
});
