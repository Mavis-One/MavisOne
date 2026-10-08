#!/usr/bin/env node
/**
 * REGRAS FISCAIS POR EMPRESA: A PLUS E A ELECTRIC SEPARADAS (fase DV, 08/10/2026).
 *
 * A regra fiscal é escolhida pela EMPRESA do estabelecimento que emite. A Plus
 * (raiz 43792899, Lucro Presumido) tem matriz + 9 filiais e as 4 regras do ERP
 * VIP; a Electric (raiz 46877837, Simples Nacional) tem a dela, copiada da NF-e
 * 1218 que emitiu pelo Viper: CFOP 5102, CSOSN 102 em todo item.
 *
 * Com banco, numa TRANSAÇÃO DESFEITA: confere que o banco não deixa um
 * estabelecimento da Electric morar na empresa da Plus, e que cada empresa
 * tributa o MESMO produto do seu jeito.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
let falhas = 0;
const check = (nome, cond, detalhe) => {
  if (cond) console.log(`  OK  ${nome}`);
  else { falhas += 1; console.log(`  XX  ${nome}${detalhe !== undefined ? ` -> ${detalhe}` : ''}`); }
};

(async () => {
  const sql = ler('banco/migrations/fase-dv-regras-por-empresa.sql');

  console.log('--- a migração ---');
  check('a Electric é Simples Nacional, CRT 1', sql.includes("values ('46877837', 'SAL INFINITY ELECTRIC LTDA', 'SIMPLES_NACIONAL', 1,"));
  check('  e o regime é corrigido se ela já existir', /on conflict \(cnpj_raiz\) do update\s*\n\s*set regime_tributario = 'SIMPLES_NACIONAL',\s*\n\s*crt = 1,/.test(sql));
  check('a regra da Electric é a da NF-e 1218: 5102 / CSOSN 102', sql.includes("select e.id, 'VENDA', true, '5102', '102', 0, '49', 0, '49', 0"));
  check('as regras da Plus só entram onde faltam', /and not exists \(\s*\n\s*select 1 from regra_fiscal x\s*\n\s*where x\.empresa_id = plus\.id/.test(sql));
  check('nada é apagado', !/\bdelete\b/i.test(sql));

  console.log('\n--- as listas de emitente mostram a filial ---');
  check('Emitir NF-e', ler('public/modules/finance/subs/emitir_nfe_focus.js').includes('${escapeHtml(e.nomeFantasia || e.razaoSocial)} — ${escapeHtml(fiscalFormatCnpjSimples(e.cnpj))}'));
  check('telas do Fiscal', ler('public/modules/fiscal/shared.js').includes('${escapeHtml(e.nomeFantasia || e.razaoSocial)} — ${escapeHtml(cnpj(e.cnpj))}'));

  if (!process.env.DATABASE_URL) {
    console.log('\n(sem DATABASE_URL: a parte com banco não roda)');
  } else {
    console.log('\n--- no banco, numa transação desfeita ---');
    const { Pool } = require('pg');
    const conexao = require(path.join(RAIZ, 'lib/db/conexao')); // registra os parsers de tipo
    const fiscal = require(path.join(RAIZ, 'lib/db/fiscal'));
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const c = await pool.connect();
    try {
      await c.query('begin');
      const plus = (await c.query("select id from empresa where cnpj_raiz = '43792899'")).rows[0];
      const electric = (await c.query("select id, regime_tributario, crt from empresa where cnpj_raiz = '46877837'")).rows[0];
      check('as duas empresas existem', Boolean(plus && electric));
      check('  a Electric no Simples, CRT 1', electric && electric.regime_tributario === 'SIMPLES_NACIONAL' && Number(electric.crt) === 1);

      // Estabelecimento da Electric dentro da Plus não existe: o banco recusa
      // (estabelecimento_valida_cnpj_raiz). É o que garante que a nota dela
      // nunca pega o regime e as regras da Plus.
      let recusou = false;
      await c.query('savepoint antes');
      try {
        await c.query(`insert into estabelecimento (empresa_id, cnpj, tipo, razao_social, uf, emite_nfe, ativo)
          values ($1, '46877837000114', 'MATRIZ', 'SAL INFINITY ELECTRIC LTDA', 'SC', true, true)`, [plus.id]);
      } catch (e) { recusou = /raiz/i.test(e.message); }
      await c.query('rollback to savepoint antes');
      check('o banco recusa estabelecimento da Electric na empresa da Plus', recusou);

      const regrasDe = async (empresaId) => (await c.query(
        'select * from regra_fiscal where empresa_id = $1 and tipo_operacao = $2', [empresaId, 'VENDA'])).rows;
      const st = (await c.query("select id from grupo_tributario where empresa_id = $1 and nome = 'Substituição tributária (ST)'", [plus.id])).rows[0];
      const resolver = (empresaId, grupo) => fiscal.resolverRegraFiscal(
        { empresaId, ncm: '87149990', grupoTributarioId: grupo || '', origem: 1, tipoOperacao: 'VENDA', ufDestino: 'SC', dentroDoEstado: true, destinatarioContribuinte: false, data: '2026-10-08' },
        { lerRegras: async ({ empresaId: id }) => ({ data: await regrasDe(id), error: null }) }
      );
      const plusSt = await resolver(plus.id, st && st.id);
      const plusSem = await resolver(plus.id, '');
      const eleSt = await resolver(electric.id, st && st.id);
      const eleSem = await resolver(electric.id, '');
      check('Plus, produto com ST: 5405 / CST 60', plusSt && plusSt.cfop === '5405' && plusSt.cstIcms === '60', plusSt && `${plusSt.cfop}/${plusSt.cstIcms}`);
      check('Plus, produto sem ST: 5102 / CST 00 a 17%', plusSem && plusSem.cfop === '5102' && plusSem.cstIcms === '00' && Number(plusSem.aliquotaIcms) === 17);
      check('Electric, o MESMO produto com ST: 5102 / CSOSN 102', eleSt && eleSt.cfop === '5102' && eleSt.csosn === '102', eleSt && `${eleSt.cfop}/${eleSt.csosn}`);
      check('Electric, produto sem ST: 5102 / CSOSN 102, sem ICMS', eleSem && eleSem.cfop === '5102' && eleSem.csosn === '102' && Number(eleSem.aliquotaIcms || 0) === 0);
    } finally {
      await c.query('rollback');
      c.release();
      await pool.end();
      await conexao.fecharPool();
    }
  }

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
