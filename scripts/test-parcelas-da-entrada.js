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
check('mais de 120: recusado', /120/.test(recusa(() => parcelasDaEntrada(nota, Array.from({ length: 121 }, () => ({ vencimento: '2026-11-20' }))))));
const comDup = { ...nota, duplicatas: [{ numero: '001', vencimento: '2026-09-20', valor: 612.5 }] };
check('com duplicatas no XML, valem as do XML (o digitado não passa por cima)', parcelasDaEntrada(comDup, [{ vencimento: '2027-01-01', valor: 612.5 }])[0].vencimento === '2026-09-20');

console.log('\n--- o servidor ---');
const servidor = ler('server.js');
const ini = servidor.indexOf('async function lancarEntradaConferida(');
const funcao = servidor.slice(ini, servidor.indexOf('\n}\n', ini));
const confere = funcao.indexOf('parcelasDaNota = entradaNfe.parcelasDaEntrada(nota, body.parcelas);');
check('confere as parcelas antes de gravar a nota', confere > 0 && confere < funcao.indexOf('await entradaNfeDb.criarEntrada('));
check('  e recusa com a mensagem (pelo sendErro: a recusa nasce com status 400)', /catch \(erroParcelas\) \{\s*return sendErro\(res, erroParcelas, 'Parcelas inválidas\.', 400\);/.test(funcao));
check('as contas a pagar saem delas', /const parcelas = parcelasDaNota;/.test(funcao));

console.log('\n--- a tela ---');
const tela = ler('public/modules/purchases/subs/entrada_nfe.js');
check('sem duplicatas, o quadro de parcelas', /` : blocoParcelas\(total\)\}/.test(tela) && !/A nota não traz duplicatas/.test(tela));
check('  abre com 1 parcela na emissão', /montarParcelasDaEntrada\(1, String\(resposta\.nota\.dataEmissao \|\| ''\)\.slice\(0, 10\), 30\);/.test(tela));
check('  parcelas, 1º vencimento e intervalo refazem as linhas', /\['entradaParcelasQtd', 'entradaParcelasPrimeiro', 'entradaParcelasIntervalo'\]\.forEach/.test(tela));
const lancar = tela.slice(tela.indexOf('async function lancar()'));
check('  o Lançar confere vencimento e soma antes de perguntar', /if \(veParcelas\(\) && somaDasParcelas\(\) !== total\)/.test(lancar)
  && lancar.indexOf('somaDasParcelas() !== total') < lancar.indexOf('if (!await confirmModal(pergunta)) return;'));
check('  quem não vê valores manda só os vencimentos', /veParcelas\(\) \? \{ vencimento: p\.vencimento, valor: p\.valor \} : \{ vencimento: p\.vencimento \}/.test(tela));
check('  só sem duplicatas no XML', /\.\.\.\(semDuplicatas \? \{ parcelas:/.test(tela));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
