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

console.log('\n--- rascunho persistente por aba ---');
check('guarda o rascunho no sessionStorage isolado por usuário e título',
  /FINANCE_DRAFT_KEY = 'mavisone:lancamento-financeiro:'/.test(tela)
  && /sessionStorage\.setItem\(chaveDoRascunho, JSON\.stringify/.test(tela)
  && /state\.user\?\.id/.test(tela));
check('persiste alterações ao digitar, alterar campos ou sair da página',
  /document\.addEventListener\(tipo,[\s\S]*?guardarRascunhoFinanceiroAtivo\?\.\(\)/.test(tela)
  && /window\.addEventListener\('pagehide', \(\) => guardarRascunhoFinanceiroAtivo\?\.\(\)\)/.test(tela));
check('restaura tipo, campos, rótulos e parcelas já ajustadas',
  /rascunhoInicial\?\.formType/.test(tela)
  && /const r = rascunhoInicial/.test(tela)
  && /parcelas = r\.parcelas\.map/.test(tela)
  && /Object\.keys\(CAMPOS_DE_BUSCA\)\.forEach/.test(tela));
check('remove o rascunho depois que o lançamento foi salvo',
  /sessionStorage\.removeItem\(chaveDoRascunho\)/.test(tela));
check('informa que o formulário está carregando em vez de mostrar uma área vazia',
  /content\.innerHTML = '<div class="panel"><p>Carregando lançamento\.\.\.<\/p><\/div>'/.test(tela));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
