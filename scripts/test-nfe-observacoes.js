#!/usr/bin/env node
// Observações adicionais da NF-e — o texto padrão da empresa.
//
// O QUE ESTE CAMPO É
// ------------------
// O grupo `infCpl` da NF-e: texto livre impresso no DANFE. Não é campo fiscal
// (não altera imposto, base nem CFOP), mas é o que o cliente lê no papel — e o
// que vale numa discussão de garantia. Ficha técnica do equipamento, prazo de
// garantia e cuidados com bateria e pneus saem daqui.
//
// AS DUAS FALHAS QUE ESTE TESTE PROTEGE
// -------------------------------------
// 1. Estourar 5000 caracteres não dá erro de digitação: dá REJEIÇÃO depois de
//    transmitir, com a numeração já consumida.
// 2. Emitir com "CHASSI:" em branco sai autorizado — e nota autorizada não se
//    corrige, só se cancela dentro do prazo. O aviso tem de vir ANTES.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, detalhe) => {
  if (cond) { console.log(`  OK  ${nome}`); }
  else { falhas += 1; console.log(`  XX  ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
};

const T = require(path.join(RAIZ, 'public/modules/shared/nfe_texto_padrao.js'));
const telaSrc = ler('public/modules/finance/subs/emitir_nfe_focus.js');
const htmlSrc = ler('public/index.html');


console.log('--- o texto padrão, como a empresa pediu ---');
[
  'FABRICANTE: MAVIS',
  'CATEGORIA: AUTOPROPELIDO',
  'GARANTIA: 90 DIAS',
  'O FRETE É POR CONTA DO CLIENTE E NÃO ESTÁ COBERTO PELA GARANTIA.',
  'CALIBRE OS PNEUS TODA SEMANA A 45 LBS.',
  'DESCONECTE O CARREGADOR ASSIM QUE A BATERIA ESTIVER TOTALMENTE CARREGADA.'
].forEach((linha) => check(`traz "${linha.slice(0, 34)}..."`, T.PADRAO.includes(linha)));
check('os anos de fabricação e modelo estão lá', /ANO DE FABRICACAO: 2026/.test(T.PADRAO) && /^ANO: 2026$/m.test(T.PADRAO));
// Acentuação preservada: o DANFE imprime o que está aqui, e "ASSISTENCIA" sem
// acento num texto de garantia é a diferença entre documento e rascunho.
check('a acentuação foi preservada', T.PADRAO.includes('ASSISTÊNCIA') && T.PADRAO.includes('REVISÕES'));
// A linha em branco separa a ficha técnica do bloco de garantia — é o que
// deixa o DANFE legível.
check('a linha em branco entre os blocos ficou', /COR:\n\nGARANTIA/.test(T.PADRAO));

console.log('\n--- campos que o operador preenche em cada nota ---');
// Declarados e vazios de propósito: campo em branco na hora de emitir é um
// lembrete; campo ausente é um esquecimento.
check('CHASSI, MODELO e COR nascem vazios', JSON.stringify(T.camposVazios(T.PADRAO)) === '["CHASSI","MODELO","COR"]');
check('preencher um tira ele da lista', !T.camposVazios(T.PADRAO.replace('CHASSI:', 'CHASSI: 9BW123')).includes('CHASSI'));
// Quem apagou a linha decidiu não usar o campo — cobrar seria teimosia.
check('campo removido não é cobrado', !T.camposVazios(T.PADRAO.replace(/^COR:$/m, '')).includes('COR'));
check('espaço em branco ainda conta como vazio', T.camposVazios('CHASSI:   ').includes('CHASSI'));

console.log('\n--- o limite da SEFAZ ---');
check('o limite é 5000', T.LIMITE_INFCPL === 5000);
check('o padrão cabe com folga', !T.excedeLimite(T.PADRAO) && T.PADRAO.length < 1000, `${T.PADRAO.length} caracteres`);
check('acima do limite é detectado', T.excedeLimite('x'.repeat(5001)));
// Barrar só na tela deixaria a rejeição acontecer; barrar antes de montar o
// corpo poupa a numeração.
check('a tela barra o envio antes de transmitir', /TextoPadrao\.excedeLimite\(observacoes\)/.test(telaSrc));
check('e diz quanto passou', /a SEFAZ aceita no máximo \$\{TextoPadrao\.LIMITE_INFCPL\}/.test(telaSrc));

console.log('\n--- a tela ---');
check('há uma aba de Observações', /data-tab="observacoes"/.test(telaSrc));
check('com o campo dentro', /name="observacoesAdicionais"/.test(telaSrc));
check('nascendo com o texto padrão', /let observacoes = TextoPadrao \? TextoPadrao\.PADRAO : '';/.test(telaSrc));
// renderForm() redesenha o formulário inteiro a cada troca de aba: sem guardar
// fora do HTML, escrever o chassi e ir conferir os itens apagaria o texto.
check('o texto sobrevive à troca de aba', /observacoes = campoObs\.value;/.test(telaSrc));
check('o envio usa a variável, não o formData', /informacoesAdicionais: observacoes/.test(telaSrc));
check('dá para restaurar o padrão', /id="nfeFocusObsRestaurar"/.test(telaSrc));
check('o contador de caracteres aparece', /de \$\{TextoPadrao\.LIMITE_INFCPL\} caracteres/.test(telaSrc));
check('e os campos em branco são listados', /Ainda em branco: \$\{vazios\.join\(', '\)\}/.test(telaSrc));

console.log('\n--- a complementar NÃO leva este texto ---');
// Complementar de ICMS não vende equipamento: ela referencia outra nota e
// destaca imposto. Ficha técnica e garantia ali seriam ruído — e a aba de
// Observações nem existe nesse fluxo (ver ehComplemento()).
// A aba e o painel ficam dentro do ramo "não é complemento" do template. Se
// escorregarem para fora, a nota complementar ganha uma ficha técnica que não
// tem nada a ver com ela.
const abreRamoComum = telaSrc.indexOf("${ehComplemento() ? '' : `");
const fechaRamoComum = telaSrc.indexOf('<button type="submit" id="nfeFocusSubmitBtn">');
const posPainelObs = telaSrc.indexOf('data-tab-panel="observacoes"');
check('o ramo da nota comum foi encontrado', abreRamoComum > 0 && fechaRamoComum > abreRamoComum);
check('o painel de observações está dentro dele', posPainelObs > abreRamoComum && posPainelObs < fechaRamoComum);
check('a aba também', /: `<button[\s\S]{0,600}data-tab="observacoes"/.test(telaSrc));
check('o complemento mantém o texto próprio', /informacoesAdicionais: formData\.get\('complementoInformacoes'\)/.test(telaSrc));

console.log('\n--- o campo de chassi escreve na linha CHASSI: ---');
// O chassi é o único dado da ficha que muda a cada nota. Procurá-lo no meio de
// vinte linhas de texto a cada emissão é onde o erro de digitação aparece.
const comChassi = T.comChassi(T.PADRAO, '9BW123ABC');
check('escreve na linha certa', /^CHASSI: 9BW123ABC$/m.test(comChassi));
check('e o resto do texto fica intacto', comChassi.includes('CALIBRE OS PNEUS TODA SEMANA A 45 LBS.')
  && comChassi.includes('FABRICANTE: MAVIS'));
check('trocar substitui, não acumula', (T.comChassi(comChassi, 'ZZZ999').match(/^CHASSI:/gm) || []).length === 1);
check('e o novo valor vale', /^CHASSI: ZZZ999$/m.test(T.comChassi(comChassi, 'ZZZ999')));
// Apagar tem de devolver a linha ao estado "em branco" — não deixar "CHASSI: "
// com um espaço solto, que deixaria de casar com camposVazios.
check('apagar limpa a linha', /^CHASSI:$/m.test(T.comChassi(comChassi, '')));
check('e volta a contar como em branco', T.camposVazios(T.comChassi(comChassi, '')).includes('CHASSI'));
check('lê de volta o que está escrito', T.chassiDoTexto(comChassi) === '9BW123ABC');
check('texto sem chassi devolve vazio', T.chassiDoTexto('nada aqui') === '');

// Trabalha sobre o TEXTO ATUAL, não sobre o modelo: o operador pode ter editado
// o resto das observações antes de digitar o chassi, e remontar do zero
// apagaria essas edições sem avisar.
const editadoAMao = 'OBSERVACAO DO VENDEDOR\nCHASSI:\nresto que o operador escreveu';
check('respeita texto editado à mão', T.comChassi(editadoAMao, 'ABC')
  === 'OBSERVACAO DO VENDEDOR\nCHASSI: ABC\nresto que o operador escreveu');

console.log('\n--- o campo na tela ---');
check('há um campo de chassi', /id="nfeFocusChassi"/.test(telaSrc));
check('que escreve no texto', /observacoes = TextoPadrao\.comChassi\(campoObs\.value, evento\.target\.value\);/.test(telaSrc));
// Se o texto for editado à mão, o campo de cima tem de acompanhar — senão os
// dois passam a dizer coisas diferentes.
check('e acompanha quem edita o texto', /campoChassi\.value = TextoPadrao\.chassiDoTexto\(observacoes\)/.test(telaSrc));
check('o campo abre com o que já está no texto', /TextoPadrao\.chassiDoTexto\(observacoes\) : ''/.test(telaSrc));

console.log('\n--- o texto do pedido não é descartado ---');
// Era perguntado ao gerar a NF-e e depois jogado fora: esta tela não lia o
// campo. Perguntar e ignorar é pior do que não perguntar.
check('a observação do pedido entra na nota', /observacaoDoPedido: doPedido\.taxNotes \|\| ''/.test(telaSrc));
const comObs = T.montar({ observacaoDoPedido: 'Entrega em 20/08.' });
check('e vai por último, depois da garantia', comObs.trim().endsWith('Entrega em 20/08.')
  && comObs.indexOf('GARANTIA') < comObs.indexOf('Entrega em 20/08.'));
check('sem observação, nada muda', T.montar({}) === T.PADRAO);
check('e não sobra linha vazia', !/\n\n\n/.test(comObs));


console.log('\n--- o arquivo é editável sem mexer na tela ---');
// É texto de NEGÓCIO: garantia e ficha técnica mudam por decisão da empresa,
// não por mudança de sistema.
check('mora em arquivo próprio', fs.existsSync(path.join(RAIZ, 'public/modules/shared/nfe_texto_padrao.js')));
check('carregado antes da tela de emissão',
  htmlSrc.indexOf('shared/nfe_texto_padrao.js') < htmlSrc.indexOf('finance/subs/emitir_nfe_focus.js'));
check('e serve ao navegador e ao teste', /if \(raiz\) raiz\.MavisNfeTextoPadrao = api;/.test(ler('public/modules/shared/nfe_texto_padrao.js')));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
