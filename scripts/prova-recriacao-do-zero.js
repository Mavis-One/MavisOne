#!/usr/bin/env node
// A RECRIACAO DO ZERO, exercitada de verdade (fases DJ e DK).
//
// NAO entra em `npm test`: cria e derruba um database. Roda a mao depois de
// gerar o arquivo com `npm run zero`, e antes de subir para o VPS:
//
//   node scripts/prova-recriacao-do-zero.js
//
// POR QUE ELA EXISTE
// ------------------
// `npm test` confere que banco/RECRIAR-DO-ZERO.sql CITA todas as migracoes. Isso
// nao e a mesma pergunta que "ele roda": um arquivo de 8.671 linhas pode citar
// tudo e quebrar na linha 6.000.
//
// A fase DK deixou isso de pe: ela DERRUBA `nfes` e `nfe_items`, que uma
// migracao mais antiga CRIA. A replay de um banco novo, portanto, cria as duas e
// as apaga no fim -- e o unico jeito de saber que essa sequencia chega ao fim,
// na ordem em que o arquivo a escreve, e rodando.
//
// Cria `prova_zero_dk`, roda o arquivo inteiro, confere o estado final e
// DERRUBA o database. Nao encosta no banco de trabalho.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const RAIZ = path.join(__dirname, '..');

const ALVO = 'prova_zero_dk';
const url = process.env.DATABASE_URL;
if (!url) { console.error('sem DATABASE_URL'); process.exit(1); }

const urlDe = (db) => url.replace(/\/[^/?]+(\?|$)/, '/' + db + '$1');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

(async () => {
  const admin = new Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${ALVO}`);
    await admin.query(`create database ${ALVO}`);
    console.log(`banco ${ALVO} criado.\n`);
  } finally {
    await admin.end();
  }

  const novo = new Client({ connectionString: urlDe(ALVO) });
  await novo.connect();
  try {
    const sql = fs.readFileSync(path.join(RAIZ, 'banco/RECRIAR-DO-ZERO.sql'), 'utf8');
    console.log('--- a replay inteira roda sem erro ---');
    let rodou = true;
    let erro = '';
    try {
      await novo.query(sql);
    } catch (e) {
      rodou = false;
      erro = e.message + (e.position ? ' (posicao ' + e.position + ')' : '');
    }
    check('RECRIAR-DO-ZERO.sql rodou do inicio ao fim', rodou, erro || `${sql.split('\n').length} linhas`);
    if (!rodou) throw new Error('replay falhou');

    console.log('\n--- e o estado final e o esperado ---');
    let r = await novo.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name in ('nfes','nfe_items')"
    );
    check('`nfes` e `nfe_items` NAO existem no fim', r.rows.length === 0,
      r.rows.map((x) => x.table_name).join(', ') || 'nenhuma');

    const NOVAS = ['fiscal_participantes', 'fiscal_documentos', 'fiscal_documento_itens',
      'fiscal_item_tributos', 'produto_fiscal', 'fiscal_unidades'];
    r = await novo.query('select relname, relrowsecurity from pg_class where relname = any($1) order by relname', [NOVAS]);
    check('as seis tabelas das fases DJ e DK existem', r.rows.length === 6, `${r.rows.length}`);
    check('  todas com RLS', r.rows.every((x) => x.relrowsecurity), r.rows.filter((x) => !x.relrowsecurity).map((x) => x.relname).join(', ') || 'todas');

    r = await novo.query("select count(*) n from pg_proc where proname = 'produto_fiscal_registrar'");
    check('a trigger da fase DJ existe no banco novo', Number(r.rows[0].n) === 1, String(r.rows[0].n));
    r = await novo.query("select count(*) n from pg_trigger where tgname = 'products_produto_fiscal'");
    check('  e esta ligada em products', Number(r.rows[0].n) === 1, String(r.rows[0].n));

    // A CARGA INICIAL PEGA OS PRODUTOS QUE O schema.sql SEMEIA.
    //
    // Eu esperava 0 aqui, e sao 2: o schema.sql semeia dois produtos de exemplo,
    // e eles entram ANTES da fase DJ na ordem do arquivo. Entao a carga inicial
    // faz o trabalho dela -- uma linha por produto existente, marcada
    // CARGA_INICIAL -- e a expectativa errada era a minha, nao a migracao.
    r = await novo.query("select count(*) p from products");
    const produtos = Number(r.rows[0].p);
    r = await novo.query("select count(*) n, count(*) filter (where motivo = 'CARGA_INICIAL') carga from produto_fiscal");
    check('uma linha de retrato por produto semeado',
      Number(r.rows[0].n) === produtos && produtos > 0, `${r.rows[0].n} retratos / ${produtos} produtos`);
    check('  todas marcadas CARGA_INICIAL', Number(r.rows[0].carga) === produtos, String(r.rows[0].carga));
    await novo.query(`insert into products (id, name, sku, ncm, unidade_comercial, stock_quantity, cost_price, sale_price)
                      values ('z1','Produto zero','Z1','84821000','UN',0,0,0)`);
    r = await novo.query("select motivo, ncm from produto_fiscal where product_id = 'z1'");
    check('  e a trigger registra o primeiro produto que entra',
      r.rows.length === 1 && r.rows[0].motivo === 'CADASTRO' && r.rows[0].ncm === '84821000',
      r.rows.length ? r.rows[0].motivo + '/' + r.rows[0].ncm : '0 linhas');

    r = await novo.query("select count(*) n from information_schema.columns where table_name='estabelecimento' and column_name in ('perfil_sped','indicador_atividade')");
    check('estabelecimento tem os dois campos do 0000', Number(r.rows[0].n) === 2, String(r.rows[0].n));

    r = await novo.query("select count(*) n from information_schema.tables where table_schema='public'");
    console.log(`\n  (o banco novo terminou com ${r.rows[0].n} tabelas)`);
  } catch (e) {
    console.error('\nERRO:', e.message);
    falhas++;
  } finally {
    await novo.end();
  }

  const limpa = new Client({ connectionString: url });
  await limpa.connect();
  try {
    await limpa.query(`drop database if exists ${ALVO}`);
    console.log(`banco ${ALVO} removido.`);
  } finally {
    await limpa.end();
  }

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== A RECRIACAO DO ZERO CHEGA AO FIM =====');
  process.exit(falhas ? 1 : 0);
})();
