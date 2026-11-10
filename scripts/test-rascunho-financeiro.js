/**
 * RASCUNHO FINANCEIRO: recuperação após recarregar ou trocar de tela.
 *
 *   node scripts/test-rascunho-financeiro.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'public/app.js'), 'utf8');
const tela = fs.readFileSync(path.join(raiz, 'public/modules/finance/subs/novo_lancamento.js'), 'utf8');
const lista = fs.readFileSync(path.join(raiz, 'public/modules/finance/subs/lancamentos.js'), 'utf8');
let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas++;
};

const extrair = (fonte, nome) => {
  const inicio = fonte.indexOf(`function ${nome}(`);
  if (inicio < 0) return '';
  let profundidade = 0;
  let abriu = false;
  for (let i = fonte.indexOf('{', inicio); i < fonte.length; i++) {
    if (fonte[i] === '{') {
      profundidade++;
      abriu = true;
    } else if (fonte[i] === '}') {
      profundidade--;
      if (abriu && profundidade === 0) return fonte.slice(inicio, i + 1);
    }
  }
  return '';
};

const prefixo = extrair(app, 'telaDoEndereco');
const contextoRota = { PREFIXO_DA_TELA: '#/' };
vm.createContext(contextoRota);
vm.runInContext(`${prefixo}; this.telaDoEndereco = telaDoEndereco;`, contextoRota);
const sufixo = extrair(app, 'sufixoDoLancamentoFinanceiro');
const contextoSufixo = { state: { financeEditEntryId: 'titulo/123' }, encodeURIComponent };
vm.createContext(contextoSufixo);
vm.runInContext(`${sufixo}; this.sufixoDoLancamentoFinanceiro = sufixoDoLancamentoFinanceiro;`, contextoSufixo);

console.log('--- endereço da edição ---');
check('o endereço retorna o identificador do título, inclusive com caracteres escapados',
  contextoRota.telaDoEndereco('#/finance/edicao_titulo/titulo%2F123')?.recordId === 'titulo/123'
  && contextoRota.telaDoEndereco('#/finance/novo_lancamento')?.recordId === '');
check('a tela restaurada recupera o id financeiro do endereço',
  /if \(doEndereco\.module === 'finance' && doEndereco\.sub === 'edicao_titulo'\) \{\s*state\.financeEditEntryId = doEndereco\.recordId \|\| null;/.test(app));
check('o id da edição segue no endereço ao trocar de tela',
  /function sufixoDoLancamentoFinanceiro\(modulo, sub\)/.test(app)
  && /sufixoDoPedido\(modulo, sub\) \+ sufixoDoLancamentoFinanceiro\(modulo, sub\)/.test(app)
  && contextoSufixo.sufixoDoLancamentoFinanceiro('finance', 'edicao_titulo') === '/titulo%2F123'
  && contextoSufixo.sufixoDoLancamentoFinanceiro('finance', 'novo_lancamento') === '');

console.log('\n--- rascunho guardado no navegador (29/10/2026) ---');
check('guarda o rascunho no localStorage, isolado por usuário e título',
  /FINANCE_DRAFT_KEY = 'mavisone:lancamento-financeiro:'/.test(tela)
  && /localStorage\.setItem\(chave, JSON\.stringify\(\{ \.\.\.rascunho, salvoEm: Date\.now\(\) \}\)\)/.test(tela)
  && /gravarRascunhoGuardado\(chaveDoRascunho, rascunho\)/.test(tela)
  && /state\.user\?\.id/.test(tela)
  && !/sessionStorage\.setItem/.test(tela));
check('o de antes, por aba, ainda é lido uma vez',
  /localStorage\.getItem\(chave\) \|\| sessionStorage\.getItem\(chave\)/.test(tela));
check('persiste alterações ao digitar, alterar campos ou sair da página',
  /document\.addEventListener\(tipo,[\s\S]*?guardarRascunhoFinanceiroAtivo\?\.\(\{ digitou: true \}\)/.test(tela)
  && /window\.addEventListener\('pagehide', \(\) => guardarRascunhoFinanceiroAtivo\?\.\(\{ aoSair: true \}\)\)/.test(tela));
check('restaura tipo, campos, rótulos e parcelas já ajustadas',
  /rascunhoInicial\?\.formType/.test(tela)
  && /const r = rascunhoInicial/.test(tela)
  && /parcelas = r\.parcelas\.map/.test(tela)
  && /Object\.keys\(CAMPOS_DE_BUSCA\)\.forEach/.test(tela));
check('remove o rascunho (dos dois armazenamentos) depois que o lançamento foi salvo',
  /encerrarRascunho\(usuarioDoRascunho, chaveDoRascunho, rascunhoId\);\s*\} catch \(error\) \{[\s\S]{0,200}Lançamento salvo, mas/.test(tela)
  && /localStorage\.removeItem\(chave\);\s*sessionStorage\.removeItem\(chave\);/.test(tela));

// 10/11/2026, pedido do usuário: "não estou conseguindo fazer novos lançamentos
// pois o mesmo não apaga as informações de lançamentos já finalizados". Com duas
// abas, a que ainda mostrava o formulário regravava o rascunho já salvo ao ser
// fechada (pagehide). Provado na 3999 antes e depois.
console.log('\n--- rascunho salvo ou descartado não volta (10/11/2026) ---');
const ctxEnc = { JSON, Array, Date, Math, Boolean, String, window: { addEventListener() {} } };
const memoria = { local: {}, sessao: {} };
const armazenamento = (dados) => ({
  getItem: (k) => (k in dados ? dados[k] : null),
  setItem: (k, v) => { dados[k] = String(v); },
  removeItem: (k) => { delete dados[k]; }
});
ctxEnc.localStorage = armazenamento(memoria.local);
ctxEnc.sessionStorage = armazenamento(memoria.sessao);
vm.createContext(ctxEnc);
const blocoEnc = tela.slice(tela.indexOf('const FINANCE_DRAFT_KEY'), tela.indexOf('// O título como estava gravado'));
vm.runInContext(`${blocoEnc}
  this.f = { gravarRascunhoGuardado, lerRascunhoGuardado, encerrarRascunho, rascunhoEncerrado, rascunhosEncerrados, novoIdDeRascunho };`, ctxEnc);
const f = ctxEnc.f;
const chaveNovo = 'mavisone:lancamento-financeiro:u1:novo';
f.gravarRascunhoGuardado(chaveNovo, { rascunhoId: 'rA', campos: { description: 'LANC 1' } });
f.encerrarRascunho('u1', chaveNovo, 'rA');
check('salvar encerra o id e apaga o rascunho dele',
  f.lerRascunhoGuardado(chaveNovo) === null && f.rascunhoEncerrado('u1', { rascunhoId: 'rA' }));
check('o encerrado é por usuário', !f.rascunhoEncerrado('u2', { rascunhoId: 'rA' }));
f.gravarRascunhoGuardado(chaveNovo, { rascunhoId: 'rB', campos: { description: 'da outra aba' } });
f.encerrarRascunho('u1', chaveNovo, 'rA');
check('encerrar não apaga o rascunho de OUTRO id que outra aba pôs ali',
  (f.lerRascunhoGuardado(chaveNovo) || {}).rascunhoId === 'rB');
for (let i = 0; i < 150; i++) f.encerrarRascunho('u1', 'outra', `x${i}`);
check('a lista dos encerrados não cresce sem fim', f.rascunhosEncerrados('u1').length === 100);
check('ids novos não se repetem', f.novoIdDeRascunho() !== f.novoIdDeRascunho());
check('a tela só grava com algo digitado nela e nunca um rascunho encerrado',
  /function salvarRascunhoFinanceiro\(\{ digitou = false \} = \{\}\) \{\s*if \(digitou\) mexeu = true;\s*if \(!mexeu \|\| encerradoAqui\) return;\s*if \(rascunhoEncerrado\(usuarioDoRascunho, \{ rascunhoId \}\)\)/.test(tela));
check('o rascunho guardado leva o id', (tela.match(/^\s*rascunhoId,$/gm) || []).length === 2);
check('rascunho encerrado guardado (ou na memória) não volta ao abrir a tela',
  /if \(rascunhoEncerrado\(usuarioDoRascunho, rascunhoSalvo\)\) \{\s*apagarRascunhoGuardado\(chaveDoRascunho\);\s*rascunhoSalvo = null;/.test(tela)
  && /if \(rascunhoEncerrado\(usuarioDoRascunho, state\.financeRascunhoLancamento\)\) state\.financeRascunhoLancamento = null;/.test(tela));
check('salvar e "Descartar rascunho" encerram o id',
  /encerradoAqui = true;\s*if \(state\.financeRascunhoLancamento && state\.financeRascunhoLancamento\.rascunhoId === rascunhoId\)/.test(tela)
  && /encerradoAqui = true;\s*try \{ encerrarRascunho\(usuarioDoRascunho, chaveDoRascunho, rascunhoId\); \}/.test(tela));
check('a aba que mostrava o rascunho encerrado noutra recomeça ou avisa',
  /window\.addEventListener\('storage', \(evento\) => \{\s*if \(evento\.key && evento\.key\.startsWith\(RASCUNHOS_ENCERRADOS_KEY\)\) aoEncerrarEmOutraAba\?\.\(\);/.test(tela)
  && /aoEncerrarEmOutraAba = \(\) => \{[\s\S]{0,700}para não lançar em dobro[\s\S]{0,300}loadModule\('finance'\);/.test(tela));
check('rascunho da edição não volta por cima do título alterado depois dele',
  /base: impressaoDoTitulo\(editEntry\)/.test(tela)
  && /rascunhoInicial\.base !== impressaoDoTitulo\(editEntry\)/.test(tela));
check('"Descartar rascunho" aparece só quando o rascunho mudou o formulário',
  /retratoDoForm\(\) !== emBranco/.test(tela)
  && /id="financeDescartarRascunho">Descartar rascunho</.test(tela)
  && /mostrarDescartar\(\);\s*\n\s*document\.getElementById\('financeEntryForm'\)\?\.addEventListener\('submit'/.test(tela));
check('informa que o formulário está carregando em vez de mostrar uma área vazia',
  /content\.innerHTML = '<div class="panel"><p>Carregando lançamento\.\.\.<\/p><\/div>'/.test(tela));

console.log('\n--- filtros das listas do Financeiro (29/10/2026) ---');
check('Lançamentos, Contas a Pagar e a Receber guardam filtros, página, ordem e painel por usuário e tela',
  /mavisone:lista-financeiro:\$\{state\.user\?\.id \|\| 'usuario'\}:\$\{telaChave\}/.test(lista)
  && /filtros: lista\.filtros, page: lista\.page, sort: lista\.sort, dir: lista\.dir, showAdvanced: lista\.showAdvanced/.test(lista)
  && /showColunas: false,\s*\.\.\.listaGuardada\(\)/.test(lista));
check('a seleção não é guardada',
  !/selecao: lista\.selecao/.test(lista));
check('guarda a cada desenho da lista',
  /function renderView\(result\) \{\s*const foco = lembrarFoco\(\);\s*guardarLista\(\);/.test(lista));
check('a etiqueta do cliente/fornecedor filtrado tem o nome depois do F5',
  (lista.match(/if \(lista\.showAdvanced \|\| lista\.filtros\.clientSupplierId\) await/g) || []).length === 2);

// 30/10/2026, pedido do usuário: "novamente o mesmo erro [...] URGENTE". Na
// Edição de Título, voltar à aba com algo gravado por outra pessoa redesenha a
// tela (dados ao vivo -> loadModule). O id já consumido virava Novo
// Lançamento, o renderApp() trocava o #moduleContent e a página ficava em
// branco; o F5 depois abria um lançamento vazio. Provado na 3099: antes, hash
// #/finance/novo_lancamento e conteúdo vazio; depois, o mesmo título aberto.
console.log('\n--- o redesenho da Edição de Título ---');
check('o título aberto vem de financeOpenedEntryId quando a tela é a Edição de Título',
  /const idEmEdicao = state\.financeEditEntryId\s*\|\| \(state\.activeSub === 'edicao_titulo' \? state\.financeOpenedEntryId : null\)/.test(tela));
check('depois do renderApp() a tela escreve no #moduleContent novo',
  /let \{ content \} = ctx;/.test(tela)
  && /renderApp\(\);\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*content = document\.getElementById\('moduleContent'\) \|\| content;/.test(tela));
check('"Novo Lançamento" de dentro da edição não reabre o mesmo título',
  /state\.financeOpenedEntryId = null;\s*state\.financeReturnTo = null;\s*renderFinanceNovoLancamento\(ctx\);/.test(tela));
check('o redesenho dos dados ao vivo é o loadModule da tela aberta', /redesenhar: \(\) => loadModule\(state\.activeModule\)/.test(app));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
