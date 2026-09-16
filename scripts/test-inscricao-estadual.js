#!/usr/bin/env node
/**
 * A INSCRIÇÃO ESTADUAL NO ATALHO DE NOVO CLIENTE — E O QUE "ISENTO" SIGNIFICA.
 *
 * O PEDIDO (15/09/2026): o atalho Novo Cliente, do botão Atalhos da barra, não
 * pedia a I.E.; passou a pedir, obrigatória.
 *
 * O QUE ISSO PUXA ATRÁS
 * ---------------------
 * O sistema decidia "contribuinte de ICMS" em três lugares — pré-checagem
 * fiscal do pedido, montagem da NF-e a partir do pedido e tela de emissão — e
 * nos três a regra era `Boolean(stateRegistration)`: qualquer coisa escrita no
 * campo virava contribuinte. Com a I.E. opcional isso não mordia: quem não
 * tinha deixava em branco. Obrigatória, quem não tem escreve ISENTO — e a
 * regra antiga mandaria a nota com indicador 1 e IE "ISENTO", rejeição da
 * SEFAZ na transmissão, longe do cadastro que a causou.
 *
 * A regra virou um módulo só, public/modules/shared/inscricao_estadual.js,
 * carregado pelo navegador e requerido pelo servidor. Este teste cobra:
 *
 *   1. a regra em si;
 *   2. que o atalho pede o campo, obrigatório, e valida/normaliza por ela;
 *   3. que os três pontos fiscais decidem por ela, e não sobrou Boolean();
 *   4. que o payload nunca leva IE de quem não é contribuinte;
 *   5. que o navegador carrega o módulo antes de quem o usa.
 *
 * MEDIDO no banco local antes de mudar: 6.492 pessoas, 552 com I.E., todas
 * pessoa jurídica e todas só dígitos, nenhuma "ISENTO". Para todas elas a
 * regra nova devolve o mesmo que a antiga.
 *
 * PROVADO num servidor de rascunho (clone do banco, porta 3998):
 *   - por HTTP, com o payload exato do atalho: pessoa física com ISENTO
 *     gravou e voltou na leitura (código 6493); jurídica com IE numérica
 *     idem (código 6494);
 *   - pelo Chrome, no atalho de verdade: "abc" foi recusado ao lado do campo,
 *     só espaço foi recusado ("Informe Inscrição Estadual (I.E.)."), e
 *     "isento" minúsculo fechou a janela e gravou "ISENTO" (código 6495).
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
const { semComentarios } = require('./sem-comentarios');
const ie = require('../public/modules/shared/inscricao_estadual');
const { buildNfePayload } = require('../lib/nfePayloadBuilder');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log('--- 1. a regra ---');
for (const [entrada, normal, contribuinte, nota] of [
  ['', '', false, undefined],
  [null, '', false, undefined],
  ['isento', 'ISENTO', false, undefined],
  ['  Isento ', 'ISENTO', false, undefined],
  ['ISENTO', 'ISENTO', false, undefined],
  ['251.234.567', '251234567', true, '251234567'],
  ['251234567', '251234567', true, '251234567'],
  ['0620080420337', '0620080420337', true, '0620080420337']
]) {
  check(`normalizar(${JSON.stringify(entrada)}) = ${JSON.stringify(normal)}`, ie.normalizar(entrada) === normal, JSON.stringify(ie.normalizar(entrada)));
  check(`  contribuinte: ${contribuinte}`, ie.ehContribuinte(entrada) === contribuinte);
  check(`  paraNota: ${JSON.stringify(nota)}`, ie.paraNota(entrada) === nota, JSON.stringify(ie.paraNota(entrada)));
}
check('valida aceita ISENTO', ie.valida('isento'));
check('valida aceita de 2 a 14 dígitos', ie.valida('12') && ie.valida('12345678901234'));
check('valida recusa vazio, letras, 1 dígito e 15 dígitos',
  !ie.valida('') && !ie.valida('abc') && !ie.valida('1') && !ie.valida('123456789012345'));
// paraNota é o que o XML recebe: só o que o tipo TIe aceita. "1" conta como
// contribuinte (tem algo, não é ISENTO) mas não pode ir na nota.
check('paraNota recusa 1 dígito e 15 dígitos, mesmo sendo "contribuinte"',
  ie.ehContribuinte('1') && ie.paraNota('1') === undefined && ie.paraNota('123456789012345') === undefined);

console.log('\n--- 1b. contribuinte sem IE válida não vira nota ---');
// A direção inversa do que a seção 4 prova: marcar "Contribuinte" e deixar a
// IE em branco (a consulta de CNPJ faz isso de propósito) dava indicador 1
// sem tag IE — rejeição da SEFAZ depois de transmitir.
for (const [caso, destinatario, recusa] of [
  ['não contribuinte, sem IE', { contribuinte: false, inscricaoEstadual: '' }, false],
  ['não contribuinte, ISENTO', { contribuinte: false, inscricaoEstadual: 'ISENTO' }, false],
  ['contribuinte com IE de 9 dígitos', { contribuinte: true, inscricaoEstadual: '251.234.567' }, false],
  ['contribuinte com IE em branco', { contribuinte: true, inscricaoEstadual: '' }, true],
  ['contribuinte com ISENTO', { contribuinte: true, inscricaoEstadual: 'ISENTO' }, true],
  ['contribuinte com letras', { contribuinte: true, inscricaoEstadual: 'abc' }, true],
  ['contribuinte com 1 dígito', { contribuinte: true, inscricaoEstadual: '1' }, true],
  ['destinatário ausente', null, false]
]) {
  const motivo = ie.motivoParaRecusar(destinatario);
  check(`${caso}: ${recusa ? 'recusa' : 'passa'}`, Boolean(motivo) === recusa, motivo || '(sem motivo)');
}
check('o motivo diz o que fazer', /desmarque "Contribuinte de ICMS"/.test(ie.motivoParaRecusar({ contribuinte: true, inscricaoEstadual: '' })));

console.log('\n--- 2. o atalho de Novo Cliente ---');
// Carrega os módulos num window falso, como test-atalhos.js: as IIFEs só
// tocam o DOM na hora de desenhar. O módulo da I.E. entra pelo MESMO caminho
// do navegador (<script>, sem `module`): é a exportação para o window que o
// atalho e a emissão usam, e o `require` lá em cima não a prova.
global.window = {};
(0, eval)(ler('public/modules/shared/inscricao_estadual.js'));
(0, eval)(ler('public/modules/shared/atalhos.js'));
const noNavegador = global.window.MavisInscricaoEstadual;
check('o módulo se pendura no window como MavisInscricaoEstadual', Boolean(noNavegador));
check('  e é a mesma regra do require', Boolean(noNavegador) && ['normalizar', 'ehContribuinte', 'paraNota', 'valida'].every((f) => typeof noNavegador[f] === 'function')
  && noNavegador.normalizar(' isento ') === 'ISENTO' && noNavegador.ehContribuinte('251.234.567') === true);
const A = global.window.MavisAtalhos;
const cliente = A.ATALHOS_CRIAR.find((a) => a.id === 'novo_cliente');
const fornecedor = A.ATALHOS_CRIAR.find((a) => a.id === 'novo_fornecedor');
const campoIe = cliente.campos.find((c) => c.name === 'stateRegistration');
// O pedido foi "no cadastro de clientes". O fornecedor criado à mão não
// passou a exigir a I.E.; se um dia passar, é decisão nova, e este check é o
// lugar de registrá-la.
check('o fornecedor NÃO passou a exigir a I.E.', !fornecedor.campos.some((c) => c.name === 'stateRegistration' && c.required));
check('o cliente tem o campo stateRegistration', Boolean(campoIe));
check('  obrigatório', Boolean(campoIe && campoIe.required));
check('  marcado como I.E. (ie: true), para validar e normalizar no envio', Boolean(campoIe && campoIe.ie));
check('  na primeira linha, ao lado do documento e do nome', Boolean(campoIe) && campoIe.linha === 1);
check('  o hint diz que ISENTO existe', /ISENTO/.test((campoIe && campoIe.hint) || ''));
// O nome do campo é o mesmo que a ficha completa grava: é por ele que a
// emissão lê a IE do cliente. Um nome diferente gravaria num lugar que
// ninguém lê.
check('  grava no mesmo campo que a ficha completa (stateRegistration)',
  /stateRegistration: String\(formData\.get\('stateRegistration'\)/.test(ler('public/app.js')));

const atalhosSrc = semComentarios(ler('public/modules/shared/atalhos.js'));
check('o envio valida pela regra', /const ie = window\.MavisInscricaoEstadual;[\s\S]{0,120}ie\.valida\(valor\)/.test(atalhosSrc));
check('  e normaliza antes de mandar', /valor = ie\.normalizar\(valor\)/.test(atalhosSrc));
check('  e recusa obrigatório em branco (espaço não vale)', /campo\.required && !String\(valor\)\.trim\(\)/.test(atalhosSrc));

console.log('\n--- 3. os três pontos fiscais decidem pela regra ---');
const serverSrc = semComentarios(ler('server.js'));
check('server.js requer o módulo', /require\('\.\/public\/modules\/shared\/inscricao_estadual'\)/.test(serverSrc));
const usosServidor = (serverSrc.match(/inscricaoEstadual\.ehContribuinte\(/g) || []).length;
check('  pré-checagem e montagem da NF-e usam ehContribuinte (2 pontos)', usosServidor === 2, String(usosServidor));
check('  e não sobrou Boolean(...stateRegistration) no servidor', !/Boolean\([^)]*stateRegistration/.test(serverSrc));
// A recusa de "contribuinte sem IE válida" fica no caminho ÚNICO da emissão,
// antes de montar o payload — com status 400, como as outras recusas dali.
const preparar = serverSrc.slice(serverSrc.indexOf('async function prepararNfeParaTransmitir'), serverSrc.indexOf('async function', serverSrc.indexOf('async function prepararNfeParaTransmitir') + 10));
check('  prepararNfeParaTransmitir recusa contribuinte sem IE válida, com 400',
  /const motivoIe = inscricaoEstadual\.motivoParaRecusar\(destinatario\);\s*if \(motivoIe\) \{[\s\S]{0,200}status = 400;[\s\S]{0,40}throw/.test(preparar));
const emissaoSrc = semComentarios(ler('public/modules/finance/subs/emitir_nfe_focus.js'));
check('a tela de emissão decide por ehContribuinte', /MavisInscricaoEstadual\.ehContribuinte\(/.test(emissaoSrc));
check('  e não sobrou Boolean(...stateRegistration) nela', !/Boolean\([^)]*stateRegistration/.test(emissaoSrc));
// O checkbox era desenhado sempre desmarcado: a linha que calculava
// `destinatario.contribuinte` do cadastro não chegava a ele.
check('  o checkbox "Contribuinte de ICMS" nasce do cadastro',
  /name="destContribuinte" \$\{destinatario\.contribuinte \? 'checked' : ''\}/.test(emissaoSrc));
check('  a IE do cadastro entra só de contribuinte, na carga e na troca de cliente',
  (emissaoSrc.match(/MavisInscricaoEstadual\.paraNota\(/g) || []).length === 2);
// Na troca de cliente pelo seletor o checkbox também acompanha — antes ficava
// como estava. A carga do pedido sozinha já satisfaria uma contagem de 1.
check('  e na troca de cliente o checkbox acompanha a regra',
  /\[name="destContribuinte"\]'\)\.checked = window\.MavisInscricaoEstadual\.ehContribuinte\(found\.stateRegistration\)/.test(emissaoSrc)
  && (emissaoSrc.match(/MavisInscricaoEstadual\.ehContribuinte\(/g) || []).length === 2);

console.log('\n--- 4. o payload nunca leva IE de quem não é contribuinte ---');
const ESTAB = {
  cnpj: '11222333000181', razaoSocial: 'Empresa Teste', logradouro: 'Rua A', numero: '100',
  bairro: 'Centro', municipio: 'São Paulo', uf: 'SP', cep: '01001000',
  codigoMunicipio: '3550308', inscricaoEstadual: '111222333'
};
const DEST = {
  nome: 'Cliente Teste', documento: '99888777000166', uf: 'MG', contribuinte: true,
  logradouro: 'Rua B', numero: '50', bairro: 'Centro', municipio: 'Belo Horizonte', cep: '30110000'
};
const montar = (destinatario) => buildNfePayload({
  estabelecimento: ESTAB, empresa: { crt: 3 }, destinatario,
  itens: [{ descricao: 'Produto', codigoProduto: 'SKU1', ncm: '84713012', quantidade: 1, valorUnitario: 100,
    unidadeComercial: 'UN', origem: 0, regraFiscal: { cfop: '6102', cstIcms: '00', aliquotaIcms: 18 } }],
  naturezaOperacao: 'Venda', tipoDocumento: 1, finalidadeEmissao: 1, dataEmissao: '2026-09-15T10:00:00'
});
const isento = montar({ ...DEST, documento: '12345678901', contribuinte: false, inscricaoEstadual: 'ISENTO' });
check('ISENTO com indicador 9: a IE não vai', isento.indicador_inscricao_estadual_destinatario === 9 && isento.inscricao_estadual_destinatario === undefined);
const pontuada = montar({ ...DEST, contribuinte: true, inscricaoEstadual: '251.234.567' });
check('contribuinte com IE pontuada: vai só com dígitos',
  pontuada.indicador_inscricao_estadual_destinatario === 1 && pontuada.inscricao_estadual_destinatario === '251234567', pontuada.inscricao_estadual_destinatario);
const desmarcado = montar({ ...DEST, contribuinte: false, inscricaoEstadual: '251234567' });
check('checkbox desmarcado com IE digitada: a IE não vai (antes ia, e era rejeição)', desmarcado.inscricao_estadual_destinatario === undefined);

console.log('\n--- 5. o navegador carrega o módulo antes de quem o usa ---');
const indexSrc = ler('public/index.html');
const pos = (trecho) => indexSrc.indexOf(trecho);
// indexOf devolve -1 quando o script não está lá — e -1 é "antes" de tudo.
// Cada comparação exige que os DOIS lados existam, senão a ausência do
// <script> passaria em três checks de quatro.
const antesDe = (a, b) => pos(a) > 0 && pos(b) > 0 && pos(a) < pos(b);
check('index.html carrega inscricao_estadual.js', pos('/modules/shared/inscricao_estadual.js') > 0);
check('  antes do atalhos.js', antesDe('/modules/shared/inscricao_estadual.js', '/modules/shared/atalhos.js'));
check('  antes da tela de emissão', antesDe('/modules/shared/inscricao_estadual.js', 'emitir_nfe_focus.js'));
check('  e antes do app.js', antesDe('/modules/shared/inscricao_estadual.js', '/app.js'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
