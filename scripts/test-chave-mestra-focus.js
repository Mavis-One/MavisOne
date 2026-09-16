#!/usr/bin/env node
// A CHAVE MESTRA DA FOCUS NFe (fase CF).
//
// O que este teste protege, em ordem de estrago:
//
//   1. A chave mestra NÃO pode virar um jeito novo de furar a trava de
//      homologação. Ela é o token da CONTA — mais poderosa que o
//      FOCUS_NFE_TOKEN, e igualmente incapaz de dizer à Focus de qual CNPJ é a
//      nota. Se ela emitisse em produção por um estabelecimento sem token, a
//      nota sairia com o emitente errado, e nota autorizada não tem desfazer.
//
//   2. O token não pode sair do servidor em texto. As funções de leitura
//      devolvem "está configurado", nunca o valor.
//
//   3. A ordem da fila de reserva tem que ser a específica primeiro: token da
//      empresa, depois a chave mestra, depois o .env. Invertida, um token
//      cadastrado à mão para um grupo seria ignorado sem aviso.
//
//   4. Banco sem a fase CF ainda tem que funcionar pelo .env — mas SÓ esse
//      erro pode ser engolido. Banco fora do ar ou chave de criptografia
//      trocada têm que estourar, e não virar "sem chave mestra".
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// Substitui um módulo ANTES de ele ser carregado de verdade: lib/focusnfe.js
// faz require('./db/...') dentro das funções, então dá para trocar o banco por
// um dublê e testar a fila de reserva sem Postgres nenhum.
function dublar(caminho, exports) {
  const resolvido = require.resolve(caminho);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, children: [], paths: [], exports };
  return resolvido;
}

// Estado que os dublês leem. Trocar isto entre um caso e outro é mais claro do
// que redefinir o módulo inteiro toda vez.
const banco = {
  tokenDoEstabelecimento: null,
  tokenDaEmpresa: null,
  chaveMestra: null,
  erroDaTabela: null,
  empresaId: 'empresa-1'
};

dublar('../lib/db/fiscal', {
  getEstabelecimentoFocusCredentials: async () => banco.tokenDoEstabelecimento,
  getEstabelecimentoById: async () => ({ id: 'estab-1', empresaId: banco.empresaId })
});

dublar('../lib/db/integracoes', {
  getChaveMestra: async (ambiente) => {
    if (banco.erroDaTabela) throw banco.erroDaTabela;
    return banco.chaveMestra ? { token: banco.chaveMestra, ambiente } : null;
  },
  getTokenDaEmpresa: async (empresaId, ambiente) => {
    if (banco.erroDaTabela) throw banco.erroDaTabela;
    return banco.tokenDaEmpresa ? { token: banco.tokenDaEmpresa, ambiente } : null;
  }
});

delete process.env.FOCUS_NFE_SOMENTE_HOMOLOGACAO;
const focus = require('../lib/focusnfe');

const TOKEN_ESTAB = 'estabelecimento0000000000000000a';
const TOKEN_EMPRESA = 'empresa00000000000000000000000za';
const TOKEN_MESTRA = 'mestra0000000000000000000000000z';
const TOKEN_ENV = 'doEnv00000000000000000000000000z';

function reset() {
  banco.tokenDoEstabelecimento = null;
  banco.tokenDaEmpresa = null;
  banco.chaveMestra = null;
  banco.erroDaTabela = null;
  process.env.FOCUS_NFE_TOKEN = TOKEN_ENV;
  process.env.FOCUS_NFE_SOMENTE_HOMOLOGACAO = '1';
}

// O cliente devolvido por forEstabelecimento não entrega o token; o jeito de
// saber qual foi escolhido é interceptar a chamada HTTP. Nenhuma requisição
// sai daqui: o fetch é substituído e devolve o token que recebeu.
const fetchOriginal = global.fetch;
function tokenUsado(resposta) {
  let visto = null;
  global.fetch = async (url, opcoes) => {
    const auth = String((opcoes.headers || {}).Authorization || '');
    visto = Buffer.from(auth.replace('Basic ', ''), 'base64').toString('utf8').replace(/:$/, '');
    return { ok: true, status: 200, text: async () => '{}' };
  };
  return resposta().then(() => visto).finally(() => { global.fetch = fetchOriginal; });
}

(async () => {
  console.log('--- 1. a chave mestra não fura a trava de produção ---');
  reset();
  process.env.FOCUS_NFE_SOMENTE_HOMOLOGACAO = '0';   // produção liberada
  banco.chaveMestra = TOKEN_MESTRA;
  banco.tokenDaEmpresa = TOKEN_EMPRESA;
  let erro = null;
  try {
    await focus.forEstabelecimento('estab-1');
  } catch (e) {
    erro = e;
  }
  check('estabelecimento sem token é recusado, mesmo com chave mestra cadastrada', Boolean(erro), erro && erro.status);
  check('e o erro diz que nem a chave mestra substitui o token do CNPJ',
    Boolean(erro) && /nem a chave mestra/.test(erro.message));

  console.log('\n--- 2. sob a trava, a fila de reserva vai da mais específica para a mais genérica ---');
  reset();
  banco.tokenDaEmpresa = TOKEN_EMPRESA;
  banco.chaveMestra = TOKEN_MESTRA;
  let cliente = await focus.forEstabelecimento('estab-1');
  check('token da empresa vence a chave mestra',
    (await tokenUsado(() => cliente.checkStatus())) === TOKEN_EMPRESA);

  reset();
  banco.chaveMestra = TOKEN_MESTRA;
  cliente = await focus.forEstabelecimento('estab-1');
  check('sem token da empresa, entra a chave mestra',
    (await tokenUsado(() => cliente.checkStatus())) === TOKEN_MESTRA);

  reset();
  cliente = await focus.forEstabelecimento('estab-1');
  check('sem nenhuma das duas, o .env continua valendo',
    (await tokenUsado(() => cliente.checkStatus())) === TOKEN_ENV);

  reset();
  banco.tokenDoEstabelecimento = { token: TOKEN_ESTAB, ambiente: 'homologacao' };
  banco.tokenDaEmpresa = TOKEN_EMPRESA;
  banco.chaveMestra = TOKEN_MESTRA;
  cliente = await focus.forEstabelecimento('estab-1');
  check('e o token do próprio estabelecimento vence todo o resto',
    (await tokenUsado(() => cliente.checkStatus())) === TOKEN_ESTAB);

  console.log('\n--- 3. operação de conta relata QUAL token usou ---');
  reset();
  banco.chaveMestra = TOKEN_MESTRA;
  let conta = await focus.contaCredentials('homologacao');
  check('com chave mestra, origem = chave-mestra', conta.origem === 'chave-mestra', conta.origem);
  check('e o token é o dela', conta.token === TOKEN_MESTRA);

  reset();
  conta = await focus.contaCredentials('homologacao');
  check('sem ela, cai no .env e diz isso', conta.origem === 'env', conta.origem);

  reset();
  process.env.FOCUS_NFE_TOKEN = '';
  conta = await focus.contaCredentials('homologacao');
  check('sem nada, origem = nenhuma (e não um "conectado" mentiroso)', conta.origem === 'nenhuma', conta.origem);

  // Com a trava ligada, pedir produção devolve homologação — correto, e não
  // pode ser calado: quem pediu produção e recebeu "conectado" sem aviso
  // conclui que a chave de produção está valendo.
  reset();
  banco.chaveMestra = TOKEN_MESTRA;
  conta = await focus.contaCredentials('producao');
  check('pedir produção sob a trava é relatado como rebaixamento', conta.rebaixadoPelaTrava === true);
  check('o pedido original é preservado no relato', conta.ambienteSolicitado === 'producao', conta.ambienteSolicitado);
  check('e o ambiente usado é o de homologação', conta.ambiente === 'homologacao', conta.ambiente);

  reset();
  process.env.FOCUS_NFE_SOMENTE_HOMOLOGACAO = '0';
  banco.chaveMestra = TOKEN_MESTRA;
  conta = await focus.contaCredentials('producao');
  check('com a trava desligada, produção não é rebaixada', conta.rebaixadoPelaTrava === false && conta.ambiente === 'producao', conta.ambiente);

  console.log('\n--- 4. banco sem a fase CF degrada; o resto estoura ---');
  reset();
  banco.erroDaTabela = new Error('relation "integracoes" does not exist');
  conta = await focus.contaCredentials('homologacao');
  check('tabela ausente = sistema de antes da fase, usando o .env', conta.origem === 'env', conta.origem);

  reset();
  banco.erroDaTabela = new Error('FOCUS_TOKEN_ENCRYPTION_KEY inválida — precisa decodificar para 32 bytes em base64.');
  let subiu = false;
  try {
    await focus.contaCredentials('homologacao');
  } catch {
    subiu = true;
  }
  check('chave de criptografia trocada NÃO vira "sem chave mestra"', subiu);

  console.log('\n--- 5. o segredo não sai do servidor ---');
  const camadaSrc = ler('lib/db/integracoes.js');
  const serverSrc = ler('server.js');
  check('a linha mapeada para a tela não tem campo de token',
    /chaveMestraHomologacaoConfigurada: Boolean\(/.test(camadaSrc)
    && !/token: (?!'')[^\n]*decryptFromBytea[^\n]*\n\s*\};/.test(camadaSrc));
  check('quem decifra está marcado como uso interno', /Uso interno \(lib\/focusnfe\.js\)/.test(camadaSrc));
  check('nenhuma rota chama getChaveMestra direto', !/integracoesDb\.getChaveMestra|integracoesDb\.getTokenDaEmpresa/.test(serverSrc));
  check('a auditoria registra o que mudou, não o valor',
    /action: 'salvarChaveMestraIntegracao'/.test(serverSrc) && !/details: \{[^}]*tokenHomologacao: body\.tokenHomologacao/.test(serverSrc));

  console.log('\n--- 6. gravar exige administrador; ler exige Configurações ---');
  check('PUT da chave mestra exige admin', /chave-mestra'\) && req\.method === 'PUT'\) \{\s*\n\s*const user = await getCurrentUser\(req\);\s*\n\s*if \(!user \|\| !\(await ehAdmin\(user\)\)\)/.test(serverSrc));
  check('GET das integrações exige o módulo settings', /'\/api\/integracoes' && req\.method === 'GET'\)[\s\S]{0,220}allowedModules\.includes\('settings'\)/.test(serverSrc));
  const permissoes = require('../lib/permissoes');
  check('o portão central enxerga a rota', permissoes.resolverPermissao('/api/integracoes', 'GET') === 'settings.ler',
    permissoes.resolverPermissao('/api/integracoes', 'GET'));
  check('e cobra edição no PUT', permissoes.resolverPermissao('/api/integracoes/FOCUS_NFE/chave-mestra', 'PUT') === 'settings.editar');

  console.log('\n--- 7. a migração guarda segredo como segredo ---');
  const migracao = ler('banco/migrations/fase-cf-chave-mestra-focus.sql');
  check('os tokens são bytea', /token_principal_homologacao_cifrado bytea/.test(migracao) && /token_principal_producao_cifrado    bytea/.test(migracao));
  check('nenhuma coluna de token em varchar/text', !/token_[a-z_]*\s+(varchar|text)/i.test(migracao));
  check('não semeia token de exemplo em texto', !/SEU_TOKEN_PRINCIPAL/.test(migracao.replace(/^--.*$/gm, '')));
  check('a linha da Focus nasce cadastrada', /insert into integracoes \(nome, provedor\)/.test(migracao));
  check('RLS ligada nas duas tabelas',
    /alter table if exists integracoes\s+enable row level security/.test(migracao)
    && /alter table if exists empresas_integracoes enable row level security/.test(migracao));

  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})();
