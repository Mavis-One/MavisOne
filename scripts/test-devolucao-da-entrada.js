#!/usr/bin/env node
/**
 * NF-e DE DEVOLUÇÃO A PARTIR DA NOTA DE ENTRADA (30/10/2026).
 *
 *   node scripts/test-devolucao-da-entrada.js
 *
 * Pedido do usuário: "fazer um botão de ação para fazer notas fiscais de
 * devolução dentro da tela de notas de entrada". O botão "devolver" abre a
 * emissão de NF-e já como Devolução: emitente = a empresa que recebeu (travado),
 * destinatário = o fornecedor (do cadastro, ou da própria nota), os itens com
 * quantidade e valor da nota, a chave referenciada e "90 — Sem pagamento".
 *
 * Provado na 3099 com uma entrada de teste: a emissão abriu no Fiscal, Plus
 * matriz travada, Devolução, natureza de devolução de compra, a chave, o
 * fornecedor com endereço da nota, os 2 itens (um sem produto, com NCM),
 * forma 90 sem condição, e a prévia calculou os impostos.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const entrada = ler('public/modules/purchases/subs/entrada_nfe.js');
const emissao = ler('public/modules/finance/subs/emitir_nfe_focus.js');

console.log('--- o botão nas Notas de Entrada ---');
check('coluna Devolução só para quem emite NF-e', /\$\{moduloDaEmissao\(\) \? '<th>Devolução<\/th>' : ''\}/.test(entrada));
check('  "devolver" só na entrada com a chave de 44 dígitos', /String\(e\.chave \|\| ''\)\.length === 44\s*\? `<button type="button" class="entrada-link" data-devolver-entrada=/.test(entrada));
check('  a emissão abre no Fiscal, ou no Financeiro', /if \(modulos\.includes\('fiscal'\)\) return 'fiscal';\s*if \(modulos\.includes\('finance'\)\) return 'finance';\s*return '';/.test(entrada));
check('a NF-e avulsa em edição não é descartada sem perguntar',
  /const salva = await api\('\/api\/fiscal\/nfe\/rascunho\?pedido='\);[\s\S]{0,400}await confirmModal\([\s\S]{0,200}if \(!seguir\) return;\s*await api\('\/api\/fiscal\/nfe\/rascunho\?pedido=', \{ method: 'DELETE' \}\);/.test(entrada));
const corpo = /state\.nfeFromOrder = \{[\s\S]*?\n {6}\};/.exec(entrada.slice(entrada.indexOf('async function devolverEntrada(')));
check('achei o que a devolução manda à emissão', Boolean(corpo));
const c = corpo ? corpo[0] : '';
check('  operação Devolução, a chave da nota e "90 — Sem pagamento"',
  /tipoOperacao: 'DEVOLUCAO'/.test(c) && /devolucaoChave: entrada\.chave/.test(c) && /formaPagamento: '90'/.test(c));
check('  emitente = quem recebeu a nota; destinatário = o fornecedor',
  /empresaCnpj: entrada\.destinatarioDocumento/.test(c) && /clientSupplierId: entrada\.cadastroId/.test(c) && /clientDocument: entrada\.emitenteDocumento/.test(c));
check('  fora do cadastro, o fornecedor vem da nota', /destinatarioDaNota: \(entrada\.resumo && entrada\.resumo\.emitente\) \|\| null/.test(c));
check('  os itens com produto, NCM, unidade, quantidade e valor da nota',
  /productId: item\.produtoId/.test(c) && /ncm: item\.ncm/.test(c) && /unit: item\.unidade/.test(c)
  && /quantity: Number\(item\.quantidade/.test(c) && /unitPrice: Number\(item\.valorUnitario/.test(c));
check('  e a observação cita a nota devolvida', /taxNotes: `Devolução da NF-e \$\{entrada\.numero\}/.test(c));
check('sem valores (custo oculto), avisa', /Os valores da nota não vieram/.test(entrada));
check('vai para a emissão', /state\.activeSub = 'emitir_nfe_focus';\s*if \(typeof renderApp === 'function'\) renderApp\(\);\s*ctx\.loadModule\(modulo\);/.test(entrada));

console.log('\n--- a emissão recebe ---');
check('a chave referenciada vem preenchida e sobrevive ao redesenho',
  /let chaveReferenciada = String\(\(doPedido && doPedido\.devolucaoChave\) \|\| ''\)/.test(emissao)
  && /name="devolucaoChave"[^>]*value="\$\{escapeHtml\(chaveReferenciada\)\}"/.test(emissao)
  && /\[name="devolucaoChave"\]'\)\?\.addEventListener\('input', \(evento\) => \{\s*chaveReferenciada = evento\.target\.value;/.test(emissao));
check('a forma de pagamento inicial pode vir (90 na devolução; 99 no resto)',
  /const formaInicial = \(doPedido && doPedido\.formaPagamento\) \|\| '99';/.test(emissao) && /f\.value === formaInicial \? 'selected' : ''/.test(emissao));
check('o NCM do item vem quando foi mandado', /ncm: item\.ncm \|\| '',/.test(emissao));
check('o documento do destinatário sem cadastro', /destinatario\.documento = cliente\?\.document \|\| doPedido\.clientDocument \|\| '';/.test(emissao));
check('o destinatário da nota (nome, IE, endereço) só sem cadastro',
  /const daNota = !cliente && doPedido\.destinatarioDaNota;/.test(emissao)
  && /destinatario\.contribuinte = window\.MavisInscricaoEstadual\.ehContribuinte\(ie\);/.test(emissao));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
