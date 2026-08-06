#!/usr/bin/env node
// Regras do menu "Mais Ações" da tela de Pedidos e Orçamentos.
//
// O que importa aqui é a regra de negócio, não o visual: rascunho não tem ação,
// pedido faturado não se cancela por essa via, orçamento reprovado não aprova.
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');

global.window = {};
(0, eval)(fs.readFileSync(path.join(raiz, 'public/modules/shared/actions_menu.js'), 'utf8'));
(0, eval)(fs.readFileSync(path.join(raiz, 'public/modules/shared/sales_record_actions.js'), 'utf8'));
const M = global.window.MavisActionsMenu;
const { CATALOG } = global.window.MavisSalesRecordActions;

const base = { escapeHtml: (s) => s, showToast() {}, imprimir() {}, focarObservacoes() {}, duplicar() {}, baixar() {}, mudarStatus() {} };
const ctx = (o) => ({ ...base, ...o });

let falhas = 0;
const check = (nome, cond, det) => { console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det ? ' -> ' + det : ''}`); if (!cond) falhas++; };
const liberadas = (c) => CATALOG.filter((a) => !M.motivoBloqueio(a, c)).map((a) => a.id);
const motivo = (id, c) => M.motivoBloqueio(CATALOG.find((a) => a.id === id), c);

console.log(`catálogo: ${CATALOG.length} ações\n`);

console.log('--- pedido NOVO (rascunho, ainda não salvo) ---');
const novo = ctx({ recordType: 'order', isEditing: false, status: 'pendente' });
check('só Observações disponível', JSON.stringify(liberadas(novo)) === JSON.stringify(['observacoes']), liberadas(novo).join(', '));
check('imprimir pede para salvar antes', /Salve o registro/.test(motivo('imprimir', novo)), motivo('imprimir', novo));
check('duplicar pede para salvar antes', /Salve o registro/.test(motivo('duplicar', novo)));

console.log('\n--- pedido salvo, pendente ---');
const pendente = ctx({ recordType: 'order', isEditing: true, status: 'pendente' });
const libPendente = liberadas(pendente);
check('aprovar (faturar) liberado', libPendente.includes('aprovar'));
check('cancelar liberado', libPendente.includes('cancelar'));
check('imprimir e impressão direta liberados', libPendente.includes('imprimir') && libPendente.includes('impressao_direta'));
check('duplicar e baixar liberados', libPendente.includes('duplicar') && libPendente.includes('baixar'));

console.log('\n--- pedido FATURADO ---');
const faturado = ctx({ recordType: 'order', isEditing: true, status: 'faturado' });
check('não deixa cancelar direto (manda cancelar a NF-e antes)', /NF-e/.test(motivo('cancelar', faturado)), motivo('cancelar', faturado));
check('não deixa faturar de novo', /já está faturado/.test(motivo('aprovar', faturado)), motivo('aprovar', faturado));
check('imprimir continua liberado', liberadas(faturado).includes('imprimir'));

console.log('\n--- pedido CANCELADO ---');
const cancelado = ctx({ recordType: 'order', isEditing: true, status: 'cancelado' });
check('não cancela duas vezes', /já está cancelado/.test(motivo('cancelar', cancelado)), motivo('cancelar', cancelado));
check('não fatura pedido cancelado', /cancelado não pode/.test(motivo('aprovar', cancelado)), motivo('aprovar', cancelado));

console.log('\n--- ORÇAMENTO em aberto ---');
const orcamento = ctx({ recordType: 'quote', isEditing: true, status: 'em aberto' });
check('aprovar liberado', liberadas(orcamento).includes('aprovar'));
check('cancelar (reprovar) liberado', liberadas(orcamento).includes('cancelar'));

console.log('\n--- ORÇAMENTO já aprovado ---');
const aprovado = ctx({ recordType: 'quote', isEditing: true, status: 'aprovado' });
check('não aprova duas vezes', /já está aprovado/.test(motivo('aprovar', aprovado)), motivo('aprovar', aprovado));

console.log('\n--- ações sem módulo ficam bloqueadas com motivo claro ---');
['ordem_compra', 'despesa_montagem', 'ordem_producao'].forEach((id) => {
  check(`${id} bloqueado`, /Módulo ainda não existe/.test(motivo(id, pendente)), motivo(id, pendente));
});
check('faturamento parcial explica o motivo real', /por inteiro/.test(motivo('faturamento_parcial', pendente)), motivo('faturamento_parcial', pendente));

console.log('\n--- nenhuma ação destrutiva de exclusão ---');
const proibidas = CATALOG.filter((a) => /excluir|deletar|remover|apagar/i.test(a.id + ' ' + a.label));
check('catálogo não tem ação de exclusão', proibidas.length === 0, proibidas.map((a) => a.id).join(', ') || 'ok');

console.log('\n--- todo bloqueio tem motivo legível ---');
let ruins = 0;
[novo, pendente, faturado, cancelado, orcamento, aprovado].forEach((c) => {
  CATALOG.forEach((a) => {
    const m = M.motivoBloqueio(a, c);
    if (m !== null && (typeof m !== 'string' || m.length < 8)) ruins++;
  });
});
check('nenhum motivo vazio', ruins === 0, `${ruins} sem motivo`);

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
