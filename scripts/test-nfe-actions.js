// Testa as regras de habilitação do painel de ações fiscais nos 4 cenários que
// importam: nada selecionado, 1 nota autorizada, 1 nota cancelada, várias notas.
const fs = require('fs');
global.window = {};
(0, eval)(fs.readFileSync(require('path').join(__dirname, '..', 'public/modules/finance/nfe_actions.js'), 'utf8'));
const A = global.window.MavisNfeActions;

const base = { escapeHtml: (s) => s, showToast() {}, print() {}, cancelar() {}, duplicar() {}, irParaVenda() {}, limparSelecao() {} };
const nfe = (over = {}) => ({ id: 'n1', number: '168', status: 'autorizada', ...over });

let falhas = 0;
const check = (nome, cond, det) => { console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det ? ' -> ' + det : ''}`); if (!cond) falhas++; };

function liberadas(ctx) {
  const c = { ...base, ...ctx };
  c.nfe = c.selecionadas.length === 1 ? c.selecionadas[0] : null;
  return A.CATALOG.filter((a) => !A.motivoBloqueio(a, c)).map((a) => a.id);
}
function motivo(id, ctx) {
  const c = { ...base, ...ctx };
  c.nfe = c.selecionadas.length === 1 ? c.selecionadas[0] : null;
  return A.motivoBloqueio(A.CATALOG.find((a) => a.id === id), c);
}

console.log(`catálogo: ${A.CATALOG.length} ações\n`);

// Trava de projeto, não detalhe de UI: NF-e não pode ser excluída em hipótese
// alguma. Uma nota autorizada é cancelada (evento registrado na SEFAZ) e
// permanece no histórico — apagar o registro quebraria a auditoria e a
// conciliação com a SEFAZ. Este teste falha se alguém reintroduzir a ação.
console.log('--- trava: exclusão de NF-e não pode existir ---');
const proibidas = A.CATALOG.filter((a) => /excluir|deletar|remover|apagar/i.test(a.id + ' ' + a.label));
check('nenhuma ação de exclusão no catálogo', proibidas.length === 0,
  proibidas.length ? 'ENCONTRADA: ' + proibidas.map((a) => a.id).join(', ') : 'ok');

console.log('\n--- nada selecionado ---');
const vazio = liberadas({ selecionadas: [], apiFiscalConfigurada: true });
check('só Cancelar Seleção (as demais de escopo any ainda não têm run)', JSON.stringify(vazio) === JSON.stringify(['cancelar_selecao']), vazio.join(', '));
check('Status Serviço bloqueado como NAO IMPLEMENTADA, não como falta de API', /não implementada/.test(motivo('status_servico', { selecionadas: [], apiFiscalConfigurada: true })), motivo('status_servico', { selecionadas: [], apiFiscalConfigurada: true }));

console.log('\n--- 1 NF autorizada, API fiscal NÃO configurada ---');
const semApi = liberadas({ selecionadas: [nfe()], apiFiscalConfigurada: false });
check('impressões liberadas', ['imprimir', 'imprimir_80mm', 'etiqueta', 'etiqueta_2col'].every((i) => semApi.includes(i)), semApi.join(', '));
check('duplicar e cancelar liberados', semApi.includes('duplicar') && semApi.includes('cancelar'));
check('Baixar XML bloqueado por falta de API', /API fiscal/.test(motivo('baixar_xml', { selecionadas: [nfe()], apiFiscalConfigurada: false })));
check('nenhuma ação de API liberada', !semApi.some((i) => ['baixar_xml', 'baixar_danfe', 'carta_correcao', 'consultar_status'].includes(i)));

console.log('\n--- 1 NF autorizada, API fiscal CONFIGURADA ---');
const comApi = liberadas({ selecionadas: [nfe()], apiFiscalConfigurada: true });
check('Baixar XML bloqueado com motivo HONESTO (não culpa a API já configurada)', /não implementada/.test(motivo('baixar_xml', { selecionadas: [nfe()], apiFiscalConfigurada: true })), motivo('baixar_xml', { selecionadas: [nfe()], apiFiscalConfigurada: true }));
check('Cancelar NFe liberado', comApi.includes('cancelar'));
check('Ir Para a Venda bloqueado sem vínculo', /não tem venda/.test(motivo('ir_para_venda', { selecionadas: [nfe()], apiFiscalConfigurada: true })));
check('Ir Para a Venda liberado com vínculo',
  liberadas({ selecionadas: [nfe({ orderId: 'ord-1' })], apiFiscalConfigurada: true }).includes('ir_para_venda'));

console.log('\n--- 1 NF cancelada ---');
const cancelada = { selecionadas: [nfe({ status: 'cancelada' })], apiFiscalConfigurada: true };
check('Cancelar NFe bloqueado', /autorizada/.test(motivo('cancelar', cancelada)), motivo('cancelar', cancelada));
check('impressão continua liberada', liberadas(cancelada).includes('imprimir'));

console.log('\n--- várias NFs selecionadas (comportamento das capturas) ---');
const varias = { selecionadas: [nfe(), nfe({ id: 'n2' })], apiFiscalConfigurada: true };
const lote = liberadas(varias);
check('ações de nota única bloqueadas', !lote.includes('imprimir') && !lote.includes('cancelar'), lote.join(', '));
check('motivo explica o porquê', /apenas uma/.test(motivo('imprimir', varias)), motivo('imprimir', varias));
check('Cancelar Seleção sempre disponível', lote.includes('cancelar_selecao'));

console.log('\n--- toda ação bloqueada tem motivo legível ---');
let semMotivo = 0;
[{ selecionadas: [], apiFiscalConfigurada: false }, { selecionadas: [nfe()], apiFiscalConfigurada: false }, varias].forEach((ctx) => {
  const c = { ...base, ...ctx };
  c.nfe = c.selecionadas.length === 1 ? c.selecionadas[0] : null;
  A.CATALOG.forEach((a) => {
    const m = A.motivoBloqueio(a, c);
    if (m !== null && (typeof m !== 'string' || m.length < 8)) semMotivo++;
  });
});
check('nenhum motivo vazio ou genérico demais', semMotivo === 0, `${semMotivo} sem motivo`);

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
