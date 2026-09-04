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
// Contra o ORÇAMENTO, e não contra o limite bruto: em homologação o aviso de
// teste ocupa parte do mesmo campo (ver a seção da fase BL, mais abaixo).
check('a tela barra o envio antes de transmitir', /if \(observacoes\.length > orcamentoObs\)/.test(telaSrc));
check('e diz quanto cabia', /cabem \$\{orcamentoObs\}/.test(telaSrc));

console.log('\n--- a tela ---');
check('há uma aba de Observações', /data-tab="observacoes"/.test(telaSrc));
check('com o campo dentro', /name="observacoesAdicionais"/.test(telaSrc));
check('nascendo com o texto padrão', /let observacoes = TextoPadrao \? TextoPadrao\.PADRAO : '';/.test(telaSrc));
// renderForm() redesenha o formulário inteiro a cada troca de aba: sem guardar
// fora do HTML, escrever o chassi e ir conferir os itens apagaria o texto.
check('o texto sobrevive à troca de aba', /observacoes = campoObs\.value;/.test(telaSrc));
check('o envio usa a variável, não o formData', /informacoesAdicionais: observacoes/.test(telaSrc));
check('dá para restaurar o padrão', /id="nfeFocusObsRestaurar"/.test(telaSrc));
check('o contador de caracteres aparece', /de \$\{orcamento\} caracteres/.test(telaSrc));
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
// A nota do pedido deixou de ser lida direto no `montar` e passou a ficar numa
// variavel (notaDoPedido): desde a fase AO, trocar o CNPJ emitente troca a BASE
// do texto, e sem guardar a observacao a parte ela seria perdida nessa troca.
check('a observação do pedido entra na nota', /notaDoPedido = doPedido\.taxNotes \|\| ''/.test(telaSrc)
  && /observacaoDoPedido: notaDoPedido/.test(telaSrc));
check('  e sobrevive à troca de CNPJ emitente', /if \(observacoes === anterior\) observacoes = padraoAtual\(\);/.test(telaSrc));
// Base vazia cai no texto do sistema: empresa sem mensagem propria nao perde a
// ficha tecnica que sempre saiu na nota.
check('  base vazia continua caindo no texto do sistema',
  T.montar({ base: '' }) === T.montar({}) && T.montar({ base: '   ' }) === T.PADRAO);
check('  e a base da empresa substitui o texto do sistema',
  T.montar({ base: 'TEXTO DA EMPRESA' }) === 'TEXTO DA EMPRESA');
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


// ---------------------------------------------------------------------------
// FASE BL — O LIMITE VALIA SÓ NO NAVEGADOR, E MEDIA A STRING ERRADA
//
// Os dois checks acima ("a tela barra o envio antes de transmitir") continuam
// certos e continuam insuficientes: eles olham para public/, e public/ só vale
// para quem passa pelo navegador. O preço de escapar é o que o cabeçalho deste
// arquivo descreve — rejeição DEPOIS de transmitir, com a numeração consumida.
//
// E havia um erro pior, que nem pelo navegador era pego: em homologação o
// builder ACRESCENTA ao rodapé o aviso obrigatório de teste com o nome do
// destinatário real, 75 a 123 caracteres que a tela não conta.
//
// Medido contra a API, com estabelecimento em homologação:
//   texto de 5000 (a tela aprova) -> payload com 5081 -> a SEFAZ rejeitaria
//   depois da correção            -> 400 antes de gravar, explicando o aviso
//   texto de 4800                 -> passa e segue para a Focus
//
// E a observação do fisco da REGRA FISCAL, que vai no campo do ITEM, não tinha
// limite em lugar nenhum: nem na textarea, nem no servidor. infAdProd é 500,
// dez vezes menos que o rodapé — e o estrago é maior, porque uma regra ruim
// rejeita TODA nota que casar com ela, não uma.
const builderSrc = ler('lib/nfePayloadBuilder.js');
const serverSrc = ler('server.js');
const { buildNfePayload, conferirLimitesDeTexto } = require(path.join(RAIZ, 'lib/nfePayloadBuilder'));

console.log('\n--- o limite também vale fora do navegador ---');
check('o catálogo conhece o limite do ITEM', T.LIMITE_INFADPROD === 500);
check('  e sabe medi-lo', T.excedeLimiteDoItem('y'.repeat(501)) && !T.excedeLimiteDoItem('y'.repeat(500)));
// Um número só. Dois faria a tela dizer "cabe" para o que o servidor recusa.
check('o builder usa o MESMO catálogo da tela',
  /require\('\.\.\/public\/modules\/shared\/nfe_texto_padrao'\)/.test(builderSrc));

// Payload mínimo, montado pelo builder de verdade: é a string final que importa.
const cenario = (informacoesAdicionais, observacaoFisco) => buildNfePayload({
  estabelecimento: {
    cnpj: '12345678000199', razaoSocial: 'X', uf: 'SC', municipio: 'Fpolis',
    codigoMunicipio: '4205407', logradouro: 'R', numero: '1', bairro: 'C',
    cep: '88000000', inscricaoEstadual: 'ISENTO'
  },
  empresa: { crt: 1, regimeTributario: 'SIMPLES_NACIONAL' },
  destinatario: { nome: 'Cliente Teste Ltda', documento: '11122233344', uf: 'SP', contribuinte: false },
  itens: [{
    codigoProduto: 'P1', descricao: 'Produto Um', ncm: '73181500', quantidade: 1,
    valorUnitario: 100, regraFiscal: { cfop: '6102', observacaoFisco }
  }],
  naturezaOperacao: 'Venda', ambiente: 'homologacao', informacoesAdicionais
});

const noLimite = 'x'.repeat(T.LIMITE_INFCPL);
const payloadNoLimite = cenario(noLimite, 'ok');
check('em homologação o rodapé cresce depois de a tela contar',
  String(payloadNoLimite.informacoes_adicionais_contribuinte).length > noLimite.length,
  `${noLimite.length} digitados -> ${String(payloadNoLimite.informacoes_adicionais_contribuinte).length} no payload`);
const erroRodape = conferirLimitesDeTexto(payloadNoLimite, { informacoesAdicionais: noLimite });
check('  e a conferência pega isso', Boolean(erroRodape));
// Mandar encurtar um texto que sozinho cabe deixaria o operador cortando
// conteúdo sem entender por quê.
check('  dizendo que a culpa é do aviso de teste, e não do texto',
  /aviso de teste/.test(erroRodape));
check('texto que cabe com o aviso junto passa',
  conferirLimitesDeTexto(cenario('x'.repeat(4800), 'ok'), { informacoesAdicionais: 'x'.repeat(4800) }) === '');

console.log('\n--- a observação do fisco do item ---');
const erroItem = conferirLimitesDeTexto(cenario('curto', 'y'.repeat(501)), { informacoesAdicionais: 'curto' });
check('501 caracteres no item é recusado', Boolean(erroItem));
// Sem o nome do item ninguém acha de onde saiu: o texto não foi digitado na
// tela de emissão, veio da regra que casou com o produto.
check('  nomeando o item', /Produto Um/.test(erroItem));
check('  e dizendo onde corrigir', /regra fiscal/.test(erroItem));
check('500 passa', conferirLimitesDeTexto(cenario('curto', 'y'.repeat(500)), { informacoesAdicionais: 'curto' }) === '');

console.log('\n--- o contador da tela conta o mesmo que o servidor ---');
// Era aqui que a tela mentia: contava só o que o usuário digitou e aprovava
// 5000 caracteres que chegavam à SEFAZ como 5081.
check('o orçamento desconta o aviso em homologação',
  T.orcamentoDoRodape({ ambiente: 'homologacao', destinatarioNome: 'Cliente Teste Ltda' }) < T.LIMITE_INFCPL);
check('  e em produção devolve o limite inteiro',
  T.orcamentoDoRodape({ ambiente: 'producao', destinatarioNome: 'Cliente Teste Ltda' }) === T.LIMITE_INFCPL);
// O nome do destinatário entra no aviso, então o orçamento MUDA de nota para
// nota — não dá para ser uma constante.
check('  e varia com o nome do destinatário',
  T.orcamentoDoRodape({ ambiente: 'homologacao', destinatarioNome: 'A' })
  > T.orcamentoDoRodape({ ambiente: 'homologacao', destinatarioNome: 'A'.repeat(60) }));
// Nome absurdo zera o campo em vez de devolver um limite negativo.
check('  e nunca fica negativo',
  T.orcamentoDoRodape({ ambiente: 'homologacao', destinatarioNome: 'x'.repeat(9000) }) === 0);

// A prova que fecha o círculo: um texto exatamente no orçamento produz um
// payload exatamente no limite, e um caractere a mais estoura.
const orcamentoAqui = T.orcamentoDoRodape({ ambiente: 'homologacao', destinatarioNome: 'Cliente Teste Ltda' });
check('texto no orçamento chega à SEFAZ exatamente no limite',
  String(cenario('x'.repeat(orcamentoAqui), 'ok').informacoes_adicionais_contribuinte).length === T.LIMITE_INFCPL,
  `${orcamentoAqui} digitados`);
check('  e um caractere a mais já estoura',
  String(cenario('x'.repeat(orcamentoAqui + 1), 'ok').informacoes_adicionais_contribuinte).length === T.LIMITE_INFCPL + 1);

check('o builder e a tela usam o MESMO aviso', /textoNfe\.avisoDeHomologacao\(destinatario\.nome\)/.test(builderSrc));
check('  e o mesmo separador', /\.join\(textoNfe\.SEPARADOR_RODAPE\)/.test(builderSrc));
// A trava do servidor rebaixa produção para homologação. Contar pelo valor
// salvo no estabelecimento daria orçamento cheio numa nota que leva o aviso.
check('a tela pergunta o ambiente EFETIVO, não o salvo',
  /if \(travadoEmHomologacao\) return 'homologacao';/.test(telaSrc));
check('  e recebe a trava do servidor', /travadoEmHomologacao = Boolean\(res\.travadoEmHomologacao\)/.test(telaSrc));
// Sem este ouvinte o contador só acertaria depois de voltar à aba de
// Observações e digitar alguma coisa.
check('digitar o destinatário recalcula o contador',
  /\[name="destNome"\]'\)\?\.addEventListener\('input', atualizarAvisosObs\)/.test(telaSrc));
check('  e o contador explica por que o número é menor',
  /em homologação o aviso de teste ocupa o resto/.test(telaSrc));

console.log('\n--- onde as guardas ficam ---');
// Passar do ponto da emissão consome numeração; nota rejeitada por texto longo
// não se conserta, porque a numeração já foi.
const posConfere = serverSrc.indexOf('const textoLongo = conferirLimitesDeTexto(payload');
const posRascunho = serverSrc.indexOf('let nfe = await fiscalDb.createNfeRascunho(');
check('a emissão confere ANTES de gravar o rascunho',
  posConfere > 0 && posRascunho > posConfere);
// Barrar só na emissão chega tarde: a regra já está salva e vale para todo
// produto que casar com ela.
check('a regra fiscal é barrada já na gravação',
  /const textoDoFisco = conferirObservacaoDoFisco\(body\);/.test(serverSrc));
// A CHAMADA, e não o nome: a declaração da função casaria com o mesmo padrão e
// faria 2 virar 3 sem que nenhuma rota a mais estivesse protegida.
check('  nas duas rotas, criar e editar',
  (serverSrc.match(/const textoDoFisco = conferirObservacaoDoFisco\(body\);/g) || []).length === 2);
check('e a textarea da regra mostra o limite',
  /name="observacaoFisco"[^>]*maxlength="500"/.test(ler('public/modules/fiscal/subs/regras.js')));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
