#!/usr/bin/env node
/**
 * A NOTA DO PEDIDO SAI DA EMPRESA DO PEDIDO (14/10/2026). Pedido do usuário:
 * "ao apertar em emitir NF-e ou NFC-e a função deve reconhecer qual a empresa
 * já selecionada no pedido e emitir a partir dela".
 *
 * Empresa do pedido e estabelecimento emissor se encontram pelo CNPJ.
 *
 * Provado (servidor local, pedido de teste depois apagado):
 *   - prévia de pedido da Marcolla pela MATRIZ: 400 "A nota deste pedido sai
 *     da empresa do pedido: SAL INFINITY PLUS (MARCOLLA) (CNPJ ...0216)";
 *     pela Marcolla, passa; nota avulsa continua livre;
 *   - Gerar NF-e: emitente MARCOLLA, travado;
 *   - Emitir NFC-e com a Marcolla (que não emite NFC-e): aviso, sem modal;
 *     com a matriz: confirma "por SAL INFINITY PLUS COMERCIO LTDA (MATRIZ)",
 *     sem lista de lojas — nada foi emitido no teste.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const servidor = ler('server.js');
const app = ler('public/app.js');
const emissao = ler('public/modules/finance/subs/emitir_nfe_focus.js');

console.log('--- servidor ---');
check('a montagem confere o emitente do pedido (NF-e, NFC-e, prévia, DANFE)',
  /if \(body\.orderId && !opcoes\.leituras\) \{\s*const doPedido = await empresaEmitenteDoPedido\(String\(body\.orderId\)\);/.test(servidor)
  && servidor.includes('A nota deste pedido sai da empresa do pedido:'));
check('  o pré-check por lote (que escolhe a loja) fica de fora', servidor.includes('if (body.orderId && !opcoes.leituras) {'));
check('a NFC-e pega a loja da empresa do pedido', /const doPedido = await empresaEmitenteDoPedido\(pedido, data\);[\s\S]{0,400}estabelecimentoId = daEmpresa\.id;/.test(servidor));
check('  pedido sem empresa continua com a escolha da tela', servidor.includes("if (!pedido || !pedido.companyId) return { pedido, empresa: null, cnpj: '' };"));

console.log('\n--- telas ---');
check('NF-e: emitente travado na empresa do pedido', emissao.includes("emitenteDoPedido = doMesmoCnpj ? doMesmoCnpj.id : '';")
  && emissao.includes('<select id="nfeFocusEstabSelect" required ${emitenteDoPedido ? \'disabled'));
check('  a nota salva não troca o emitente do pedido', emissao.includes('selectedEstabelecimentoId = emitenteDoPedido || d.selectedEstabelecimentoId;'));
check('NFC-e: confirma pela loja do pedido, sem lista', app.includes('const estabelecimentoId = lojaDoPedido\n              ? (await confirmModal('));
check('  empresa que não emite NFC-e: avisa e para', app.includes('if (cnpjDoPedido && !lojaDoPedido) {'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
