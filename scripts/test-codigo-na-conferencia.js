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
// 30/10/2026, pedido do usuário: "permita criar códigos novos por sku mesmo
// que já tenha códigos antigos". O botão fica à vista também com o item ligado
// a um produto ("Criar código novo"), e a ficha da nota vem em todo item.
check('o botão de cadastrar aparece em todo item, ligado ou não',
  /data-cadastrar-produto="\$\{item\.numero\}">\$\{rotuloDoCriar\(escolha\.produtoId\)\}<\/button>/.test(tela)
  && /if \(criar\) criar\.textContent = rotuloDoCriar\(escolha\.produtoId\);/.test(tela)
  && !/criar\.hidden/.test(tela) && !/escolha\.produtoId \? 'hidden'/.test(tela));
check('  "Criar produto" sem produto, "Criar código novo" com', /return produtoId \? 'Criar código novo' : 'Criar produto';/.test(tela));
check('  o aviso diz qual código o item deixa de usar', /O item deixa de usar o código \$\{codigoAtual\}, que continua cadastrado/.test(tela));
// 30/10/2026: com o servidor de antes (sem a ficha no item ligado) o clique
// parava em "Abra a nota de novo". A tela monta a mesma ficha com o item.
check('  sem a ficha do servidor, a tela monta a mesma com o item', /const s = fichaDoItem\(item\);/.test(tela)
  && /if \(item\.sugestaoProduto\) return item\.sugestaoProduto;/.test(tela) && !/Abra a nota de novo/.test(tela));
{
  const fonte = /function fichaDoItem\(item\) \{[\s\S]*?\n    \}/.exec(tela);
  const E = require('../lib/entradaNfe');
  const item = { numero: 1, codigo: '10766', descricao: 'ALGARISMO 125MM', ean: '7896112466314', ncm: '83100000', cest: '1234567',
    unidade: 'PC', unidadeTributavel: 'UN', icms: { origem: '0' }, valorUnitario: 4.5 };
  // eslint-disable-next-line no-new-func
  const daTela = fonte ? new Function(`${fonte[0]}\nreturn fichaDoItem;`)()(item) : null;
  const doServidor = E.sugerirProdutoDoItem(item);
  const campos = ['name', 'sku', 'ean', 'ncm', 'cest', 'unidadeComercial', 'unidadeTributavel', 'origem', 'costPrice'];
  check('  e a ficha da tela é a do servidor, campo a campo', Boolean(daTela) && campos.every((c) => daTela[c] === doServidor[c]),
    daTela && campos.filter((c) => daTela[c] !== doServidor[c]).join(','));
}
{
  const E = require('../lib/entradaNfe');
  const c = E.montarConferencia({
    nota: { chave: '4'.repeat(44), emitente: { documento: '05824631000149', nome: 'F' }, destinatario: { documento: '43792899000135' },
      itens: [{ numero: 1, codigo: 'A1', descricao: 'PARAFUSO 10MM', ean: '7891234567895', ncm: '73181500', quantidade: 1, valorUnitario: 2, valorTotal: 2 }] },
    produtos: [{ id: 'p-velho', sku: '000123', name: 'PARAFUSO ANTIGO', ean: '7891234567895' }]
  });
  check('  item ligado a produto antigo também traz a ficha da nota', c.itens[0].vinculo && c.itens[0].vinculo.produtoId === 'p-velho'
    && c.itens[0].sugestaoProduto && c.itens[0].sugestaoProduto.name === 'PARAFUSO 10MM');
}
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
