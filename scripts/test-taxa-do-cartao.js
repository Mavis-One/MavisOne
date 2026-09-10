#!/usr/bin/env node
/**
 * A TAXA DA MAQUININHA (fase BX) — o campo que era cadastrado e nunca lido.
 *
 * O DEFEITO
 * ---------
 * O cadastro de formas de pagamento tem "Taxa (%)" desde sempre. É digitado, é
 * validado (não pode ser negativo), aparece na lista formatado com duas casas —
 * e uma busca por `feePercent` no repositório inteiro só encontrava o próprio
 * cadastro. Ninguém lia.
 *
 * Reproduzido contra a API, com o código de antes, num banco de prova:
 *
 *   venda de R$ 1.000,00 no cartão a 3,5%
 *     título gerado ....... R$ 1.000,00, taxa NULA, líquido NULO
 *     extrato da Rede ..... R$ 965,00
 *     casamento exato? .... NÃO (erra por exatamente a taxa)
 *     depois de conciliar . status "parcial", R$ 35,00 em aberto PARA SEMPRE
 *
 * É o `OBS-28` da observação do ViperERP de 08/09/2026, palavra por palavra:
 * "o campo Conc. fica ✗ e o contas a receber nunca é baixado". E, de quebra,
 * toda margem saía otimista pela taxa, em toda venda no cartão.
 *
 * O QUE ESTE TESTE PROVA
 * ----------------------
 * 1. `amount` CONTINUA SENDO O BRUTO. A taxa entra ao lado, não no lugar —
 *    mexer no bruto mudaria receita, comissão e todo relatório existente.
 * 2. A taxa e o líquido são calculados a partir do cadastro da forma.
 * 3. Forma SEM taxa não ganha campo nenhum: ausente é "não se aplica",
 *    enquanto `feePercent: 0` seria "taxa zero contratada" — afirmações
 *    diferentes, e a tela mostra uma e não a outra.
 * 4. A identidade do cartão (credenciadora, bandeira, NSU) viaja junto,
 *    porque o extrato da credenciadora casa por NSU, não por número de pedido.
 * 5. O ajuste de centavo REFAZ o líquido: senão bruto − taxa não fecharia com
 *    o líquido, e a diferença apareceria como se fosse do banco.
 * 6. A conciliação procura pelo LÍQUIDO e fecha o título abatendo a taxa.
 *
 * O QUE ESTE TESTE NÃO COBRE: a taxa lançada como DESPESA por venda. Isso muda
 * a DRE e dobra o número de lançamentos — é decisão de contabilidade, não
 * escolha para tomar de lado. Hoje a taxa aparece como desconto na baixa, onde
 * fica visível no histórico.
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

const { parcelasDoPedido } = require('../lib/vendas-financeiro');

const CARTAO = {
  id: 'pm-rede', name: 'Cartao Rede 2-6x', type: 'cartao-credito',
  daysToReceive: 30, feePercent: 3.5, cardAcquirerId: 'adq-rede'
};
const DINHEIRO = { id: 'pm-din', name: 'Dinheiro', type: 'dinheiro', daysToReceive: 0, feePercent: 0 };
const formas = new Map([[CARTAO.id, CARTAO], [DINHEIRO.id, DINHEIRO]]);
const credenciadoras = new Map([['adq-rede', { id: 'adq-rede', name: 'Rede', cnpj: '01425787000104' }]]);
const contexto = { credenciadorasPorId: credenciadoras };

const pedido = (payments, total) => ({
  id: 'ped-1', code: '1001', date: '2026-09-10', totalAmount: total, payments
});
const noCartao = (valor, extra = {}) => ({
  methodId: CARTAO.id, methodName: CARTAO.name, amount: valor,
  cardBrand: '06', cardAuthorization: 'R07242', cardIntegration: '2', ...extra
});

console.log('--- 1. o bruto continua sendo o bruto ---');
const [p1] = parcelasDoPedido(pedido([noCartao(1000)], 1000), formas, contexto);
// Mexer em `amount` mudaria receita bruta, comissão e todo relatório que existe.
check('amount é o valor cheio da venda', p1.amount === 1000, p1.amount);
check('a taxa vem do cadastro da forma', p1.feePercent === 3.5);
check('  em reais', p1.feeAmount === 35, p1.feeAmount);
check('  e o líquido é o que cai na conta', p1.netAmount === 965, p1.netAmount);
// Arredondado, e não subtração crua: 333,34 − 11,67 dá 321,66999999999996 em
// ponto flutuante. O código usa `cent()`; a conferência tem de usar também,
// senão acusa erro onde não há.
const cent = (v) => Math.round(Number(v || 0) * 100) / 100;
check('bruto − taxa fecha com o líquido', cent(p1.amount - p1.feeAmount) === p1.netAmount);
// O prazo já vinha do cadastro desde a fase AU; aqui só se confirma que a taxa
// não o atropelou.
check('o vencimento continua saindo do prazo da forma', p1.dueDate === '2026-10-10', p1.dueDate);

console.log('--- 2. a identidade do cartão viaja junto ---');
// O extrato da credenciadora vem por NSU e bandeira, não por número de pedido:
// sem estes campos a conciliação não tem por onde casar.
check('a credenciadora vai pelo id', p1.cardAcquirerId === 'adq-rede');
// Nome gravado junto, como clientSupplierName: credenciadora renomeada ou
// inativada não pode apagar de quem era o título do ano passado.
check('  e pelo NOME, que é snapshot', p1.cardAcquirerName === 'Rede');
check('a bandeira vai como código tBand', p1.cardBrand === '06');
check('o NSU vai', p1.cardAuthorization === 'R07242');
// Sem o mapa de credenciadoras (chamada antiga, teste puro) degrada em vez de
// quebrar: fica o id, falta o nome.
const [semMapa] = parcelasDoPedido(pedido([noCartao(1000)], 1000), formas, {});
check('sem o mapa de credenciadoras, degrada em vez de quebrar',
  semMapa.cardAcquirerId === 'adq-rede' && semMapa.cardAcquirerName === '');

console.log('--- 3. "não se aplica" é diferente de "zero" ---');
const [emDinheiro] = parcelasDoPedido(
  pedido([{ methodId: DINHEIRO.id, methodName: 'Dinheiro', amount: 1000 }], 1000), formas, contexto);
// Ausente e 0 são afirmações diferentes: "esta forma não cobra taxa" contra
// "o contrato tem taxa zero". A tela mostra uma e não a outra.
check('forma sem taxa não ganha feePercent', emDinheiro.feePercent === undefined);
check('  nem feeAmount', emDinheiro.feeAmount === undefined);
check('  nem netAmount', emDinheiro.netAmount === undefined);
check('  e nem campo de cartão', emDinheiro.cardAcquirerId === undefined);

console.log('--- 4. o ajuste de centavo refaz o líquido ---');
// 1000 em 3 parcelas dá 333,33 × 3 = 999,99. O centavo vai na última — e a
// taxa dela foi calculada sobre 333,33. Deixar o líquido como estava faria
// bruto − taxa não fechar, e a diferença apareceria como se fosse do banco.
const tres = parcelasDoPedido(
  pedido([noCartao(333.33), noCartao(333.33), noCartao(333.33)], 1000), formas, contexto);
const ultima = tres[tres.length - 1];
check('a última parcela recebeu o centavo', ultima.amount === 333.34, ultima.amount);
check('  e o líquido dela foi refeito', cent(ultima.amount - ultima.feeAmount) === ultima.netAmount,
  `${ultima.amount} − ${ultima.feeAmount} = ${ultima.netAmount}`);
check('a soma das parcelas fecha com o pedido',
  Math.round(tres.reduce((s, p) => s + p.amount, 0) * 100) / 100 === 1000);

console.log('--- 5. a linha de diferença não é cartão ---');
// Pagamentos que não fecham o total geram uma linha "diferença". Ela não veio
// de maquininha nenhuma: dar taxa a ela inventaria um custo.
const comFalta = parcelasDoPedido(pedido([noCartao(600)], 1000), formas, contexto);
check('a diferença virou parcela', comFalta.length === 2 && comFalta[1].amount === 400);
check('  sem taxa', comFalta[1].feeAmount === undefined);
check('  e sem cartão', comFalta[1].cardAcquirerId === undefined);

console.log('--- 6. a conciliação procura pelo líquido e fecha o título ---');
const src = ler('server.js');
// Procurar pelo bruto erra por exatamente a taxa, sempre — é o "Conc. ✗".
check('o casamento sabe o que esperar no extrato', /function esperadoNoExtrato\(entry, restante, jaPago\)/.test(src));
check('  e o usa no cálculo da diferença',
  /esperadoNoExtrato\(entry, remaining, paid\) - Number\(tx\.amount \|\| 0\)/.test(src));
// Com baixa parcial no meio, o que falta já não é o líquido inteiro.
check('  mas só enquanto nada foi baixado', /if \(jaPago > 0\.005\) return restante;/.test(src));
check('a taxa fecha o título na conciliação', /function descontoDaTaxaDoCartao\(entry, baixasAnteriores, valorDaTransacao\)/.test(src));
// Um crédito de outro valor não é essa taxa; abater seria inventar um desconto.
check('  só quando a transação É o líquido',
  /if \(Math\.abs\(liquido - Number\(valorDaTransacao \|\| 0\)\) > 0\.01\) return 0;/.test(src));
check('  e a baixa da conciliação a usa', /discount: taxaDoCartao,/.test(src));
// O débito quita na hora e TAMBÉM tem taxa: baixar pelo bruto creditava na
// conta um dinheiro que não chegou.
check('a baixa automática entra pelo líquido',
  /amount: parcela\.netAmount == null \? parcela\.amount : parcela\.netAmount,/.test(src));

console.log('--- 7. a migração e o que a tela mostra ---');
const migracao = ler('banco/migrations/fase-bx-titulo-de-cartao.sql');
for (const coluna of ['fee_percent', 'fee_amount', 'net_amount', 'card_acquirer_id', 'card_acquirer_name', 'card_brand', 'card_authorization']) {
  check(`a coluna ${coluna} entra`, new RegExp(`add column if not exists ${coluna}\\b`).test(migracao));
}
// A conciliação com o extrato da credenciadora procura por NSU; sem índice é
// varredura na tabela inteira a cada linha do extrato.
check('  com índice no NSU', /create index if not exists idx_financial_entries_card_authorization/.test(migracao));
check('e está no arquivo do zero', /net_amount/.test(ler('banco/RECRIAR-DO-ZERO.sql')));

const financeiro = ler('lib/db/financeiro.js');
check('a gravação distingue zero de ausente', /fee_percent: payload\.feePercent \?\? null,/.test(financeiro));
check('a leitura também', /feePercent: row\.fee_percent == null \? null : Number\(row\.fee_percent\),/.test(financeiro));

const tela = ler('public/modules/finance/subs/lancamentos.js');
check('o lançamento mostra o bloco do cartão', /finance-cartao-box/.test(tela));
check('  com o crédito previsto', /Crédito previsto/.test(tela));
// Sem preencher, quem baixa digita o bruto e o título fica "parcial" pela taxa.
check('a baixa já nasce com o líquido', /value="\$\{Number\(valorSugerido\)\.toFixed\(2\)\}"/.test(tela));
check('  e com a taxa no desconto', /name="discount" value="\$\{Number\(taxaAAbater\)\.toFixed\(2\)\}"/.test(tela));
// Com baixa parcial no meio, sugerir o líquido inteiro colocaria número errado.
check('  só na primeira baixa', /&& !entry\.payments\.length/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
