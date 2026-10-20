// O CÓDIGO DO PRODUTO NA CONFERÊNCIA DA ENTRADA (20/10/2026, pedido do
// usuário, no print de "Itens da nota": "preciso que o código do produto
// apareça nessa tela").
//
// A linha mostrava só o código do FORNECEDOR. Agora a coluna "Código", logo
// depois do "#", traz o código do produto do estoque vinculado ao item, e muda
// com a escolha. Provado no navegador com o XML de exemplo: item 1 (vinculado
// pelo código de barras) com o código 11845; item 2 sem produto "—", e com o
// produto escolhido na busca, 8311.
const fs = require('fs');
const path = require('path');

const tela = fs.readFileSync(path.join(__dirname, '..', 'public/modules/purchases/subs/entrada_nfe.js'), 'utf8');
let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas++;
};

check('a coluna Código, logo depois do #', /<th>#<\/th>\s*<th>Código<\/th>\s*<th>Descrição na nota<\/th>/.test(tela));
check('  com o código do produto vinculado ao item', /data-codigo-item="\$\{item\.numero\}">\$\{escapeHtml\(codigoDoProduto\(escolha\.produtoId\)\)\}<\/td>/.test(tela));
check('  "—" quando não há produto (ou ele não tem código)', /return produto && produto\.sku \? produto\.sku : '—';/.test(tela));
check('  e muda quando se escolhe outro produto', /escolha\.produtoId = valor \|\| '';\s*const celula = document\.querySelector\(`\[data-codigo-item="\$\{item\.numero\}"\]`\);\s*if \(celula\) celula\.textContent = codigoDoProduto\(escolha\.produtoId\);/.test(tela));
check('o do fornecedor continua embaixo da descrição', /cód\. fornecedor \$\{escapeHtml\(item\.codigo \|\| '—'\)\}/.test(tela));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
