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

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
