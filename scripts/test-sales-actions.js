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
// O catálogo de ações decide por status — carrega o catálogo de status junto.
global.window.MavisSalesStatus = require(path.join(raiz, 'public/modules/shared/sales_status'));
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
const novo = ctx({ recordType: 'order', isEditing: false, status: 'pedido' });
check('só Observações disponível', JSON.stringify(liberadas(novo)) === JSON.stringify(['observacoes']), liberadas(novo).join(', '));
check('imprimir pede para salvar antes', /Salve o registro/.test(motivo('imprimir', novo)), motivo('imprimir', novo));
check('duplicar pede para salvar antes', /Salve o registro/.test(motivo('duplicar', novo)));

console.log('\n--- pedido salvo, ainda não faturado ---');
const pendente = ctx({ recordType: 'order', isEditing: true, status: 'pedido' });
const libPendente = liberadas(pendente);
// O FLUXO É APROVAR E DEPOIS EMITIR (13/10/2026, pedido do usuário). Faturar
// exige NF-e no servidor (fase AV) e a autorização fatura o pedido (fase BE);
// antes, "Aprovar" pedia faturar e voltava "Este pedido não tem NF-e", e
// "Gerar NF-e" pedia o pedido já faturado — um pedido novo não tinha saída.
check('aprovar liberado', libPendente.includes('aprovar'));
const aprovou = [];
CATALOG.find((a) => a.id === 'aprovar').run({ ...pendente, mudarStatus: (st) => aprovou.push(st) });
check('  e leva a Pedido Pré-Faturado (não fatura sem nota)', aprovou[0] === 'pedido-pre-faturado', aprovou[0]);
const faturouPelaNota = [];
CATALOG.find((a) => a.id === 'aprovar').run({ ...pendente, nfeId: 'n1', nfeStatus: 'AUTORIZADO', mudarStatus: (st) => faturouPelaNota.push(st) });
check('  com nota já valendo, aprovar fatura direto', faturouPelaNota[0] === 'pedido-faturado', faturouPelaNota[0]);
check('aprovar sem faturamento liberado', libPendente.includes('aprovar_sem_faturamento'));
check('cancelar liberado', libPendente.includes('cancelar'));
check('imprimir e impressão direta liberados', libPendente.includes('imprimir') && libPendente.includes('impressao_direta'));
check('duplicar e baixar liberados', libPendente.includes('duplicar') && libPendente.includes('baixar'));
check('NF-e e NFC-e esperam a aprovação', /Aprove o pedido/.test(motivo('gerar_nfe', pendente)) && /Aprove o pedido/.test(motivo('emitir_nfce', pendente)), motivo('gerar_nfe', pendente));

console.log('\n--- pedido APROVADO (Pré-Faturado), esperando a nota ---');
const preFaturado = ctx({ recordType: 'order', isEditing: true, status: 'pedido-pre-faturado' });
check('gera NF-e e NFC-e', liberadas(preFaturado).includes('gerar_nfe') && liberadas(preFaturado).includes('emitir_nfce'), motivo('gerar_nfe', preFaturado));
check('  não aprova duas vezes', /já está aprovado/.test(motivo('aprovar', preFaturado)), motivo('aprovar', preFaturado));
// A transição pré-faturado -> aprovado sem faturamento não existe no banco.
check('  nem vira "aprovado sem faturamento"', /já foi aprovado/.test(motivo('aprovar_sem_faturamento', preFaturado)), motivo('aprovar_sem_faturamento', preFaturado));
check('  e ainda pode ser cancelado (nada saiu do estoque)', liberadas(preFaturado).includes('cancelar'), motivo('cancelar', preFaturado));
const SS = global.window.MavisSalesStatus;
check('pedido -> pré-faturado -> faturado existem no catálogo',
  SS.podeTransicionar('pedido', 'pedido-pre-faturado') && SS.podeTransicionar('pedido-pre-faturado', 'pedido-faturado')
  && SS.podeTransicionar('pedido-nao-faturado', 'pedido-pre-faturado'));
check('a tela fica no pedido depois de aprovar',
  /novoStatus === 'pedido-pre-faturado' && resposta\?\.record/.test(fs.readFileSync(path.join(raiz, 'public/app.js'), 'utf8')));

console.log('\n--- pedido FATURADO ---');
const faturado = ctx({ recordType: 'order', isEditing: true, status: 'pedido-faturado' });
check('não deixa cancelar direto (manda cancelar a NF-e antes)', /NF-e/.test(motivo('cancelar', faturado)), motivo('cancelar', faturado));
check('não deixa faturar de novo', /já está faturado/.test(motivo('aprovar', faturado)), motivo('aprovar', faturado));
check('não deixa aprovar sem faturamento depois de faturado', /já foi baixado/.test(motivo('aprovar_sem_faturamento', faturado)), motivo('aprovar_sem_faturamento', faturado));
check('gerar NF-e liberado', liberadas(faturado).includes('gerar_nfe'));
check('imprimir continua liberado', liberadas(faturado).includes('imprimir'));

console.log('\n--- pedido APROVADO SEM FATURAMENTO (transferência, remessa) ---');
// O caso que motivou o catálogo: mercadoria sai, financeiro não nasce.
const semFaturamento = ctx({ recordType: 'order', isEditing: true, status: 'pedido-aprovado-sem-faturamento' });
check('emite NF-e (é a nota de transferência)', liberadas(semFaturamento).includes('gerar_nfe'));
check('não repete a baixa de estoque', /já foi baixado/.test(motivo('aprovar_sem_faturamento', semFaturamento)));
check('cancelar segue liberado (não gerou financeiro)', liberadas(semFaturamento).includes('cancelar'), motivo('cancelar', semFaturamento) || 'liberado');

console.log('\n--- NF-e CANCELADA: o pedido volta a poder emitir (13/10/2026) ---');
// Cancelar a nota devolve o pedido para "Não Faturado" (fase BF), mas o vínculo
// com a nota cancelada fica — documento fiscal não se apaga. O menu lia esse
// vínculo como "já tem NF-e" e o pedido nunca mais oferecia a nota nova.
const voltou = ctx({ recordType: 'order', isEditing: true, status: 'pedido-nao-faturado', nfeId: 'n1', nfeStatus: 'CANCELADO' });
check('depois do cancelamento, aprova de novo', liberadas(voltou).includes('aprovar'), motivo('aprovar', voltou));
const voltouAprovado = { ...voltou, status: 'pedido-pre-faturado' };
check('  e aí gera NF-e (a nota cancelada não trava)', liberadas(voltouAprovado).includes('gerar_nfe'), motivo('gerar_nfe', voltouAprovado));
check('  e NFC-e também', liberadas(voltouAprovado).includes('emitir_nfce'), motivo('emitir_nfce', voltouAprovado));
const comNotaViva = ctx({ recordType: 'order', isEditing: true, status: 'pedido-faturado', nfeId: 'n1', nfeStatus: 'AUTORIZADO' });
check('nota AUTORIZADA continua travando', /já tem NF-e/.test(motivo('gerar_nfe', comNotaViva)));
check('  e a que está PROCESSANDO também',
  /já tem NF-e/.test(motivo('gerar_nfe', { ...comNotaViva, nfeStatus: 'PROCESSANDO' })));
check('  e a nota manual (sem situação) também', /já tem NF-e/.test(motivo('gerar_nfe', { ...comNotaViva, nfeStatus: '' })));
const fonte = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
check('o pedido leva a situação da nota para a tela', /nfeStatus: \(\(\) => \{/.test(fonte('server.js'))
  && /nfeStatus: editRecord\?\.nfeStatus \|\| '',/.test(fonte('public/app.js')));
check('  e a consulta das notas traz a situação', /select id, numero, status(, modelo)? from nfe/.test(fonte('lib/db/vendas-compras.js')));

console.log('\n--- pedido CANCELADO ---');
const cancelado = ctx({ recordType: 'order', isEditing: true, status: 'pedido-cancelado' });
check('não cancela duas vezes', /já está cancelado/.test(motivo('cancelar', cancelado)), motivo('cancelar', cancelado));
check('não fatura pedido cancelado', /cancelado não pode/.test(motivo('aprovar', cancelado)), motivo('aprovar', cancelado));
check('não emite NF-e de pedido cancelado', /cancelado não emite/.test(motivo('gerar_nfe', cancelado)), motivo('gerar_nfe', cancelado));

console.log('\n--- ORÇAMENTO ---');
const orcamento = ctx({ recordType: 'quote', isEditing: true, status: 'orcamento' });
check('aprovar liberado', liberadas(orcamento).includes('aprovar'));
check('cancelar (reprovar) liberado', liberadas(orcamento).includes('cancelar'));
check('orçamento não baixa estoque', /Só pedido baixa estoque/.test(motivo('aprovar_sem_faturamento', orcamento)), motivo('aprovar_sem_faturamento', orcamento));
check('orçamento não emite NF-e', /Só pedido gera NF-e/.test(motivo('gerar_nfe', orcamento)), motivo('gerar_nfe', orcamento));

console.log('\n--- ORÇAMENTO já aprovado ---');
const aprovado = ctx({ recordType: 'quote', isEditing: true, status: 'orcamento-aprovado' });
check('não aprova duas vezes', /já está aprovado/.test(motivo('aprovar', aprovado)), motivo('aprovar', aprovado));

console.log('\n--- status LEGADO ainda decide certo (registro antigo aberto na tela) ---');
check('"faturado" bloqueia cancelar', /NF-e/.test(motivo('cancelar', ctx({ recordType: 'order', isEditing: true, status: 'faturado' }))));
check('"em aberto" é orçamento', /Só pedido gera NF-e/.test(motivo('gerar_nfe', ctx({ recordType: 'quote', isEditing: true, status: 'em aberto' }))));

console.log('\n--- ações sem módulo ficam bloqueadas com motivo claro ---');
['ordem_compra', 'despesa_montagem'].forEach((id) => {
  check(`${id} bloqueado`, /Módulo ainda não existe/.test(motivo(id, pendente)), motivo(id, pendente));
});

console.log('\n--- gerar ordem de produção (o PCP existe agora) ---');
check('pedido salvo libera', liberadas(pendente).includes('ordem_producao'));
check('rascunho pede para salvar antes', /Salve o registro/.test(motivo('ordem_producao', novo)));
check('orçamento não gera produção', /Só pedido gera ordem de produção/.test(motivo('ordem_producao', orcamento)), motivo('ordem_producao', orcamento));
check('pedido cancelado não gera produção', /cancelado não gera produção/.test(motivo('ordem_producao', cancelado)), motivo('ordem_producao', cancelado));
// Pedido faturado ainda pode precisar de produção — faturar não impede.
check('pedido faturado continua podendo gerar', liberadas(faturado).includes('ordem_producao'));
check('faturamento parcial explica o motivo real', /por inteiro/.test(motivo('faturamento_parcial', pendente)), motivo('faturamento_parcial', pendente));

console.log('\n--- nenhuma ação destrutiva de exclusão ---');
const proibidas = CATALOG.filter((a) => /excluir|deletar|remover|apagar/i.test(a.id + ' ' + a.label));
check('catálogo não tem ação de exclusão', proibidas.length === 0, proibidas.map((a) => a.id).join(', ') || 'ok');

console.log('\n--- todo bloqueio tem motivo legível ---');
let ruins = 0;
[novo, pendente, faturado, semFaturamento, cancelado, orcamento, aprovado].forEach((c) => {
  CATALOG.forEach((a) => {
    const m = M.motivoBloqueio(a, c);
    if (m !== null && (typeof m !== 'string' || m.length < 8)) ruins++;
  });
});
check('nenhum motivo vazio', ruins === 0, `${ruins} sem motivo`);

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
