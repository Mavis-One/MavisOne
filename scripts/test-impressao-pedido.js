#!/usr/bin/env node
// O PEDIDO IMPRESSO, NO MODELO QUE A EMPRESA JÁ USA.
//
// Em 30/09/2026 a impressão do pedido foi padronizada com o documento que a
// empresa entrega ao cliente: cabeçalho com emitente e número, DADOS DO
// CLIENTE em caixa, PRODUTOS E SERVIÇOS com Código/NCM/Unidade, TOTAIS em
// faixa, termos, assinatura e observações.
//
// O QUE ESTE TESTE PROTEGE, em ordem de estrago:
//
//   1. O SEGREDO DA FOCUS não pode entrar no cabeçalho. `mapEstabelecimentoRow`
//      devolve `focusTokenConfigured` e `focusAmbiente`; o emitente da
//      impressão é montado campo por campo justamente para que um spread
//      distraído não os carregue para um papel que vai para o cliente.
//
//   2. AS PARCELAS IMPRESSAS TÊM DE FECHAR COM O TOTAL. Era o defeito da
//      versão anterior: o documento listava desconto em % e R$ e omitia
//      despesas gerais e taxa de montagem, então a soma não dava o total.
//      "Outros" existe para que nada fique fora.
//
//   3. COLUNA QUE SÓ SABE DIZER ZERO não entra. O modelo tem "Seguro"; este
//      sistema não tem o campo. Uma coluna sempre em R$ 0,00 sugere que
//      alguém controla seguro por pedido, e ninguém controla.
//
//   4. CABEÇALHO SEM DADOS tem de dizer onde cadastrar. `empresa` e
//      `estabelecimento` têm 0 linhas nesta base: moldura vazia parece defeito
//      de impressora, e uma frase diz o que fazer.
//
// A renderização de verdade é conferida por scripts/prova-impressao-pedido.js,
// que sobe o servidor. Aqui é estático: roda sem banco e sem rede.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const tela = ler('public/app.js');
const servidor = ler('server.js');
// Só o template da impressão: `server.js` e o resto de `app.js` falam de
// "Seguro", "NCM" e "TOTAL" por outros motivos, e um check sobre o arquivo
// inteiro daria verde para o papel errado.
const template = (tela.match(/const emitente = meta\.emitente \|\| null;[\s\S]*?<\/body><\/html>`\);/) || [''])[0];

console.log('--- 1. o template existe e é o da impressão ---');
check('o trecho do documento foi encontrado', template.length > 1000, template.length + ' caracteres');
check('  e é escrito na janela aberta', /win\.document\.write\(/.test(template));

console.log('\n--- 2. as seções do modelo ---');
const SECOES = ['DADOS DO CLIENTE', 'PRODUTOS E SERVIÇOS', 'TOTAIS', 'TERMOS E CONDIÇÕES DA VENDA', 'OBSERVAÇÕES'];
for (const secao of SECOES) check(`  ${secao}`, template.includes(`<h2>${secao}</h2>`));
const posicoes = SECOES.map((s) => template.indexOf(`<h2>${s}</h2>`));
check('  e nesta ordem', posicoes.every((p, i) => i === 0 || p > posicoes[i - 1]), posicoes.join(' < '));

// O CABEÇALHO À DIREITA: número, emissão e validade, como no modelo. Só a
// prova (que sobe servidor) conferia isso, então uma mutação que tirava o
// número do papel passava no npm test — o documento ficava sem o único dado
// que permite achar o pedido depois.
const cabecalho = (template.match(/<div class="doc-num">[\s\S]*?<\/div>\n\s*<\/div>/) || [''])[0];
check('o número do pedido está no cabeçalho',
  /editRecord\?\.code \? ` Nº \$\{escapeHtml\(String\(editRecord\.code\)\)\}`/.test(cabecalho));
check('  a emissão também', /Emissão \$\{escapeHtml\(formState\.date \|\| '-'\)\}/.test(cabecalho));
check('  e a validade, quando existe', /formState\.dueDate \? `<div>Validade/.test(cabecalho));

console.log('\n--- 3. as sete colunas de PRODUTOS E SERVIÇOS ---');
const COLUNAS = ['Código', 'NCM', 'Descrição', 'Qtd.', 'Unidade', 'Valor Unitário', 'Valor Total'];
for (const coluna of COLUNAS) check(`  ${coluna}`, template.includes(`<th>${coluna}</th>`));
// NCM e unidade não estão no item do pedido — vêm do catálogo, pelo productId.
check('NCM e unidade vêm do catálogo pelo productId',
  /const catalogo = new Map\(\(meta\.products \|\| \[\]\)\.map\(\(p\) => \[p\.id, p\]\)\)/.test(template)
  && /catalogo\.get\(i\.productId\)/.test(template));
check('  e o produto traz esses dois campos na rota',
  /ncm: p\.ncm/.test(servidor) || /ncm,/.test(servidor));

console.log('\n--- 4. as parcelas fecham com o total ---');
// base − desconto + frete + outros = total. Se uma parcela sair da faixa, a
// conta impressa deixa de fechar e ninguém avisa.
for (const parcela of ['totais.freteCobrado', 'totais.descontoTotal', 'totais.base', 'totais.totalAmount']) {
  check(`  ${parcela} está na faixa`, template.includes(parcela));
}
check('"Outros" soma despesas gerais e taxa de montagem',
  /const outros = Number\(totais\.despesasGerais \|\| 0\) \+ Number\(totais\.taxaMontagem \|\| 0\);/.test(template)
  && /salesFormatBRL\(outros\)/.test(template));
check('e nenhuma coluna de Seguro, que só saberia dizer zero',
  !/<th>Seguro<\/th>/.test(template));

console.log('\n--- 5. o bloco do cliente pede o que o modelo pede ---');
// Metade dos rótulos sai de `linhaCliente(rotulo, valor)` e metade é <th>
// literal, então o check aceita as duas formas. A primeira versão só olhava o
// <th> e acusava "Condições:" como ausente quando ele estava lá, via helper.
for (const rotulo of ['Cliente:', 'Endereço:', 'Condições:', 'Vendedor:', 'Telefone:', 'CPF/CNPJ:', 'Frete por Conta:', 'Status:']) {
  check(`  ${rotulo}`, template.includes(`<th>${rotulo}</th>`) || template.includes(`linhaCliente('${rotulo}'`));
}
// O telefone do cliente não existia no diretório antes de 30/09/2026: a linha
// sairia vazia em todo pedido.
check('o diretório do cadastro passou a levar telefone',
  /phone: record\.phone \|\| '',/.test(servidor));
check('  e a lista da página continua enxuta',
  /directory: getCadastroDirectory\(data\)\.map\(\(c\) => \(\{ id: c\.id, name: c\.name \}\)\)/.test(servidor));
check('"Condições" vem do paymentTerm, não de texto livre',
  /formState\.paymentInfo && formState\.paymentInfo\.paymentTerm\) === 'aprazo'/.test(template));
check('"Frete por Conta" vem da aba Entrega',
  /formState\.delivery && formState\.delivery\.shippingMethod/.test(template));

console.log('\n--- 6. o emitente: sem segredo, e sem moldura vazia ---');
const emitenteFn = (servidor.match(/async function emitenteParaImpressao\(\) \{[\s\S]*?\n\}/) || [''])[0];
check('a função do emitente existe', emitenteFn.length > 200, emitenteFn.length + ' caracteres');
check('ela escolhe campo por campo, sem spread do estabelecimento',
  /razaoSocial: escolhido\.razaoSocial/.test(emitenteFn)
  && !/\.\.\.escolhido/.test(emitenteFn));
check('NENHUM campo da Focus sai nele',
  !/focus/i.test(emitenteFn.replace(/^\s*\/\/.*$/gm, '')));
check('sem estabelecimento devolve null, e não um objeto vazio',
  /if \(!ativos\.length\) return null;/.test(emitenteFn));
check('  com vários, escolhe a MATRIZ e diz quantos são',
  /MATRIZ/.test(emitenteFn) && /unidades: ativos\.length/.test(emitenteFn));
check('banco sem a fase fiscal ainda imprime', /catch \(erro\) \{\s*\n\s*return null;/.test(emitenteFn));
check('a rota do formulário entrega o emitente',
  /emitente: await emitenteParaImpressao\(\),/.test(servidor));

check('o cabeçalho sem dados diz onde cadastrar',
  /Cabeçalho sem dados da empresa/.test(template)
  && /Configurações › Fiscal/.test(template));
check('  e não é o mesmo tom do cabeçalho preenchido',
  /class="sem-emitente"/.test(template));

console.log('\n--- 7. o papel continua dizendo o que ele é ---');
// Ele não é NF-e. O cabeçalho com CNPJ pode ser lido como emissão fiscal, e é
// justamente por isso que a frase tem de continuar lá.
check('"Documento interno, sem valor fiscal" segue no documento',
  /Documento interno, sem valor fiscal/.test(template));
check('termos e observações só saem quando existem',
  /\$\{formState\.salesTerms \? `/.test(template) && /\$\{formState\.note \? `/.test(template));
check('  e a linha de assinatura acompanha os termos',
  template.indexOf('Assinatura:') > template.indexOf('formState.salesTerms ?')
  && template.indexOf('Assinatura:') < template.indexOf('formState.note ?'));

console.log('\n--- 8. nada escapa sem escapar ---');
// Nome de cliente com "<" viraria tag. A primeira versão deste bloco tentou
// varrer TODA interpolação com uma regex de exceções, e acusou quatro falsos
// positivos: `${cliente.city}` dentro de `enderecoDoCliente()` (cuja saída é
// escapada depois), `${rotulo}` (literal do nosso próprio código) e um
// ternário entre dois literais. Regex generalista sobre template literal não
// decide isso. O que decide é apontar CADA valor que vem de fora.
check('o helper das linhas do cliente escapa o valor',
  /const linhaCliente = \(rotulo, valor\) => `<tr><th>\$\{rotulo\}<\/th><td>\$\{escapeHtml\(valor \|\| ''\)\}<\/td>`/.test(template));
for (const campo of [
  "cliente?.phone || ''", "cliente?.document || ''",
  'formState.note', 'formState.salesTerms', 'fretePorConta',
  'SalesStatus.rotulo(formState.status)', "formState.date || '-'"
]) {
  check(`  escapeHtml(${campo})`, template.includes(`escapeHtml(${campo})`));
}
// Os dois endereços são montados por helper e escapados na saída dele: o do
// cliente pelo `linhaCliente`, o do emitente na própria interpolação.
check('  o endereço do cliente entra pelo helper que escapa',
  template.includes("linhaCliente('Endereço:', enderecoDoCliente())"));
check('  e o do emitente é escapado na interpolação',
  template.includes('escapeHtml(enderecoDoEmitente())'));
// A linha do item: descrição e unidade vêm de cadastro, então passam por
// escapeHtml; os dois valores de dinheiro passam por salesFormatBRL, que
// formata número e não repassa texto.
check('a descrição do item é escapada', /escapeHtml\(descricao\)/.test(template));
check('  e o NCM e a unidade do catálogo também',
  /escapeHtml\(produto\.ncm \|\| ''\)/.test(template) && /escapeHtml\(produto\.unidadeComercial \|\| ''\)/.test(template));
check('  e o código do item', /escapeHtml\(i\.sku \|\| '-'\)/.test(template));
// Os campos do emitente vêm do cadastro fiscal e vão para o topo do papel.
//
// O RECORTE É SÓ O HTML, e não o preâmbulo: `enderecoDoEmitente()` monta uma
// string JS com `${emitente.municipio}` dentro, e a saída DELA é escapada na
// interpolação. Varrer o preâmbulo junto acusava esses dois como crus, que era
// falso — o que importa é o que entra no documento.
const soHtml = template.slice(template.indexOf('win.document.write(`'));
const emitenteCru = (soHtml.match(/\$\{emitente\.(?!unidades)[a-zA-Z]+\}/g) || []);
check('nenhum campo do emitente entra cru no documento', emitenteCru.length === 0,
  emitenteCru.slice(0, 3).join(', ') || 'todos escapados');
check('  e a unidade, que é número, é a única exceção',
  /\$\{emitente\.unidades\}/.test(soHtml) || /há \$\{emitente\.unidades\}/.test(soHtml));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
