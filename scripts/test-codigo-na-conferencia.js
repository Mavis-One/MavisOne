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

// 22/10/2026, pedido do usuário: "preciso que apareça o código no produto e no
// campo de pesquisa, mas também preciso do botão criar produto via SKU
// diretamente na tela, caso não tenha". Provado na 3099: busca por "010" deu
// "010 — CAPA DE MURO 19CM"; o item de código de fornecedor "010" ficou sem
// produto (antes ia para a capa de muro), "Criar produto" à vista; criado,
// o item ficou "101298 — CAIXA ORGANIZADORA 20L" com o selo "criado agora",
// o outro item e o valor a pagar ficaram como estavam, e a próxima análise
// trouxe o item "já vinculado antes".
check('o código do produto na FRENTE do nome, no campo e na busca', /label: p\.sku \? `\$\{p\.sku\} — \$\{p\.name\}` : p\.name/.test(tela));
check('o selo "código igual ao SKU" saiu', !/código igual ao SKU/.test(tela));
check('"Criar produto" aparece sempre que o item está sem produto',
  /data-cadastrar-produto="\$\{item\.numero\}"\s*\$\{escolha\.produtoId \? 'hidden' : ''\}>\s*Criar produto/.test(tela)
  && /if \(criar\) criar\.hidden = Boolean\(escolha\.produtoId\);/.test(tela));
check('  e o item fica ligado ao produto criado, sem perder o resto da conferência',
  /tela\.escolhas\.set\(numeroItem, \{ produtoId: novo\.id, movimentarEstoque: !tela\.jaNoViper \}\);/.test(tela)
  && /escolhidos\.forEach\(\(e, numero\) => tela\.escolhas\.set\(numero, e\)\);/.test(tela)
  && /Object\.assign\(tela, conferencia\);/.test(tela)
  && /doItem\.vinculo = \{ produtoId: novo\.id, por: 'criado', confianca: 'alta' \};/.test(tela));
check('a reanálise vai como pedido novo (a guarda de repetição devolvia a lista velha)', /body: JSON\.stringify\(\{ xml, instante: Date\.now\(\) \}\)/.test(tela));
const lib = fs.readFileSync(path.join(__dirname, '..', 'lib/entradaNfe.js'), 'utf8');
check('o servidor não casa mais o código do fornecedor com o nosso SKU', !/const porSku = produtos\.find/.test(lib) && !/const porFabricante = produtos\.find/.test(lib));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
