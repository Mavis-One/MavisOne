/**
 * O PRODUTO ABERTO NO STATUS DO PRODUTO SOBREVIVE AO REDESENHO (11/11/2026).
 *
 * Pedido do usuário: "toda vez que eu troco de aba ou faço algum movimento fora
 * dessa página ela joga pra essa outra". Voltar à aba redesenha a tela (dados
 * ao vivo -> loadModule), e o produto escolhido só valia no primeiro desenho:
 * o seguinte abria o primeiro da lista ("0,100 UN PB314P...").
 *
 *   node scripts/test-status-do-produto-no-redesenho.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'public/app.js'), 'utf8');
const tela = fs.readFileSync(path.join(raiz, 'public/modules/stock/subs/product_status.js'), 'utf8');
let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas++;
};
const extrair = (fonte, nome) => {
  const inicio = fonte.indexOf(`function ${nome}(`);
  if (inicio < 0) return '';
  let profundidade = 0;
  for (let i = fonte.indexOf('{', inicio); i < fonte.length; i++) {
    if (fonte[i] === '{') profundidade++;
    else if (fonte[i] === '}' && --profundidade === 0) return fonte.slice(inicio, i + 1);
  }
  return '';
};

console.log('--- a tela ---');
check('o produto aberto fica guardado, e o pedido de fora vem antes dele',
  /let productId = \[state\.stockStatusProductId, state\.stockStatusAbertoId\]\.find\(existe\)\s*\|\| \(meta\.products\[0\] \? meta\.products\[0\]\.id : ''\);/.test(tela)
  && /state\.stockStatusAbertoId = id \|\| null;/.test(tela));
check('produto que não existe mais (excluído) não é aberto', /const existe = \(id\) => Boolean\(id\) && meta\.products\.some\(\(p\) => p\.id === id\);/.test(tela));
check('escolher outro produto guarda o novo', /onSelect: \(value\) => \{\s*abrirProduto\(value\);\s*render\(\);/.test(tela));
check('o endereço só muda com a tela na frente',
  /state\.activeModule === 'stock' && state\.activeSub === 'product_status'\) \{\s*gravarTelaNoEndereco\('stock', 'product_status', \{ substituir: true \}\);/.test(tela));

console.log('\n--- o endereço (F5, guia nova, Voltar) ---');
const ctx = { state: {}, encodeURIComponent };
vm.createContext(ctx);
vm.runInContext(`${extrair(app, 'sufixoDoStatusDoProduto')}; this.sufixo = sufixoDoStatusDoProduto;`, ctx);
ctx.state.stockStatusAbertoId = 'prod-10072';
check('o produto aberto vai no endereço', ctx.sufixo('stock', 'product_status') === '/prod-10072');
ctx.state.stockStatusProductId = 'prod/2';
check('  o pedido de fora antes do aberto, escapado', ctx.sufixo('stock', 'product_status') === '/prod%2F2');
check('  outra tela, nada', ctx.sufixo('stock', 'products') === '' && ctx.sufixo('finance', 'product_status') === '');
check('gravar a tela leva o sufixo', /\+ sufixoDoStatusDoProduto\(modulo, sub\);/.test(app));
check('o endereço do F5 abre o produto dele',
  /if \(doEndereco\.module === 'stock' && doEndereco\.sub === 'product_status' && doEndereco\.recordId\) \{\s*state\.stockStatusProductId = doEndereco\.recordId;/.test(app));
check('o Voltar para outro produto troca de produto', /const mesmoProduto = !\(doEndereco\.module === 'stock' && doEndereco\.sub === 'product_status'\)/.test(app)
  && /&& mesmoPedido && mesmoTitulo && mesmoProduto\) return;/.test(app));
check('sair do sistema esquece o produto aberto', /state\.cadastroDraft = \{ people: \{\}, cnpjs: \{\} \};\s*state\.stockStatusAbertoId = null;/.test(app));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
