#!/usr/bin/env node
// IMPORTAR AS EMPRESAS DA CONTA FOCUS (fase CH).
//
// Esta funcionalidade abriu a PRIMEIRA exceção à trava de homologação desde que
// ela existe. Até aqui a regra era simples de verificar: nenhuma chamada sai
// para a URL de produção, ponto. Agora uma sai — e é por isso que este teste
// existe, porque "quase nenhuma" é uma regra que se afrouxa sozinha com o
// tempo se ninguém estiver medindo.
//
// O que ele protege, em ordem de estrago:
//
//   1. A exceção é ESTREITA. Só GET, só os caminhos da lista, e só quando quem
//      chama pede explicitamente. Emitir em produção com a trava ligada
//      continua sendo recusado — se este teste passar a falhar aqui, uma nota
//      pode sair com valor fiscal sem ninguém ter decidido isso.
//
//   2. O TOKEN NÃO CHEGA AO NAVEGADOR. A resposta de /v2/empresas traz o token
//      de produção de cada CNPJ da conta. Se ele vazar para a tela, "quem abre
//      Configurações" vira "quem emite por qualquer um dos 10 CNPJs".
//
//   3. Os NOMES DE CAMPO da Focus, que foram lidos da resposta real e não
//      inferidos. Errar um aqui não estoura: produz tela em branco, ou pior,
//      uma coluna "certificado" vazia que parece "sem certificado".
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// Mesmo arranjo de test-chave-mestra-focus.js: lib/focusnfe.js faz require do
// banco DENTRO das funções, então dá para trocá-lo por um dublê e rodar tudo
// isto sem Postgres nenhum.
function dublar(caminho, exports) {
  const resolvido = require.resolve(caminho);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, children: [], paths: [], exports };
  return resolvido;
}

const TOKEN_MESTRA = 'mestra0000000000000000000000000z';
const TOKEN_PROD_A = 'producaoA00000000000000000000001';
const TOKEN_HOMOL_A = 'homologacaoA000000000000000000001';

const banco = { chaveMestra: TOKEN_MESTRA };

dublar('../lib/db/integracoes', {
  getChaveMestra: async (ambiente) => (banco.chaveMestra ? { token: banco.chaveMestra, ambiente } : null),
  getTokenDaEmpresa: async () => null
});
dublar('../lib/db/fiscal', {
  getEstabelecimentoFocusCredentials: async () => null,
  getEstabelecimentoById: async () => null
});

// A trava LIGADA é o cenário que importa: é nele que a exceção tem de valer
// para a leitura e continuar valendo para a emissão.
delete process.env.FOCUS_NFE_SOMENTE_HOMOLOGACAO;
const focus = require('../lib/focusnfe');

// A resposta real da Focus, recortada. Os nomes vieram de uma chamada de
// verdade a GET /v2/empresas em 16/09/2026 — não são palpite.
const RESPOSTA_DA_FOCUS = [
  {
    id: 1,
    nome: 'SAL INFINITY PLUS COMERCIO LTDA',
    nome_fantasia: 'MATRIZ',
    cnpj: '43792899000135',
    inscricao_estadual: '261345958',
    inscricao_municipal: '12345',
    email: 'contato@exemplo.com.br',
    telefone: '(47) 3204-3738',
    logradouro: 'Rua Reinoldo Rau',
    numero: '696',
    complemento: '',
    bairro: 'Centro',
    cep: '89251-600',
    codigo_municipio: '4208906',
    municipio: 'Jaraguá do Sul',
    uf: 'SC',
    regime_tributario: 3,
    habilita_nfe: true,
    habilita_nfce: true,
    serie_nfe_producao: 1,
    proximo_numero_nfe_producao: 1,
    serie_nfe_homologacao: 1,
    proximo_numero_nfe_homologacao: 5,
    certificado_cnpj: '43792899001026',
    certificado_valido_ate: '2027-07-09T10:13:00-03:00',
    data_ultima_emissao: '2026-08-22T09:59:40-03:00',
    token_producao: TOKEN_PROD_A,
    token_homologacao: TOKEN_HOMOL_A
  },
  {
    // A filial sem certificado. Existe no teste porque é o caso que a tela
    // precisa mostrar em vermelho: ela não emite, e nada na resposta grita.
    id: 2,
    nome: 'SAL INFINITY PLUS COMERCIO LTDA',
    nome_fantasia: 'JOINVILLE - IRIRIU',
    cnpj: '43792899000992',
    municipio: 'Joinville',
    uf: 'SC',
    habilita_nfe: true,
    certificado_cnpj: '',
    certificado_valido_ate: null,
    data_ultima_emissao: null,
    token_producao: 'producaoB00000000000000000000002',
    token_homologacao: ''
  }
];

// Captura para onde as chamadas foram, sem rede.
let chamadas = [];
function fingirFocus(resposta = RESPOSTA_DA_FOCUS, status = 200) {
  chamadas = [];
  global.fetch = async (url, options = {}) => {
    chamadas.push({ url: String(url), method: options.method || 'GET' });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(resposta)
    };
  };
}

console.log('--- a exceção é estreita: só GET, e só os caminhos da lista ---');
check('GET /empresas é leitura de conta', focus.ehLeituraDeContaPermitida('GET', '/empresas') === true);
check('GET /empresas?x=1 também (a query não muda o caminho)', focus.ehLeituraDeContaPermitida('GET', '/empresas?nsu=0') === true);
check('POST /empresas NÃO é', focus.ehLeituraDeContaPermitida('POST', '/empresas') === false);
check('DELETE /empresas NÃO é', focus.ehLeituraDeContaPermitida('DELETE', '/empresas') === false);
check('GET /nfe/123 NÃO é (emitir/consultar nota nunca entra)', focus.ehLeituraDeContaPermitida('GET', '/nfe/123') === false);
check('GET /hooks NÃO é (não está na lista)', focus.ehLeituraDeContaPermitida('GET', '/hooks') === false);
check('caminho vazio NÃO é', focus.ehLeituraDeContaPermitida('GET', '') === false);

(async () => {
  console.log('\n--- com a trava LIGADA, a leitura de conta vai para produção ---');
  fingirFocus();
  const empresas = await focus.listarEmpresasDaConta();
  check('a trava está ligada neste teste', focus.somenteHomologacao() === true);
  check('foi uma chamada só', chamadas.length === 1, String(chamadas.length));
  check('foi para a URL de PRODUÇÃO', chamadas[0] && chamadas[0].url === 'https://api.focusnfe.com.br/v2/empresas', chamadas[0] && chamadas[0].url);
  check('e foi um GET', chamadas[0] && chamadas[0].method === 'GET');

  console.log('\n--- ...e a emissão continua recusada, que é o ponto ---');
  let erroEmissao = null;
  try {
    await focus.emitirNfe('ref-1', { natureza_operacao: 'Venda' }, { token: TOKEN_PROD_A, ambiente: 'producao' });
  } catch (erro) {
    erroEmissao = erro;
  }
  check('emitir em produção com a trava ligada estoura', Boolean(erroEmissao));
  check('e estoura com 409 (configuração), não 403 (autenticação)', erroEmissao && erroEmissao.status === 409, erroEmissao && String(erroEmissao.status));
  check('a emissão não chegou a sair da máquina', chamadas.length === 1, String(chamadas.length));

  let erroDownload = null;
  try {
    await focus.baixarArquivo('/arquivos/nota.xml', { token: TOKEN_PROD_A, ambiente: 'producao' });
  } catch (erro) {
    erroDownload = erro;
  }
  check('baixar XML em produção continua barrado (o caminho lateral de sempre)', erroDownload && erroDownload.status === 409);

  console.log('\n--- o token NÃO sai na listagem da tela ---');
  const serializado = JSON.stringify(empresas);
  check('nenhum token de produção no que a tela recebe', !serializado.includes(TOKEN_PROD_A));
  check('nenhum token de homologação também', !serializado.includes(TOKEN_HOMOL_A));
  check('nenhuma chave chamada token_*', !/token_producao|token_homologacao/.test(serializado));
  check('mas a tela sabe QUE existe token', empresas[0].temTokenProducao === true && empresas[0].temTokenHomologacao === true);
  check('e sabe quando não existe', empresas[1].temTokenHomologacao === false);

  console.log('\n--- os nomes de campo da Focus, lidos da resposta real ---');
  const matriz = empresas[0];
  check('cnpj', matriz.cnpj === '43792899000135', matriz.cnpj);
  check('nome_fantasia', matriz.nomeFantasia === 'MATRIZ');
  check('inscricao_estadual', matriz.inscricaoEstadual === '261345958');
  check('regime_tributario', matriz.regimeTributario === 3);
  check('serie_nfe_producao', matriz.serieNfeProducao === 1);
  check('proximo_numero_nfe_producao', matriz.proximoNumeroNfeProducao === 1, String(matriz.proximoNumeroNfeProducao));
  check('proximo_numero_nfe_homologacao', matriz.proximoNumeroNfeHomologacao === 5);
  check('certificado_valido_ate', matriz.certificadoValidoAte === '2027-07-09T10:13:00-03:00');
  check('data_ultima_emissao', matriz.dataUltimaEmissao === '2026-08-22T09:59:40-03:00');
  check('sem certificado vira vazio, não some', empresas[1].certificadoValidoAte === null);
  check('nunca emitiu vira null', empresas[1].dataUltimaEmissao === null);

  console.log('\n--- o endereço vem junto, para abrir o cadastro preenchido ---');
  check('logradouro', matriz.logradouro === 'Rua Reinoldo Rau');
  check('numero', matriz.numero === '696');
  check('bairro', matriz.bairro === 'Centro');
  check('cep (formatado na origem; quem grava normaliza)', matriz.cep === '89251-600');
  check('codigo_municipio é o IBGE, não o SIAFI', matriz.codigoMunicipio === '4208906');
  check('inscricao_municipal', matriz.inscricaoMunicipal === '12345');
  check('email', matriz.email === 'contato@exemplo.com.br');
  check('telefone', matriz.telefone === '(47) 3204-3738');
  check('endereço ausente vira vazio, nunca undefined', empresas[1].logradouro === '' && empresas[1].cep === '');

  console.log('\n--- empresa sem CNPJ de 14 dígitos não entra ---');
  fingirFocus([{ id: 9, nome: 'SEM CNPJ', cnpj: '', token_producao: 'x' }]);
  const soValidas = await focus.listarEmpresasDaConta();
  check('descartada', soValidas.length === 0, String(soValidas.length));

  console.log('\n--- tokensDaConta: o caminho interno, esse SIM devolve o token ---');
  fingirFocus();
  const tokens = await focus.tokensDaConta();
  check('mapa por CNPJ', tokens.get('43792899000135').producao === TOKEN_PROD_A);
  check('homologação junto', tokens.get('43792899000135').homologacao === TOKEN_HOMOL_A);
  check('token ausente vira string vazia, não undefined', tokens.get('43792899000992').homologacao === '');

  console.log('\n--- sem chave mestra de produção, a mensagem diz o que fazer ---');
  banco.chaveMestra = null;
  let erroSemChave = null;
  try {
    await focus.listarEmpresasDaConta();
  } catch (erro) {
    erroSemChave = erro;
  }
  banco.chaveMestra = TOKEN_MESTRA;
  check('estoura', Boolean(erroSemChave));
  check('com 501 (falta configurar), não 500', erroSemChave && erroSemChave.status === 501);
  check('e a mensagem cita a chave mestra de produção', erroSemChave && /chave mestra de PRODUÇÃO/i.test(erroSemChave.message));

  console.log('\n--- o que o servidor expõe ---');
  const serverSrc = ler('server.js');
  check('a rota de listar existe',
    /pathname\.endsWith\('\/empresas'\) && req\.method === 'GET'/.test(serverSrc));
  check('a rota de importar existe',
    /pathname\.endsWith\('\/importar-tokens'\) && req\.method === 'POST'/.test(serverSrc));
  check('as duas exigem administrador',
    (serverSrc.match(/endsWith\('\/empresas'\) && req\.method === 'GET'\)[\s\S]{0,320}?ehAdmin/g) || []).length === 1);
  check('a importação usa tokensDaConta (uso interno), não a listagem da tela',
    /focusNfe\.tokensDaConta\(\)/.test(serverSrc));
  check('a auditoria grava os CNPJs, nunca o token',
    /details: \{ ambiente, importados: importados\.map\(\(i\) => i\.cnpj\)/.test(serverSrc));

  const telaSrc = ler('public/modules/settings/subs/fiscal.js');

  console.log('\n--- a ordem sai do próprio CNPJ (dígitos 9 a 12) ---');
  // A tela é arquivo de navegador; roda aqui com um window de mentira, e as
  // duas funções puras saem pelo return. Melhor do que conferir por regex: o
  // que se quer saber é o que elas RESPONDEM, não como foram escritas.
  const daTela = new Function('window', `${telaSrc}\nreturn { fiscalOrdemDoCnpj, fiscalTipoPelaOrdem };`)({ MavisSubscreenRegistry: {} });
  check('matriz', daTela.fiscalOrdemDoCnpj('43792899000135') === '0001');
  check('primeira filial', daTela.fiscalOrdemDoCnpj('43792899000216') === '0002');
  check('a do CNPJ maior', daTela.fiscalOrdemDoCnpj('43792899001026') === '0010');
  check('CNPJ formatado também', daTela.fiscalOrdemDoCnpj('43.792.899/0002-16') === '0002');
  check('CNPJ incompleto não inventa ordem', daTela.fiscalOrdemDoCnpj('4379289') === '');
  check('0001 sugere MATRIZ', daTela.fiscalTipoPelaOrdem('0001') === 'MATRIZ');
  check('o resto sugere FILIAL', daTela.fiscalTipoPelaOrdem('0010') === 'FILIAL');

  console.log('\n--- cadastrar a partir da linha da Focus ---');
  check('o botão existe nas linhas sem estabelecimento', /fiscal-cadastrar-da-focus/.test(telaSrc));
  check('o CNAE fica vazio (a Focus não devolve, e chutar seria inventar a atividade)',
    /cnaePrincipal: '',/.test(telaSrc));
  check('NFC-e não é herdada da Focus (o sistema não emite NFC-e)',
    /emiteNfce: false/.test(telaSrc));
  check('sem empresa da raiz, recusa em vez de abrir formulário que vai falhar',
    /Cadastre primeiro a empresa da raiz/.test(telaSrc));

  check('a tela manda CNPJ para importar, não token',
    /cnpjs: alvos\.map\(\(e\) => e\.cnpj\)/.test(telaSrc));
  check('a tela avisa que importar produção muda o ambiente',
    /muda o ambiente desses estabelecimentos para Produção/.test(telaSrc));
  check('e avisa quando a trava está desligada',
    /a próxima nota emitida por eles vale de verdade/.test(telaSrc));

  const fiscalDbSrc = ler('lib/db/fiscal.js');
  check('salvarTokenFocusDoEstabelecimento grava só as três colunas do token',
    /focus_token_cifrado: encryptToBytea\(assertTokenValido\(token\)\),\n\s*focus_ambiente: amb,\n\s*focus_cadastrado_em/.test(fiscalDbSrc));
  check('e não passa por buildEstabelecimentoFields (que apagaria o cadastro)',
    !/salvarTokenFocusDoEstabelecimento[\s\S]{0,400}buildEstabelecimentoFields/.test(fiscalDbSrc));

  console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})().catch((erro) => {
  console.error('O teste quebrou:', erro);
  process.exit(1);
});
