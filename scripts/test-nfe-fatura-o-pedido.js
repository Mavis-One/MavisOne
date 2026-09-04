#!/usr/bin/env node
/**
 * A NF-e AUTORIZADA FATURA O PEDIDO — VENHA A AUTORIZAÇÃO POR ONDE VIER (fase BE).
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * 1. O FATURAMENTO MORA NO RAMO DA AUTORIZAÇÃO, NÃO NA EMISSÃO.
 *
 *    A chamada ficava em emitirNfeFiscal, logo depois da resposta SÍNCRONA da
 *    Focus. Só que o caminho normal da Focus é assíncrono: ela devolve 202 e a
 *    nota fica PROCESSANDO. Nesse instante faturarPedidoDaNota via o status
 *    "PROCESSANDO" e saía na primeira linha. A autorização chegava depois, pelo
 *    webhook ou por uma reconsulta — e as duas passam por
 *    aplicarRespostaFocusNaNfe, que não faturava.
 *
 *    Reproduzido num banco de prova, com o webhook da Focus dizendo AUTORIZADO:
 *      antes  -> nota AUTORIZADA, pedido em "pedido", 0 movimentos, 0 recebíveis
 *      depois -> "pedido-faturado", saída de 2 unidades, 1 parcela de R$ 150
 *    A rota respondia {"success":true} nos dois casos.
 *
 * 2. QUEM FATURA PELO WEBHOOK NÃO É UMA PESSOA.
 *
 *    O webhook não tem sessão: quem chamou foi a Focus. mudarStatusSalesRecord
 *    lê `user.name` e `user.id` direto, então sem um substituto a chamada
 *    estourava em TypeError e morria no catch, calada.
 *
 *    E o id do substituto precisa ser VAZIO, não um 'sistema' inventado:
 *    financial_entries.created_by tem chave estrangeira para users. Com um id
 *    fictício, provado no banco de prova, o pedido ficava faturado, o estoque
 *    baixava e o recebível NÃO nascia — metade aplicada, que é pior do que
 *    nada. Vazio vira NULL na coluna e passa.
 *
 * 3. A FALHA DE FATURAMENTO NÃO SOBE, MAS TAMBÉM NÃO SOME.
 *
 *    Não sobe porque a nota já existe para a SEFAZ. Mas um console.error num
 *    servidor é o mesmo que nada. O registro de auditoria foi o que revelou,
 *    na própria prova, que faltava o vínculo orders.nfe_id no cenário — era
 *    invisível até existir.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const src = ler('server.js');
const corpoDe = (nome) => {
  const m = new RegExp(`(?:async )?function ${nome}\\([\\s\\S]*?\\n\\}`).exec(src);
  return m ? m[0] : '';
};

console.log('--- 1. o faturamento acompanha a autorização ---');

const aplicar = corpoDe('aplicarRespostaFocusNaNfe');
check('aplicarRespostaFocusNaNfe existe', aplicar.length > 0);
check('  fatura o pedido', /await faturarPedidoDaNota\(atualizada, atualizada\.orderId, user\);/.test(aplicar));
// Dentro do `if (novoStatus === 'AUTORIZADO')`: nota rejeitada não baixa
// estoque nem cria conta a receber.
const posAutorizado = aplicar.indexOf("if (novoStatus === 'AUTORIZADO')");
const posFatura = aplicar.indexOf('await faturarPedidoDaNota(');
check('  e só depois de a SEFAZ dizer sim',
  posAutorizado >= 0 && posFatura > posAutorizado);
// `orderId` da própria nota, e não por parâmetro: o webhook só tem a
// referência da nota nas mãos.
check('  lendo o pedido da própria nota', /atualizada\.orderId/.test(aplicar));
// A guarda do topo é o que torna o faturamento único: só se entra no corpo
// quando o status MUDOU. Sem ela, cada reenvio do webhook refaria o efeito.
check('  uma vez só, porque a função sai quando o status não mudou',
  /if \(novoStatus === nfe\.status\) \{\s*\n\s*return nfe;/.test(aplicar));

const emitir = corpoDe('emitirNfeFiscal');
check('emitirNfeFiscal existe', emitir.length > 0);
// Um caminho só. Faturar aqui TAMBÉM não quebraria (a segunda chamada seria
// no-op), mas dois lugares decidindo a mesma coisa divergem na primeira
// mudança — e foi o de fora que ficou cego para o assíncrono.
check('  e não fatura mais por fora', !/await faturarPedidoDaNota\(/.test(emitir));

console.log('--- 2. quem fatura pelo webhook não é uma pessoa ---');

const faturar = corpoDe('faturarPedidoDaNota');
check('faturarPedidoDaNota existe', faturar.length > 0);
check('  tem substituto para quando não há sessão',
  /const quemFatura = user && user\.id \? user : \{ id: '', name: '[^']+' \};/.test(faturar));
// O id VAZIO é a regra, não descuido: um id que não existe em `users` derruba
// a criação da conta a receber pela chave estrangeira.
check('  com id vazio, e não um usuário inventado',
  /\{ id: '', name:/.test(faturar) && !/id: 'sistema/.test(faturar));
check('  e é o substituto que muda o status, não o `user` cru',
  /mudarStatusSalesRecord\([^)]*, dataVendas, quemFatura\);/.test(faturar));

console.log('--- 3. a falha não sobe, mas também não some ---');

check('a falha vira registro de auditoria',
  /action: 'falhaAoFaturarPedidoDaNota'/.test(faturar));
check('  com o motivo junto, e não só o rótulo',
  /details: \{ erro: erro\.message/.test(faturar));
// Deixar a exceção subir derrubaria a autorização de uma nota que a SEFAZ já
// aceitou — o sistema ficaria em desacordo com o Fisco, que é pior.
check('  e a exceção continua sem subir', /catch \(erro\) \{/.test(faturar) && !/throw erro/.test(faturar));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
