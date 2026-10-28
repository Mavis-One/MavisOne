// AS PARCELAS DA NOTA SEM VENCIMENTOS NO XML, NA PRÓPRIA ENTRADA (19/10/2026).
//
// Pedido do usuário (sexta, 17/10, e de novo hoje): "parcelar pagamento de
// NFE, quando o vencimento das parcelas não está no XML". Na sexta saiu o
// Parcelar na janela de Contas a Pagar; hoje, a escolha do usuário foi levá-lo
// para a conferência da entrada — as contas a pagar já nascem parceladas.
//
// Provado no banco local (porta 3099), com o XML de exemplo sem <cobr>: soma
// errada recusada ANTES de gravar (nenhuma entrada a mais); 3 parcelas de
// 204,18 + 204,16 + 204,16 = 612,50 nos vencimentos escolhidos; na tela, o
// quadro abre com 1 parcela na emissão, monta 3 de 30 em 30 dias e o Lançar
// avisa a soma que não fecha. Entrada de teste apagada.
const fs = require('fs');
const path = require('path');
const { parcelasDaEntrada } = require('../lib/entradaNfe');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const recusa = (fn) => { try { fn(); return ''; } catch (e) { return e.status === 400 ? e.message : `SEM STATUS: ${e.message}`; } };

console.log('--- a regra (lib/entradaNfe.js) ---');
const nota = { dataEmissao: '2026-08-20', totais: { nota: 612.5 }, duplicatas: [] };
check('sem nada: uma parcela na emissão, como sempre', JSON.stringify(parcelasDaEntrada(nota, undefined)) === JSON.stringify([{ numero: '001', vencimento: '2026-08-20', valor: 612.5 }]));
const tres = parcelasDaEntrada(nota, [{ vencimento: '2026-11-20', valor: 204.18 }, { vencimento: '2026-12-20', valor: 204.16 }, { vencimento: '2027-01-19', valor: '204.16' }]);
check('com valores: os escolhidos', tres.map((p) => `${p.numero}:${p.vencimento}:${p.valor}`).join(' ') === '001:2026-11-20:204.18 002:2026-12-20:204.16 003:2027-01-19:204.16');
check('soma que não fecha: recusada', /tem de fechar com o valor da nota \(R\$\s612,50\)/.test(recusa(() => parcelasDaEntrada(nota, [{ vencimento: '2026-11-20', valor: 300 }, { vencimento: '2026-12-20', valor: 300 }]))));
const semValor = parcelasDaEntrada(nota, [{ vencimento: '2026-11-20' }, { vencimento: '2026-12-20' }, { vencimento: '2027-01-19' }]);
check('sem valores (quem não vê custo): partes iguais, o centavo na 1ª', semValor.map((p) => p.valor).join(',') === '204.18,204.16,204.16');
check('vencimento faltando: recusado', /vencimento/.test(recusa(() => parcelasDaEntrada(nota, [{ vencimento: '' }, { vencimento: '2026-12-20' }]))));
check('valor zero: recusado', /maior que zero/.test(recusa(() => parcelasDaEntrada(nota, [{ vencimento: '2026-11-20', valor: 612.5 }, { vencimento: '2026-12-20', valor: 0 }]))));
// 240 desde 28/10/2026 ("aumentar o limite de parcelas de lançamento de títulos para 240").
check('mais de 240: recusado', /240/.test(recusa(() => parcelasDaEntrada(nota, Array.from({ length: 241 }, () => ({ vencimento: '2026-11-20' }))))));
const comDup = { ...nota, duplicatas: [{ numero: '001', vencimento: '2026-09-20', valor: 612.5 }] };
check('com duplicatas no XML, valem as do XML (o digitado não passa por cima)', parcelasDaEntrada(comDup, [{ vencimento: '2027-01-01', valor: 612.5 }])[0].vencimento === '2026-09-20');
// "Parcelar diferente da nota" (21/10/2026): vencimento único no XML, pago no
// cartão em 5x. Provado na 3099: 2 duplicatas viraram 5 de 122,50, cinco
// contas a pagar, e a fila abriu "título 1 de 5".
const cinco = parcelasDaEntrada(comDup, Array.from({ length: 5 }, (_, i) => ({ vencimento: `2026-1${i % 3}-20`, valor: 122.5 })), { substituirDuplicatas: true });
check('marcado "Parcelar diferente": as digitadas no lugar das do XML', cinco.length === 5 && cinco.every((p) => p.valor === 122.5));
check('  com as mesmas conferências (a soma fecha com a nota)', /tem de fechar/.test(recusa(() => parcelasDaEntrada(comDup, [{ vencimento: '2026-11-20', valor: 100 }], { substituirDuplicatas: true }))));
check('  e sem parcela digitada, as do XML', parcelasDaEntrada(comDup, [], { substituirDuplicatas: true })[0].vencimento === '2026-09-20');
// O VALOR A PAGAR (22/10/2026, "preciso conseguir alterar valor total e fazer
// parcelas"). Provado na 3099: a nota de R$ 612,50 a pagar R$ 600,00 em 3x
// virou três títulos de R$ 200,00, com o ajuste dito na observação.
const aPagar = parcelasDaEntrada(comDup, [{ vencimento: '2026-11-20', valor: 200 }, { vencimento: '2026-12-20', valor: 200 }, { vencimento: '2027-01-19', valor: 200 }], { substituirDuplicatas: true, totalAPagar: 600 });
check('valor a pagar diferente da nota: as parcelas fecham com ele', aPagar.map((p) => p.valor).join(',') === '200,200,200');
check('  e a soma que não fecha cita o valor a pagar', /tem de fechar com o valor a pagar \(R\$\s600,00\)/.test(recusa(() => parcelasDaEntrada(nota, [{ vencimento: '2026-11-20', valor: 612.5 }], { totalAPagar: 600 }))));
check('  sem valores digitados, divide o valor a pagar', parcelasDaEntrada(nota, [{ vencimento: '2026-11-20' }, { vencimento: '2026-12-20' }], { totalAPagar: 100 }).map((p) => p.valor).join(',') === '50,50');
check('  e sem parcela nenhuma, uma só pelo valor a pagar', parcelasDaEntrada(nota, [], { totalAPagar: 99.9 })[0].valor === 99.9);

console.log('\n--- o servidor ---');
const servidor = ler('server.js');
const ini = servidor.indexOf('async function lancarEntradaConferida(');
const funcao = servidor.slice(ini, servidor.indexOf('\n}\n', ini));
const confere = funcao.indexOf('parcelasDaNota = entradaNfe.parcelasDaEntrada(nota, body.parcelas, {');
// O valor a pagar (22/10/2026): só de quem vê os valores das parcelas.
check('o valor a pagar vai junto, só de administrador ou de quem acessa o Financeiro',
  /const podeAjustarTotal = \(await ehAdmin\(user\)\) \|\| \(user\.allowedModules \|\| \[\]\)\.includes\('finance'\);/.test(funcao)
  && /substituirDuplicatas: body\.parcelarDiferente === true,\s*totalAPagar: podeAjustarTotal \? Number\(body\.totalAPagar\) \|\| 0 : 0/.test(funcao));
check('  e o título diz que o valor foi ajustado', /Valor a pagar ajustado na entrada: a nota é de \$\{reais\(centavosDaNota\)\}, os títulos somam \$\{reais\(centavosDosTitulos\)\}\./.test(funcao));
check('confere as parcelas antes de gravar a nota', confere > 0 && confere < funcao.indexOf('await entradaNfeDb.criarEntrada('));
check('  e recusa com a mensagem (pelo sendErro: a recusa nasce com status 400)', /catch \(erroParcelas\) \{\s*return sendErro\(res, erroParcelas, 'Parcelas inválidas\.', 400\);/.test(funcao));
check('as contas a pagar saem delas', /const parcelas = parcelasDaNota;/.test(funcao));

console.log('\n--- a tela ---');
const tela = ler('public/modules/purchases/subs/entrada_nfe.js');
check('sem duplicatas (ou "Parcelar diferente"), o quadro de parcelas',
  /if \(!duplicatas\.length \|\| tela\.parcelarDiferente\) return blocoParcelas\(\);/.test(tela) && !/A nota não traz duplicatas/.test(tela));
check('  com o Valor a pagar (começa no da nota) para quem vê os valores',
  /<span>Valor a pagar \(R\$\)<\/span>\s*<input type="number" min="0\.01" step="0\.01" id="entradaParcelasTotal"/.test(tela)
  && /return tela\.totalAPagar !== null && tela\.totalAPagar !== undefined \? tela\.totalAPagar : totalDaNota\(\);/.test(tela)
  && /const total = Math\.round\(totalAPagar\(\) \* 100\);/.test(tela));
check('  e manda o valor a pagar ao lançar', /\.\.\.\(usaAsParcelasDaTela && tela\.totalAPagar !== null \? \{ totalAPagar: tela\.totalAPagar \} : \{\}\)/.test(tela));
check('  a troca mexe só na área das parcelas (não perde os vínculos de item)',
  /if \(area\) area\.innerHTML = areaDoParcelamento\(\);\s*ligarParcelas\(\);/.test(tela));
check('  e começa nas duplicatas do XML (quantas, o 1º vencimento)',
  /montarParcelasDaEntrada\(duplicatas\.length \|\| 1, String\(\(duplicatas\[0\] && duplicatas\[0\]\.vencimento\) \|\| ''\)\.slice\(0, 10\), 30\);/.test(tela));
check('  abre com 1 parcela na emissão', /montarParcelasDaEntrada\(1, String\(resposta\.nota\.dataEmissao \|\| ''\)\.slice\(0, 10\), 30\);/.test(tela));
check('  parcelas, 1º vencimento, intervalo e valor a pagar refazem as linhas', /\['entradaParcelasQtd', 'entradaParcelasPrimeiro', 'entradaParcelasIntervalo', 'entradaParcelasTotal'\]\.forEach/.test(tela));
const lancar = tela.slice(tela.indexOf('async function lancar()'));
check('  o Lançar confere vencimento e soma antes de perguntar', /if \(veParcelas\(\) && somaDasParcelas\(\) !== total\)/.test(lancar)
  && lancar.indexOf('somaDasParcelas() !== total') < lancar.indexOf('if (!await confirmModal(pergunta)) return;'));
check('  quem não vê valores manda só os vencimentos', /veParcelas\(\) \? \{ vencimento: p\.vencimento, valor: p\.valor \} : \{ vencimento: p\.vencimento \}/.test(tela));
check('  sem duplicatas no XML, ou com "Parcelar diferente" (e aí avisa o servidor)',
  /const usaAsParcelasDaTela = semDuplicatas \|\| parcelarDiferente;/.test(tela)
  && /\.\.\.\(usaAsParcelasDaTela \? \{ parcelas:/.test(tela) && /\.\.\.\(parcelarDiferente \? \{ parcelarDiferente: true \} : \{\}\)/.test(tela));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
