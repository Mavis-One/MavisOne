#!/usr/bin/env node
/**
 * TRÊS AJUSTES DE 14/10/2026, pedidos do usuário:
 *
 * 1. "não permita que o código seja alterado" (emissão da NF-e, aba 3. Itens):
 *    item ligado a um produto tem o Código travado, e o servidor manda o SKU do
 *    cadastro mesmo que o corpo traga outro. Item avulso continua digitável.
 * 2. "preciso que o nome do produto seja editado!" (itens do pedido): o nome
 *    vira campo na linha; vale só para aquele pedido (e a NF-e dele), o
 *    cadastro do produto não muda. Vazio volta ao nome do cadastro.
 * 3. "preciso que o campo de NSU/CV seja obrigatório": pagamento em cartão
 *    (crédito ou débito) com valor exige NSU / Autorização, na tela e no
 *    servidor. Orçamento fica de fora (ainda não houve cobrança).
 *
 * Provado no navegador (servidor local): a emissão abriu com código 9204
 * travado e a descrição editável; uma linha avulsa nova veio digitável. No
 * pedido, o nome trocado ficou na linha e, apagado, voltou ao do cadastro. Pela
 * API: sem NSU, 400 "Informe o NSU / Autorização..."; com NSU, o pedido gravou
 * o nome editado (o registro de teste foi apagado e a numeração voltou).
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const emissao = ler('public/modules/finance/subs/emitir_nfe_focus.js');
const servidor = ler('server.js');
const app = ler('public/app.js');

console.log('--- 1. código travado na emissão ---');
check('o campo Código fica somente-leitura com produto',
  emissao.includes(`<td><input data-field="codigoProduto" data-index="\${index}" value="\${escapeHtml(item.codigoProduto)}" placeholder="Código" style="width:90px;" \${item.produtoId ? 'readonly tabindex="-1"`));
check('o servidor usa o SKU do cadastro antes do corpo', servidor.includes("codigoProduto: produto.sku || bruto.codigoProduto || '',")
  && !servidor.includes("codigoProduto: bruto.codigoProduto || produto.sku || '',"));

console.log('\n--- 2. nome do item editável no pedido ---');
check('campo de nome na linha do item', app.includes('<input type="text" class="sales-item-nome" data-index="${index}"'));
check('vazio volta ao nome do cadastro', app.includes("item.name = limpo || (produto && produto.name) || item.name || '';"));
check('o servidor grava o nome do corpo', servidor.includes("name: String(item.name || '').trim(),"));

console.log('\n--- 3. NSU obrigatório no cartão ---');
const regra = require('../public/modules/shared/venda_obrigatorios');
const formas = [{ id: 'c', type: 'cartao-credito' }, { id: 'e', type: 'cartao-debito' }, { id: 'd', type: 'dinheiro' }];
const base = { companyId: 'a', category: 'VENDA', depositId: 'd', sellerId: 's', status: 'pedido' };
const falta = (payments, extra = {}, tipoRegistro = 'order') => regra.faltando({ ...base, ...extra, payments }, { formas, tipoRegistro, total: 100 });
check('crédito sem NSU falta', (falta([{ methodId: 'c', amount: 100 }]) || {}).rotulo === 'NSU / Autorização');
check('débito sem NSU falta', (falta([{ methodId: 'e', amount: 100 }]) || {}).rotulo === 'NSU / Autorização');
check('NSU só com espaço também falta, e diz a linha', (falta([{ methodId: 'd', amount: 50 }, { methodId: 'c', amount: 50, cardAuthorization: '  ' }]) || {}).linha === 1);
check('com NSU passa', falta([{ methodId: 'c', amount: 100, cardAuthorization: '123456' }]) === null);
check('dinheiro não pede NSU', falta([{ methodId: 'd', amount: 100 }]) === null);
check('orçamento não pede NSU', falta([{ methodId: 'c', amount: 100 }], { status: 'orcamento' }, 'quote') === null);
check('tela e servidor passam o cadastro de formas',
  app.includes('formas: meta.paymentMethods || [], tipoRegistro: recordType });')
  && (servidor.match(/formas: loadData\(\)\.paymentMethods \|\| \[\], tipoRegistro: /g) || []).length === 2);
check('o campo diz "Obrigatório"', app.includes('placeholder="Obrigatório" />'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
