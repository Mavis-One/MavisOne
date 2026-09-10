#!/usr/bin/env node
/**
 * PRÉ-CHECK FISCAL DOS PEDIDOS DO DIA (fase BY, OBS-21).
 *
 * A PERGUNTA QUE ELE RESPONDE
 * ---------------------------
 * "Quais dos pedidos de hoje seriam recusados se eu transmitisse agora?"
 *
 * Sem ele a resposta só existe uma nota por vez, DEPOIS de transmitir — e nota
 * rejeitada consumiu numeração, que não volta. Na observação do ViperERP de
 * 08/09/2026 o operador descobriu um defeito de CADASTRO assim: emitiu, foi
 * recusado com "Falha no Schema XML (Cod: 225)", corrigiu a nota à mão, emitiu
 * a seguinte, e foi recusado igual. O erro era o mesmo nas duas porque a origem
 * era uma só.
 *
 * O QUE ESTE TESTE PROTEGE — E É UMA COISA SÓ
 * -------------------------------------------
 * QUE NÃO EXISTAM DUAS LISTAS DE CONFERÊNCIA.
 *
 * A tentação, ao escrever um pré-check, é fazer uma segunda lista mais curta
 * "só para a tela". As duas convergem enquanto ninguém mexe e divergem no dia
 * em que uma regra nova entra só na emissão. A partir daí o pré-check diz
 * "tudo certo" para notas que a SEFAZ recusa — o que é PIOR do que não ter
 * pré-check, porque agora alguém confia nele.
 *
 * Por isso a validação virou `prepararNfeParaTransmitir`, e os dois caminhos a
 * chamam. Este teste falha se alguém separar os dois de novo.
 *
 * Provado contra a API, num banco de prova, com cinco pedidos do mesmo dia:
 *   1001 tudo certo ................................ PASSA
 *   1002 cliente legado sem endereço ............... RECUSA (enderDest)
 *   1003 produto sem NCM ........................... RECUSA (classificação)
 *   1004 cartão integrado sem NSU .................. RECUSA (a 225 do Viper)
 *   1005 outro pedido do MESMO cliente sem endereço  RECUSA (agrupado com 1002)
 *
 *   notas gravadas pelo pré-check .................. 0
 *   mensagem do pré-check x mensagem da emissão .... idênticas
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

const src = ler('server.js');

console.log('--- 1. a conferência é UMA SÓ ---');
check('a validação virou função própria', /async function prepararNfeParaTransmitir\(body\) \{/.test(src));
// Se a emissão voltar a validar por conta própria, o pré-check passa a conferir
// outra coisa — e é exatamente isso que este teste existe para impedir.
check('a emissão a chama', /\} = await prepararNfeParaTransmitir\(body\);/.test(src));
check('o pré-check chama a MESMA', /await prepararNfeParaTransmitir\(corpo\);/.test(src));

// A prova de que ela não grava: tudo o que escreve ficou do outro lado do corte.
const preparar = src.slice(src.indexOf('async function prepararNfeParaTransmitir'), src.indexOf('async function emitirNfeFiscal'));
for (const escrita of ['createNfeRascunho', 'saveData(', 'updateOrder', 'focusNfe.emitir']) {
  check(`  e não grava (${escrita})`, !preparar.includes(escrita));
}
// Rodar sobre trinta pedidos não pode custar numeração nem chamada de rede.
// `focusNfe.ambienteEfetivo` fica de fora da lista de propósito: é conta local
// sobre o estabelecimento e a trava de homologação, não ida à Focus — e é o
// que decide se o nome do destinatário vai ser o texto de teste, então precisa
// rodar aqui para o payload conferido ser o mesmo que seria transmitido.
for (const rede of ['focusNfe.emitir', 'focusNfe.consultar', 'focusNfe.cancelar', 'focusNfe.enviar']) {
  check(`  nem fala com a Focus (${rede})`, !preparar.includes(rede));
}

console.log('--- 2. a nota do pedido é montada NO SERVIDOR ---');
// A tradução pedido -> NF-e vivia inteira no navegador (state.nfeFromOrder). Só
// funcionava por aquela tela: nada mais no sistema conseguia perguntar "que
// nota este pedido geraria?".
check('a montagem existe', /function montarNfeDoPedido\(pedido, estabelecimentoId, data\)/.test(src));
const montar = src.slice(src.indexOf('function montarNfeDoPedido'), src.indexOf('async function prepararNfeParaTransmitir'));
check('  com o destinatário do cadastro', /const pessoa = \(data\.people \|\| \[\]\)\.concat\(data\.cnpjs \|\| \[\]\)/.test(montar));
// NCM, CEST e origem vêm do cadastro do produto, no servidor: mandar palpite
// faria duas notas do mesmo produto sairem com classificações diferentes.
check('  sem palpitar a classificação fiscal', !/ncm:/.test(montar));
check('  com as linhas de pagamento do pedido', /formaPagamento\.codigoNfe\(forma \? forma\.type : ''\)/.test(montar));
check('  e o grupo do cartão quando é cartão', /formaPagamento\.ehCartao\(forma\.type\)/.test(montar));
// Fase BQ: desconto, frete cobrado e despesas também são a nota.
check('  com desconto, frete e despesas', /desconto: totais\.descontoTotal \|\| 0,/.test(montar));

console.log('--- 3. as chaves de endereço do cadastro não são uniformes ---');
// Dois formulários cresceram sobre a mesma tabela (`people.extra` é jsonb): um
// grava street/number/district, o outro address/addressNumber/neighborhood.
// Ler as variantes num lugar só é o que evita a terceira.
check('existe um leitor único de endereço', /function enderecoDaPessoa\(pessoa\)/.test(src));
const endereco = src.slice(src.indexOf('function enderecoDaPessoa'), src.indexOf('function montarNfeDoPedido'));
check('  que aceita street e address', /primeiro\(p\.street, p\.address, p\.logradouro\)/.test(endereco));
check('  number e addressNumber', /primeiro\(p\.number, p\.addressNumber, p\.numero\)/.test(endereco));
check('  district e neighborhood', /primeiro\(p\.district, p\.neighborhood, p\.bairro\)/.test(endereco));

console.log('--- 4. o endereço do destinatário passou a ser conferido ---');
const builder = ler('lib/nfePayloadBuilder.js');
// A emissão só conferia nome, documento e UF. O resto do grupo enderDest ia em
// branco para a SEFAZ e voltava rejeitado — e o CEP nem é `required` no
// formulário de emissão, então a nota avulsa sem CEP passava direto.
check('a conferência existe', /function conferirDestinatarioDaNota\(payload\)/.test(builder));
check('  e cobra o grupo enderDest', /enderDest/.test(builder));
check('a emissão a usa', /const enderecoIncompleto = conferirDestinatarioDaNota\(payload\);/.test(src));
const { conferirDestinatarioDaNota } = require('../lib/nfePayloadBuilder');
const completo = {
  logradouro_destinatario: 'Rua A', bairro_destinatario: 'Centro',
  municipio_destinatario: 'Blumenau', uf_destinatario: 'SC', cep_destinatario: '89000000'
};
check('endereço completo passa', conferirDestinatarioDaNota(completo) === '');
check('sem CEP é recusado', conferirDestinatarioDaNota({ ...completo, cep_destinatario: '' }).includes('o CEP'));
check('sem bairro é recusado', conferirDestinatarioDaNota({ ...completo, bairro_destinatario: '' }).includes('o bairro'));
check('  e a mensagem lista TUDO o que falta',
  conferirDestinatarioDaNota({ ...completo, bairro_destinatario: '', cep_destinatario: '' })
    .includes('o bairro, o CEP'));
// O montador já preenche 'S/N', que é o valor previsto no layout para endereço
// sem número: exigi-lo recusaria uma nota que a SEFAZ aceita.
check('o NÚMERO não é exigido (o montador põe S/N)',
  conferirDestinatarioDaNota({ ...completo, numero_destinatario: '' }) === '');

console.log('--- 5. a rota ---');
check('a rota existe', /if \(pathname === '\/api\/fiscal\/pre-check' && req\.method === 'GET'\)/.test(src));
// LEITURA pede 'visualizar' e não 'emitir': quem confere de manhã não precisa
// poder transmitir. Exigir 'emitir' faria a conferência só existir para quem já
// pode errar caro.
check('  pedindo permissão de LEITURA', /if \(pathname === '\/api\/fiscal\/pre-check'\) return 'visualizar';/.test(src));
const rota = src.slice(src.indexOf("if (pathname === '/api/fiscal/pre-check'"));
const corpoRota = rota.slice(0, rota.indexOf("if (pathname === '/api/fiscal/nfe' && req.method === 'GET')"));
check('  exigindo o estabelecimento', /Escolha o estabelecimento que vai emitir\./.test(corpoRota));
// Orçamento, pedido já faturado e cancelado não vão virar nota: conferi-los
// enche a lista de ruído e esconde o que importa.
check('  só sobre quem ainda vai virar nota',
  /salesStatus\.podeTransicionar\(p\.status, 'pedido-faturado'\)/.test(corpoRota));
check('  e devolve a mensagem INTEIRA da emissão', /problema: erro\.message \|\| 'Erro desconhecido\.'/.test(corpoRota));
// Resumir aqui criaria um texto que não existe em lugar nenhum e que ninguém
// consegue procurar.
check('  sem resumir', !/\.slice\(0, \d+\)/.test(corpoRota.slice(corpoRota.indexOf('problema:'))));
// `orders.customer` tem DEFAULT '-' no banco, e '-' é truthy: usá-lo como
// primeira opção curto-circuitava o fallback e a coluna saía com um tracinho.
check('o cliente vem do cadastro, não do campo com default "-"',
  /cliente: cadastrosCore\.directoryName\(dados, pedido\.clientSupplierId\)/.test(corpoRota));

console.log('--- 6. a tela ---');
const tela = ler('public/modules/fiscal/subs/pre_check.js');
check('a tela está registrada', /MavisSubscreenRegistry\.fiscal\.pre_check = desenhar;/.test(tela));
check('entra no index.html', ler('public/index.html').includes('modules/fiscal/subs/pre_check.js'));
check('e no menu do Fiscal', /key: 'pre_check'/.test(ler('public/app.js')));
// Numa tela de conferência o que interessa é a exceção: obrigar a rolar até
// achar o vermelho é esconder a resposta.
check('os problemas aparecem primeiro',
  /const ordenados = comProblema\.concat\(pedidos\.filter\(\(p\) => p\.ok\)\);/.test(tela));
// Erro repetido quase nunca é N pedidos ruins: é um cadastro errado, uma vez.
check('o mesmo erro em vários pedidos é agrupado', /const repetidos = \[\.\.\.porProblema\.entries\(\)\]/.test(tela));
// A tela não pode saber nenhuma regra fiscal — se soubesse, seria a segunda
// lista que este teste inteiro existe para impedir.
for (const regra of ['NCM', 'tpIntegra', 'CFOP', 'cnpj']) {
  check(`  e a tela não conhece a regra "${regra}"`, !new RegExp(regra).test(tela.replace(/^\s*\/\/.*$/gm, '')));
}

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
