#!/usr/bin/env node
/**
 * CARGA EM TRÂNSITO E CONFERÊNCIA NA CHEGADA (fase CZ) — sem banco e sem servidor.
 *
 * O DEFEITO. A transferência entre depósitos era INSTANTÂNEA: a saída da origem
 * e a entrada no destino nasciam na mesma transação. Para dois depósitos do
 * mesmo galpão está certo — a mercadoria muda de prateleira. Para 13 lojas, a
 * carga que sai do CD aparece no estoque da FILIAL 08 antes de o caminhão sair:
 *
 *   1. a filial vende o que está na estrada, e o cliente descobre no balcão;
 *   2. durante a viagem ninguém é o dono — a origem já não responde e o destino
 *      ainda não tem;
 *   3. perda no caminho NÃO EXISTE como fato. Reaparece meses depois como falta
 *      na contagem da filial, sem data e sem carga a que atribuí-la.
 *
 * Medido por HTTP em 25/09/2026, com 10 unidades no CD (ANTES da fase):
 *
 *   enviar 10 CD -> FILIAL 08
 *     CD 0 · FILIAL 10 · a filial já podia vender as 10
 *
 * E DEPOIS:
 *
 *   enviar 10 CD -> FILIAL 08
 *     CD 0 · FILIAL 0 · TRÂNSITO 10 · total do produto 10 (inalterado)
 *   conferir 7
 *     FILIAL 7 · TRÂNSITO 3 · linha segue 'enviada' · total 10
 *   conferir os 3 que faltavam
 *     FILIAL 10 · TRÂNSITO 0 · linha 'recebida' · total 10
 *
 * O QUE ESTE TESTE PROTEGE, E POR QUE CADA COISA
 * ---------------------------------------------
 * 1. O TOTAL DO PRODUTO NUNCA MUDA. A mercadoria existe durante a viagem. Um
 *    sistema que a faz desaparecer até a chegada mente para a contagem e para o
 *    valor do estoque — seria trocar um erro por outro.
 *
 * 2. O TRÂNSITO NÃO É O "NÃO ALOCADO". São dois baldes com significados
 *    diferentes: não alocado é produto antigo, de antes do módulo, e a guarda de
 *    saldo negativo o trata de outro jeito ("só recusa quando o lote piora").
 *    Somar a carga da estrada nele faria a tela dizer "sem depósito" para
 *    mercadoria que tem destino, data e conferência marcada.
 *
 * 3. O BALDE NÃO TEM LINHA EM `deposits`, e é isso que o torna inescolhível de
 *    graça: toda tela monta seletor a partir de `data.deposits`, e
 *    `assertMovementIsPossible` recusa depósito que não esteja lá. Uma linha em
 *    `deposits` exigiria escrever à mão a guarda de movimento manual, de
 *    depósito padrão de produto, de exclusão e de transferência para dentro
 *    dele — e a que faltasse seria a que alguém acharia.
 *
 * 4. `received_quantity` ACUMULA. A caixa que faltou chega no dia seguinte e é
 *    recebida numa segunda conferência, sem lançamento de perda nenhum.
 *
 * 5. RECEBER MAIS DO QUE SAIU É RECUSADO — o excesso não saiu de origem
 *    nenhuma, e aceitá-lo criaria estoque.
 *
 * 6. NÃO EXISTE "DAR BAIXA NA FALTA", e é de propósito: escrever perda de
 *    estoque é decisão de contabilidade, não default que o sistema escolhe. O
 *    que não se resolve fica visível na lista de cargas pendentes.
 *
 * 7. O HISTÓRICO CONTINUA VERDADEIRO. `status` nasce 'recebida' porque toda
 *    transferência que já existe foi instantânea; marcá-las 'enviada'
 *    inventaria um trânsito que nunca houve e encheria a lista de pendentes com
 *    anos de histórico.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const { semComentarios } = require('./sem-comentarios');

const stockCore = require(path.join(RAIZ, 'lib/stock-core'));

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`  ${cond ? 'OK  ' : 'XX  '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// ---------------------------------------------------------------------------
console.log('--- 1. o balde de trânsito ---');
check('a constante existe e tem nome próprio',
  stockCore.DEPOSITO_EM_TRANSITO === '__transito__', stockCore.DEPOSITO_EM_TRANSITO);
// Se fosse '' colidiria com o balde de saldo não alocado, que é outra coisa.
check('  e não é o balde do não alocado', stockCore.DEPOSITO_EM_TRANSITO !== '');
check('o rótulo existe, para a tela não mostrar o id cru',
  typeof stockCore.ROTULO_EM_TRANSITO === 'string' && stockCore.ROTULO_EM_TRANSITO.length > 0,
  stockCore.ROTULO_EM_TRANSITO);
check('depositLabel traduz o trânsito',
  stockCore.depositLabel({ deposits: [] }, '__transito__') === stockCore.ROTULO_EM_TRANSITO);
check('  e continua resolvendo depósito de verdade',
  stockCore.depositLabel({ deposits: [{ id: 'd1', name: 'CD' }] }, 'd1') === 'CD');
check('  e devolve vazio para id desconhecido',
  stockCore.depositLabel({ deposits: [] }, 'd9') === '');

// ---------------------------------------------------------------------------
console.log('\n--- 2. o total não muda, e o trânsito sai do "não alocado" ---');
const CD = { id: 'dep-cd', name: 'CD' };
const FILIAL = { id: 'dep-f8', name: 'FILIAL 08' };
const PRODUTO = { id: 'p1', name: 'Bike', stockQuantity: 10 };

// Enviadas: saem do CD, entram no trânsito. É o estado "no caminhão".
const enviada = {
  deposits: [CD, FILIAL],
  stockMovements: [
    { productId: 'p1', depositId: 'dep-cd', type: 'entrada', quantity: 10 },
    { productId: 'p1', depositId: 'dep-cd', type: 'saida', quantity: 10 },
    { productId: 'p1', depositId: '__transito__', type: 'entrada', quantity: 10 }
  ]
};
const saldosEnviada = stockCore.productBalances(enviada, PRODUTO);
check('o CD zerou', saldosEnviada.balances.find((b) => b.depositId === 'dep-cd').quantity === 0);
check('a FILIAL continua em zero — não pode vender o que está na estrada',
  saldosEnviada.balances.find((b) => b.depositId === 'dep-f8').quantity === 0);
check('inTransit mostra os 10', saldosEnviada.inTransit === 10, String(saldosEnviada.inTransit));
// O CHECK CENTRAL desta fase.
check('  e "não alocado" fica em ZERO, não em 10',
  saldosEnviada.unallocated === 0, String(saldosEnviada.unallocated));
check('o TOTAL do produto não mudou', saldosEnviada.total === 10, String(saldosEnviada.total));

// Recebidas: saem do trânsito, entram na filial.
const recebida = {
  deposits: [CD, FILIAL],
  stockMovements: [
    ...enviada.stockMovements,
    { productId: 'p1', depositId: '__transito__', type: 'saida', quantity: 10 },
    { productId: 'p1', depositId: 'dep-f8', type: 'entrada', quantity: 10 }
  ]
};
const saldosRecebida = stockCore.productBalances(recebida, PRODUTO);
check('depois da conferência a FILIAL tem os 10',
  saldosRecebida.balances.find((b) => b.depositId === 'dep-f8').quantity === 10);
check('  o trânsito zerou', saldosRecebida.inTransit === 0);
check('  e o total seguiu 10 do começo ao fim', saldosRecebida.total === 10);

// Parcial: 7 chegaram, 3 na estrada.
const parcial = {
  deposits: [CD, FILIAL],
  stockMovements: [
    ...enviada.stockMovements,
    { productId: 'p1', depositId: '__transito__', type: 'saida', quantity: 7 },
    { productId: 'p1', depositId: 'dep-f8', type: 'entrada', quantity: 7 }
  ]
};
const saldosParcial = stockCore.productBalances(parcial, PRODUTO);
check('no parcial: 7 na filial, 3 em trânsito',
  saldosParcial.balances.find((b) => b.depositId === 'dep-f8').quantity === 7
  && saldosParcial.inTransit === 3);
check('  e o não alocado continua zero', saldosParcial.unallocated === 0);

// O saldo não alocado DE VERDADE continua funcionando — não pode ter sido
// engolido pela mudança.
const comNaoAlocado = {
  deposits: [CD],
  stockMovements: [{ productId: 'p1', depositId: '', type: 'entrada', quantity: 4 }]
};
check('o não alocado de verdade (depósito vazio) continua aparecendo',
  stockCore.productBalances(comNaoAlocado, { id: 'p1', stockQuantity: 4 }).unallocated === 4);

// ---------------------------------------------------------------------------
console.log('\n--- 3. a linha da transferência conta o que falta ---');
const serial = (t) => stockCore.serializeTransfer(t, { deposits: [CD, FILIAL] }, new Map([['p1', PRODUTO]]));
const emViagem = serial({ id: 't1', code: 'TRA-0001', productId: 'p1', quantity: 10, receivedQuantity: 0, status: 'enviada', originDepositId: 'dep-cd', destinationDepositId: 'dep-f8' });
check('faltando tudo: pendingQuantity = 10', emViagem.pendingQuantity === 10, String(emViagem.pendingQuantity));
const meioCaminho = serial({ id: 't1', productId: 'p1', quantity: 10, receivedQuantity: 7, status: 'enviada' });
check('recebidos 7: faltam 3', meioCaminho.pendingQuantity === 3, String(meioCaminho.pendingQuantity));
const fechada = serial({ id: 't1', productId: 'p1', quantity: 10, receivedQuantity: 10, status: 'recebida' });
check('recebida: falta zero', fechada.pendingQuantity === 0);
// O HISTÓRICO. Linha antiga não tem status nem received_quantity: ela é o que
// sempre foi — uma transferência que chegou no instante em que saiu.
const antiga = serial({ id: 't0', productId: 'p1', quantity: 5 });
check('linha ANTIGA (sem status) sai como recebida', antiga.status === 'recebida', antiga.status);
check('  com o enviado todo recebido', antiga.receivedQuantity === 5, String(antiga.receivedQuantity));
check('  e nada pendente — não inventa trânsito que nunca houve',
  antiga.pendingQuantity === 0, String(antiga.pendingQuantity));
check('e a linha leva o batchId, para a tela abrir a CARGA e não a linha',
  Object.prototype.hasOwnProperty.call(emViagem, 'batchId'));
// pendingQuantity é DERIVADO, como o "Falta" da ordem de produção: um terceiro
// número guardado pode discordar dos outros dois.
const razao = semComentarios(ler('banco/migrations/fase-cz-carga-em-transito.sql'));
check('o banco NÃO guarda a falta', !/add column if not exists pending/.test(razao));

// ---------------------------------------------------------------------------
console.log('\n--- 4. a migração mantém o passado verdadeiro ---');
check('status nasce "recebida"',
  /add column if not exists status text not null default 'recebida'/.test(razao));
check('  e só admite os dois valores',
  /check \(status in \('enviada', 'recebida'\)\)/.test(razao));
check('o recebido do histórico é preenchido com o enviado',
  /update stock_transfers\s*\n\s*set received_quantity = quantity\s*\n\s*where status = 'recebida'/.test(razao));
// A garantia contra receber mais do que saiu mora no banco, não só na rota.
check('e o banco limita o recebido ao enviado',
  /check \(received_quantity >= 0 and received_quantity <= quantity\)/.test(razao));
check('índice parcial para a lista de pendentes',
  /on stock_transfers \(status, date desc\) where status = 'enviada'/.test(razao));
// NÃO existe coluna de perda: dar baixa na falta é decisão de contabilidade,
// não default que o sistema escolhe.
//
// A asserção olha as COLUNAS criadas, e não o texto do arquivo. Primeira versão
// buscava /perda|baixa/ no fonte inteiro e falhava contra a própria prosa da
// migração, que explica por que a perda não está ali — `semComentarios` é um
// removedor de comentário de JAVASCRIPT e não toca em `--` de SQL, então o
// cabeçalho todo continua na string. Regra que vale para qualquer teste daqui:
// afirmar sobre DDL, nunca sobre a explicação ao lado dela.
const colunasNovas = [...razao.matchAll(/add column if not exists (\w+)/g)].map((m) => m[1]);
check('a migração não cria campo de perda/baixa',
  !colunasNovas.some((c) => /perda|baixa|write_off|loss/i.test(c)),
  colunasNovas.join(', '));

// ---------------------------------------------------------------------------
console.log('\n--- 5. o envio manda para o trânsito ---');
const src = semComentarios(ler('server.js'));
const pedacoDaRota = (marca) => {
  const i = src.indexOf(marca);
  if (i < 0) return '';
  const fim = src.indexOf('\n  if (pathname', i + marca.length);
  return src.slice(i, fim < 0 ? src.length : fim);
};
const envio = pedacoDaRota("if (pathname === '/api/stock/transfers' && req.method === 'POST')");
check('achei a rota de envio', envio.length > 500, `${envio.length} caracteres`);
check('a entrada nasce no trânsito',
  /depositId: comConferencia \? stockCore\.DEPOSITO_EM_TRANSITO : destinationDepositId/.test(envio));
// LIGADO POR PADRÃO: quem não decidir nada cai no lado seguro.
check('  e a conferência é o padrão',
  /const comConferencia = body\.conferirNaChegada !== false;/.test(envio));
check('a linha nasce "enviada" com zero recebido',
  /status: comConferencia \? 'enviada' : 'recebida'/.test(envio)
  && /receivedQuantity: comConferencia \? 0 : item\.quantity/.test(envio));
// movement_in_id É a entrada no destino, e com conferência ela só existe na
// chegada. Preenchê-la no envio mentiria para quem já lia essa coluna.
check('  e movementInId fica vazio até a chegada',
  /movementInId: comConferencia \? '' : into\.id/.test(envio));
check('  com a perna do trânsito em coluna própria',
  /movementTransitInId: comConferencia \? into\.id : ''/.test(envio));

console.log('\n--- 6. a conferência ---');
const receber = pedacoDaRota("if (pathname === '/api/stock/transfers/receive' && req.method === 'POST')");
check('achei a rota de conferência', receber.length > 500, `${receber.length} caracteres`);
// A CARGA, e não a linha: o que chega no balcão é um caminhão.
check('recebe a carga pelo batchId', /const batchId = String\(body\.batchId \|\| ''\)\.trim\(\);/.test(receber));
// Tudo conferido antes de gravar — mesma regra do envio. Meia carga recebida
// com uma mensagem que não diz o que ficou feito é pior que a recusa inteira.
check('valida a carga inteira antes de gravar qualquer coisa',
  receber.indexOf('const conferidos = []') < receber.indexOf('const movimentos = []'));
check('receber mais do que saiu é recusado', /criaria estoque/.test(receber));
check('  e a linha já recebida não aceita nova conferência',
  /já foi recebida por inteiro e não aceita nova conferência/.test(receber));
// Zero é resposta, e a mais importante: "esta caixa não chegou".
check('zero não gera movimento e não é erro', /if \(!quantidade\) continue;/.test(receber));
check('quantidade negativa é erro', /não pode ser negativa/.test(receber));
// A TRAVA. Duas pessoas conferindo a mesma carga no balcão é o caso comum.
check('trava o LOTE inteiro dentro da transação',
  /await razaoEstoque\.travarLoteParaConferir\(cliente, batchId\)/.test(receber));
check('  e reconfere o pendente com a linha travada',
  /if \(quantidade > pendente \+ 0\.00005\)/.test(receber));
check('  dentro do tambemNaTransacao, junto dos movimentos',
  /tambemNaTransacao: async \(cliente\) => \{/.test(receber));
check('as duas pernas saem: do trânsito e para o destino',
  /depositId: stockCore\.DEPOSITO_EM_TRANSITO/.test(receber)
  && /depositId: linha\.destinationDepositId/.test(receber));
// A cor atravessa as quatro pernas. Sem isto, 4 pretos sairiam do CD e
// chegariam SEM COR na filial — o total fecharia e o preto teria sumido.
check('e a cor atravessa a conferência',
  (receber.match(/classValueId: linha\.classValueId \|\| ''/g) || []).length === 2);

console.log('\n--- 7. o acumulado é do banco, numa expressão só ---');
// `received_quantity + $2` no próprio UPDATE, e não ler-somar-gravar: duas
// conferências simultâneas fariam a segunda sobrescrever a primeira.
const dbRazao = semComentarios(ler('lib/db/estoque-razao.js'));
check('received_quantity soma no UPDATE', /set received_quantity = received_quantity \+ \$2/.test(dbRazao));
check('  e o status é decidido pela mesma expressão',
  /status = case when received_quantity \+ \$2 >= quantity then 'recebida' else 'enviada' end/.test(dbRazao));
check('a trava do lote é for update, ordenada por id',
  /where batch_id = \$1 order by id for update/.test(dbRazao),
  'mesma razao da ordem dos locks de produto: evitar deadlock');

console.log('\n--- 8. as telas ---');
const lista = ler('public/modules/stock/subs/transfers.js');
const conferencia = ler('public/modules/stock/subs/receive_transfer.js');
const formulario = ler('public/modules/stock/subs/new_transfer.js');
const app = ler('public/app.js');
const roteador = ler('public/modules/stock/index.js');
const html = ler('public/index.html');

check('a lista filtra por situação', /name="status"/.test(lista));
check('  e distingue parcial de não-chegou', /Parcial — faltam/.test(lista));
check('  com ação de conferir só no que está em trânsito',
  /transfer\.status === 'enviada' \? `<button type="button" class="secondary" data-receive=/.test(lista));
// DUAS ENTRADAS DE MENU, UMA TELA: quem está na filial precisa de um lugar para
// perguntar "chegou algo para mim?".
check('a mesma tela serve "Entre Depósitos" e "Cargas a Conferir"',
  /window\.MavisSubscreenRegistry\.stock\.transfers = \(ctx\) => renderTransfers\(ctx, ''\);/.test(lista)
  && /window\.MavisSubscreenRegistry\.stock\.transfers_pending = \(ctx\) => renderTransfers\(ctx, 'enviada'\);/.test(lista));
check('  e "Limpar" não esvazia de sentido a tela de pendentes',
  /filters\.status = situacaoInicial \|\| '';/.test(lista));

check('o formulário tem a caixa de conferir na chegada', /name="conferirNaChegada"/.test(formulario));
check('  marcada por padrão', /name="conferirNaChegada" checked/.test(formulario));
// Checkbox desmarcado não aparece no FormData: `=== 'on'` trataria ausência e
// desmarcado igual, e aí o padrão da tela discordaria do padrão da rota.
check('  e lida por ausência, não por "on"',
  /conferirNaChegada: formData\.get\('conferirNaChegada'\) !== null/.test(formulario));

check('a conferência abre a CARGA inteira', /batchId=\$\{encodeURIComponent\(batchId\)\}/.test(conferencia));
check('  o campo nasce com o que falta', /value="\$\{l\.pendingQuantity\}"/.test(conferencia));
check('  e zero é oferecido como resposta', /id="receiveNothing"/.test(conferencia));
check('  avisando antes de gravar divergência', /menor do que a enviada/.test(conferencia));

// A FALHA SILENCIOSA: a tela aparece no menu, o clique cai no fallback e abre
// Produtos, sem erro nenhum. Foi o que test-modulos-telas.js pegou na fase CU.
check('as duas chaves estão no roteador',
  /'transfers_pending', 'receive_transfer',/.test(roteador));
check('"Cargas a Conferir" está no menu', /key: 'transfers_pending'/.test(app));
// receive_transfer NÃO tem entrada de menu: precisa de uma carga escolhida.
check('  e a conferência NÃO tem entrada de menu',
  !/key: 'receive_transfer'/.test(app), 'abri-la sem carga so devolveria a pessoa para a lista');
check('o <script> da conferência está na página',
  /modules\/stock\/subs\/receive_transfer\.js/.test(html));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
