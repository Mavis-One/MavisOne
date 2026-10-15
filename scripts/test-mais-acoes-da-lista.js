#!/usr/bin/env node
/**
 * O "MAIS AÇÕES" DA LISTA DE PEDIDOS E ORÇAMENTOS (15/10/2026). Pedido do
 * usuário: "verifique o motivo das mais ações dentro dos pedidos e orçamentos
 * não estarem funcionando".
 *
 * Dois motivos:
 *   1. "Aprovar" levava o PEDIDO direto a "Faturado" — e faturar sem nota é
 *      recusado (fase AV). Agora vai a "Pré-Faturado", como o "Aprovar Pedido"
 *      de dentro do pedido; quem fatura é a autorização da nota.
 *   2. Editar, Observações, NF-e, NFC-e, Imprimir, Impressão Direta, Baixar e
 *      Gerar Ordens de Produção Individual apareciam como "ainda não existe",
 *      embora existissem dentro do pedido. Com um selecionado, a lista abre o
 *      pedido e roda lá a ação dele (mesma regra); com mais de um, desligam
 *      dizendo por quê.
 *
 * Provado no navegador (servidor local, pedido faturado): Editar abriu o
 * pedido; NF-e abriu o pedido e fez a pergunta das observações da geração de
 * NF-e de dentro dele; com dois selecionados, essas ações desligaram com
 * "selecione um registro só"; as que não existem continuam dizendo o motivo.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { semComentarios } = require('./sem-comentarios');
const B = require('../public/modules/shared/sales_bulk_actions');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

console.log('\n--- 1. Aprovar ---');
const aprovar = B.PORID.get('aprovar');
const pedido = { id: 'p', type: 'order', status: 'pedido', code: 1 };
const naoFaturado = { id: 'n', type: 'order', status: 'pedido-nao-faturado', code: 2 };
const preFaturado = { id: 'pf', type: 'order', status: 'pedido-pre-faturado', code: 3 };
const orcamento = { id: 'o', type: 'quote', status: 'orcamento', code: 4 };
const faturado = { id: 'f', type: 'order', status: 'pedido-faturado', code: 5 };
check('pedido vai a Pré-Faturado (não a Faturado)', aprovar.destino(pedido) === 'pedido-pre-faturado' && aprovar.destino(naoFaturado) === 'pedido-pre-faturado');
check('orçamento vai a Aprovado', aprovar.destino(orcamento) === 'orcamento-aprovado');
check('pedido e orçamento são elegíveis', aprovar.elegivel(pedido) === true && aprovar.elegivel(naoFaturado) === true && aprovar.elegivel(orcamento) === true);
check('pré-faturado manda gerar a nota', /gere a NF-e ou a NFC-e/.test(aprovar.elegivel(preFaturado)));
check('faturado: já está faturado', /já está faturado/.test(aprovar.elegivel(faturado)));

console.log('\n--- 2. as ações que abrem o pedido ---');
// O catálogo do pedido usa window.MavisActionsMenu e window.MavisSalesStatus:
// carrega num `window` de mentira só para ler os ids.
const janela = { MavisActionsMenu: { ICONS: new Proxy({}, { get: () => '' }) }, MavisSalesStatus: require('../public/modules/shared/sales_status') };
vm.runInNewContext(ler('public/modules/shared/sales_record_actions.js'), { window: janela, console });
const doPedido = new Set(janela.MavisSalesRecordActions.CATALOG.map((a) => a.id));
const abremOPedido = B.CATALOGO.filter((a) => a.noPedido !== undefined);
check('são as oito', JSON.stringify(abremOPedido.map((a) => a.id)) === JSON.stringify(['editar', 'observacoes', 'nfe', 'nfce', 'imprimir', 'impressao_direta', 'baixar', 'op_individual']),
  abremOPedido.map((a) => a.id).join(','));
check('cada uma aponta para uma ação que existe no pedido (Editar só abre)',
  abremOPedido.every((a) => a.noPedido === '' || doPedido.has(a.noPedido)), abremOPedido.map((a) => a.noPedido).join(','));
check('com um selecionado, valem', B.avaliar('imprimir', [faturado]).elegiveis.length === 1 && B.avaliar('editar', [orcamento]).elegiveis.length === 1);
check('com dois, desligam dizendo por quê', abremOPedido.every((a) => {
  const r = B.avaliar(a.id, [pedido, faturado]);
  return r.elegiveis.length === 0 && /selecione um registro só/.test(r.ignorados[0].motivo);
}));
check('NF-e só de pedido aprovado', B.PORID.get('nfe').elegivel(pedido) === 'Aprove o pedido antes de emitir a nota.'
  && B.PORID.get('nfe').elegivel(preFaturado) === true && B.PORID.get('nfe').elegivel(faturado) === true
  && /Só pedido gera NF-e/.test(B.PORID.get('nfe').elegivel(orcamento)));

console.log('\n--- 3. a tela ---');
const app = semComentarios(ler('public/app.js'));
check('a lista abre o pedido com a ação marcada, sem ir ao servidor',
  /if \(acao\.noPedido !== undefined\) \{\s*draft\.selecionados = \[\];\s*draft\.showLoteMenu = false;\s*state\.salesDraft\.acaoAoAbrir = acao\.noPedido;\s*abrirRegistroDaLista\(elegiveis\[0\]\.id\);\s*return;/.test(app));
check('o pedido roda a ação uma vez, pela regra do menu dele',
  /const acaoDaLista = state\.salesDraft\.acaoAoAbrir;[\s\S]{0,200}state\.salesDraft\.acaoAoAbrir = null;[\s\S]{0,300}const pode = typeof acaoDoPedido\.enabled === 'function' \? acaoDoPedido\.enabled\(contexto\) : true;\s*if \(pode === true\) setTimeout\(\(\) => acaoDoPedido\.run\(contexto\), 0\);\s*else showToast\(String\(pode\), 'warning'\);/.test(app));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
