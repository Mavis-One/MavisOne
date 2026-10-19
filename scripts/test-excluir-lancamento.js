// EXCLUIR LANÇAMENTOS FINANCEIROS (19/10/2026, pedido do usuário: "faça uma
// opção para excluir lançamentos financeiros").
//
// Decisões do usuário, na mesma data:
//   - quem: o administrador e quem tem Financeiro › excluir (o módulo marcado
//     na ficha dá ler/criar/editar, não excluir);
//   - com baixa: sai junto com as baixas, e a movimentação do extrato
//     conciliada com ele volta a "Não conciliado";
//   - título de pedido ou de nota: também sai, com o vínculo avisado antes.
//
// Provado no servidor local (porta 3099): excluir um título pago e conciliado
// apagou o título e a baixa, devolveu a movimentação a "Não conciliado" e
// deixou na auditoria o lançamento, a baixa e o motivo; o usuário só com o
// módulo marcado levou 403 "finance.excluir".
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const Lista = require('../public/modules/shared/lancamentos_lista');
const permissoes = require('../lib/permissoes');
const servidor = ler('server.js');
const tela = ler('public/modules/finance/subs/lancamentos.js');
const banco = ler('lib/db/financeiro.js');

console.log('--- quem pode ---');
check('DELETE /api/finance/entries é finance.excluir', permissoes.resolverPermissao('/api/finance/entries', 'DELETE') === 'finance.excluir');
const soModulo = { id: 'u', active: true, role: 'user', allowedModules: ['finance'] };
check('o módulo marcado na ficha não dá excluir', !permissoes.usuarioPode(soModulo, 'finance.excluir', { efetivas: new Set(), negadas: new Set() }));
check('  quem tem a permissão pode', permissoes.usuarioPode(soModulo, 'finance.excluir', { efetivas: new Set(['finance.excluir']), negadas: new Set() }));
check('  o administrador pode', permissoes.usuarioPode({ id: 'a', active: true, role: 'admin', allowedModules: [] }, 'finance.excluir', { efetivas: new Set(), negadas: new Set() }));
check('o lote por POST recusa "excluir" (seria cobrado como criar)',
  /hasOwnProperty\.call\(listaDeLancamentos\.ACOES, acao\) \|\| acao === 'excluir'\)/.test(servidor));
check('a tela só mostra o botão a quem pode', /function podeExcluir\(\) \{\s*if \(typeof usuarioEhAdmin === 'function' && usuarioEhAdmin\(\)\) return true;\s*return Boolean\(state\.user && Array\.isArray\(state\.user\.permissions\) && state\.user\.permissions\.includes\('finance\.excluir'\)\);/.test(tela));

console.log('\n--- o que pode ser excluído ---');
const l = (rawStatus) => ({ rawStatus });
check('qualquer situação: em aberto, parcial, pago, cancelado',
  ['pending', 'parcial', 'paid', 'cancelado'].every((s) => Lista.ACOES.excluir.elegivel(l(s)) === true));

console.log('\n--- o servidor ---');
const ini = servidor.indexOf("if (pathname === '/api/finance/entries' && req.method === 'DELETE') {");
const rota = servidor.slice(ini, servidor.indexOf("if (pathname === '/api/finance/entries' && req.method === 'POST') {", ini));
check('a rota existe', ini > 0 && rota.length > 1000);
check('motivo de pelo menos 10 caracteres', /if \(!previa && motivo\.length < 10\)/.test(rota));
check('a prévia diz baixas, conciliação e vínculo', /baixas: baixas\.length,[\s\S]{0,200}conciliadas: conciliadasCom\(id\)\.length,\s*vinculo: vinculos\.get\(id\) \|\| ''/.test(rota));
check('uma exclusão por vez por lançamento (a trava da baixa)', /if \(lancamentosEmGravacao\.has\(id\)\)[\s\S]{0,300}lancamentosEmGravacao\.add\(id\);[\s\S]*finally \{\s*lancamentosEmGravacao\.delete\(id\);/.test(rota));
check('lê do banco na hora, não do retrato', /const \[entry\] = await db\.getFinancialEntriesByIds\(\[id\]\);\s*if \(!entry\)/.test(rota));
check('o extrato conciliado volta a Não conciliado', /for \(const tx of transacoes\) \{\s*tx\.status = 'nao_conciliado';\s*tx\.matchedEntryId = '';\s*tx\.matchedPaymentId = '';/.test(rota));
check('a auditoria guarda o lançamento, as baixas e o motivo',
  /action: 'excluirLancamento',[\s\S]{0,200}details: \{\s*motivo,[\s\S]{0,80}lancamento: entry,\s*baixas,/.test(rota));
check('grava o extrato no fim', /saveData\(data\);\s*return sendJson\(res, \{\s*success: true,\s*processados,/.test(rota));
check('o vínculo: pedido, entrada de NF-e, contrato e a nota',
  /from orders where id = any\(\$1\)[\s\S]{0,200}from nfe_entrada where id = any\(\$1\)[\s\S]{0,200}from contracts where id = any\(\$1\)[\s\S]{0,200}from nfe where id = any\(\$1\)/.test(servidor));

console.log('\n--- o banco ---');
check('as baixas saem pela FK (on delete cascade)', /entry_id text not null references financial_entries\(id\) on delete cascade/.test(ler('banco/RECRIAR-DO-ZERO.sql')));
check('o ponteiro do extrato no banco é solto antes do DELETE',
  /async function deleteFinancialEntry\(id\) \{\s*const solta = await banco\.from\('bank_transactions'\)\s*\.update\(\{ matched_entry_id: null, matched_payment_id: null, status: 'nao_conciliado' \}\)\s*\.eq\('matched_entry_id', id\);[\s\S]{0,120}banco\.from\('financial_entries'\)\.delete\(\)\.eq\('id', id\)/.test(banco));

console.log('\n--- a tela ---');
check('Excluir na janela do lançamento', /id="financeModalExcluir">Excluir lançamento<\/button>/.test(tela) && /financeModalExcluir'\)\?\.addEventListener\('click', \(\) => excluirLancamentos\(\[entry\.id\], \{ doModal: true \}\)\)/.test(tela));
check('Excluir na barra da seleção', /podeExcluir\(\) \? botao\('excluir', Lista\.avaliar\('excluir', itens\), 'btn-danger'\)/.test(tela) && /acao === 'excluir'\) \{\s*excluirLancamentos\(selecionados\(\)\.map/.test(tela));
check('prévia antes do motivo, pelo DELETE', /method: 'DELETE', body: JSON\.stringify\(\{ ids, previa: true \}\)[\s\S]*await promptModal\(\{[\s\S]{0,500}rotulo: 'Motivo da exclusão'/.test(tela));
check('a auditoria mostra o nome da ação', /excluirLancamento: 'Exclusão de lançamento'/.test(ler('public/modules/settings/subs/access_logs.js')));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
