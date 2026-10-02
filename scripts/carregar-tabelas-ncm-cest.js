#!/usr/bin/env node
/**
 * CARGA DAS TABELAS OFICIAIS DE NCM E CEST (fase DO).
 *
 *   node scripts/carregar-tabelas-ncm-cest.js              baixa, lê e mostra
 *   node scripts/carregar-tabelas-ncm-cest.js --confirmo   … e grava
 *
 *   --ncm=<arquivo.json>   usa o JSON do Siscomex já baixado
 *   --cest=<arquivo.html>  usa a página do Convênio 142/2018 já baixada
 *
 * As duas tabelas são SUBSTITUÍDAS inteiras, numa transação: são referência
 * pública, não dado da empresa, e a versão nova é a que vale. Rodar de novo
 * quando a Receita publicar NCM novo (Resolução Gecex) ou o CONFAZ alterar o
 * convênio.
 */

require('dotenv').config();
const fs = require('fs');
const { obterPool } = require('../lib/db/conexao');
const { lerNcmSiscomex, lerCestConfaz } = require('../lib/tabelas-fiscais');

const FONTE_NCM = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json?perfil=PUBLICO';
const FONTE_CEST = 'https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18';

const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) || '').split('=').slice(1).join('=');

async function obter(arquivo, url) {
  if (arquivo) return fs.readFileSync(arquivo, 'utf8');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} respondeu ${r.status}`);
  return r.text();
}

async function inserirEmLotes(c, tabela, colunas, linhas) {
  const LOTE = 500;
  for (let i = 0; i < linhas.length; i += LOTE) {
    const lote = linhas.slice(i, i + LOTE);
    const valores = [];
    const marcas = lote.map((linha, j) => `(${colunas.map((_, k) => `$${j * colunas.length + k + 1}`).join(', ')})`);
    for (const linha of lote) valores.push(...linha);
    await c.query(`insert into ${tabela} (${colunas.join(', ')}) values ${marcas.join(', ')}`, valores);
  }
}

(async () => {
  const confirmo = process.argv.includes('--confirmo');
  const ncm = lerNcmSiscomex(await obter(arg('ncm'), FONTE_NCM));
  const cest = lerCestConfaz(await obter(arg('cest'), FONTE_CEST));
  console.log(`\nNCM:  ${ncm.itens.length} códigos de 8 dígitos · ${ncm.versao}`);
  console.log(`CEST: ${cest.itens.length} códigos · Convênio ICMS 142/2018, redação vigente`);
  if (cest.descartados.length) console.log(`      trechos do campo NCM que não se leem: ${cest.descartados.join(', ')}`);
  if (ncm.itens.length < 10000 || cest.itens.length < 1000) {
    console.error('\nERRO: a fonte veio menor do que devia — nada gravado.');
    process.exit(1);
  }

  const pool = obterPool();
  const c = await pool.connect();
  let falhou = false;
  try {
    await c.query('begin');
    await c.query('delete from fiscal_ncm');
    await inserirEmLotes(c, 'fiscal_ncm', ['codigo', 'descricao', 'descricao_completa', 'data_inicio', 'data_fim'],
      ncm.itens.map((n) => [n.codigo, n.descricao, n.descricaoCompleta, n.dataInicio, n.dataFim]));
    await c.query('delete from fiscal_cest');
    await inserirEmLotes(c, 'fiscal_cest', ['cest', 'segmento', 'segmento_nome', 'descricao', 'ncm_prefixos'],
      cest.itens.map((x) => [x.cest, x.segmento, x.segmentoNome, x.descricao, x.ncmPrefixos]));
    for (const [tabela, versao, fonte, linhas] of [
      ['NCM', ncm.versao, arg('ncm') ? `arquivo ${arg('ncm')}` : FONTE_NCM, ncm.itens.length],
      ['CEST', 'Convênio ICMS 142/2018 — redação vigente', arg('cest') ? `arquivo ${arg('cest')}` : FONTE_CEST, cest.itens.length]
    ]) {
      await c.query(
        `insert into fiscal_tabela_carga (tabela, versao, fonte, linhas, carregado_em) values ($1, $2, $3, $4, now())
         on conflict (tabela) do update set versao = excluded.versao, fonte = excluded.fonte, linhas = excluded.linhas, carregado_em = now()`,
        [tabela, versao, fonte, linhas]);
    }
    if (confirmo) {
      await c.query('commit');
      console.log('\n===== GRAVADO =====');
    } else {
      await c.query('rollback');
      console.log('\n(nada gravado — rode com --confirmo para gravar)');
    }
  } catch (e) {
    falhou = true;
    try { await c.query('rollback'); } catch (_) { /* conexão perdida */ }
    console.error('\nERRO:', e.message);
  } finally {
    c.release();
    await pool.end();
  }
  process.exit(falhou ? 1 : 0);
})();
