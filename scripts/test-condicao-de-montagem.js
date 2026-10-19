#!/usr/bin/env node
// CONDIÇÃO DE MONTAGEM — DESMONTADO / MONTADO (fase ER, 17/10/2026).
//
// O usuário colou o script "MAVIS ONE — 006" e escolheu ADAPTÁ-LO ao sistema.
// Decidido com ele: a condição só vale para o produto marcado "Controla
// montagem" (nasce marcado no NCM 8711); todo o saldo que já existia virou
// MONTADO; os dois depósitos da matriz viraram um (o de Montados foi unido ao
// Depósito Matriz por transferência registrada); a localização fica para uma
// segunda etapa.
//
// Provado no banco local com o AUTOPROPELIDO MAVIS FLIC 650W | 2026 | 02 (10
// montados no Depósito Matriz): entrada de 3 desmontados; saída sem condição e
// saída de 5 desmontados recusadas; Ordem de Montagem de 2 com baixa de 1 e de
// mais 1 (desmontado -> montado, mesmo depósito, total igual; a ordem concluiu
// sozinha), baixa a mais recusada, cancelar e excluir com baixa recusados,
// "Desfazer" devolveu ao desmontado e reabriu a ordem; transferência de 3
// montados com conferência, chegada e estorno (a linha ficou "estornada" e o
// saldo voltou); o estorno da união da fase ER é recusado; o banco recusou
// DELETE e UPDATE direto em stock_movements; contagem por condição (montado 11,
// desmontado 0 -> ajuste de -1 no desmontado); venda sem condição recusada,
// desmontado sem saldo recusado, montado baixou e o cancelamento devolveu ao
// montado. Na tela: coluna Condição no item, Disponível da condição, cartões
// do Status do Produto com montado/desmontado, chave "Controla Montagem" no
// cadastro, janela de montagem na lista de ordens. Tudo apagado depois.
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
const trecho = (inicio, fim) => { const i = servidor.indexOf(inicio); return i < 0 ? '' : servidor.slice(i, servidor.indexOf(fim, i + inicio.length)); };

console.log('\n--- 1. banco (fase ER) ---');
const mig = ler('banco/migrations/fase-er-condicao-de-montagem.sql');
check('o produto diz se controla montagem, e o NCM 8711 nasce marcado',
  /add column if not exists controla_montagem boolean not null default false/.test(mig) && /like '8711%'/.test(mig));
check('a condição vive no movimento, na transferência e na contagem',
  /alter table if exists stock_movements add column if not exists condicao text not null default ''\s*check \(condicao in \('', 'desmontado', 'montado'\)\)/.test(mig)
  && /alter table if exists stock_transfers add column if not exists condicao/.test(mig)
  && /alter table if exists stock_count_items add column if not exists condicao/.test(mig)
  && /on stock_count_items \(count_id, product_id, class_value_id, condicao\)/.test(mig));
check('o saldo que já existia virou MONTADO', /update stock_movements m set condicao = 'montado'\s*from products p\s*where p\.id = m\.product_id and p\.controla_montagem and m\.condicao = ''/.test(mig));
check('o Montados passa ao Depósito Matriz por transferência registrada, e fica inativo e unido',
  /insert into stock_transfers/.test(mig) && /'lot-fase-er'/.test(mig)
  && /update deposits set classificacao = null, status = 'inativo', unido_a = v_matriz/.test(mig)
  && /update orders set deposit_id = v_matriz where deposit_id = v_montados;/.test(mig));
check('fica um só depósito de montagem', /check \(classificacao is null or classificacao = 'montagem'\)/.test(mig));
check('a Ordem de Montagem é uma OP de tipo montagem, e a baixa aponta a ordem',
  /add column if not exists tipo text not null default 'producao'\s*check \(tipo in \('producao', 'montagem'\)\)/.test(mig)
  && /alter table if exists pcp_baixas add column if not exists ordem_id text references pcp_orders\(id\) on delete set null/.test(mig));
check('o banco recusa apagar e alterar movimento (só classifica a condição vazia)',
  /raise exception 'Movimentação de estoque não se apaga/.test(mig)
  && /\(to_jsonb\(new\) - 'condicao'\) is distinct from \(to_jsonb\(old\) - 'condicao'\)/.test(mig)
  && /before update or delete on stock_movements/.test(mig));

console.log('\n--- 2. o saldo por condição (stock-core) ---');
const core = require('../lib/stock-core');
const mov = (type, depositId, quantity, condicao, extra = {}) => ({ productId: 'P', type, depositId, quantity, condicao, ...extra });
const dados = {
  deposits: [{ id: 'MAT', name: 'Matriz' }, { id: 'MONT', name: 'Montados', status: 'inativo' }],
  stockMovements: [
    mov('entrada', 'MAT', 10, 'montado'),
    mov('entrada', 'MAT', 3, 'desmontado'),
    mov('saida', 'MAT', 1, 'desmontado'),
    mov('entrada', 'MAT', 1, 'montado', { classValueId: 'PRETO' }),
    mov('entrada', core.DEPOSITO_EM_TRANSITO, 2, 'montado')
  ]
};
check('normalizar só aceita as duas condições', core.normalizarCondicao(' MONTADO ') === 'montado' && core.normalizarCondicao('x') === '' && core.normalizarCondicao('') === '');
check('saldo do depósito por condição', core.depositBalance(dados, 'P', 'MAT', 'desmontado') === 2 && core.depositBalance(dados, 'P', 'MAT', 'montado') === 11
  && core.depositBalance(dados, 'P', 'MAT') === 13);
check('  e da cor na condição', core.classValueBalance(dados, 'P', 'PRETO', 'MAT', 'montado') === 1 && core.classValueBalance(dados, 'P', 'PRETO', 'MAT', 'desmontado') === 0);
check('desmontado e montado do produto (sem o trânsito)', JSON.stringify(core.conditionBalances(dados, 'P')) === JSON.stringify({ desmontado: 2, montado: 11 }));
const serial = core.serializeProduct({ id: 'P', name: 'Moto', stockQuantity: 15, controlaMontagem: true }, dados);
check('o produto serializado leva a condição por depósito', serial.controlaMontagem === true
  && JSON.stringify(serial.balances.find((b) => b.depositId === 'MAT').condicoes) === JSON.stringify({ desmontado: 2, montado: 11 })
  && serial.balances.find((b) => b.depositId === 'MONT').inativo === true);
check('  e o que não controla não leva', core.serializeProduct({ id: 'P', name: 'Peça', stockQuantity: 15 }, dados).balances.every((b) => !b.condicoes));
const razao = { stockMovements: [{ id: 'a' }, { id: 'b', estornoDe: 'a' }] };
check('o estorno marca o original como estornado',
  core.serializeMovement(razao.stockMovements[0], razao, new Map()).estornado === true
  && core.serializeMovement(razao.stockMovements[1], razao, new Map()).estornoDe === 'a');

console.log('\n--- 3. a gravação (commitStockMovements) ---');
const commit = trecho('async function commitStockMovements(', '\nasync function descarregarMovimentosPendentes(');
check('o movimento que aponta um depósito unido vai para o que vale', /const unidos = await razaoEstoque\.depositosUnidos\(cliente\);/.test(commit)
  && /if \(unidos\.has\(movimento\.depositId\)\) movimento\.depositId = unidos\.get\(movimento\.depositId\);/.test(commit));
check('produto que controla montagem: entrada sem condição entra desmontada, saída sem condição é recusada',
  /if \(movimento\.type === 'entrada'\) \{ movimento\.condicao = 'desmontado'; continue; \}/.test(commit)
  && /controla montagem: informe se sai montado ou desmontado\./.test(commit)
  && /if \(!comMontagem\.has\(movimento\.productId\)\) \{ movimento\.condicao = ''; continue; \}/.test(commit));
check('a guarda de saldo negativo confere cada condição', /const cond = movimento\.condicao \? `\|\$\{movimento\.condicao\}` : '';/.test(commit)
  && /const \[produtoId, depositoId, classValueId, condicao\] = chave\.split\('\|'\);/.test(commit));
const razaoDb = ler('lib/db/estoque-razao.js');
check('o saldo do banco filtra a condição', /filtros \+= ` and condicao = \$\$\{parametros\.length\}`;/.test(razaoDb) && /'condicao', 'estorno_de'/.test(razaoDb));
check('o razão não tem mais função de apagar', !/delete from stock_movements/.test(razaoDb) && !/apagarMovimento|apagarTransferencia/.test(servidor));

console.log('\n--- 4. estornos sem apagar ---');
const estornoMov = trecho("if (/^\\/api\\/stock\\/movements\\/[^/]+$/.test(pathname) && req.method === 'DELETE')", "if (pathname === '/api/stock/transfers' && req.method === 'GET')");
check('a movimentação estornada ganha o movimento contrário', /estornoDe: movement\.id/.test(estornoMov) && /await commitStockMovements\(data, \[contrario\], productsById\);/.test(estornoMov)
  && /Esta movimentação já foi estornada\./.test(estornoMov) && /Este movimento já é um estorno\./.test(estornoMov));
const estornoTra = trecho("if (/^\\/api\\/stock\\/transfers\\/[^/]+$/.test(pathname) && req.method === 'DELETE')", '// INVENTÁRIOS');
check('a transferência estornada grava os contrários e fica "estornada"', /marcarTransferenciaEstornada\(cliente, id, user\)/.test(estornoTra)
  && /origin: 'transferencia-estorno'/.test(estornoTra) && /transfer\.batchId === 'lot-fase-er'/.test(estornoTra));

console.log('\n--- 5. a venda ---');
const obrig = require('../public/modules/shared/venda_obrigatorios');
const controla = (item) => item.productId === 'MOTO';
check('item de produto que controla montagem sem condição falta',
  obrig.itemSemCondicao([{ productId: 'PECA' }, { productId: 'MOTO', condicao: '' }], controla) === 1
  && obrig.itemSemCondicao([{ productId: 'MOTO', condicao: 'montado' }], controla) === -1);
const falta = obrig.faltando({ companyId: 'c', category: 'VENDA', depositId: 'd', sellerId: 's', items: [{ productId: 'MOTO', name: 'MOTO X', chassi: 'ABC' }], payments: [{ methodId: 'f', amount: 1 }] },
  { montagemDoItem: controla });
check('  e a mensagem diz o item', falta && falta.rotulo === 'Condição' && /MOTO X \(item 1\) sai montado ou desmontado/.test(falta.mensagem));
check('o servidor confere na criação e na alteração', (servidor.match(/montagemDoItem: await montagemDosItensDaVenda\(body\.items\)/g) || []).length === 2);
check('item gravado antes, sem condição, sai do MONTADO', /return stockCore\.normalizarCondicao\(item\.condicao\) \|\| 'montado';/.test(servidor));
check('a baixa e o estorno da venda levam a condição', /condicao: condicaoDoItemDaVenda\(item, produtoAtual\),/.test(servidor)
  && /condicao: \(movimentoDeOrigem\(data, \{/.test(servidor));
const app = ler('public/app.js');
check('a tela tem a coluna Condição e o Disponível da condição', /<th>Condição<\/th>/.test(app) && /class="sales-item-condicao/.test(app)
  && /const noDeposito = saldoNoDepositoEscolhido\(item\.productId, item\.classValueId, condicao\);/.test(app));
check('o depósito inativo não se oferece na venda', /String\(d\.status \|\| 'ativo'\)\.toLowerCase\(\) !== 'inativo' \|\| d\.id === atual/.test(app));

console.log('\n--- 6. a montagem (PCP) ---');
const baixas = trecho("const baixaMatch = pathname.match(", '// Pedido de venda -> ordens de produção.');
check('a baixa troca desmontado por montado no MESMO depósito', /type: 'saida', condicao: 'desmontado'/.test(baixas) && /type: 'entrada', condicao: 'montado'/.test(baixas)
  && /\$8, \$8, nullif\(\$9, ''\)/.test(baixas));
check('a ordem de montagem soma a baixa e conclui sozinha', /status = case when quantity_done \+ \$2 >= quantity - 0\.000001 then 'concluida' else 'em_producao' end/.test(baixas));
check('desfazer devolve à ordem e a reabre', /status = case when greatest\(0, quantity_done - \$2\) <= 0\.000001 then 'aberta' else 'em_producao' end/.test(baixas));
check('a ordem de montagem não aceita o apontamento da ficha', /aponte pela baixa de montagem, na lista de ordens\./.test(servidor));
check('nem cancela ou sai com baixa ativa', /Ordem de montagem com baixa não se cancela/.test(servidor) && /Desfaça as baixas antes de excluí-la\./.test(servidor));
const modulos = ler('lib/db/modulos.js');
check('o tipo, o depósito e a cor gravam na ordem', /tipo: \['tipo', 'texto', 'producao'\], depositId: \['deposit_id', 'texto'\],/.test(modulos) && /classValueId: \['class_value_id', 'texto'\]/.test(modulos));
const pcp = ler('public/modules/pcp/subs/pcp.js');
check('a lista de ordens abre a janela de montagem só na OM', /visivel: \(item\) => item\.tipo === 'montagem',/.test(pcp) && /run: abrirMontagemDaOrdem/.test(pcp)
  && /api\('\/api\/pcp\/baixas', \{ method: 'POST', body: JSON\.stringify\(\{ ordemId: ordem\.id, quantidade \}\) \}\)/.test(pcp));

console.log('\n--- 7. cadastro, estoque e contagem ---');
check('ligar "Controla montagem" classifica o saldo sem condição como montado, numa transação',
  /update stock_movements set condicao = 'montado' where product_id = \$1 and condicao = ''/.test(servidor) && /action: 'produto\.controla-montagem'/.test(servidor));
check('a chave aparece no cadastro', /chave\('controlaMontagem', 'Controla Montagem'/.test(ler('public/modules/stock/subs/new_product.js')));
check('movimentação e transferência pedem a condição', /id="movementItemCondicao"/.test(ler('public/modules/stock/subs/new_movement.js'))
  && /id="transferItemCondicao"/.test(ler('public/modules/stock/subs/new_transfer.js')));
check('a contagem conta cada condição', /id="countItemCondicao"/.test(ler('public/modules/stock/subs/new_count.js'))
  && /conte o montado e o desmontado em linhas separadas/.test(servidor));
check('os cartões do Status do Produto mostram montado e desmontado', /estoque-card-condicao/.test(ler('public/modules/stock/shared.js')));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
