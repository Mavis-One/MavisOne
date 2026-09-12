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
 * NENHUM DEPÓSITO PODE FICAR NEGATIVO (fase CK)
 * -----------------------------------------------
 * A venda conferia só o TOTAL do produto e gravava a baixa no depósito
 * escolhido. Vender 8 de um depósito com 5, quando o produto tinha 10 somando
 * dois galpões, era aceito e o depósito ficava em -3.
 *
 * Isto foi apresentado, o usuário primeiro decidiu deixar como estava e depois
 * mandou corrigir — "nenhum estoque pode ficar negativo, nada pode sair dos
 * estoques após zerados ou com quantidade menor do que solicitado no pedido".
 * O texto que ficava aqui dizia que o comportamento seguiria como estava;
 * deixá-lo seria pior do que não ter comentário.
 *
 * A GUARDA MORA NO COMMIT, e não em cada chamador. commitStockMovements é o
 * ponto único: venda, PCP, transferência, nota de entrada, recebimento de
 * compra e estorno todos passam por lá. Remendar caminho por caminho garante
 * que o próximo caminho novo esqueça. E fica DENTRO da transação, depois do
 * travarProduto — conferir antes de abrir a transação deixaria duas vendas
 * simultâneas passarem somadas pela guarda.
 *
 * MEDIDO contra servidor e banco descartáveis, com 5 em cada um de 2 depósitos:
 *
 *   vender 8 da BARRA, que tem 5 ............ RECUSADO
 *      "Estoque insuficiente em FILIAL 009 (BARRA) ...: disponível 5,
 *       necessário 8. Nenhum depósito pode ficar negativo — transfira o saldo
 *       antes, ou escolha outro depósito."
 *   vender 5, que é exatamente o que há ..... ACEITO
 *   vender 1 da BARRA, agora zerada ......... RECUSADO (disponível 0)
 *   vender 3 da BARRA com 5 no GALPÃO ....... RECUSADO — o total do produto
 *                                             não salva mais ninguém
 *   transferir 3 do GALPÃO e vender 3 ....... ACEITO
 *
 * O "NÃO ALOCADO" TAMBÉM NÃO PODE FICAR NEGATIVO
 * ----------------------------------------------
 * Movimento sem depósito cai nesse balde. Deixá-lo de fora produzia um estado
 * incoerente SEM nenhum número negativo na tela — medido antes desta guarda,
 * com o produto 10000:
 *
 *     FILIAL 006 (GALPAO) = 2      ·      total do produto = 1
 *
 * Então a venda de um pedido sem depósito passa a consumir apenas o não
 * alocado. Saldo fora de depósito só nasce de importação (a rota de
 * movimentação exige depósito de verdade), e é o caso dos produtos do
 * ViperERP. Medido, com 4 fora de depósito:
 *
 *     vender 3 .......... ACEITO, sobra 1
 *     vender 5 .......... RECUSADO (disponível 1)
 *     vender 1 .......... ACEITO, sobra 0
 *     vender 1 .......... RECUSADO (disponível 0)
 *
 * SALDO QUE JÁ ESTAVA NEGATIVO continua aceitando crédito: devolver mercadoria
 * a um depósito negativo é o conserto, não a infração. A guarda só recusa
 * quando o lote PIORA o saldo.
 *
 * A TELA AVISA ANTES
 * ------------------
 * Recusar no faturamento, sozinho, é dizer "não" depois de o cliente ter
 * ouvido "sim". O seletor de produto da venda passou a mostrar o saldo DO
 * DEPÓSITO ESCOLHIDO:
 *
 *     sem depósito ............ "... · saldo 1"
 *     FILIAL 006 (GALPAO) ..... "... · 2 em FILIAL 006 (GALPAO) (1 no total)"
 *     FILIAL 009 (BARRA) ...... "... · 0 em FILIAL 009 (BARRA) (1 no total)"
 *
 * O total vai entre parênteses porque "0 em Barra" sozinho faria concluir que o
 * produto acabou, quando ele pode estar no galpão esperando transferência.
 *
 * DEPÓSITO PERTENCE A UMA FILIAL, E AGORA DÁ PARA DIZER ISSO NA TELA
 * -----------------------------------------------------------------
 * A coluna deposits.company_id e a conferência da rota existem desde a fase AW,
 * e Vendas já filtrava o depósito pela empresa escolhida — mas não havia CAMPO
 * em tela nenhuma. O vínculo só podia ser gravado por SQL, e um recurso que só
 * o banco alcança é um recurso que não existe. Medido:
 *
 *     FILIAL 006 (GALPAO) -> SAL INFINITY PLUS (MATRIZ)
 *     FILIAL 009 (BARRA)  -> SAL INFINITY FILIAL 009 (BARRA)
 *     ESTOQUE CENTRAL     -> (todas as filiais)
 *
 *     escolhendo a BARRA na venda: ["ESTOQUE CENTRAL (todas)", "FILIAL 009 (BARRA)"]
 *     escolhendo a MATRIZ:         ["ESTOQUE CENTRAL (todas)", "FILIAL 006 (GALPAO)"]
 *
 * Em branco é escolha legítima e é o padrão: um galpão central serve a rede
 * inteira, e obrigar a escolher uma filial mentiria sobre ele — é também o que
 * mantém de pé os depósitos já cadastrados sem empresa (ver a fase AW).
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

const app = semComentarios(ler('public/app.js'));

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
console.log('--- 8. a guarda: nenhum deposito pode ficar negativo ---');
// A GUARDA MORA NO COMMIT, e nao em cada chamador. Este e' o check que garante
// isso: se ela migrar para dentro de transitionOrderStockEffect, PCP, nota de
// entrada e recebimento de compra voltam a ficar descobertos.
const posCommit = servidor.indexOf('async function commitStockMovements');
const posGuarda = servidor.indexOf('const deltaPorDeposito = new Map();');
const posInsere = servidor.indexOf('await razaoEstoque.inserirMovimentos(cliente, movements);');
check('a guarda esta dentro de commitStockMovements', posGuarda > posCommit && posCommit > 0);
// ANTES de inserir: conferir depois gravaria e desfaria, e o rollback teria de
// ser perfeito para o razao nao ficar com linha fantasma.
check('  e ANTES de inserir os movimentos', posInsere > posGuarda);
// DEPOIS do lock: conferir antes de travar deixaria duas vendas simultaneas do
// mesmo produto passarem somadas pela guarda.
const posLock = servidor.indexOf('await razaoEstoque.travarProduto(cliente, productId);');
check('  e DEPOIS de travar o produto', posGuarda > posLock && posLock > posCommit);
check('o saldo e lido do BANCO, dentro da transacao',
  /await razaoEstoque\.saldosPorDeposito\(cliente, pares\)/.test(servidor));
const razaoDb = semComentarios(ler('lib/db/estoque-razao.js'));
check('  e a consulta soma o razao por produto+deposito',
  /where product_id = \$1 and deposit_id = \$2/.test(razaoDb));

console.log('--- 9. os dois niveis, e o que fica de fora ---');
const guarda = servidor.slice(posGuarda, posInsere);
// Conferir so a cor deixaria o deposito estourar por itens sem cor; conferir so
// o deposito deixaria uma cor ficar devendo enquanto outra sobra.
check('confere o deposito inteiro E o deposito+cor',
  /const chaves = \[/.test(guarda) && /if \(movimento\.classValueId\) chaves\.push\(/.test(guarda));
// Saldo que JA estava negativo continua aceitando credito: devolver mercadoria
// a um deposito negativo e o conserto, nao a infracao.
check('so recusa quando o lote PIORA o saldo', /\.filter\(\(\[, v\]\) => v\.delta < 0\)/.test(guarda));
check('  e passa quando o resultado nao fica negativo', /if \(resultado >= 0\) continue;/.test(guarda));
// A mensagem tem de dizer ONDE e QUANTO, senao a pessoa nao sabe o que fazer.
const servidorCru = ler('server.js');
check('a recusa nomeia o deposito e os dois numeros',
  /Estoque insuficiente em \$\{nomeDoDeposito/.test(servidorCru)
  && /dispon\u00edvel \$\{Number\(saldo\)\}, necess\u00e1rio \$\{Number\(-delta\)\}/.test(servidorCru));
check('  e diz o que fazer', /transfira o saldo antes, ou escolha outro dep\u00f3sito/.test(servidorCru));

console.log('--- 10. o "nao alocado" tambem nao pode ficar negativo ---');
// Sem isto o estado ficava incoerente SEM nenhum negativo na tela: o produto
// dizia "1 em estoque" e um galpao sozinho guardava 2.
check('ha guarda para movimento sem deposito', /const deltaSemDeposito = new Map\(\);/.test(servidor));
check('  lendo o nao alocado do banco', /await razaoEstoque\.naoAlocadoDoProduto\(cliente, produtoId\)/.test(servidor));
// `unallocated` e DERIVADO (total - alocado), como productBalances calcula.
// Somar o razao do deposito vazio daria outro numero para produto cujo saldo
// entrou por importacao, sem movimento nenhum.
check('  e o nao alocado e total MENOS os depositos, como productBalances faz',
  /coalesce\(p\.stock_quantity, 0\) - coalesce\(\(/.test(razaoDb)
  && /where m\.product_id = p\.id and m\.deposit_id <> ''/.test(razaoDb));
check('a recusa explica que o saldo esta dentro de depositos',
  /O saldo restante est\u00e1 dentro de dep\u00f3sitos/.test(servidorCru));

console.log('--- 11. a tela de venda avisa ANTES ---');
// Recusar no faturamento, sozinho, e dizer "nao" depois de o cliente ter
// ouvido "sim".
check('a meta de vendas manda o saldo por deposito', /saldosPorDeposito,/.test(servidor));
check('o seletor de produto le o deposito escolhido',
  /const saldoNoDepositoEscolhido = \(productId, classValueId\) =>/.test(app));
check('  e a linha do item tambem',
  /const noDeposito = saldoNoDepositoEscolhido\(item\.productId, item\.classValueId\);/.test(app));
// "0 em Barra" sozinho faria concluir que o produto acabou, quando ele pode
// estar no galpao esperando transferencia.
check('o rotulo mostra o total entre parenteses', /no total\)/.test(servidorCru) || /no total\)/.test(ler('public/app.js')));
// Sem isto os numeros continuariam os do deposito anterior, com o campo
// dizendo outro nome.
check('trocar o deposito redesenha o formulario',
  /syncFormState\(\);[\s\S]{0,80}formState\.depositId = valor;[\s\S]{0,40}renderForm\(\);/.test(app));
// renderApp() e para NAVEGACAO: usado aqui, levava o formulario embora.
check('  e NAO com renderApp, que e de navegacao',
  !/formState\.depositId = valor;[\s\S]{0,20}renderApp\(\);/.test(app));

console.log('--- 12. o vinculo deposito -> filial tem campo em tela ---');
const telaDeposito = ler('public/modules/stock/subs/new_deposit.js');
check('o cadastro de deposito tem o campo Filial', /name: 'companyId'/.test(telaDeposito));
check('  alimentado pela meta do estoque',
  /options: \(meta\) => \(meta && meta\.companies\) \|\| \[\]/.test(telaDeposito));
check('  e a meta do estoque manda as empresas',
  /companies: \(data\.companies \|\| \[\]\)\.map/.test(servidor));
// Em branco e escolha legitima e e o padrao: um galpao central serve a rede
// inteira, e obrigar a escolher mentiria sobre ele.
check('"Todas as filiais" e o padrao', /empty: 'Todas as filiais'/.test(telaDeposito));
check('a dica explica o que o vazio significa',
  /Em branco, o dep\u00f3sito serve a qualquer filial/.test(telaDeposito));
// A dica era aceita na descricao do campo e descartada no desenho — pior que
// nao existir, porque quem escreveu acha que esta na tela.
check('  e Stock.field passou a DESENHAR a dica',
  /const dica = def\.hint \?/.test(semComentarios(ler('public/modules/stock/shared.js'))));

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
