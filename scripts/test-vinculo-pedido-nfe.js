// Vínculo pedido <-> NF-e: existe nos DOIS sentidos, e um pedido não emite
// duas notas.
//
// A fase-P criou `orders.nfe_id` e `nfes.order_id` em 2026. Medido em
// 22/08/2026: 7 pedidos no banco, 3 deles faturados, e ZERO com nfe_id. Não
// era migração faltando — as colunas estavam lá. Era código: só o caminho
// MANUAL (POST /api/finance/nfe) fechava o vínculo. O caminho FISCAL, que é o
// que vai à SEFAZ, gravava `nfe.order_id` e nunca o contrário.
//
// Pior que o vínculo torto: o caminho manual já barrava a segunda emissão para
// o mesmo pedido, e o fiscal não barrava nada. Dava para faturar duas vezes e
// ficar com DOIS documentos na SEFAZ — e documento fiscal não se apaga, só se
// cancela, com justificativa e dentro do prazo.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const serverSrc = ler('server.js');
const fiscalDbSrc = ler('lib/db/fiscal.js');
const emissao = serverSrc.slice(
  serverSrc.indexOf('async function emitirNfeFiscal'),
  serverSrc.indexOf('async function cfopsDaNfeGeramFinanceiro'));

console.log('--- a consulta que sustenta a regra ---');
check('getNfesPorPedido existe', /async function getNfesPorPedido\(orderId\)/.test(fiscalDbSrc));
check('e está exportada', /^\s*getNfesPorPedido,/m.test(fiscalDbSrc));
check('consulta pela coluna do vínculo', /\.from\('nfe'\)\.select\('\*'\)\.eq\('order_id', id\)/.test(fiscalDbSrc));
// Pedido vazio não pode varrer a tabela inteira e casar com tudo.
check('pedido vazio devolve lista vazia', /if \(!id\) return \[\];/.test(fiscalDbSrc));

console.log('\n--- um pedido, uma nota ---');
check('a emissão fiscal consulta as notas do pedido', /await fiscalDb\.getNfesPorPedido\(pedidoDaNota\)/.test(emissao));
check('e recusa quando já existe nota viva', /err\.status = 409/.test(emissao));
// ERRO/CANCELADO/DENEGADO não podem travar o pedido para sempre: a nota
// rejeitada não é documento, e o pedido precisa poder tentar de novo.
check('nota rejeitada ou cancelada NÃO trava o pedido',
  /\['ERRO', 'CANCELADO', 'DENEGADO'\]\.includes/.test(emissao));
check('a recusa diz o número e o porquê', /já tem a NF-e[\s\S]{0,200}dois documentos na SEFAZ/.test(emissao));
// A guarda roda ANTES de montar o payload e de falar com a Focus: recusar
// depois de transmitir seria tarde.
const posGuarda = emissao.indexOf('getNfesPorPedido');
const posEnvio = emissao.indexOf('client.emitirNfe(');
check('a guarda vem antes de transmitir', posGuarda > -1 && posGuarda < posEnvio, `guarda ${posGuarda}, envio ${posEnvio}`);

console.log('\n--- o pedido passa a saber qual nota saiu dele ---');
check('grava o vínculo no pedido', /await db\.updateOrder\(pedido\.id, \{ \.\.\.pedido, nfeId: nfe\.id \}\)/.test(emissao));
// Antes de transmitir: se a Focus falhar e a pessoa clicar de novo, a segunda
// tentativa precisa encontrar a primeira.
const posVinculo = emissao.indexOf('nfeId: nfe.id');
check('e grava ANTES de transmitir', posVinculo > -1 && posVinculo < posEnvio, `vínculo ${posVinculo}, envio ${posEnvio}`);
// A nota é o documento; o vínculo é conveniência. Falhar aqui não pode
// derrubar uma emissão que já foi.
check('falha no vínculo não derruba a emissão',
  /catch \(error\) \{[\s\S]{0,160}não consegui gravar o vínculo no pedido/.test(emissao));
check('e o problema vai para o log', /console\.error\('NF-e emitida, mas não consegui gravar o vínculo/.test(emissao));

console.log('\n--- o caminho manual continua fechando o vínculo ---');
// Ele já fazia certo; o teste existe para ninguém "unificar" removendo.
check('a NF-e manual também grava o pedido',
  /pedidoOrigem\.nfeId = nfe\.id;[\s\S]{0,120}updateOrder\(pedidoOrigem\.id/.test(serverSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
