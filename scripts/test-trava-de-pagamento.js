#!/usr/bin/env node
// A TRAVA DE PAGAMENTO ANTES DA NF-e (fase ES, 19/10/2026).
//
// O usuário colou o desenho "Fluxo de Faturamento com confirmação de pagamento
// antes da NF-e" e escolheu adaptá-lo ao fluxo atual. Decidido com ele: só a
// NF-e de pedido (a NFC-e do balcão sai na hora); "recebido" é qualquer baixa
// (conciliação ou Financeiro); cartão com NSU conta como recebido; a venda a
// prazo sai com "Emitir mesmo assim" (motivo, auditoria), que o administrador e
// quem tem a chave na ficha do usuário podem usar.
//
// Provado no servidor local SEM transmitir nota nenhuma: pedido aprovado com
// dinheiro 40 + boleto 60 -> "Aguardando pagamento" na lista e na aba de
// títulos; liberação integral recebido 0 de 100; baixa manual do dinheiro ->
// 40 de 100; percentual 40% libera, 50% não; entrada libera; política inválida
// recusada; a conferência do dia (mesma preparação da emissão) mostrou a trava
// num pedido de cliente completo; forçar sem motivo recusado. Na tela de
// emissão (com o POST de emitir interceptado no navegador): o aviso ao abrir
// pelo pedido, a janela "Emitir mesmo assim" com motivo, e o reenvio com
// emitirSemPagamento + motivo. Tudo apagado depois.
'use strict';
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');
const ler = (a) => fs.readFileSync(path.join(RAIZ, a), 'utf8');
const servidor = semComentarios(ler('server.js'));

console.log('\n--- 1. a regra (lib/faturamento-gate.js) ---');
const g = require('../lib/faturamento-gate');
const t = (valor, recebido, extra = {}) => ({ valor, recebido, ...extra });
// Desde 20/10/2026 (fase EX) o padrão é DESLIGADA: os casos da trava dizem a política.
const integral = { politica: 'integral' };
check('desligada (o padrão): não se aplica a pedido nenhum, nada aparece', (() => {
  const padrao = g.avaliarLiberacao({ titulos: [t(100, 0)] });
  const gravada = g.avaliarLiberacao({ titulos: [t(100, 0)], config: { politica: 'desligada' } });
  return !padrao.aplica && padrao.liberado && padrao.politica === 'desligada' && !gravada.aplica && gravada.liberado;
})());
check('integral: nada recebido trava, e diz quanto falta', (() => {
  const r = g.avaliarLiberacao({ titulos: [t(100, 0)], config: integral });
  return r.aplica && !r.liberado && r.falta === 100 && r.estagio === 'aguardando_pagamento';
})());
check('  um centavo a menos trava; o arredondamento (3 x 33,33) não', !g.avaliarLiberacao({ titulos: [t(100, 99.99)], config: integral }).liberado
  && g.avaliarLiberacao({ titulos: [t(33.33, 33.33), t(33.33, 33.33), t(33.34, 33.34)], config: integral }).liberado);
check('  título quitado conta inteiro', g.avaliarLiberacao({ titulos: [t(100, 0, { quitado: true })], config: integral }).liberado);
check('cartão com NSU conta como recebido', g.avaliarLiberacao({ titulos: [t(60, 0, { cartaoComNsu: true }), t(40, 40)], config: integral }).liberado
  && !g.avaliarLiberacao({ titulos: [t(60, 0), t(40, 40)], config: integral }).liberado);
check('título cancelado não entra na conta', g.avaliarLiberacao({ titulos: [t(100, 100), t(50, 0, { cancelado: true })], config: integral }).liberado);
check('pedido sem título não é travado (não aplica)', (() => { const r = g.avaliarLiberacao({ titulos: [], config: integral }); return !r.aplica && r.liberado; })());
check('entrada: a parcela que vence primeiro recebida libera', g.avaliarLiberacao({
  titulos: [t(50, 0, { vencimento: '2026-11-19' }), t(50, 50, { vencimento: '2026-10-19' })], config: { politica: 'entrada' }
}).liberado && !g.avaliarLiberacao({
  titulos: [t(50, 50, { vencimento: '2026-11-19' }), t(50, 0, { vencimento: '2026-10-19' })], config: { politica: 'entrada' }
}).liberado);
check('percentual: 40 de 100 libera com 40% e trava com 50%',
  g.avaliarLiberacao({ titulos: [t(100, 40)], config: { politica: 'percentual', percentual: 40 } }).liberado
  && !g.avaliarLiberacao({ titulos: [t(100, 40)], config: { politica: 'percentual', percentual: 50 } }).liberado);
check('política desconhecida vira desligada (o padrão)', g.normalizarPolitica({ politica: 'x' }).politica === 'desligada' && g.normalizarPolitica({ politica: 'percentual', percentual: 0 }).percentual === 100);
check('a mensagem traz recebido, total e o que falta', /recebido R\$\s0,00 de R\$\s100,00; a NF-e exige o pedido inteiro recebido \(falta R\$\s100,00\)/.test(g.mensagemDaTrava(g.avaliarLiberacao({ titulos: [t(100, 0)], config: integral }))));

console.log('\n--- 2. o banco (fase ES) ---');
const mig = ler('banco/migrations/fase-es-trava-de-pagamento-da-nfe.sql');
check('a chave do usuário e a política numa linha só', /add column if not exists pode_emitir_nfe_sem_pagamento boolean not null default false/.test(mig)
  && /politica text not null default 'integral' check \(politica in \('integral', 'entrada', 'percentual'\)\)/.test(mig)
  && /insert into faturamento_config \(id\) values \(1\) on conflict \(id\) do nothing;/.test(mig));

console.log('\n--- 3. o servidor ---');
check('a trava fica na preparação, só na NF-e de pedido, depois do estoque', /if \(!nfce && pedido && !opcoes\.semTravaDePagamento\) \{/.test(servidor)
  && servidor.indexOf('if (!nfce && pedido && !opcoes.semTravaDePagamento)') > servidor.indexOf('Sem estoque para faturar:'));
check('  recusa com 422 e os números', /err\.status = 422;\s*err\.travaDePagamento = liberacao;/.test(servidor));
check('  a prévia e a DANFE de prévia não são travadas', (servidor.match(/prepararNfeParaTransmitir\(body, \{ semTravaDePagamento: true \}\)/g) || []).length === 2);
check('o recebido soma as baixas (com o desconto da taxa) e o NSU do cartão', /recebido: \(baixasPorTitulo\.get\(l\.id\) \|\| \[\]\)\.reduce\(\(s, p\) => s \+ Number\(p\.amount \|\| 0\) \+ Number\(p\.discount \|\| 0\), 0\)/.test(servidor)
  && /cartaoComNsu: Boolean\(String\(l\.cardAuthorization \|\| ''\)\.trim\(\)\)/.test(servidor)
  && /String\(l\.type \|\| ''\)\.toUpperCase\(\) === 'RECEITA'/.test(servidor));
check('"Emitir mesmo assim": só quem pode, com motivo, e vai à auditoria', /if \(!\(await podeEmitirNfeSemPagamento\(user\)\)\) \{/.test(servidor)
  && /if \(motivoSemPagamento\.length < 5\) \{/.test(servidor) && /action: 'nfe\.emitidaSemPagamento'/.test(servidor));
check('  pode: o administrador e quem tem a chave', /return Boolean\(user\) && \(\(await ehAdmin\(user\)\) \|\| user\.podeEmitirNfeSemPagamento === true\);/.test(servidor));
check('a rota de emitir devolve a trava para a tela', /travaDePagamento: erroDaEmissao\.travaDePagamento,\s*podeEmitirSemPagamento: await podeEmitirNfeSemPagamento\(user\)/.test(servidor));
check('a lista de vendas leva o selo do pedido Pré-Faturado', /r\.status === 'pedido-pre-faturado'/.test(servidor) && (servidor.match(/return enviarListaDeVendas\(res, montarRespostaDeVendas\(\{/g) || []).length === 2);
check('a política: lê quem vê Configurações, grava o administrador', /pathname === '\/api\/settings\/faturamento'/.test(servidor) && /Só o administrador muda a liberação da NF-e\./.test(servidor));
const auth = ler('lib/db/auth.js');
check('a chave do usuário lê, cria e altera', /podeEmitirNfeSemPagamento: row\.pode_emitir_nfe_sem_pagamento === true/.test(auth)
  && /updates\.pode_emitir_nfe_sem_pagamento = payload\.podeEmitirNfeSemPagamento === true;/.test(auth));

console.log('\n--- 4. as telas ---');
const emissao = ler('public/modules/finance/subs/emitir_nfe_focus.js');
check('a emissão avisa ao abrir pelo pedido', /\/api\/sales\/records\/\$\{encodeURIComponent\(orderIdOrigem\)\}\/liberacao-nfe/.test(emissao) && /<div id="nfeTravaPagamento">/.test(emissao));
check('  e a recusa abre "Emitir mesmo assim" com motivo', /if \(error\.dados && error\.dados\.travaDePagamento\) \{/.test(emissao)
  && /confirmar: 'Emitir mesmo assim'/.test(emissao) && /emitirSemPagamento: true, motivoSemPagamento: motivo/.test(emissao));
const app = ler('public/app.js');
check('selo "Aguardando pagamento" / "Pagamento confirmado" na lista e na aba de títulos', /function seloDePagamento\(liberacao\)/.test(app)
  && /f\.badge\(r\.status\) \+ seloDePagamento\(r\.liberacaoNfe\)/.test(app) && /class="sales-liberacao-nfe"/.test(app));
check('Configurações › Liberação da NF-e', /key: 'liberacao_nfe', label: 'Liberação da NF-e'/.test(app)
  && /'liberacao_nfe'\]/.test(ler('public/modules/settings/index.js'))
  && /settings\/subs\/liberacao_nfe\.js/.test(ler('public/index.html')));
check('a chave na ficha do usuário', /name="podeEmitirNfeSemPagamento"/.test(ler('public/modules/settings/subs/users_form.js')));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
