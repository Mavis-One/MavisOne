#!/usr/bin/env node
// Campo de busca com sugestão (renderSearchableSelect / attachSearchableSelect).
//
// O QUE MUDOU E POR QUÊ
// ---------------------
// O campo abria a lista INTEIRA ao receber o foco. Com centenas de clientes
// cadastrados, clicar no campo despejava tudo por cima do formulário: não
// ajudava a achar ninguém e ainda tapava os campos de baixo. Virou busca de
// verdade — sugere conforme se digita, e a lista completa só sai pela lupa.
//
// O que este teste guarda:
//   1. o foco não reabrir a lista inteira (a regressão mais fácil de voltar,
//      porque "abrir no foco" parece prestativo);
//   2. a busca continuar funcionando sem acento — "galpao" tem que achar
//      "Galpão", senão o campo só serve para quem acerta a acentuação;
//   3. a lupa usar mousedown, não click: click tira o foco do input, e o blur
//      fecha o dropdown 150ms depois — a lista abriria e sumiria sozinha;
//   4. o corte de 50 itens ser avisado, senão o usuário procura um item que
//      existe e não aparece.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

const appSrc = ler('public/app.js');
const cssSrc = ler('public/app.css');
const serverSrc = ler('server.js');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// Carrega as funções puras do app.js num escopo isolado.
function recortar(nome) {
  const inicio = appSrc.indexOf(`function ${nome}(`);
  const fim = appSrc.indexOf('\n}\n', inicio);
  return appSrc.slice(inicio, fim + 3);
}
const { textoDeBusca } = new Function(`${recortar('textoDeBusca')}\nreturn { textoDeBusca };`)();

console.log('--- a busca ignora acento e caixa ---');
// O exemplo do usuário: digitar "gal" tem que oferecer "Galpão".
const casa = (termo, rotulo) => textoDeBusca(rotulo).includes(textoDeBusca(termo).trim());
check('"gal" acha "Galpão"', casa('gal', 'Galpão'));
check('"galpao" acha "Galpão"', casa('galpao', 'Galpão'));
check('"GALPÃO" acha "Galpão"', casa('GALPÃO', 'Galpão'));
check('"sao paulo" acha "São Paulo"', casa('sao paulo', 'Depósito São Paulo'));
check('"revenda" acha "Revenda"', casa('revenda', 'Revenda'));
check('"orcamento" acha "Orçamento"', casa('orcamento', 'Tabela Orçamento'));
check('não casa o que não existe', !casa('xyz', 'Galpão'));

console.log('\n--- o foco NÃO abre a lista inteira ---');
const attach = appSrc.slice(appSrc.indexOf('function attachSearchableSelect'), appSrc.indexOf('function sanitizeDigits'));
// Era exatamente isto: input.addEventListener('focus', () => renderDropdown(''))
check('foco não chama renderDropdown vazio', !/addEventListener\('focus', \(\) => renderDropdown\(''\)\)/.test(attach));
// Sem termo e sem pedido explícito, o dropdown fica fechado.
check('sem termo e sem lupa, não abre', /if \(!term && !mostrarTudo\) \{[\s\S]{0,80}dropdown\.hidden = true;/.test(attach));
// Mas se já há texto digitado, voltar ao campo mostra o que combina com ele.
check('com texto digitado, o foco reabre o filtrado', /addEventListener\('focus', \(\) => \{\s*\n?\s*if \(input\.value\.trim\(\)\) renderDropdown\(input\.value\)/.test(attach));

console.log('\n--- a lupa é a saída para ver tudo ---');
check('o botão existe no HTML', /class="searchable-select-lupa"/.test(appSrc));
check('tem rótulo acessível', /aria-label="Ver todas as opções"/.test(appSrc));
// click tiraria o foco do input; o blur fecha o dropdown 150ms depois.
check('usa mousedown, não click', /lupa\?\.addEventListener\('mousedown'/.test(attach));
check('e impede o blur', /lupa\?\.addEventListener\('mousedown', \(evento\) => \{\s*\n?\s*evento\.preventDefault\(\)/.test(attach));
check('a lupa abre a lista completa', /renderDropdown\('', \{ mostrarTudo: true \}\)/.test(attach));
check('e alterna: clicar de novo fecha', /if \(!dropdown\.hidden\) \{ dropdown\.hidden = true; return; \}/.test(attach));

console.log('\n--- desempenho e limite da lista ---');
// Normalizar centenas de rótulos a cada tecla trava o campo em cadastro grande.
check('índice de busca calculado uma vez', /const indice = options\.map\(/.test(attach));
check('não normaliza dentro do filtro', !/filter\(\(o\) => textoDeBusca\(o\.label\)/.test(attach));
// Cortar em 50 sem avisar faz o usuário procurar um item que existe.
check('corte em 50 é avisado', /Mostrando \$\{mostrados\.length\} de \$\{filtrados\.length\}/.test(attach));
check('e diz o que fazer', /digite mais para refinar/.test(attach));
check('lista vazia tem mensagem', /Nenhum resultado/.test(attach));

console.log('\n--- Escape fecha sem fechar a tela ---');
// stopPropagation: sem ele, o Esc do campo subiria e fecharia o modal inteiro.
check('Escape fecha o dropdown', /evento\.key === 'Escape' && !dropdown\.hidden/.test(attach));
check('e não deixa o evento subir', /evento\.stopPropagation\(\)/.test(attach));

console.log('\n--- Categoria e Tabela de Preços viraram busca ---');
// Eram <input> de texto livre, mesmo existindo cadastro dos dois no Estoque:
// "Revenda", "revenda" e "Revensa" viravam três categorias diferentes.
check('Categoria não é mais texto livre', !/<input name="category" value=/.test(appSrc));
check('Tabela de Preços não é mais texto livre', !/<input name="priceTable" value=/.test(appSrc));
check('Categoria usa o campo de busca', /id: 'salesCategory', name: 'category'/.test(appSrc));
check('Tabela de Preços usa o campo de busca', /id: 'salesPriceTable', name: 'priceTable'/.test(appSrc));
check('as duas são ligadas', /attachSearchableSelect\(\{ id: 'salesCategory'/.test(appSrc)
  && /attachSearchableSelect\(\{ id: 'salesPriceTable'/.test(appSrc));
// Guardam o NOME, não um id: é o que a venda sempre gravou. Trocar para id
// exigiria migrar as vendas antigas.
check('Categoria guarda o nome, não id', /id: 'salesCategory'[\s\S]{0,180}value: c\.name, label: c\.name/.test(appSrc));
check('Tabela guarda o nome, não id', /id: 'salesPriceTable'[\s\S]{0,180}value: t\.name, label: t\.name/.test(appSrc));

console.log('\n--- o servidor manda as duas listas ---');
const meta = serverSrc.slice(serverSrc.indexOf("pathname === '/api/sales/meta'"), serverSrc.indexOf("pathname === '/api/sales/dashboard'"));
check('meta envia productCategories', /productCategories:/.test(meta));
check('meta envia priceTables', /priceTables:/.test(meta));
check('categoria inativa fica de fora', /filter\(\(c\) => c\.status !== 'inativo'\)/.test(meta));
// Sem o padrão no cliente, um meta que falhe deixaria .map estourando.
check('o cliente tem padrão vazio para as duas', /productCategories: \[\], priceTables: \[\]/.test(appSrc));

console.log('\n--- todos os campos de busca da venda ganharam a lupa ---');
// A lupa vem de renderSearchableSelect, então todo campo que o usa herda.
['salesClientSupplier', 'salesCompany', 'salesDeposit', 'salesSeller', 'salesCategory', 'salesPriceTable'].forEach((campo) => {
  check(`${campo} usa o componente`, new RegExp(`id: '${campo}'`).test(appSrc));
});

console.log('\n--- o CSS reserva espaço para a lupa ---');
// Sem padding à direita o texto passa por baixo do botão e some.
check('input tem padding-right', /\.searchable-select-input \{[^}]*padding-right: 38px/.test(cssSrc));
check('lupa posicionada', /\.searchable-select-lupa \{[\s\S]*?position: absolute/.test(cssSrc));
check('lupa tem foco visível', /\.searchable-select-lupa:focus-visible/.test(cssSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
