#!/usr/bin/env node
/**
 * CAMPOS DE VALOR NO PADRÃO 1.234,56 (13/10/2026).
 *
 * Pedido do usuário: "padronize os campos de valores para que se ajustem
 * automaticamente, por cópia e cola ou digitação; coloque sempre em unidade
 * qualquer dígito, no padrão xx,xx; xxx,xx; x.xxx,xx". Ver
 * public/modules/shared/campo_dinheiro.js.
 *
 * Provado no navegador (banco local, nada gravado): digitando 1500 no preço
 * do item o campo passa por 1 -> 15 -> 150 -> 1.500; ".5" vira "1.500,5";
 * ao sair, "1.500,50" — e `value` continua "1500.5". Colar "R$ 2.345,67",
 * "2345.67" e "1,500.50" dá "2.345,67" e "1.500,50". O FormData do novo
 * lançamento devolve 12345.6. Valor 0 num campo de mínimo 0,01 é recusado.
 *
 * Achado no mesmo teste, e que já existia: trocar o preço de um item já salvo
 * não mudava o Total da Venda até salvar — a soma lia o `total` pronto que o
 * item traz do servidor. O valor gravado sempre esteve certo (o servidor
 * recalcula); era a tela. Ver refazTotalDoItem em app.js.
 */
const fs = require('fs');
const path = require('path');
const D = require('../public/modules/shared/campo_dinheiro.js');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

console.log('--- 1. digitando: cada dígito é unidade ---');
const passos = ['1', '15', '150', '1500', '15000', '150000', '1500000'].map((t) => D.formatarDigitando(t));
check('1 -> 15 -> 150 -> 1.500 -> 15.000 -> 150.000 -> 1.500.000',
  passos.join(' ') === '1 15 150 1.500 15.000 150.000 1.500.000', passos.join(' '));
check('a vírgula abre os centavos', D.formatarDigitando('1.500,5') === '1.500,5');
check('  no máximo dois', D.formatarDigitando('1.500,567') === '1.500,56');
check('  e vírgula sozinha vira 0,', D.formatarDigitando(',') === '0,');
check('zeros à esquerda somem', D.formatarDigitando('0001234') === '1.234');
check('letras e símbolos são ignorados', D.formatarDigitando('R$ 12a3') === '123');
check('sinal só onde o campo aceita negativo',
  D.formatarDigitando('-12', true) === '-12' && D.formatarDigitando('-12', false) === '12');

console.log('\n--- 2. saindo do campo: completa os centavos ---');
check('"1.500" -> "1.500,00"', D.completar('1.500') === '1.500,00');
check('"1.500,5" -> "1.500,50"', D.completar('1.500,5') === '1.500,50');
check('"12" -> "12,00" e "0,5" -> "0,50"', D.completar('12') === '12,00' && D.completar('0,5') === '0,50');
check('vazio continua vazio', D.completar('') === '');

console.log('\n--- 3. colando: qualquer formato ---');
const colagens = {
  'R$ 1.500,50': 1500.5, '1500.5': 1500.5, '1.500,50': 1500.5, '1,500.50': 1500.5,
  '1.500': 1500, '1500': 1500, '0,05': 0.05, '12.34': 12.34, '2.345.678': 2345678,
  '1.234.567,891': 1234567.89, '-200,00': -200
};
Object.entries(colagens).forEach(([texto, esperado]) => {
  check(`colar "${texto}"`, D.deColagem(texto) === esperado, D.deColagem(texto));
});
check('texto sem número não cola', D.deColagem('abc') === null);

console.log('\n--- 4. o número que o sistema lê não muda ---');
check('"1.234.567,89" -> "1234567.89"', D.paraNumero('1.234.567,89') === '1234567.89');
check('vazio -> ""', D.paraNumero('') === '');
check('gravar 1500.5 mostra "1.500,50"', D.textoDoValor(1500.5) === '1.500,50');
check('gravar "1234.56" (como as telas gravam) mostra "1.234,56"', D.textoDoValor('1234.56') === '1.234,56');
check('gravar "0" mostra "0,00"', D.textoDoValor('0') === '0,00');
check('negativo', D.formatar(-1234.5) === '-1.234,50');

console.log('\n--- 5. quais campos ---');
const campo = (atributos, rotulo) => ({
  tagName: 'INPUT',
  name: atributos.name || '',
  id: atributos.id || '',
  className: atributos.className || '',
  dataset: atributos.dataset || {},
  hasAttribute: (a) => a in (atributos.attrs || {}),
  closest: (sel) => (sel === 'label' ? (rotulo ? { textContent: rotulo } : null) : (atributos.attrs || {})['data-nao-dinheiro'] !== undefined ? {} : null)
});
check('valor, frete, preço são dinheiro', ['amount', 'freight', 'salePrice'].every((n) => D.candidato(campo({ name: n }, 'Valor'))));
check('base e valor dos impostos também', D.candidato(campo({ dataset: { fiscalCampo: 'baseIcms' } }, 'Base')));
check('alíquota não é', !D.candidato(campo({ dataset: { fiscalCampo: 'aliquotaIcms' } }, 'Alíquota %')));
check('desconto % não é', !D.candidato(campo({ name: 'discountPercent' })));
check('rótulo com % não é', !D.candidato(campo({ name: 'taxa' }, 'Taxa (%)')));
check('quantidade não é', !D.candidato(campo({ dataset: { field: 'quantidade' } })));
check('litros não é', !D.candidato(campo({ name: 'liters' }, 'Litros')));
check('origem da mercadoria (código 0 a 8) não é', !D.candidato(campo({ dataset: { fiscalCampo: 'origem' } }, 'Origem')));
check('data-nao-dinheiro tira; data-dinheiro põe',
  !D.candidato(campo({ name: 'amount', attrs: { 'data-nao-dinheiro': '' } }))
  && D.candidato(campo({ name: 'aliquota', attrs: { 'data-dinheiro': '' } })));

console.log('\n--- 6. ligado na página ---');
const html = ler('public/index.html');
const pos = (s) => html.indexOf(s);
check('carrega antes do app.js', pos('shared/campo_dinheiro.js') > 0 && pos('shared/campo_dinheiro.js') < pos('src="/app.js"'));
check('o FormData recebe o número, não o texto da tela', /addEventListener\('formdata'/.test(ler('public/modules/shared/campo_dinheiro.js')));
check('maiúsculas não mexe no campo de valor', /data-dinheiro-ativo/.test(ler('public/modules/shared/maiusculas.js')));
const app = ler('public/app.js');
check('trocar preço ou quantidade refaz o total do item (Total da Venda na hora)',
  (app.match(/refazTotalDoItem\(items\[Number\(input\.dataset\.index\)\]\);/g) || []).length === 2);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
