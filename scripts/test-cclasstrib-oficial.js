#!/usr/bin/env node
/**
 * A TABELA OFICIAL DE cClassTrib (fase EM, 14/10/2026).
 *
 * Fonte: a tabela da SVRS (dfe-portal.svrs.rs.gov.br/DFE/ClassificacaoTributaria),
 * indicada pelo IT 2025.002 v1.50 (RFB, 15/04/2026) que o usuário baixou. Lida
 * em 14/10/2026: 18 CSTs, 173 cClassTrib, 104 válidos para NF-e/NFC-e.
 *
 * Provado no navegador: CST 410 (que antes ficava digitável) passou a listar
 * 27 códigos; o 000002 (fora de NF-e) não aparece na lista do CST 000.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const sql = ler('banco/migrations/fase-em-cclasstrib-oficial.sql');

const linhas = sql.match(/^\s+\('\d{6}', '\d{3}', '[^\n]*', (true|false)\)/gm) || [];
check('173 cClassTrib carregados', linhas.length === 173, linhas.length);
check('  104 marcados como válidos para NF-e/NFC-e', linhas.filter((l) => /true\)$/.test(l)).length === 104);
check('o código começa sempre pelo CST', linhas.every((l) => { const m = l.match(/\('(\d{3})\d{3}', '(\d{3})'/); return m && m[1] === m[2]; }));
check('18 CSTs com o nome oficial', (sql.match(/^\s+\('\d{3}', '[^']+'\)/gm) || []).length === 18);
check('só insere e atualiza: nada sai', !/\bdelete\b/i.test(sql.replace(/--.*$/gm, '')));
check('a coluna vale_nfe nasce verdadeira para o que já existia', sql.includes('add column if not exists vale_nfe boolean not null default true;'));
// 14/10/2026: o usuário pediu "mostre todos" (faltava o 000002, que só vale
// para NFS-e Via). Todos aparecem; os fora de NF-e/NFC-e vão marcados e por
// último, e a troca de CST continua escolhendo primeiro um válido para NF-e.
const emissao = ler('public/modules/finance/subs/emitir_nfe_focus.js');
check('a emissão mostra todos, os fora de NF-e marcados e por último',
  emissao.includes(".sort((a, b) => Number(a.vale_nfe === false) - Number(b.vale_nfe === false)")
  && emissao.includes("const fora = l.vale_nfe === false ? ' (fora de NF-e)' : '';")
  && !emissao.includes('l.vale_nfe !== false && String(l.codigo)'));
check('  e as Regras Fiscais também', ler('public/modules/fiscal/subs/regras.js').includes("${l.vale_nfe === false ? ' (fora de NF-e)' : ''}"));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
