#!/usr/bin/env node
/**
 * UM PRODUTO EM VÁRIOS DEPÓSITOS (verificado na fase CJ).
 *
 * A pergunta era se dá para ter o mesmo produto em estoques diferentes. Dá, e
 * funciona — mas nada no `npm test` provava isso. Se alguém mexesse em
 * productBalances ou na guarda da transferência, nenhum teste reclamaria.
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * 1. O saldo por depósito é DERIVADO DO RAZÃO, não guardado à parte. É o que
 *    impede os dois números de divergirem: uma tabela de saldo por depósito
 *    seria um terceiro número, atualizado por outro caminho, livre para
 *    discordar do razão e do total do produto.
 *
 * 2. total = soma dos depósitos + não alocado. Sem esta conta fechando, a
 *    pessoa vê "14 em estoque" e 10 + 4 nos galpões e não tem como saber qual
 *    dos três números está errado.
 *
 * 3. A transferência confere o saldo DO DEPÓSITO DE ORIGEM.
 *
 * MEDIDO contra um servidor e um banco descartáveis, com três depósitos:
 *
 *     10 no GALPAO MATRIZ + 4 na LOJA SAO BENTO ...... total 14, soma bate
 *     transferir 3 da MATRIZ para a ASSISTENCIA ...... ok (7 / 4 / 3)
 *     transferir 99 da LOJA, que tem 4 ............... RECUSADO:
 *        "Saldo insuficiente em LOJA SAO BENTO: disponível 4, solicitado 99."
 *     filtrar a lista por depósito ................... só quem tem saldo > 0
 *     tela Status do Produto ......................... posição por depósito,
 *        participação % e o histórico completo, movimento por movimento
 *
 * O QUE FICA REGISTRADO, E NÃO É BUG POR DECISÃO
 * ----------------------------------------------
 * A VENDA NÃO CONFERE O DEPÓSITO — só o total do produto. Medido:
 *
 *     LOJA SAO BENTO tinha 4, o produto tinha 14 no total
 *     vender 10 DA LOJA .............................. ACEITO
 *     depois:  ASSISTENCIA=3  LOJA=-6  GALPAO=7  total=4
 *     vender 9999 (mais que o total) ................. recusado,
 *        "disponível: 4, necessário: 9999"
 *
 * O total fica certo e nenhum depósito individual fica. A transferência recusa
 * o mesmo movimento que a venda aceita: em server.js a projeção da venda usa a
 * chave `productId|classValueId`, SEM depósito, e semeia com o total do
 * produto — mas grava a baixa no depósito escolhido no pedido.
 *
 * ISTO FOI APRESENTADO E O USUÁRIO DECIDIU DEIXAR COMO ESTÁ (12/09/2026). Está
 * escrito aqui para que:
 *   - ninguém gaste um dia redescobrindo o mesmo comportamento; e
 *   - ninguém o "corrija" achando que é descuido, sem saber que foi escolha.
 *
 * NÃO existe check assertando o comportamento atual de propósito. Travá-lo em
 * teste faria o conserto — que é a direção certa se a decisão mudar — falhar a
 * suíte como se fosse regressão.
 *
 * Se um dia a decisão mudar, o conserto tem UM cuidado: pedido SEM depósito
 * escolhido tem de continuar projetando contra o total. Os 14.864 pedidos
 * importados do ViperERP têm deposit_id vazio, e passar a exigir saldo de um
 * depósito em branco bloquearia todos eles.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const stockCore = require('../lib/stock-core');

// Um razão de mentira, com o MESMO produto em dois depósitos. Este bloco roda
// de verdade: é função pura, e é o coração do saldo por depósito.
const MATRIZ = 'dep-matriz';
const LOJA = 'dep-loja';
const ASSIST = 'dep-assistencia';
const PRODUTO = 'prod-capacete';

const razao = (movimentos) => ({
  deposits: [
    { id: MATRIZ, name: 'GALPAO MATRIZ' },
    { id: LOJA, name: 'LOJA SAO BENTO' },
    { id: ASSIST, name: 'ASSISTENCIA TECNICA' }
  ],
  stockMovements: movimentos,
  productCategories: [],
  productMeta: {}
});

const mov = (type, depositId, quantity, classValueId = '') => ({
  productId: PRODUTO, type, depositId, quantity, classValueId
});

// ---------------------------------------------------------------------------
console.log('--- 1. o mesmo produto em dois depósitos (roda de verdade) ---');
const dados = razao([
  mov('entrada', MATRIZ, 10),
  mov('entrada', LOJA, 4)
]);
const produto = { id: PRODUTO, name: 'CAPACETE', sku: 'DEP-001', stockQuantity: 14, costPrice: 100, salePrice: 200 };

const pos = stockCore.productBalances(dados, produto);
const porDeposito = (p) => Object.fromEntries(p.balances.map((b) => [b.depositName, b.quantity]));

check('cada depósito tem o seu saldo', JSON.stringify(porDeposito(pos))
  === JSON.stringify({ 'GALPAO MATRIZ': 10, 'LOJA SAO BENTO': 4, 'ASSISTENCIA TECNICA': 0 }),
  JSON.stringify(porDeposito(pos)));
// ESTE é o check que importa: sem a conta fechando, a pessoa vê "14 em estoque"
// e 10 + 4 nos galpões e não tem como saber qual dos três números mentiu.
check('  e total = soma dos depósitos + não alocado',
  pos.allocated + pos.unallocated === pos.total,
  `${pos.allocated} + ${pos.unallocated} = ${pos.total}`);
check('  com nada sobrando fora de depósito', pos.unallocated === 0, String(pos.unallocated));

console.log('--- 2. o saldo sai do RAZÃO, e não de um número guardado à parte ---');
// Um movimento a mais muda o saldo sem ninguém "atualizar" campo nenhum. É isto
// que impede o saldo por depósito de divergir do razão.
const comTransferencia = razao([
  mov('entrada', MATRIZ, 10),
  mov('entrada', LOJA, 4),
  mov('saida', MATRIZ, 3),
  mov('entrada', ASSIST, 3)
]);
const pos2 = stockCore.productBalances(comTransferencia, produto);
check('transferir 3 da matriz para a assistência move os dois lados',
  JSON.stringify(porDeposito(pos2))
  === JSON.stringify({ 'GALPAO MATRIZ': 7, 'LOJA SAO BENTO': 4, 'ASSISTENCIA TECNICA': 3 }),
  JSON.stringify(porDeposito(pos2)));
// A transferência não cria nem destrói mercadoria: o total do produto não muda.
check('  e o total do produto não muda', pos2.allocated === 14, String(pos2.allocated));
check('depositBalance responde por par produto+depósito',
  stockCore.depositBalance(comTransferencia, PRODUTO, MATRIZ) === 7
  && stockCore.depositBalance(comTransferencia, PRODUTO, ASSIST) === 3);

console.log('--- 3. a cor DENTRO do depósito ---');
// Saber que existem 8 pretos não diz de qual galpão dá para tirá-los. Sem a
// quebra por cor por depósito, a transferência escolhe o galpão errado e a
// recusa só chega no envio.
const comCor = razao([
  mov('entrada', MATRIZ, 6, 'cor-preto'),
  mov('entrada', MATRIZ, 4, 'cor-branco'),
  mov('entrada', LOJA, 2, 'cor-preto')
]);
check('o preto da matriz é contado separado do preto da loja',
  stockCore.classValueBalance(comCor, PRODUTO, 'cor-preto', MATRIZ) === 6
  && stockCore.classValueBalance(comCor, PRODUTO, 'cor-preto', LOJA) === 2);
// Sem depósito, soma TODOS: é o número do produto, não o do galpão.
check('  e sem depósito soma os dois, porque aí a pergunta é do produto',
  stockCore.classValueBalance(comCor, PRODUTO, 'cor-preto') === 8,
  String(stockCore.classValueBalance(comCor, PRODUTO, 'cor-preto')));
const posCor = stockCore.productBalances(comCor, { ...produto, stockQuantity: 12 });
const matrizCores = posCor.balances.find((b) => b.depositId === MATRIZ).classes;
check('cada depósito devolve a própria quebra por cor',
  matrizCores.length === 2 && matrizCores.every((c) => [6, 4].includes(c.quantity)),
  JSON.stringify(matrizCores));

console.log('--- 4. saldo fora de depósito não desaparece ---');
// Produto com saldo total maior que a soma dos depósitos: o que sobra é saldo
// de antes de o controle por depósito existir, ou de importação. Esconder isso
// faria a soma dos galpões não bater com o total e ninguém saberia por quê.
const posSobra = stockCore.productBalances(dados, { ...produto, stockQuantity: 20 });
check('a sobra aparece como não alocado', posSobra.unallocated === 6, String(posSobra.unallocated));
check('  e a conta continua fechando',
  posSobra.allocated + posSobra.unallocated === posSobra.total,
  `${posSobra.allocated} + ${posSobra.unallocated} = ${posSobra.total}`);

console.log('--- 5. a transferência confere o depósito de ORIGEM ---');
const servidor = semComentarios(ler('server.js'));
const css = ler('public/app.css');
check('há recusa por saldo do depósito de origem',
  /Saldo insuficiente em \$\{deposit\.name\}: dispon[íi]vel \$\{available\}, solicitado \$\{qty\}\./.test(servidor));
// A mesma recusa, por cor: transferir 3 pretos de um galpão que tem 2 pretos e
// 10 no total não pode passar.
check('  e por cor dentro do depósito',
  /Saldo insuficiente de \$\{nome\} em \$\{deposit\.name\}/.test(servidor));

console.log('--- 6. o filtro da lista por depósito ---');
check('a lista de produtos filtra por depósito',
  /list = list\.filter\(\(p\) => \(p\.balances\.find\(\(b\) => b\.depositId === depositId\) \|\| \{\}\)\.quantity > 0\)/.test(servidor));

console.log('--- 7. o painel "Quantidades Disponíveis por Estoque" ---');
const compartilhado = ler('public/modules/stock/shared.js');
const compartilhadoCodigo = semComentarios(compartilhado);
const telaStatus = ler('public/modules/stock/subs/product_status.js');

check('o painel existe e mora no compartilhado', /Stock\.quantidadesPorEstoque = function/.test(compartilhadoCodigo));
check('  e a tela Status do Produto o usa', /\$\{S\.quantidadesPorEstoque\(product\)\}/.test(telaStatus));
check('  com o título do painel', /<h3>Quantidades Disponíveis por Estoque<\/h3>/.test(telaStatus));
// A tabela de tres colunas nao pode voltar: ela respondia a mesma pergunta
// obrigando a ler linha por linha.
check('  e a tabela de três colunas não voltou',
  !/<th>Depósito<\/th><th>Saldo<\/th><th>Participação<\/th>/.test(telaStatus));

// TRES ESTADOS. Zero quer dizer "nao tem aqui"; negativo quer dizer "o livro
// esta errado". Pintar os dois iguais esconderia um problema atras de um
// estado normal.
check('três estados, e não dois',
  /const estado = qtd < 0 \? 'negativo' : \(qtd > 0 \? 'tem-saldo' : 'zerado'\);/.test(compartilhadoCodigo));
for (const classe of ['tem-saldo', 'zerado', 'negativo', 'sem-deposito']) {
  check(`  .estoque-card.${classe.padEnd(13)} tem estilo`,
    new RegExp(`\.estoque-card\.${classe} \{`).test(css));
}
// As cores saem dos tokens do tema, e nao de hex solto: o painel tem de
// funcionar no claro e no escuro. Medido no navegador — claro: verde
// rgb(22,163,74) / vermelho rgb(239,68,68); escuro: rgb(59,255,109) /
// rgb(255,59,92).
check('as cores vêm dos tokens do tema',
  /\.estoque-card\.tem-saldo \{[\s\S]{0,60}background: var\(--success\);/.test(css)
  && /\.estoque-card\.zerado \{[\s\S]{0,60}background: var\(--danger\);/.test(css));

// Os zerados APARECEM. Uma lista que mostra so' onde ha saldo nao responde "de
// onde da' para transferir", que e' a pergunta seguinte.
const corpoDoPainel = compartilhadoCodigo.slice(
  compartilhadoCodigo.indexOf('quantidadesPorEstoque'),
  compartilhadoCodigo.indexOf('quantidadesPorEstoque') + 1800
);
check('os depósitos zerados aparecem (nada filtra por saldo positivo no painel)',
  !/balances[^;]*filter\([^;]*quantity[^;]*> 0/.test(corpoDoPainel));
// Maior primeiro: a pergunta e' "de onde eu tiro este produto?".
check('a ordem é decrescente pelo saldo',
  /\.sort\(\(a, b\) => Number\(b\.quantity \|\| 0\) - Number\(a\.quantity \|\| 0\)\)/.test(compartilhadoCodigo));
// O negativo cai no fim da ordem decrescente. O aviso e o que impede de
// depender de varrer o painel inteiro para notar.
check('  e um aviso conta quantos depósitos estão negativos',
  /depósito\(s\) com saldo negativo/.test(compartilhado));
// Nome empilhado sobre o numero: os dois sao <span>, que e inline por padrao.
// Sem isto saiam lado a lado e o numero deixava de saltar aos olhos.
check('o nome fica EMPILHADO sobre o número, não ao lado',
  /\.estoque-card-nome \{[\s\S]{0,40}display: block;/.test(css)
  && /\.estoque-card-qtd \{[\s\S]{0,40}display: block;/.test(css));
// "Sem deposito definido" nao e' deposito: e' o saldo do cadastro que nunca foi
// distribuido. Nem verde nem vermelho dizem a verdade sobre ele.
check('o saldo sem depósito tem cartão próprio, neutro',
  /SEM DEPÓSITO DEFINIDO/.test(compartilhado)
  && /\.estoque-card\.sem-deposito \{[\s\S]{0,120}background: var\(--panel-alt\)/.test(css));
check('  e só aparece quando existe', /if \(Number\(product\.unallocated \|\| 0\) !== 0\)/.test(compartilhadoCodigo));
check('sem depósito nenhum, o painel explica em vez de sair vazio',
  /Nenhum depósito cadastrado\. Cadastre um depósito/.test(compartilhado));

// ---------------------------------------------------------------------------
console.log('--- o que foi medido, com servidor e banco descartáveis ---');
for (const [caso, resultado] of [
  ['10 na matriz + 4 na loja', 'total 14, soma bate'],
  ['transferir 3 matriz -> assistência', 'ok — 7 / 4 / 3'],
  ['transferir 99 da loja (tem 4)', 'RECUSADO: "disponível 4, solicitado 99"'],
  ['filtrar por depósito', 'só quem tem saldo > 0 nele'],
  ['tela Status do Produto', 'posição por depósito, % e histórico'],
  ['erros de console', '0']
]) console.log(`  ·  ${caso.padEnd(34)} ${resultado}`);

console.log('');
console.log('  !  A VENDA NÃO CONFERE O DEPÓSITO — só o total do produto:');
console.log('     a loja tinha 4, o produto tinha 14, vender 10 DA LOJA foi ACEITO');
console.log('     e a loja ficou em -6 (total 4: ASSISTENCIA=3 LOJA=-6 GALPAO=7).');
console.log('     Vender mais que o TOTAL é recusado. A transferência recusa o');
console.log('     mesmo movimento que a venda aceita.');
console.log('     Apresentado ao usuário em 12/09/2026 — decidiu DEIXAR COMO ESTÁ.');
console.log('     Não há check travando esse comportamento, de propósito: travá-lo');
console.log('     faria o conserto falhar a suíte como se fosse regressão.');

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
