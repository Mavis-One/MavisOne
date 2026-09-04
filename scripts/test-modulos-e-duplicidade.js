#!/usr/bin/env node
/**
 * AS CAIXAS DE MÓDULO VALEM, E O QUE JÁ ENTROU NÃO ENTRA DE NOVO (fase BR).
 *
 * Três defeitos, todos reproduzidos num banco de prova com `git stash`.
 *
 * 1. CINCO MÓDULOS NÃO CONFERIAM `allowedModules` EM PONTO NENHUM.
 *
 *    Frota, RH, PCP e Contratos são servidos por um CRUD genérico, e o CRM por
 *    duas rotas próprias. Nenhum dos dois lia `allowedModules`: o portão central
 *    autoriza pelo PAPEL, e o papel 'Usuário' já traz fleet.*, pcp.*, hr.ler e
 *    contracts.ler. O admin desmarcava esses módulos em Configurações >
 *    Usuários, salvava, e não fechava nada — as telas somem do menu (montado por
 *    allowedModules) e as rotas continuam abertas para quem souber o endereço.
 *
 *      antes  usuário com {dashboard,sales}: 200 em /api/fleet/vehicles,
 *             /api/pcp/orders, /api/hr/employees e /api/crm/connection
 *      depois 403 nos quatro, e 200 em /api/sales/records, que é o que ele tem
 *
 *    Defesa em profundidade, igual às rotas vizinhas: o portão diz o que o
 *    PAPEL permite, a rota diz o que aquele USUÁRIO tem liberado.
 *
 * 2. O NÚMERO DO PEDIDO SAÍA DE max+1, SEM TRAVA.
 *
 *    Entre o SELECT do maior código e o INSERT existe uma janela. Duas
 *    requisições simultâneas liam o mesmo maior e gravavam o MESMO número —
 *    não há unique em orders.code nem em quotes.code, então o banco aceitava os
 *    dois. Agora o número vem de `sales_code_seq`, e nextval é atômico.
 *
 *      depois três pedidos disparados juntos -> 1001, 1002, 1003
 *
 *    Nada é indexado por `code` (o vínculo é sempre por `id`), então o estrago
 *    nunca foi corrupção: era a lista mostrando dois documentos com o mesmo
 *    número e o cliente recebendo duas notas citando "Pedido 1042".
 *
 * 3. IMPORTAR O MESMO EXTRATO DUAS VEZES DOBRAVA TODAS AS LINHAS.
 *
 *      antes  2ª importação -> "importadas: 2", extrato com 4 linhas
 *      depois 2ª importação -> "importadas: 0, já existiam: 2", extrato com 2
 *
 *    Reimportar é o que se faz quando a primeira importação parece ter falhado
 *    — justamente a hora em que duplicar dói.
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

console.log('--- 1. os cinco módulos conferem o acesso do usuário ---');
check('o CRUD genérico de Frota/RH/PCP/Contratos confere',
  /const usuarioDoModulo = await getCurrentUser\(req\);\s*\n\s*if \(!usuarioDoModulo \|\| !usuarioDoModulo\.allowedModules\.includes\(modulo\)\) \{/.test(src));
// `modulo` vem do próprio caminho, então a checagem acompanha os quatro sem
// lista paralela para manter em dia.
check('  usando o módulo do próprio caminho', /includes\(modulo\)\)/.test(src));
check('o CRM confere também',
  /if \(pathname\.startsWith\('\/api\/crm\/'\)\) \{[\s\S]{0,600}?allowedModules\.includes\('crm'\)/.test(src));
// A conexão do CRM guarda credencial de um sistema externo: quem não tem o
// módulo não precisa ler nem gravar.
check('  antes das duas rotas de CRM',
  src.indexOf("if (pathname.startsWith('/api/crm/'))") < src.indexOf("if (pathname === '/api/crm/connection')"));

console.log('--- 2. o número do pedido vem de uma sequence ---');
const vendas = ler('lib/db/vendas-compras.js');
check('getNextSalesCode usa nextval', /select nextval\('sales_code_seq'\)::int as code/.test(vendas));
// Banco sem a migração continua gravando, com a janela de antes, em vez de não
// gravar nada — mesma filosofia das outras fases.
check('  e cai no max+1 se a sequence não existir',
  /if \(!\/sales_code_seq\/i\.test\(erro\.message \|\| ''\)\) throw erro;/.test(vendas));
check('  avisando qual migração falta', /fase-br-sequence-do-codigo-de-venda\.sql/.test(vendas));
const migracao = ler('banco/migrations/fase-br-sequence-do-codigo-de-venda.sql');
check('a migração cria a sequence', /create sequence if not exists sales_code_seq/.test(migracao));
// Começar do 1 repetiria todos os números já gravados. O setval considera as
// DUAS tabelas, porque pedido e orçamento compartilham a numeração.
check('  começando depois do maior número que já existe',
  /select setval\(/.test(migracao)
  && /max\(code\) from orders/.test(migracao)
  && /max\(code\) from quotes/.test(migracao));
check('  e ela está no arquivo do zero', /create sequence if not exists sales_code_seq/.test(ler('banco/RECRIAR-DO-ZERO.sql')));

console.log('--- 3. o extrato não entra duas vezes ---');
check('a importação monta um índice do que já existe',
  /const jaExistem = new Set\(\(data\.bankTransactions \|\| \[\]\)\.map\(chaveDaTransacao\)\);/.test(src));
// Conta + data + descrição normalizada + valor + tipo: duas compras iguais no
// mesmo dia são indistinguíveis num CSV, e importar uma só é melhor do que
// duplicar toda vez que alguém reimporta o arquivo.
check('  pela conta, data, descrição, valor e tipo',
  /tx\.bankAccountId, tx\.date,[\s\S]{0,200}?Number\(tx\.amount \|\| 0\)\.toFixed\(2\), tx\.type/.test(src));
check('  com a descrição normalizada', /toLowerCase\(\)\.replace\(\/\\s\+\/g, ' '\)/.test(src));
check('e pula o que já estava lá', /if \(jaExistem\.has\(chave\)\) \{\s*\n\s*repetidas \+= 1;/.test(src));
// Duas linhas iguais DENTRO do mesmo arquivo também são uma só.
check('  incluindo repetições dentro do próprio arquivo', /jaExistem\.add\(chave\);/.test(src));
check('a resposta conta as repetidas', /repetidas,/.test(src));
// Sem esse número, reimportar mostraria "0 importadas" e pareceria falha.
check('e a tela mostra esse número',
  /result\.repetidas \? `, \$\{result\.repetidas\} já existia\(m\)` : ''/.test(ler('public/modules/finance/subs/extrato_open_finance.js')));

console.log('--- 4. clique duplo não grava dois documentos ---');

// O número agora vem de sequence, então dois cliques não colidem mais no código
// — mas continuam sendo dois documentos idênticos, e se o status já baixa
// estoque os DOIS baixam. Mesmo padrão de stock/subs/new_movement.js.
const formPedido = ler('public/app.js');
check('o formulário de venda trava o botão',
  /const botaoSalvar = form\.querySelector\('button\[type="submit"\]'\);\s*\n\s*if \(botaoSalvar\?\.disabled\) return;/.test(formPedido));
// Travar ANTES das validações deixaria o botão morto quando faltasse o cliente.
check('  só depois das validações de tela',
  formPedido.indexOf('if (botaoSalvar) botaoSalvar.disabled = true;')
  > formPedido.indexOf('Adicione ao menos um produto.'));
check('  e o devolve quando a gravação falha',
  /if \(botaoSalvar\) botaoSalvar\.disabled = false;/.test(formPedido));

const formCompra = ler('public/modules/purchases/subs/new_purchase_order.js');
check('o formulário de ordem de compra também trava',
  /const botao = evento\.target\.querySelector\('button\[type="submit"\]'\);\s*\n\s*if \(botao\?\.disabled\) return;/.test(formCompra));
check('  e o devolve quando falha', /if \(botao\) botao\.disabled = false;/.test(formCompra));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
