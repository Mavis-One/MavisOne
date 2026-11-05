// O TOTAL DO ITEM NA EMISSÃO DE NF-e É DIGITÁVEL (19/10/2026, pedido do
// usuário: "preciso que o campo de valor total possa ser alterado").
//
// Antes o Total da linha era só texto (quantidade × unitário). Agora é um
// campo: digitar o total refaz o unitário, com até 10 casas (o máximo do
// vUnCom), para quantidade × unitário dar o total ao centavo — a SEFAZ confere
// o vProd contra essa conta. Quantidade e unitário continuam refazendo o total.
//
// Aqui: a conta do unitário, provada contra o montador da nota (o valor_bruto
// que vai à Focus tem de ser o total digitado), e as ligações da tela.
const fs = require('fs');
const path = require('path');
const { buildNfeItemPayload } = require('../lib/nfePayloadBuilder');

const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const tela = ler('public/modules/finance/subs/emitir_nfe_focus.js');
const fonte = (tela.match(/function unitarioDoTotal\(total, quantidade\) \{[\s\S]*?\n  \}/) || [])[0];
check('a tela tem a conta do unitário a partir do total', Boolean(fonte));
// eslint-disable-next-line no-new-func
const unitarioDoTotal = new Function(`${fonte}; return unitarioDoTotal;`)();

console.log('\n--- o total digitado é o que a nota leva ---');
const valorBruto = (quantidade, valorUnitario) => buildNfeItemPayload({
  descricao: 'X', ncm: '83112000', quantidade, valorUnitario, regraFiscal: { cfop: '5102', cstIcms: '00' }
}, 0).valor_bruto;
check('o caso da tela: 3 KG por R$ 119,72', valorBruto(3, unitarioDoTotal(119.72, 3)) === 119.72, unitarioDoTotal(119.72, 3));
let errados = [];
for (const quantidade of [1, 2, 3, 6, 7, 9, 11, 13, 0.5, 1.75, 2.333, 12.5, 37, 144, 999, 1000, 4321]) {
  for (let centavos = 1; centavos <= 2000000; centavos = Math.ceil(centavos * 1.37) + 1) {
    const total = centavos / 100;
    const u = unitarioDoTotal(total, quantidade);
    if (valorBruto(quantidade, u) !== total) errados.push(`${quantidade} x ${u} != ${total}`);
  }
}
check('qualquer total, qualquer quantidade: o valor_bruto é o digitado', errados.length === 0, errados.slice(0, 3).join('; '));
check('no máximo 10 casas no unitário (vUnCom)', (String(unitarioDoTotal(100, 7)).split('.')[1] || '').length <= 10, unitarioDoTotal(100, 7));
check('sem quantidade não há unitário', unitarioDoTotal(50, 0) === null && unitarioDoTotal(50, '') === null);
check('total zero zera o unitário', unitarioDoTotal(0, 3) === 0);

console.log('\n--- a tela ---');
check('o Total da linha é um campo de dinheiro',
  /<input type="number" step="0\.01" min="0" data-field="valorTotal" data-index="\$\{index\}" value="\$\{itemTotal\(item\)\}"/.test(tela)
  && !/data-row-total/.test(tela));
check('digitar o total refaz o unitário e o campo dele',
  /if \(field === 'valorTotal'\) \{\s*const unitario = unitarioDoTotal\(input\.value, itens\[index\]\.quantidade\);[\s\S]{0,200}itens\[index\]\.valorUnitario = unitario;[\s\S]{0,200}campoUnitario\.value = unitario;/.test(tela));
check('quantidade e unitário refazem o total', /const campoTotal = campoDaLinha\('valorTotal'\);\s*if \(campoTotal\) campoTotal\.value = itemTotal\(itens\[index\]\);/.test(tela));
check('ao sair, o total mostra o que a nota leva', /input\[data-field="valorTotal"\]'\)\.forEach[\s\S]{0,200}addEventListener\('change'[\s\S]{0,150}input\.value = itemTotal\(item\);/.test(tela));
check('o corpo da emissão leva o unitário inteiro, sem arredondar', /valorUnitario: Number\(item\.valorUnitario \|\| 0\),/.test(tela));

// O PEDIDO E O ORÇAMENTO (04/11/2026, pedido do usuário: acertar os centavos
// do total de certos produtos no pedido). A mesma regra: o total digitado
// refaz o unitário (até 10 casas) e não mexe na quantidade.
console.log('\n--- o pedido (app.js) ---');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
check('o Total da linha do pedido é um campo de dinheiro',
  /<input type="number" min="0" step="0\.01" class="sales-item-total" data-index="\$\{index\}"/.test(app)
  && !/<td class="sales-item-readonly"><strong>\$\{salesFormatBRL\(Number\(item\.quantity/.test(app));
const handler = (app.match(/querySelectorAll\('\.sales-item-total'\)\.forEach[\s\S]*?\n {10}\}\);/) || [])[0] || '';
check('  digitar refaz o unitário com 10 casas, e não a quantidade',
  /item\.unitPrice = Math\.round\(\(Math\.max\(0, Number\(input\.value \|\| 0\)\) \/ quantidade\) \* 1e10\) \/ 1e10;/.test(handler)
  && !/item\.quantity =/.test(handler) && /refazTotalDoItem\(item\);/.test(handler));
const pedidoUnitario = (total, quantidade) => Math.round((Math.max(0, Number(total || 0)) / quantidade) * 1e10) / 1e10;
const totalDoServidor = (q, u) => Math.round(q * u * 100) / 100; // normalizeSalesItems e buildNfeItemPayload
check('  o caso do print: 4 × 257,67 = 1.030,68, digitado 1.030,70 -> unitário 257,675',
  pedidoUnitario(1030.70, 4) === 257.675 && totalDoServidor(4, pedidoUnitario(1030.70, 4)) === 1030.70);
check('  e o servidor grava o unitário inteiro e refaz o mesmo total',
  /const unitPrice = Number\(item\.unitPrice \|\| 0\);[\s\S]{0,2500}total: Math\.round\(quantity \* unitPrice \* 100\) \/ 100/.test(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')));
check('  e a NF-e do pedido leva esse unitário (vProd = quantidade × unitário)',
  /const valorBruto = round2\(quantidade \* valorUnitario\);/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'nfePayloadBuilder.js'), 'utf8')));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
