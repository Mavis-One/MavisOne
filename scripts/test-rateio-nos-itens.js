#!/usr/bin/env node
/**
 * FRETE, SEGURO, DESCONTO E OUTRAS DESPESAS RATEADOS PELOS ITENS (16/10/2026).
 *
 * A primeira NF-e com despesas do pedido (despesas gerais + taxa de montagem)
 * voltou da SEFAZ com a rejeição 604, "Total do vOutro difere do somatório dos
 * itens": o valor ia só no total da nota. A SEFAZ confere cada total contra a
 * soma dos itens — frete, seguro e desconto do mesmo jeito. Nomes da Focus
 * conferidos em campos.focusnfe.com.br/nfe/NotaFiscalXML.html (no item:
 * valor_frete, valor_seguro, valor_desconto, valor_outras_despesas).
 */
const { buildNfePayload, buildNfcePayload, ratearPelosItens } = require('../lib/nfePayloadBuilder');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const soma = (items, campo) => Math.round(items.reduce((s, i) => s + Number(i[campo] || 0), 0) * 100) / 100;

const BASE = {
  estabelecimento: {
    razaoSocial: 'Loja', cnpj: '11222333000181', logradouro: 'Rua', numero: '1',
    bairro: 'Centro', municipio: 'Blumenau', uf: 'SC', cep: '89000000',
    codigoMunicipio: '4202404', inscricaoEstadual: '123456789'
  },
  empresa: { crt: 1 },
  destinatario: {
    nome: 'Cliente', documento: '11222333000181', uf: 'SC',
    logradouro: 'Rua', bairro: 'Centro', municipio: 'Blumenau', cep: '89000000'
  },
  naturezaOperacao: 'Venda'
};
const item = (valor, extra = {}) => ({ descricao: 'Produto', quantidade: 1, valorUnitario: valor, ncm: '87116000', regraFiscal: { cfop: '5102' }, ...extra });

console.log('--- 1. o caso da rejeição 604 ---');
const umItem = buildNfePayload({ ...BASE, itens: [item(3990)], outrasDespesas: 75.65 });
check('as outras despesas vão para o item', umItem.items[0].valor_outras_despesas === 75.65, umItem.items[0].valor_outras_despesas);
check('  e o total da nota fecha com a soma dos itens', umItem.valor_outras_despesas === soma(umItem.items, 'valor_outras_despesas'));
check('  e o valor da nota continua o mesmo', umItem.valor_total === 4065.65, umItem.valor_total);

console.log('\n--- 2. vários itens, centavos quebrados ---');
const varios = buildNfePayload({ ...BASE, itens: [item(100), item(200), item(0.01), item(33.33)], frete: 10, seguro: 0.07, desconto: 3.33, outrasDespesas: 75.65 });
for (const [campo, total] of [['valor_frete', 10], ['valor_seguro', 0.07], ['valor_desconto', 3.33], ['valor_outras_despesas', 75.65]]) {
  check(`${campo}: soma dos itens = total (${total})`, soma(varios.items, campo) === total && varios[campo] === total, `${soma(varios.items, campo)} / ${varios[campo]}`);
}
check('proporcional ao valor (o de 200 leva o dobro do de 100, até o centavo)',
  Math.abs(varios.items[1].valor_frete - 2 * varios.items[0].valor_frete) <= 0.01, `${varios.items[0].valor_frete} / ${varios.items[1].valor_frete}`);
check('nenhuma parte negativa', varios.items.every((i) => ['valor_frete', 'valor_seguro', 'valor_desconto', 'valor_outras_despesas'].every((c) => !(Number(i[c]) < 0))));
check('o valor da nota não muda', varios.valor_total === Math.round((333.34 + 10 + 0.07 + 75.65 - 3.33) * 100) / 100, varios.valor_total);

console.log('\n--- 3. o que não entra ---');
const semNada = buildNfePayload({ ...BASE, itens: [item(50)] });
check('sem frete nem despesas, o item não ganha os campos',
  ['valor_frete', 'valor_seguro', 'valor_desconto', 'valor_outras_despesas'].every((c) => semNada.items[0][c] === undefined));
const itens = [{ valor_bruto: 100 }, { valor_bruto: 0, inclui_no_total: 0 }, { valor_bruto: 50 }];
ratearPelosItens(itens, 'valor_frete', 9);
check('item que não soma no total (escritural) fica de fora', itens[1].valor_frete === undefined && soma(itens, 'valor_frete') === 9, JSON.stringify(itens));
check('a base do ICMS do item não muda', buildNfePayload({ ...BASE, empresa: { crt: 3 }, itens: [item(1000, { regraFiscal: { cfop: '5102', cstIcms: '00', aliquotaIcms: 17 } })], outrasDespesas: 100 }).items[0].icms_base_calculo === 1000);

console.log('\n--- 4. a NFC-e rateia o desconto ---');
const nfce = buildNfcePayload({ ...BASE, itens: [item(30), item(70)], desconto: 5, pagamentos: [{ forma: '01', valor: 95 }] });
check('desconto da NFC-e nos itens', soma(nfce.items, 'valor_desconto') === 5 && nfce.valor_desconto === 5, JSON.stringify(nfce.items.map((i) => i.valor_desconto)));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
