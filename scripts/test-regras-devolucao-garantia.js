// REGRAS FISCAIS DE DEVOLUÇÃO E DE GARANTIA (fase EY, 20/10/2026).
//
// Pedido do usuário: "faça duas novas regras fiscais se baseando nas que já
// existem para fazer: devolução e garantia". Decidido com ele: devolução de
// COMPRA ao fornecedor (5102 -> 5202, 5405 -> 5411); garantia = operação nova,
// peça/produto ao cliente, sem financeiro, refere a nota de venda (CFOP 5949);
// tributação copiada da venda de cada empresa (Plus e Electric) — a conferir
// com o contador.
//
// Provado no banco local: 6 regras novas (Plus: 5202, 5411, 5949 x2; Electric:
// 5202, 5949), rodar de novo não duplica; prévia sem transmitir na matriz da
// Plus — Garantia 5949 (CST 00 17% e CST 60 com ST), Devolução 5202/5411;
// garantia sem a chave da venda recusada; a tela mostra as duas operações.
const fs = require('fs');
const path = require('path');
const op = require('../lib/operacaoFiscal');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log('--- a operação Garantia ---');
const g = op.operacao('GARANTIA');
check('existe, com a natureza REMESSA EM GARANTIA', g && op.naturezaDaOperacao('GARANTIA') === 'REMESSA EM GARANTIA');
check('  sai do estoque, sem conta a receber', g.movimentaEstoque === true && g.geraFinanceiro === false && g.finalidade === 1);
check('  refere a nota de venda (sem a chave, recusa)', g.exigeReferencia === true
  && op.validarOperacao({ tipoOperacao: 'GARANTIA', finalidade: 1, referencias: [], itens: [{ quantidade: 1, valorUnitario: 10 }] }).some((e) => /chave de acesso/i.test(e)));
check('a devolução sai como devolução de compra', op.naturezaDaOperacao('DEVOLUCAO') === 'DEVOLUCAO DE COMPRA PARA COMERCIALIZACAO');

console.log('\n--- as regras (migração) ---');
const sql = ler('banco/migrations/fase-ey-regras-devolucao-e-garantia.sql');
check('o banco aceita GARANTIA nas regras e nas categorias', /regra_fiscal_tipo_operacao_check[\s\S]{0,200}'GARANTIA'/.test(sql) && /sales_categories_operacao_fiscal_check[\s\S]{0,250}'GARANTIA'/.test(sql));
check('devolução: 5102 -> 5202 e 5405 -> 5411', /\('DEVOLUCAO', '5102', '5202'\)/.test(sql) && /\('DEVOLUCAO', '5405', '5411'\)/.test(sql));
check('garantia: 5102 e 5405 -> 5949', /\('GARANTIA',\s+'5102', '5949'\)/.test(sql) && /\('GARANTIA',\s+'5405', '5949'\)/.test(sql));
check('copia da regra de venda, empresa por empresa (tributação e grupo de ST juntos)',
  /from regra_fiscal v\s*join novas n on n\.de = v\.cfop\s*where v\.tipo_operacao = 'VENDA'/.test(sql) && /v\.empresa_id, v\.ncm/.test(sql) && /v\.icms_motivo_desoneracao, v\.grupo_tributario_id/.test(sql));
check('rodar de novo não duplica', /and not exists \([\s\S]{0,200}x\.tipo_operacao = n\.tipo and x\.cfop = n\.para/.test(sql));

console.log('\n--- as telas ---');
const emissao = ler('public/modules/finance/subs/emitir_nfe_focus.js');
check('a emissão oferece Garantia, com a natureza', /\{ value: 'GARANTIA', label: 'Garantia', natureza: 'REMESSA EM GARANTIA' \}/.test(emissao));
check('  e pede a chave da NF-e de venda (a devolução, a da devolvida)',
  /const NFE_FOCUS_REFERE_NOTA = \{ DEVOLUCAO: 'Chave de acesso da NF-e devolvida', GARANTIA: 'Chave de acesso da NF-e de venda' \};/.test(emissao)
  && /function validarReferenciaDaNota\(formData\)/.test(emissao)
  && /tipoOperacao === NFE_FOCUS_COMPLEMENTO[\s\S]{0,160}complementoChave[\s\S]{0,100}devolucaoChave/.test(emissao)
  && (emissao.match(/validarReferenciaDaNota\(formData\)/g) || []).length >= 3);
check('Regras Fiscais e Configurações › Fiscal listam Garantia',
  /\{ value: 'GARANTIA', label: 'Garantia' \}/.test(ler('public/modules/fiscal/subs/regras.js')) && /\{ value: 'GARANTIA', label: 'Garantia' \}/.test(ler('public/modules/settings/subs/fiscal.js')));
check('a categoria de venda pode usar Garantia (sem mudar sozinha)', /\{ id: 'GARANTIA', name: 'Garantia' \}/.test(ler('public/modules/shared/categoria_venda.js'))
  && /\{ id: 'garantia', name: 'Garantia', estoque: true, financeiro: false, operacao: '' \}/.test(ler('public/modules/shared/categoria_venda.js')));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
