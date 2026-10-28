#!/usr/bin/env node
/**
 * LANÇAMENTO PARCELADO (15/10/2026). Pedido do usuário: "preciso de uma opção
 * para fazer vários lançamentos financeiros de contas a pagar ou a receber,
 * com opções de datas, exemplo uma guia de impostos em 2x ou mais precisa ser
 * lançada com datas diferentes".
 *
 * Provado no navegador (servidor local): R$ 1.000 em 3x mensal vencendo
 * 31/10/2026 -> 31/10, 30/11, 31/12 com 333,33 + 333,33 + 333,34; a 1ª em 500
 * -> as outras 250 + 250; a data da 2ª editável; quinzenal refaz as datas;
 * salvar criou "Parcela 1/3 - GUIA ICMS TESTE PARCELAS" (500, 31/10), 2/3 (250,
 * 30/11) e 3/3 (250, 31/12), e a tela de sucesso lista as três. Os títulos de
 * teste foram apagados.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, extra) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${!cond && extra !== undefined ? ` -> ${extra}` : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const tela = ler('public/modules/finance/subs/novo_lancamento.js');
const servidor = ler('server.js');

// As contas de verdade, recortadas da tela.
const trecho = (de, ate) => tela.slice(tela.indexOf(de), tela.indexOf(ate, tela.indexOf(de)));
const fonte = [
  trecho('  const doisDigitos', '  function gerarParcelas'),
].join('\n');
// eslint-disable-next-line no-new-func
const { dataDaParcela, dividirCentavos } = new Function(`${fonte}; return { dataDaParcela, dividirCentavos };`)();

check('mensal no mesmo dia', [0, 1, 2].map((i) => dataDaParcela('2026-10-15', i, 'mensal')).join(',') === '2026-10-15,2026-11-15,2026-12-15');
check('  31 num mês de 30 vira o último dia (e volta ao 31 depois)',
  [0, 1, 2, 4].map((i) => dataDaParcela('2026-10-31', i, 'mensal')).join(',') === '2026-10-31,2026-11-30,2026-12-31,2027-02-28');
check('  virando o ano', dataDaParcela('2026-12-10', 1, 'mensal') === '2027-01-10');
check('a cada 15, 30 e 7 dias', dataDaParcela('2026-10-31', 1, '15') === '2026-11-15'
  && dataDaParcela('2026-10-31', 1, '30') === '2026-11-30' && dataDaParcela('2026-10-31', 2, '7') === '2026-11-14');
check('divide em centavos, a sobra na última', JSON.stringify(dividirCentavos(100000, 3)) === '[33333,33333,33334]');
check('  e fecha sempre no total', dividirCentavos(1, 3).reduce((a, b) => a + b, 0) === 1 && dividirCentavos(99999, 7).reduce((a, b) => a + b, 0) === 99999);

check('só no lançamento novo de receita ou despesa', /\$\{!editEntry && !isTransfer \? `\s*<div class="row finance-parcelamento">/.test(tela));
check('o Valor vira "Valor total" com 2 ou mais', tela.includes("if (rotulo) rotulo.textContent = 'Valor total';"));
check('mexer numa parcela redistribui o resto entre as seguintes',
  /const resto = dividirCentavos\(Math\.max\(0, total - ate\), parcelas\.length - i - 1\);/.test(tela));
check('  e na última o total passa a ser a soma', /form\.elements\.namedItem\('amount'\)\.value = parcelas\.reduce/.test(tela));
check('vão juntas no envio, o valor é a soma e o vencimento o da 1ª',
  /payload\.parcelas = parcelas\.map\(\(p\) => \(\{ dueDate: p\.dueDate, amount: Number\(p\.amount\) \}\)\);\s*payload\.amount = [^;]+;\s*payload\.dueDate = parcelas\[0\]\.dueDate;/.test(tela));

check('servidor: confere todas antes de gravar a primeira',
  servidor.indexOf('A parcela ${errada + 1} precisa de vencimento e de valor maior que zero.') > 0
  && servidor.indexOf('A parcela ${errada + 1}') < servidor.indexOf('for (const parte of partes) {'));
// 240 desde 28/10/2026 (pedido do usuário: "aumentar o limite de parcelas de
// lançamento de títulos para 240").
check('  no máximo 240', servidor.includes("No máximo 240 parcelas por lançamento."));
check('  "Parcela 1/3 - descrição", com o vencimento e o valor de cada uma',
  servidor.includes('description: `Parcela ${i + 1}/${parcelasPedidas.length} - ${descricao}`') && /dueDate: parte\.dueDate,\s*amount: parte\.amount,/.test(servidor));
check('  transferência não se parcela', servidor.includes("const parcelasPedidas = type !== 'TRANSFERENCIA' && Array.isArray(body.parcelas) ? body.parcelas : [];"));
check('  e devolve todas (a tela lista as criadas)', /entries: criados\.length > 1 \? criados\.map/.test(servidor));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
