#!/usr/bin/env node
/**
 * A DESCRIÇÃO DO LANÇAMENTO E O MOTIVO DO CANCELAMENTO (fase AX).
 *
 * Roda no `npm test`: o catálogo é função pura, e o resto se mede lendo a
 * fonte — o comportamento de rede tem verificação contra a API quando há
 * servidor no ar.
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * 1. AS QUATRO ORIGENS ESCREVEM A MESMA FRASE. Pedido faturado, ordem de
 *    compra, entrada de NF-e e NF-e avulsa escreviam cada uma o seu formato,
 *    com três separadores diferentes e duas grafias de parcela. Nenhuma dizia
 *    se a linha era dinheiro entrando ou saindo.
 *
 * 2. A DISPENSA APARECE ONDE O DINHEIRO ESTÁ. A fase AV passou a registrar o
 *    motivo da dispensa no PEDIDO; quem concilia o recebimento abre o
 *    Financeiro. Sem "Sem NF-e (dispensada)" na descrição, a parcela sem nota é
 *    idêntica à que ainda não teve a nota resolvida.
 *
 * 3. CANCELAR EXIGE MOTIVO. Era um clique e um "confirma?". Um lançamento
 *    cancelado de R$ 8.400 sem explicação é indistinguível de erro, de venda
 *    desfeita e de cobrança abandonada.
 *
 * 4. A COLUNA "CÓDIGO" MOSTRA O NÚMERO. Ela mostrava os oito últimos caracteres
 *    do id interno — o erro que este teste encontrou. Ver a seção 4.
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

const descricao = require('../public/modules/shared/descricao_lancamento');
const { parcelasDoPedido } = require('../lib/vendas-financeiro');

console.log('--- 1. o catálogo monta a frase ---');
check('receita de venda com pedido e nota',
  descricao.montar({ qual: 'receita', tipo: 'venda', pedido: '1042', nota: '123' })
    === 'Receita de venda · Pedido 1042 · NF-e 123',
  descricao.montar({ qual: 'receita', tipo: 'venda', pedido: '1042', nota: '123' }));
check('despesa de compra com ordem',
  descricao.montar({ qual: 'despesa', tipo: 'compra', ordem: 'OC0007' })
    === 'Despesa de compra · Ordem OC0007',
  descricao.montar({ qual: 'despesa', tipo: 'compra', ordem: 'OC0007' }));
// "Transferencia de transferencia" e' o que sairia com o complemento.
check('transferência não ganha complemento',
  descricao.montar({ qual: 'transferencia', tipo: 'transferência' }) === 'Transferência',
  descricao.montar({ qual: 'transferencia', tipo: 'transferência' }));
check('o que não vem não aparece',
  descricao.montar({ qual: 'receita', tipo: 'venda' }) === 'Receita de venda',
  descricao.montar({ qual: 'receita', tipo: 'venda' }));
check('nada em branco vira string vazia', descricao.montar({}) === '');

console.log('\n--- 2. parcela só quando é parcelamento ---');
// "Parcela 1/1" e' ruido: uma parcela so nao e' parcelamento.
check('1/1 não aparece',
  !/Parcela/.test(descricao.montar({ qual: 'receita', parcela: 1, parcelas: 1 })));
check('1/3 aparece',
  /Parcela 1\/3/.test(descricao.montar({ qual: 'receita', parcela: 1, parcelas: 3 })));

console.log('\n--- 3. a dispensa aparece no financeiro ---');
const pedidoDispensado = {
  code: '1042',
  date: '2026-09-03',
  totalAmount: 500,
  dispensaDocumentoFiscal: true,
  payments: []
};
const semNota = parcelasDoPedido(pedidoDispensado, new Map());
check('pedido faturado sem nota diz que foi dispensada',
  /Sem NF-e \(dispensada\)/.test(semNota[0].description), semNota[0].description);
const comNota = parcelasDoPedido(pedidoDispensado, new Map(), { nfeNumero: '77' });
// A nota VENCE a dispensa: existindo numero, e' o numero que importa.
check('  e some quando a nota chega',
  /NF-e 77/.test(comNota[0].description) && !/dispensada/.test(comNota[0].description),
  comNota[0].description);

console.log('\n--- 4. as parcelas do pedido usam o catálogo ---');
const pedido = {
  code: '1042',
  date: '2026-09-03',
  totalAmount: 300,
  payments: [
    { amount: 100, methodName: 'Dinheiro' },
    { amount: 100, methodName: 'Boleto' },
    { amount: 100, methodName: 'Boleto' }
  ]
};
const tres = parcelasDoPedido(pedido, new Map(), { nfeNumero: '000000123' });
check('a primeira parcela diz tudo',
  tres[0].description === 'Receita de venda · Pedido 1042 · NF-e 000000123 · Parcela 1/3 · Dinheiro',
  tres[0].description);
check('  e as três somam o total',
  tres.reduce((s, p) => s + p.amount, 0) === 300);
// A diferenca continua existindo — e agora tambem diz de onde veio.
const faltando = parcelasDoPedido(
  { code: '9', date: '2026-09-03', totalAmount: 300, payments: [{ amount: 100 }] },
  new Map()
);
check('a linha de diferença mantém o complemento',
  faltando.some((p) => /Diferença não coberta/.test(p.description) && /Receita de venda/.test(p.description)),
  faltando.map((p) => p.description).join(' | '));

console.log('\n--- 5. as quatro origens passam pelo catálogo ---');
const servidor = ler('server.js');
const usos = (servidor.match(/descricaoLancamento\.montar\(/g) || []).length;
check('server.js monta descrição pelo catálogo em 3 origens', usos === 3, `${usos} usos`);
check('  nenhuma origem escreve "Ordem de Compra " + code na descrição',
  !/description: 'Ordem de Compra ' \+/.test(servidor));
check('  nem "NF-e ${nota.numero} — "',
  !/description: `NF-e \$\{nota\.numero\} —/.test(servidor));
const vendas = ler('lib/vendas-financeiro.js');
check('as parcelas do pedido também', /descricao\.montar\(/.test(vendas));

console.log('\n--- 6. cancelar exige motivo ---');
check('a rota cobra o mínimo de 10 caracteres',
  /motivo\.length < 10/.test(servidor) && /Informe o motivo do cancelamento/.test(servidor));
check('  e grava as três colunas',
  /cancelReason: motivo/.test(servidor)
  && /cancelledAt: agora/.test(servidor)
  && /cancelledByName: user\.name/.test(servidor));
// Cancelar duas vezes sobrescreveria o motivo do primeiro cancelamento.
check('  e recusa cancelar o que já está cancelado',
  /Este lançamento já está cancelado/.test(servidor));
check('o motivo volta para a tela', /cancelReason: entry\.cancelReason/.test(servidor));

const dadosFin = ler('lib/db/financeiro.js');
check('o mapper lê cancel_reason', /cancelReason: row\.cancel_reason/.test(dadosFin));
check('o update grava cancel_reason', /row\.cancel_reason = payload\.cancelReason/.test(dadosFin));
const migracao = ler('banco/migrations/fase-ax-motivo-do-cancelamento.sql');
check('a migração cria as três colunas',
  /add column if not exists cancel_reason text/.test(migracao)
  && /add column if not exists cancelled_at timestamptz/.test(migracao)
  && /add column if not exists cancelled_by_name text/.test(migracao));

console.log('\n--- 7. a tela ---');
const telaLanc = ler('public/modules/finance/subs/lancamentos.js');
// O CHECK QUE ENCONTROU UM ERRO REAL: a coluna "Codigo" mostrava
// String(entry.id).slice(-8) — pedaco de uuid. A fase AT criou o numero do
// lancamento e ligou so o titulo da tela de edicao.
check('a coluna Código mostra o número do lançamento',
  /<td>\$\{escapeHtml\(entry\.codigo \|\| '-'\)\}<\/td>/.test(telaLanc));
check('  e não mais um pedaço do id interno',
  !/escapeHtml\(String\(entry\.id\)\.slice\(-8\)\)/.test(telaLanc));
check('cancelar abre o promptModal com mínimo 10',
  /promptModal\(\{[\s\S]*?minimo: 10/.test(telaLanc));
check('  e manda o motivo no corpo',
  /body: JSON\.stringify\(\{ motivo \}\)/.test(telaLanc));
check('o modal mostra o motivo do cancelamento',
  /entry\.cancelReason/.test(telaLanc) && /Motivo não registrado/.test(telaLanc));
check('o catálogo é carregado pelo navegador',
  /modules\/shared\/descricao_lancamento\.js/.test(ler('public/index.html')));

console.log('\n--- 8. a nota que chega depois do faturamento ---');
// Pedido faturado com dispensa (SEFAZ fora) + nota no dia seguinte: as parcelas
// ja existem dizendo "Sem NF-e (dispensada)", que passa a ser mentira.
check('existe o gancho que completa a descrição',
  /async function anotarNotaNoFinanceiroDoPedido/.test(servidor));
check('  chamado quando o pedido já estava faturado',
  /podeTransicionar\(pedido\.status, 'pedido-faturado'\)\) \{[\s\S]*?anotarNotaNoFinanceiroDoPedido/.test(servidor));
// SO REESCREVE O QUE ELE MESMO ESCREVEU: comparar com o texto que este codigo
// produziria e' o que protege a descricao editada a mao.
check('  e só reescreve o texto que ele mesmo gerou',
  /p\.description === entry\.description/.test(servidor));

console.log('\n--- 9. o número da nota chega às parcelas ---');
check('o faturamento resolve o número da nota',
  /nfeNumero: await numeroDaNotaDoPedido\(data, record\)/.test(servidor));
// ERRO CORRIGIDO: syncNfeData so populava data.nfes (manual). O serializer do
// pedido procura em data.nfe (fiscal) primeiro — e ela vinha sempre vazia.
check('syncNfeData popula as DUAS tabelas de NF-e',
  /data\.nfes = manuais;/.test(servidor) && /data\.nfe = fiscais;/.test(servidor));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
