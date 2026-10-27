// O PEDIDO SOBREVIVE AO F5 (21/10/2026, pedido do usuário: "quando estou dentro
// de um pedido e aperto F5 ele não pode simplesmente sumir as informações").
//
// O pedido aberto vivia só em state.salesDraft.editRecord, e o endereço era
// "#/sales/new_sale" para qualquer pedido: o F5 abria uma Nova Venda vazia.
//   - O pedido aberto vai no endereço (#/sales/new_sale/<id>) e é relido do
//     servidor depois do F5, do Voltar ou de um link colado.
//   - O que foi digitado e não salvo fica nesta aba (sessionStorage) e volta
//     sobre o formulário — só depois do F5, e só sobre o mesmo pedido, na mesma
//     versão gravada.
//
// Provado no navegador (porta 3099) com um pedido de teste (16365, apagado
// depois): aberto, o endereço levou o id; F5 reabriu o 16365 com o cliente; a
// observação mudada sem salvar voltou depois do F5, com o aviso; saindo para a
// lista e reabrindo pelo caminho normal, veio a gravada; a Nova Venda digitada
// voltou depois do F5 ("A venda que estava sendo digitada voltou...").
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');
let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas++;
};

console.log('\n--- o pedido no endereço ---');
const fonte = (app.match(/function registroDoEndereco\(hash = window\.location\.hash\) \{[\s\S]*?\n\}/) || [''])[0];
const contexto = { PREFIXO_DA_TELA: '#/', window: { location: { hash: '' } } };
vm.createContext(contexto);
vm.runInContext(`${fonte}; this.registroDoEndereco = registroDoEndereco;`, contexto);
check('o terceiro pedaço do endereço é o pedido',
  contexto.registroDoEndereco('#/sales/new_sale/ord-123') === 'ord-123'
  && contexto.registroDoEndereco('#/sales/new_sale') === ''
  && contexto.registroDoEndereco('#/sales/new_sale/ord%2F9') === 'ord/9'
  && contexto.registroDoEndereco('#/sales/new_sale/%E0%A4%A') === '');
check('gravar a tela leva o pedido aberto junto',
  /function gravarTelaNoEndereco\(modulo, sub, \{ substituir = false \} = \{\}\) \{\s*const alvo = enderecoDaTela\(modulo, sub\) \+ sufixoDoPedido\(modulo, sub\) \+ sufixoDoLancamentoFinanceiro\(modulo, sub\);/.test(app)
  && /const aberto = modulo === 'sales' && sub === 'new_sale' && state\.salesDraft && state\.salesDraft\.editRecord;/.test(app));
check('o link de menu continua sem pedido (Nova Venda é venda nova)',
  /function enderecoDaTela\(modulo, sub\) \{[^}]*return `\$\{window\.location\.pathname\}\$\{PREFIXO_DA_TELA\}\$\{m\}\$\{sub \? '\/' \+ encodeURIComponent\(String\(sub\)\) : ''\}`;/.test(app));
check('ao abrir pelo endereço, a tela do pedido sabe qual é',
  /if \(doEndereco\.module === 'sales' && doEndereco\.sub === 'new_sale'\) state\.pedidoDoEndereco = registroDoEndereco\(\);/.test(app));
check('o Voltar entre dois pedidos troca de pedido',
  /const mesmoPedido = !\(doEndereco\.module === 'sales' && doEndereco\.sub === 'new_sale'\) \|\| registroDoEndereco\(\) === pedidoAberto;/.test(app)
  && /&& mesmoPedido && mesmoTitulo\) return;/.test(app));

console.log('\n--- a tela do pedido ---');
const tela = app.slice(app.indexOf("if (sub === 'new_sale') {"), app.indexOf("if (sub === 'new_sale') {") + 4500);
check('relê o pedido do endereço (uma vez) antes de montar a tela',
  /if \(typeof state\.pedidoDoEndereco === 'string'\) \{\s*const pedidoId = state\.pedidoDoEndereco;\s*state\.pedidoDoEndereco = null;/.test(tela)
  && /await api\(`\/api\/sales\/records\/\$\{encodeURIComponent\(pedidoId\)\}`\)/.test(tela)
  && tela.indexOf('state.pedidoDoEndereco = null') < tela.indexOf('const editRecord = state.salesDraft?.editRecord || null;'));
check('  e acerta o endereço para o pedido que abriu',
  /const isEditing = Boolean\(editRecord\);\s*acertarPedidoNoEndereco\(editRecord \? editRecord\.id : ''\);/.test(tela));

console.log('\n--- o que estava digitado ---');
check('só a primeira tela depois do F5 recupera, e só se o F5 foi na tela do pedido',
  /state\.recuperarPedidoDaAba = state\.activeModule === 'sales' && state\.activeSub === 'new_sale';/.test(app)
  && /const recuperarDaAba = Boolean\(state\.recuperarPedidoDaAba\);\s*state\.recuperarPedidoDaAba = false;/.test(app));
check('guarda tudo o que o salvar manda',
  /formState, items, payments, discountAmount, discountPercent, freight, generalExpenses, assemblyFee,\s*freightFixed, chargeFreightToBuyer, generateServiceOrder, ignoreCreditLimit, showCteOptions, paymentTerm, abaAtiva/.test(app));
check('  com o pedido e a versão gravada, e só volta sobre os mesmos',
  /registroId: editRecord \? editRecord\.id : '',\s*versao: editRecord \? String\(editRecord\.updatedAt \|\| ''\) : '',/.test(app)
  && /guardado\.registroId === \(editRecord \? editRecord\.id : ''\)\s*&& \(!editRecord \|\| guardado\.versao === String\(editRecord\.updatedAt \|\| ''\)\)/.test(app));
check('  e avisa que voltou (sem contar a aba e a hora de abertura como mudança)',
  /registrationTime: undefined/.test(app) && app.includes("'A venda que estava sendo digitada voltou. Ela ainda não foi salva.'")
  && app.includes("'As alterações que ainda não tinham sido salvas voltaram. Salve para gravá-las.'"));
check('grava a cada redesenho, a cada digitação e ao sair da página',
  /\/\/ Item, pagamento ou aba mudou \(todo mexer redesenha\): guarda na aba\.\s*guardarPedidoNaAba\(\);\s*\};\s*renderForm\(\);/.test(app)
  && /\['input', 'change'\]\.forEach\(\(tipo\) => document\.addEventListener\(tipo,/.test(app)
  && /window\.addEventListener\('pagehide', \(\) => window\.__mavisGuardarPedidoNaAba\?\.\(\)\);/.test(app));
check('  sem a tela do pedido aberta, não grava nada',
  /const guardarPedidoNaAba = \(\) => \{\s*if \(!document\.getElementById\('salesRecordForm'\)\) return;/.test(app));
check('  e armazenamento bloqueado não quebra a tela', /sessionStorage\.setItem\(PEDIDO_EM_EDICAO_KEY, JSON\.stringify\(fotoDoPedido\(\)\)\);\s*\} catch \(_\) \{/.test(app));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
