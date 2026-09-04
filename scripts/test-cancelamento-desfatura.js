#!/usr/bin/env node
/**
 * CANCELAR A NF-e DESFAZ O FATURAMENTO QUE ELA CAUSOU (fase BF).
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * 1. A PORTA DE VOLTA EXISTE, NOS DOIS LADOS.
 *
 *    Até aqui 'pedido-faturado' só saía para 'pedido-cancelado'. Cancelar a
 *    nota, então, ou matava a venda junto ou não fazia nada — e não fazia nada:
 *    cancelarNfeFiscal falava com a SEFAZ, gravava o evento, e o pedido seguia
 *    faturado. Mercadoria de volta na prateleira e conta a receber cobrando por
 *    uma nota que não existe mais.
 *
 *    Cancelar uma nota quase nunca quer dizer cancelar a venda: cancela-se por
 *    erro de dados, para reemitir. Por isso o destino é 'pedido-nao-faturado'.
 *
 *    A transição tem de valer no CATÁLOGO e no BANCO. O gatilho
 *    sales_status_guarda recusa o que não estiver na tabela — foi ele que
 *    recusou o primeiro ensaio desta prova. test-transicoes-status.js compara
 *    as duas listas par a par; aqui se confere que ESTE par está nas duas.
 *
 * 2. DESFATURAR EXIGE QUE A NOTA NÃO VALHA MAIS.
 *
 *    É a regra da fase AV lida ao contrário. Faturar exige documento;
 *    desfaturar exige que o documento tenha morrido. Sem esta guarda, a porta
 *    recém-aberta deixaria alguém desfaturar pela tela um pedido cuja NF-e
 *    continua AUTORIZADA — nota válida na SEFAZ, mercadoria de volta no estoque
 *    e nenhuma conta a receber. O inverso exato do problema que a fase AV
 *    resolveu.
 *
 * 3. "TER NOTA" É UM ESTADO, NÃO A EXISTÊNCIA DA LINHA.
 *
 *    `orders.nfe_id` continua apontando para a nota mesmo depois de cancelada —
 *    documento fiscal não se apaga. A guarda de faturar perguntava só se o
 *    campo estava preenchido, então um pedido desfaturado pelo cancelamento
 *    podia ser faturado de novo apontando para a nota morta.
 *
 * PROVADO PONTA A PONTA, num banco de prova com dublê da Focus:
 *   webhook autoriza  -> pedido-faturado, estoque 20->18, recebível 'pending'
 *   desfaturar na mão -> RECUSADO: "A NF-e 123 deste pedido continua AUTORIZADO"
 *   cancelar a nota   -> pedido-nao-faturado, estoque 18->20, recebível 'cancelado'
 *   faturar de novo   -> RECUSADO: "Este pedido não tem NF-e"
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

console.log('--- 1. a porta de volta existe nos dois lados ---');

const S = require('../public/modules/shared/sales_status');
check('o catálogo deixa pedido-faturado voltar para não faturado',
  S.podeTransicionar('pedido-faturado', 'pedido-nao-faturado'));
// Continua sendo caminho legítimo cancelar direto — a venda pode ter caído.
check('  sem fechar o caminho para cancelado',
  S.podeTransicionar('pedido-faturado', 'pedido-cancelado'));
// O gatilho do banco é a terceira porta: a que segue fechada quando alguém
// escreve direto no Postgres. Sem o par lá, a transição é recusada com
// "Transicao de status invalida" e o cancelamento da nota falha pela metade.
const sqlTransicoes = ler('banco/migrations/fase-aj-transicoes-de-status.sql');
check('o banco conhece a mesma transição',
  /\('pedido-faturado', 'pedido-nao-faturado'\)/.test(sqlTransicoes));
check('  e o arquivo do zero também',
  /\('pedido-faturado', 'pedido-nao-faturado'\)/.test(ler('banco/RECRIAR-DO-ZERO.sql')));

console.log('--- 2. cancelar a nota puxa o gatilho ---');

const cancelar = corpoDe('cancelarNfeFiscal');
check('cancelarNfeFiscal desfatura o pedido', /await desfaturarPedidoDaNota\(updated, user\);/.test(cancelar));
// `updated`, e não `nfe`: é o registro DEPOIS da resposta da SEFAZ. Passar o
// de antes desfaturaria mesmo quando o cancelamento foi recusado.
check('  com o registro DEPOIS da resposta da SEFAZ, não o de antes',
  !/desfaturarPedidoDaNota\(nfe,/.test(cancelar));

const desfaturar = corpoDe('desfaturarPedidoDaNota');
check('desfaturarPedidoDaNota existe', desfaturar.length > 0);
check('  só age se a nota REALMENTE foi cancelada',
  /if \(String\(nfe\.status \|\| ''\)\.toUpperCase\(\) !== 'CANCELADO'\) return;/.test(desfaturar));
check('  e só sobre pedido que estava faturado',
  /salesStatus\.normalizar\(pedido\.status\) !== 'pedido-faturado'\) return;/.test(desfaturar));
// Cancelar as parcelas em aberto é metade do serviço, e
// transitionOrderFinanceEffect as procura em `data.finance`. Sem o sync a lista
// chega vazia: o estoque voltava e o recebível seguia cobrando.
check('  sincroniza o financeiro, senão o recebível sobrevive',
  /syncFinanceData\(dataVendas\)/.test(desfaturar));
check('  e a falha vira auditoria em vez de sumir',
  /action: 'falhaAoDesfaturarPedidoDaNota'/.test(desfaturar));

console.log('--- 3. "ter nota" é um estado, não a existência da linha ---');

const sustenta = corpoDe('notaQueSustentaOFaturamento');
check('notaQueSustentaOFaturamento existe', sustenta.length > 0);
check('  AUTORIZADO e PROCESSANDO sustentam', /'AUTORIZADO', 'PROCESSANDO'/.test(sustenta));
// Olha TODAS as notas do pedido: ele pode ter uma cancelada e outra emitida
// depois, e orders.nfe_id guarda uma só.
check('  olha todas as notas do pedido, não só orders.nfe_id',
  /getNfesPorPedido\(pedido\.id\)/.test(sustenta));
// Tabela fiscal fora do ar não pode travar a edição de pedido.
check('  e degrada para o vínculo direto se a consulta falhar',
  /if \(!candidatas\.length && pedido\.nfeId\)/.test(sustenta));

const efeitos = corpoDe('aplicarEfeitosDeStatus');
check('faturar exige nota VIVA, não campo preenchido',
  /const temNota = Boolean\(await notaQueSustentaOFaturamento\(/.test(efeitos));
check('desfaturar é recusado enquanto a nota vale',
  /statusNovo === 'pedido-nao-faturado'\) \{[\s\S]{0,200}?const notaViva = await notaQueSustentaOFaturamento\(current\);/.test(efeitos));
// A recusa diz o que fazer. "Não pode" sem alternativa deixa a pessoa tentando
// de novo — mesmo critério de motivoDaRecusa no catálogo.
check('  e a recusa diz qual é o caminho', /Cancele a nota primeiro/.test(efeitos));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
