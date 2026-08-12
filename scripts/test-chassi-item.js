#!/usr/bin/env node
// Chassi na linha do item de venda.
//
// POR QUE ELE FICA NO ITEM, E NÃO NO PEDIDO
// -----------------------------------------
// O chassi identifica UMA unidade física. Um pedido com dois triciclos tem dois
// chassis; guardá-lo no cabeçalho do pedido serviria para um e mentiria sobre o
// outro. É o mesmo raciocínio da cor, que também mora no item — e é por isso
// que a linha avisa quando alguém põe um chassi numa linha de quantidade 2.
//
// PARA ONDE ELE VAI
// -----------------
// Para as observações da NF-e (campo CHASSI do texto padrão, ver
// modules/shared/nfe_texto_padrao.js) e para o registro do equipamento. Por ser
// código de identificação, é normalizado: "9bw 123" e "9BW123" são o mesmo
// chassi, e guardar os dois formatos faria a busca não achar metade das vendas.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, detalhe) => {
  if (cond) { console.log(`  OK  ${nome}`); }
  else { falhas += 1; console.log(`  XX  ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
};

const serverSrc = ler('server.js');
const appSrc = ler('public/app.js');

// normalizeSalesItems é interna ao server.js, que sobe um servidor ao ser
// carregado. Extrair a função do texto é o que permite testá-la sem rede.
const ini = serverSrc.indexOf('function normalizeSalesItems');
const fim = serverSrc.indexOf('// Delega para o módulo compartilhado');
const normalizar = new Function(`${serverSrc.slice(ini, fim)}\nreturn normalizeSalesItems;`)();

console.log('--- o chassi é código, não texto livre ---');
const itens = normalizar([
  { productId: 'p1', name: 'Triciclo', quantity: 1, unitPrice: 15000, chassi: ' 9bw 123 abc ' },
  { productId: 'p1', name: 'Triciclo', quantity: 1, unitPrice: 15000, chassi: '9BW999' },
  { productId: 'p2', name: 'Parafuso', quantity: 2, unitPrice: 100 }
]);
check('vai para maiúsculas', itens[0].chassi === '9BW123ABC', itens[0].chassi);
check('espaços somem', !/\s/.test(itens[0].chassi));
check('quem não tem fica vazio, não undefined', itens[2].chassi === '');
// Campo sem limite aceitaria um texto colado inteiro e estouraria a coluna.
check('tem teto de tamanho', normalizar([{ name: 'X', quantity: 1, unitPrice: 1, chassi: 'A'.repeat(80) }])[0].chassi.length === 25);

console.log('\n--- um chassi por unidade ---');
// O mesmo produto entra duas vezes, uma linha por equipamento — o mesmo
// desenho que já permite duas cores do mesmo produto na mesma venda.
check('mesmo produto, chassis diferentes, duas linhas', itens.filter((i) => i.productId === 'p1').length === 2);
check('e cada linha guarda o seu', itens[0].chassi !== itens[1].chassi);
// Com dois ou mais na mesma linha o número serviria para um e mentiria sobre
// os outros.
check('a tela avisa se a quantidade for maior que 1', /1 chassi para ' \+ salesFormatQty\(item\.quantity\) \+ ' unidades/.test(appSrc));

console.log('\n--- a tela ---');
check('há coluna de Chassi', /<th>Chassi<\/th>/.test(appSrc));
check('com campo editável por linha', /class="sales-item-chassi" data-index="\$\{index\}"/.test(appSrc));
// Um renderForm() por tecla reconstruiria a linha e tiraria o foco do campo.
check('guarda a cada tecla sem redesenhar', /input'.*\n?\s*items\[Number\(input\.dataset\.index\)\]\.chassi = input\.value;/.test(appSrc));
check('e redesenha só ao sair do campo', /const limpo = input\.value\.trim\(\)\.toUpperCase\(\);/.test(appSrc));
check('o payload leva o chassi', /chassi: item\.chassi \|\| '',/.test(appSrc));
check('item novo nasce com o campo', /chassi: '',/.test(appSrc));
// A linha vazia da tabela tem de cobrir a coluna nova, senão a mensagem
// "nenhum produto" fica torta.
check('o colspan da linha vazia acompanhou', /colspan="8" class="muted">Nenhum produto adicionado/.test(appSrc));
// Em fonte proporcional, 0/O e 1/I ficam idênticos — e conferir chassi contra
// o documento do equipamento é exatamente o caso em que isso importa.
check('o campo é monoespaçado', /\.sales-item-chassi \{[\s\S]{0,220}monospace/.test(ler('public/app.css')));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
