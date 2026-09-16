// Cliente para a API da Focus NFe (https://doc.focusnfe.com.br).
// Autenticação: HTTP Basic Auth com o token da empresa como usuário e senha em branco.
//
// Cada estabelecimento pode ter seu próprio token (guardado criptografado em
// estabelecimento.focus_token_cifrado — ver lib/db/fiscal.js). As funções
// aceitam um "credentials" opcional {token, ambiente}; quando omitido, cai
// pro token único global do .env (usado hoje só pelo painel de status em
// Configurações, antes de existir qualquer estabelecimento cadastrado).
const FOCUS_NFE_BASE_URLS = {
  homologacao: 'https://homologacao.focusnfe.com.br/v2',
  producao: 'https://api.focusnfe.com.br/v2'
};

// Trava de ambiente.
//
// Enquanto ela estiver ligada, NENHUMA chamada sai para a URL de produção —
// nem por um estabelecimento salvo como "producao", nem pelo .env. Uma nota
// autorizada em produção não tem desfazer: ela existe para a SEFAZ, entra na
// apuração e só pode ser cancelada (dentro do prazo) ou virar denúncia de
// espontaneidade. Por isso o padrão é FECHADO: se a variável não existir, o
// sistema assume homologação. Ir para produção tem que ser um ato explícito
// (FOCUS_NFE_SOMENTE_HOMOLOGACAO=0), nunca um esquecimento de configuração.
const DESLIGA_TRAVA = new Set(['0', 'false', 'off', 'nao', 'não']);

function somenteHomologacao() {
  const raw = String(process.env.FOCUS_NFE_SOMENTE_HOMOLOGACAO ?? '').trim().toLowerCase();
  return !DESLIGA_TRAVA.has(raw);
}

// Separa o que foi PEDIDO do que vai ser USADO. Sem essa distinção, um
// estabelecimento marcado como produção seria rebaixado em silêncio e o
// usuário acharia que emitiu de verdade.
function ambienteEfetivo(raw) {
  const bruto = String(raw || 'homologacao').toLowerCase();
  const pedido = FOCUS_NFE_BASE_URLS[bruto] ? bruto : 'homologacao';
  const travado = somenteHomologacao();
  const efetivo = travado ? 'homologacao' : pedido;
  return { pedido, efetivo, travado, bloqueado: pedido !== efetivo };
}

function normalizeAmbiente(raw) {
  return ambienteEfetivo(raw).efetivo;
}

// O campo do token na tela é type="password", e o Chrome preenche campo de
// senha com a senha salva do site mesmo com autocomplete="off". Já aconteceu:
// a senha do login do ERP foi gravada como se fosse o token da Focus, e o
// único sintoma era um 401 "permissao_negada" no botão Testar conexão — que
// parece token expirado, não token trocado. Mora aqui, e não em db/fiscal.js,
// porque é conhecimento sobre a Focus, não sobre o banco.
//
// O token da Focus é alfanumérico puro (32 caracteres nos que ela emite hoje);
// a faixa é folgada de propósito, porque recusar um token válido de formato
// novo seria pior do que aceitar um palpite improvável. O que ela barra é o
// caso real: senha curta ou com pontuação, colada por engano.
const FOCUS_TOKEN_FORMATO = /^[A-Za-z0-9]{20,64}$/;

function assertTokenValido(token) {
  const limpo = String(token == null ? '' : token).trim();
  if (FOCUS_TOKEN_FORMATO.test(limpo)) return limpo;
  const err = new Error(
    'Isso não parece um token da Focus NFe (esperado: 20 a 64 caracteres, só letras e números). ' +
    'Atenção ao preenchimento automático do navegador: se ele sugeriu a senha do seu login, ' +
    'apague o campo e cole o token gerado no painel da Focus NFe.'
  );
  err.status = 400;
  throw err;
}

function envCredentials() {
  return {
    token: String(process.env.FOCUS_NFE_TOKEN || '').trim(),
    ambiente: normalizeAmbiente(process.env.FOCUS_NFE_AMBIENTE)
  };
}

function isConfigured() {
  return Boolean(envCredentials().token);
}

// ---------------------------------------------------------------------------
// A CHAVE MESTRA (fase CF)
// ---------------------------------------------------------------------------
// O token PRINCIPAL da conta Focus — o que não pertence a nenhuma filial.
// Mora no banco, cifrado (lib/db/integracoes.js), porque .env só troca com
// deploy, não cabe dois ambientes e fica em texto no disco do servidor.
//
// O require é DENTRO da função, e não no topo: assim importar este módulo não
// arrasta o banco junto. Metade dos testes da suíte carrega lib/focusnfe.js só
// para conferir regra de ambiente e montagem de payload, sem Postgres nenhum
// por perto — mesmo arranjo já usado em forEstabelecimento.
async function chaveMestraCredentials(ambienteBruto) {
  const ambiente = normalizeAmbiente(ambienteBruto === undefined ? process.env.FOCUS_NFE_AMBIENTE : ambienteBruto);
  try {
    const { getChaveMestra } = require('./db/integracoes');
    return await getChaveMestra(ambiente);
  } catch (erro) {
    // ÚNICA degradação aceita: a tabela ainda não existe porque a fase CF não
    // foi aplicada. Aí o sistema é o de antes dela, e o .env continua valendo.
    // Quem cobra isso é o verificador (npm run migracoes), que enxerga a
    // migração pendente — não este catch, que não tem como avisar ninguém.
    //
    // Qualquer outro erro SOBE: banco fora do ar, chave de criptografia
    // trocada, token que não decifra. Tratar esses como "não configurado" faria
    // o sistema emitir pelo token de reserva achando que usou o certo.
    if (ehTabelaAusente(erro)) return null;
    throw erro;
  }
}

// O banco responde nomeando a tabela que não existe — é assim que o resto do
// projeto pergunta "isto já foi migrado?" (scripts/verificar-migracoes.js).
function ehTabelaAusente(erro) {
  return /does not exist|Could not find|schema cache/i.test((erro && erro.message) || '');
}

/**
 * Credenciais para operação de CONTA (não de nota): testar se a conta responde,
 * listar as empresas cadastradas nela, registrar uma empresa nova.
 *
 * Ordem: chave mestra do banco → FOCUS_NFE_TOKEN do .env. O .env fica por
 * último e continua funcionando — quem já tinha o sistema de pé não precisa
 * cadastrar nada para continuar como estava.
 *
 * `origem` viaja junto porque "conectado" não responde a pergunta que se faz
 * quando algo dá errado, que é conectado COM QUAL token.
 */
async function contaCredentials(ambienteBruto) {
  // O PEDIDO E O USO SÃO COISAS DIFERENTES, e aqui os dois viajam juntos.
  //
  // Com a trava ligada, pedir produção devolve credencial de homologação — é o
  // que se quer. O que não se pode é devolver isso calado: quem pediu produção
  // e recebeu um "conectado" sem saber do rebaixamento conclui que a chave de
  // produção está valendo, que é justamente a confusão que a trava existe para
  // evitar. Mesma distinção de ambienteEfetivo(), pelo mesmo motivo.
  const info = ambienteEfetivo(ambienteBruto === undefined ? process.env.FOCUS_NFE_AMBIENTE : ambienteBruto);
  const relato = {
    ambiente: info.efetivo,
    ambienteSolicitado: info.pedido,
    rebaixadoPelaTrava: info.bloqueado
  };

  const mestra = await chaveMestraCredentials(info.efetivo);
  if (mestra && mestra.token) return { ...relato, token: mestra.token, origem: 'chave-mestra' };
  const env = envCredentials();
  if (env.token) return { ...relato, token: env.token, origem: 'env' };
  return { ...relato, token: '', origem: 'nenhuma' };
}

/** checkStatus da conta, usando a chave mestra quando ela existir. */
async function checkStatusDaConta(ambienteBruto) {
  const creds = await contaCredentials(ambienteBruto);
  const status = await checkStatus(creds);
  return { ...status, origem: creds.origem };
}

// ---------------------------------------------------------------------------
// A EXCEÇÃO ESTREITA À TRAVA (fase CH)
// ---------------------------------------------------------------------------
// A trava existe para impedir que uma NOTA saia com valor fiscal por engano.
// Ela não existe para impedir LER o cadastro da conta — e essa distinção
// passou a importar porque a API de empresas da Focus **só existe em
// produção**: não há `homologacao.focusnfe.com.br/v2/empresas`. Sem exceção,
// a única forma de descobrir os tokens de 10 CNPJs seria digitar os 10 à mão,
// que é exatamente o erro que esta funcionalidade veio evitar (o campo é
// type="password" e o navegador já gravou a senha do login no lugar de um
// token — ver assertTokenValido).
//
// A exceção é deliberadamente pequena, e as três condições valem JUNTAS:
//
//   1. quem chama pede explicitamente (`leituraDeConta: true`);
//   2. o método é GET — nada que escreva na Focus passa por aqui;
//   3. o caminho está na lista fechada abaixo.
//
// Uma só não basta. Um bug que esqueça o `leituraDeConta` continua barrado
// pelo caminho; um caminho novo colado por engano continua barrado pelo GET.
// EMITIR NUNCA PASSA: `/nfe` não está na lista e emissão não é GET.
const LEITURAS_DE_CONTA = new Set(['/empresas']);

function ehLeituraDeContaPermitida(method, path) {
  if (String(method).toUpperCase() !== 'GET') return false;
  return LEITURAS_DE_CONTA.has(String(path || '').split('?')[0]);
}

// Recusa em vez de rebaixar. Rebaixar produção para homologação mandaria um
// token de produção para a URL de homologação, e a Focus responderia 403 —
// um erro de autenticação para um problema que é de configuração. Melhor
// parar aqui, com o motivo escrito.
function assertAmbientePermitido(ambienteBruto, opcoes = {}) {
  const info = ambienteEfetivo(ambienteBruto);
  // A leitura de conta usa o ambiente PEDIDO, não o efetivo: é o caso em que
  // produção é o destino certo mesmo com a trava ligada.
  if (info.bloqueado && opcoes.permitirProducao === true) return info.pedido;
  if (info.bloqueado) {
    const err = new Error(
      'Este estabelecimento está marcado como Produção, mas o sistema está travado em homologação. ' +
      'Enquanto FOCUS_NFE_SOMENTE_HOMOLOGACAO estiver ligada, nenhuma nota sai com valor fiscal: ' +
      'troque o ambiente do estabelecimento para Homologação e use o token de homologação da Focus NFe.'
    );
    err.status = 409;
    throw err;
  }
  return info.efetivo;
}

async function focusRequest(method, path, body, credentials, opcoes = {}) {
  const creds = credentials || envCredentials();
  if (!creds.token) {
    const err = new Error('Focus NFe não está configurado — falta o token (FOCUS_NFE_TOKEN no .env ou token do estabelecimento).');
    err.status = 501;
    throw err;
  }

  // As três condições da exceção, avaliadas JUNTAS e aqui — no único ponto por
  // onde toda chamada à Focus passa. Ver o bloco de LEITURAS_DE_CONTA.
  const ambiente = assertAmbientePermitido(creds.ambiente, {
    permitirProducao: opcoes.leituraDeConta === true && ehLeituraDeContaPermitida(method, path)
  });
  const url = `${FOCUS_NFE_BASE_URLS[ambiente]}${path}`;
  const auth = Buffer.from(`${creds.token}:`).toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Tempo de resposta excedido ao comunicar com a Focus NFe.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok && response.status !== 202) {
    const message = payload.mensagem || payload.erro || payload.message || 'Erro ao comunicar com a Focus NFe.';
    const err = new Error(message);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }

  return { status: response.status, data: payload, ambiente };
}

// Chamada leve só pra validar que um token é aceito pela Focus NFe.
//
// Usa /hooks, e NÃO /empresas: /empresas é endpoint de conta parceira
// (revenda) e responde 404 para o token comum de uma empresa. Testado contra
// a homologação: token válido devolve 200 com a lista de webhooks, token
// inválido devolve 401 "permissao_negada". Um health check que dá "Falhou"
// para um token bom é pior do que não ter health check — manda procurar
// defeito onde não tem.
async function checkStatus(credentials) {
  const creds = credentials || envCredentials();
  const info = ambienteEfetivo(creds.ambiente);
  const base = {
    ambiente: info.efetivo,
    ambienteSolicitado: info.pedido,
    travadoEmHomologacao: info.travado
  };
  if (!creds.token) {
    return { ...base, configured: false, connected: false, message: 'Token não configurado.' };
  }
  try {
    await focusRequest('GET', '/hooks', undefined, creds);
    return {
      ...base,
      configured: true,
      connected: true,
      message: info.travado
        ? 'Conectado em homologação — notas emitidas aqui NÃO têm valor fiscal.'
        : 'Conectado com sucesso.'
    };
  } catch (error) {
    // 401 é a única resposta que acusa o token; qualquer outra coisa é rede,
    // instabilidade da Focus ou ambiente errado. Dizer "token inválido" para
    // um timeout faz o usuário trocar uma credencial que estava certa.
    // No 401, as três causas reais são indistinguíveis pela resposta da Focus
    // (ela sempre devolve "permissao_negada"), então a mensagem lista as três.
    // A terceira já aconteceu e é a mais difícil de suspeitar sozinho: o campo
    // do token é type="password" e o navegador o preencheu com a senha do
    // login do ERP — o token estava "cadastrado", só não era um token.
    const message = error.status === 401
      ? `Token recusado pela Focus NFe (ambiente de ${info.efetivo}). Verifique se o token é deste ambiente, se não foi revogado, e se o que está salvo é mesmo o token da Focus — o preenchimento automático do navegador pode ter gravado uma senha no lugar dele.`
      : error.message;
    return { ...base, configured: true, connected: false, message, status: error.status };
  }
}

// ATENÇÃO: exige token de conta PARCEIRA (revenda). Com o token comum de uma
// empresa a Focus responde 404 — não é sinal de token inválido. Não use isso
// como teste de conexão (ver checkStatus).
async function listarEmpresas(credentials) {
  const { data } = await focusRequest('GET', '/empresas', undefined, credentials);
  return data;
}

async function emitirNfe(ref, payload, credentials) {
  const { data, status } = await focusRequest('POST', `/nfe?ref=${encodeURIComponent(ref)}`, payload, credentials);
  return { ...data, httpStatus: status };
}

async function consultarNfe(ref, credentials) {
  const { data } = await focusRequest('GET', `/nfe/${encodeURIComponent(ref)}`, undefined, credentials);
  return data;
}

async function cancelarNfe(ref, justificativa, credentials) {
  const { data } = await focusRequest('DELETE', `/nfe/${encodeURIComponent(ref)}`, { justificativa }, credentials);
  return data;
}

async function emitirCartaCorrecao(ref, correcao, credentials) {
  const { data } = await focusRequest('POST', `/nfe/${encodeURIComponent(ref)}/carta_correcao`, { correcao }, credentials);
  return data;
}

// Cadastra na Focus NFe a URL que ela deve chamar quando o status de uma NF-e
// mudar de forma assíncrona (POST /api/fiscal/webhooks/focus neste servidor).
async function criarWebhook({ event, cnpj, url, secret, secretHeader }, credentials) {
  const { data } = await focusRequest('POST', '/hooks', {
    event,
    url,
    cnpj,
    authorization: secret,
    authorization_header: secretHeader
  }, credentials);
  return data;
}

async function listarWebhooks(credentials) {
  const { data } = await focusRequest('GET', '/hooks', undefined, credentials);
  return data;
}

async function excluirWebhook(id, credentials) {
  const { data } = await focusRequest('DELETE', `/hooks/${encodeURIComponent(id)}`, undefined, credentials);
  return data;
}

// Baixa o conteúdo bruto de um arquivo hospedado pela Focus (XML ou DANFE),
// a partir do caminho relativo que ela devolve em caminho_xml_nota_fiscal /
// caminho_danfe. Usado pra guardar uma cópia local, em vez de depender do
// link da Focus continuar disponível pra sempre.
async function baixarArquivo(caminho, credentials) {
  const creds = credentials || envCredentials();
  if (!creds.token) {
    const err = new Error('Focus NFe não está configurado — falta o token.');
    err.status = 501;
    throw err;
  }
  const ambiente = assertAmbientePermitido(creds.ambiente);
  const rootUrl = FOCUS_NFE_BASE_URLS[ambiente].replace(/\/v2$/, '');
  const url = /^https?:\/\//.test(caminho) ? caminho : `${rootUrl}${caminho}`;
  const auth = Buffer.from(`${creds.token}:`).toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch(url, { headers: { Authorization: `Basic ${auth}` }, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Tempo de resposta excedido ao baixar arquivo da Focus NFe.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const err = new Error(`Não foi possível baixar o arquivo (status ${response.status}).`);
    err.status = response.status;
    throw err;
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function inutilizarNumeracao({ cnpj, serie, numeroInicial, numeroFinal, justificativa }, credentials) {
  const { data } = await focusRequest('POST', '/nfe/inutilizacao', {
    cnpj,
    serie: String(serie),
    numero_inicial: String(numeroInicial),
    numero_final: String(numeroFinal),
    justificativa
  }, credentials);
  return data;
}

/**
 * A FILA DE RESERVA — só para quando o estabelecimento não tem token próprio,
 * e só sob a trava de homologação (quem decide isso é forEstabelecimento).
 *
 * Ordem, do mais específico para o mais genérico:
 *
 *   1. token da EMPRESA   (o grupo, em empresas_integracoes)
 *   2. chave mestra       (a conta, em integracoes)
 *   3. FOCUS_NFE_TOKEN    (o .env, como sempre foi)
 *
 * Nessa ordem porque, se alguém se deu ao trabalho de cadastrar um token para
 * aquele grupo, ele é mais provavelmente o certo do que o da conta inteira.
 *
 * O ambiente da reserva é sempre 'homologacao': é a única situação em que esta
 * função é chamada, e dizer isso aqui evita que um token de produção salvo na
 * empresa seja despachado para a URL de homologação por engano.
 */
async function credencialDeReserva(estabelecimentoId) {
  try {
    const { getTokenDaEmpresa } = require('./db/integracoes');
    const { getEstabelecimentoById } = require('./db/fiscal');
    const estabelecimento = await getEstabelecimentoById(estabelecimentoId);
    if (estabelecimento && estabelecimento.empresaId) {
      const daEmpresa = await getTokenDaEmpresa(estabelecimento.empresaId, 'homologacao');
      if (daEmpresa && daEmpresa.token) return { token: daEmpresa.token, ambiente: 'homologacao' };
    }
  } catch (erro) {
    if (!ehTabelaAusente(erro)) throw erro;
  }

  const mestra = await chaveMestraCredentials('homologacao');
  if (mestra && mestra.token) return { token: mestra.token, ambiente: 'homologacao' };

  const global = envCredentials();
  if (global.token) return { token: global.token, ambiente: 'homologacao' };

  return null;
}

// Cliente já vinculado ao token de um estabelecimento específico — usar isso
// (em vez das funções soltas acima) em qualquer fluxo real de emissão.
async function forEstabelecimento(estabelecimentoId) {
  const { getEstabelecimentoFocusCredentials } = require('./db/fiscal');
  let creds = await getEstabelecimentoFocusCredentials(estabelecimentoId);

  // Sem token próprio, cai numa reserva — mas SÓ com a trava de homologação
  // ligada. Em produção o token é quem identifica o emitente para a Focus: uma
  // reserva emitindo por um estabelecimento que não é o dela sairia com o CNPJ
  // errado na nota, e nota autorizada não tem desfazer. Em teste, esse mesmo
  // atalho evita recadastrar o token em cada filial.
  //
  // A CHAVE MESTRA NÃO MUDA ESSA REGRA (fase CF). Ela é mais poderosa que o
  // FOCUS_NFE_TOKEN, não mais segura para emitir: também não é o token do CNPJ.
  // Por isso entra na mesma fila, atrás do mesmo `somenteHomologacao()`.
  if (!creds && somenteHomologacao()) {
    creds = await credencialDeReserva(estabelecimentoId);
  }

  if (!creds) {
    const err = new Error(
      somenteHomologacao()
        ? 'Este estabelecimento não tem token da Focus NFe configurado, e não há reserva para usar em teste — nem chave mestra cadastrada (Configurações › Integrações), nem FOCUS_NFE_TOKEN no .env.'
        : 'Este estabelecimento não tem token da Focus NFe configurado. Em produção cada estabelecimento precisa do token próprio — é ele que identifica o emitente para a Focus, e nem a chave mestra da conta substitui isso.'
    );
    err.status = 400;
    throw err;
  }
  return {
    checkStatus: () => checkStatus(creds),
    listarEmpresas: () => listarEmpresas(creds),
    emitirNfe: (ref, payload) => emitirNfe(ref, payload, creds),
    consultarNfe: (ref) => consultarNfe(ref, creds),
    cancelarNfe: (ref, justificativa) => cancelarNfe(ref, justificativa, creds),
    emitirCartaCorrecao: (ref, correcao) => emitirCartaCorrecao(ref, correcao, creds),
    inutilizarNumeracao: (dados) => inutilizarNumeracao(dados, creds),
    criarWebhook: (dados) => criarWebhook(dados, creds),
    listarWebhooks: () => listarWebhooks(creds),
    excluirWebhook: (id) => excluirWebhook(id, creds),
    baixarArquivo: (caminho) => baixarArquivo(caminho, creds)
  };
}

// ===========================================================================
// DISTRIBUIÇÃO DE DF-e — as notas que emitiram CONTRA o nosso CNPJ (fase AR)
// ===========================================================================
//
// TODO O ACOPLAMENTO COM A FOCUS MORA NESTE BLOCO, de propósito.
//
// Nenhuma destas rotas foi exercida contra a Focus de verdade — nem em
// homologação — porque a conta ainda não foi validada lá. Então o resto do
// sistema não pode depender do formato exato da resposta: se um campo tiver
// outro nome, a correção tem de ser UMA edição aqui, e não uma caçada por seis
// arquivos.
//
// É a lição do `notas_referenciadas`, que a Focus ignora em silêncio quando o
// nome do campo está errado: com integração não verificada, o perigo não é o
// erro que estoura — é o que não estoura.
//
// OS NOMES DOS CAMPOS ESTÃO TODOS EM `CAMPOS_DFE`, abaixo, e `normalizarDocumento`
// é o único ponto que os lê. Conferir a documentação da Focus é comparar uma
// tabela; ajustar é trocar uma string.
const CAMPOS_DFE = {
  // Onde vem a lista de documentos dentro do corpo da resposta.
  lista: ['documentos', 'notas', 'dfes', 'data'],
  // O NSU do documento.
  nsu: ['nsu', 'NSU', 'numero_sequencial'],
  // O maior NSU que existe para o CNPJ (diz se ainda falta buscar).
  maxNsu: ['ultimo_nsu', 'max_nsu', 'maxNSU', 'ultNSU'],
  // CONFIRMADO pela doc da automação `mde_ciencia_automatica`.
  chave: ['chave_nfe', 'chave', 'chNFe', 'chave_acesso'],
  // `documento_emitente` é o nome CONFIRMADO; os outros quatro continuam
  // palpite, para o caso de o GET /dfe falar diferente do webhook. Ele vem
  // primeiro porque é o único que se sabe verdadeiro — e sem ele o CNPJ do
  // emitente chegava vazio na tela, que é o tipo de falha que não estoura.
  emitenteDocumento: ['documento_emitente', 'cnpj_emitente', 'emitente_cnpj', 'CNPJ', 'cnpj'],
  // CONFIRMADO: `nome_emitente`.
  emitenteNome: ['nome_emitente', 'emitente_nome', 'xNome', 'razao_social_emitente'],
  // CONFIRMADO: `data_emissao`.
  dataEmissao: ['data_emissao', 'dhEmi', 'data', 'emissao'],
  // CONFIRMADO: `valor_total`.
  valorTotal: ['valor_total', 'valor', 'vNF', 'valor_nota'],
  // O XML completo, quando a nota já pode ser baixada.
  xml: ['xml', 'xml_nfe', 'procNFe', 'documento'],
  // O que a Focus chama de tipo/schema do documento devolvido.
  tipo: ['tipo', 'schema', 'tipo_documento'],

  // --- Só no webhook da automação MD-e (todos CONFIRMADOS pela doc) ---
  // Contra qual CNPJ/CPF a nota foi emitida: é por ele que se descobre de qual
  // estabelecimento nosso é esta nota.
  destinatarioDocumento: ['cnpj_destinatario', 'cpf_destinatario'],
  // O que a Focus manifestou automaticamente ('ciencia'). Ver manifestacao.js.
  manifestacao: ['manifestacao_destinatario'],
  // Booleano: a nota completa já está disponível na Focus. NÃO é o XML.
  completa: ['nfe_completa'],
  // 'autorizada', 'cancelada'... a situação da nota na SEFAZ.
  situacao: ['situacao']
};

/** Primeiro nome de campo que existir no objeto. Undefined se nenhum existir. */
function primeiroCampo(objeto, nomes) {
  if (!objeto || typeof objeto !== 'object') return undefined;
  for (const nome of nomes) {
    if (objeto[nome] !== undefined && objeto[nome] !== null && objeto[nome] !== '') return objeto[nome];
  }
  return undefined;
}

/**
 * Traduz um documento da Focus para a forma que o resto do sistema usa.
 *
 * O `bruto` viaja junto (campo `bruto`) porque, enquanto a integração não for
 * verificada contra a Focus real, a resposta que ela mandou é a única prova do
 * que aconteceu — e ela vai para a coluna `resumo` jsonb, que é onde se olha
 * quando um campo vier vazio sem explicação.
 */
function normalizarDocumento(bruto) {
  const chave = String(primeiroCampo(bruto, CAMPOS_DFE.chave) || '').replace(/\D/g, '');
  const xml = primeiroCampo(bruto, CAMPOS_DFE.xml);
  return {
    nsu: Number(primeiroCampo(bruto, CAMPOS_DFE.nsu) || 0),
    chave,
    emitenteDocumento: String(primeiroCampo(bruto, CAMPOS_DFE.emitenteDocumento) || '').replace(/\D/g, ''),
    emitenteNome: String(primeiroCampo(bruto, CAMPOS_DFE.emitenteNome) || ''),
    dataEmissao: primeiroCampo(bruto, CAMPOS_DFE.dataEmissao) || null,
    valorTotal: Number(primeiroCampo(bruto, CAMPOS_DFE.valorTotal) || 0),
    // Resumo é o que a SEFAZ devolve antes da manifestação; completo é o que
    // vem depois. Sem XML em mãos, é resumo — independente do que o campo
    // `tipo` disser, porque é o XML que decide o que dá para fazer com a nota.
    tipoDocumento: xml ? 'completo' : 'resumo',
    xml: xml ? String(xml) : null,
    bruto
  };
}

/**
 * Traduz o POST da automação `mde_ciencia_automatica` da Focus NFe.
 *
 * É A FOCUS QUE NOS CHAMA, e não o contrário — o `curl` da documentação dela
 * descreve o que ela envia para a nossa URL (daí o `Authorization:` vazio no
 * exemplo: o valor é o que se configura no cadastro do hook).
 *
 * O QUE ESSA AUTOMAÇÃO FAZ, e por que o `manifestacaoCodigo` sai daqui:
 * a Focus dá CIÊNCIA na SEFAZ automaticamente pelas notas emitidas contra o
 * CNPJ, e este POST é o aviso de que o evento JÁ ACONTECEU. Por isso gravar a
 * manifestação ao recebê-lo não fere a regra de lib/db/dfe.js ("não existe
 * função que grave manifestação sem ter ido à SEFAZ"): a ida à SEFAZ existiu,
 * só não foi nossa. Quem não distinguir isso vai ler a tela e achar que alguém
 * daqui manifestou.
 *
 * DIFERENÇAS PARA O QUE `distribuicaoDfe` DEVOLVE, todas deliberadas:
 *
 *   NSU     — não vem no payload. Fica 0, e `gravarDocumento` aceita: 0 quer
 *             dizer "chegou por aviso, não pela varredura". A varredura por NSU
 *             depois atualiza a MESMA linha (o índice único é por cnpj+chave),
 *             então nada se duplica e o ponteiro de NSU não é mexido daqui —
 *             movê-lo com um NSU que não existe faria pular notas.
 *
 *   XML     — também não vem. `nfe_completa: true` diz que a nota completa está
 *             disponível NA FOCUS, não que ela está aqui. Enquanto o XML não
 *             estiver em mãos, o documento é 'resumo' — é o XML que decide o
 *             que dá para fazer com a nota, e não um booleano de outro sistema.
 *
 * A chave vem prefixada ('NFe' + 44 dígitos) no exemplo da doc, igual ao
 * webhook de NF-e emitida — por isso o mesmo `replace(/\D/g, '')` de
 * `normalizarDocumento`, que já existia e cobre os dois.
 */
function normalizarMdeAutomacao(bruto) {
  const documento = normalizarDocumento(bruto);
  const destinatario = String(primeiroCampo(bruto, CAMPOS_DFE.destinatarioDocumento) || '').replace(/\D/g, '');
  const manifestacaoBruta = String(primeiroCampo(bruto, CAMPOS_DFE.manifestacao) || '').trim();
  return {
    documento,
    destinatarioDocumento: destinatario,
    // O texto da Focus ('ciencia'), traduzido pelo catálogo em manifestacao.js
    // — que já devolve registro inerte para evento desconhecido, em vez de
    // quebrar. Vazio quando a automação não manifestou nada.
    manifestacao: manifestacaoBruta,
    situacao: String(primeiroCampo(bruto, CAMPOS_DFE.situacao) || ''),
    notaCompletaDisponivel: primeiroCampo(bruto, CAMPOS_DFE.completa) === true
  };
}

/**
 * Busca documentos emitidos contra um CNPJ.
 *
 * `modo` é um dos quatro da tela:
 *   'ultimo-nsu'  — continua de onde parou (pede `nsu` = o último sincronizado)
 *   'tres-meses'  — varre desde o NSU 0, filtrando por data no chamador
 *   'nsu'         — um NSU específico
 *   'chave'       — uma chave de acesso específica
 *
 * A SEFAZ entrega no máximo 50 documentos por consulta e responde 'cStat 137'
 * (nenhum documento localizado) quando não há nada novo — que NÃO é erro, é a
 * resposta normal de quem já está em dia. Por isso 404 aqui vira lista vazia em
 * vez de exceção: tratar "nada novo" como falha faria a tela gritar todo dia.
 */
async function distribuicaoDfe({ cnpj, modo, nsu, chave }, credentials) {
  const limpo = String(cnpj || '').replace(/\D/g, '');
  if (limpo.length !== 14) {
    const err = new Error('Informe o CNPJ da empresa (14 dígitos) para consultar a SEFAZ.');
    err.status = 400;
    throw err;
  }

  const parametros = new URLSearchParams({ cnpj: limpo });
  if (modo === 'chave') {
    const chaveLimpa = String(chave || '').replace(/\D/g, '');
    if (chaveLimpa.length !== 44) {
      const err = new Error('A chave de acesso precisa ter 44 dígitos.');
      err.status = 400;
      throw err;
    }
    parametros.set('chave', chaveLimpa);
  } else {
    // Nos outros três modos o que muda é o ponto de partida. 'tres-meses'
    // começa do zero porque a SEFAZ não filtra por data: ela pagina por NSU, e
    // o recorte de data é feito por quem chama.
    parametros.set('nsu', String(Number(nsu || 0)));
  }

  try {
    const { data } = await focusRequest('GET', `/dfe?${parametros.toString()}`, undefined, credentials);
    const lista = primeiroCampo(data, CAMPOS_DFE.lista);
    const documentos = Array.isArray(lista) ? lista : (Array.isArray(data) ? data : []);
    return {
      documentos: documentos.map(normalizarDocumento).filter((d) => d.chave.length === 44),
      maxNsu: Number(primeiroCampo(data, CAMPOS_DFE.maxNsu) || 0),
      bruto: data
    };
  } catch (erro) {
    // "Nenhum documento localizado" não é falha.
    if (erro.status === 404) return { documentos: [], maxNsu: Number(nsu || 0), bruto: null };
    throw erro;
  }
}

/**
 * Manifesta uma nota na SEFAZ.
 *
 * `codigo` é o do evento (210200/210210/210220/210240) — ver
 * public/modules/shared/manifestacao.js, que é quem decide o que cada um
 * significa para o estoque.
 *
 * A JUSTIFICATIVA É OBRIGATÓRIA no desconhecimento e na operação não realizada,
 * e a SEFAZ exige no mínimo 15 caracteres. Recusar aqui, antes de gastar a
 * viagem, dá um erro que diz o que fazer — a SEFAZ devolveria um código
 * numérico que ninguém decora.
 */
async function manifestarNfe({ chave, codigo, justificativa, cnpj }, credentials) {
  const chaveLimpa = String(chave || '').replace(/\D/g, '');
  if (chaveLimpa.length !== 44) {
    const err = new Error('A chave de acesso precisa ter 44 dígitos.');
    err.status = 400;
    throw err;
  }
  const exigeJustificativa = codigo === '210220' || codigo === '210240';
  if (exigeJustificativa && String(justificativa || '').trim().length < 15) {
    const err = new Error('Desconhecimento e operação não realizada exigem justificativa de pelo menos 15 caracteres.');
    err.status = 400;
    throw err;
  }

  const corpo = {
    cnpj: String(cnpj || '').replace(/\D/g, ''),
    chave: chaveLimpa,
    tipo_evento: codigo
  };
  if (exigeJustificativa) corpo.justificativa = String(justificativa).trim();

  const { data } = await focusRequest('POST', '/manifesto', corpo, credentials);
  return data;
}

// ===========================================================================
// AS EMPRESAS DA CONTA — importar em vez de digitar (fase CH)
// ===========================================================================
//
// OS NOMES DE CAMPO AQUI NÃO SÃO PALPITE. Foram lidos da resposta real de
// `GET /v2/empresas` em 16/09/2026, numa conta com 10 CNPJs — os 137 campos
// que ela devolve estão no relatório daquela sessão. Isso importa porque a
// Focus ignora campo desconhecido em silêncio (ver o bloco CAMPOS_DFE): num
// payload de escrita isso produz nota errada e resposta de sucesso; aqui, na
// leitura, produziria tela em branco sem erro nenhum.
//
// POR QUE ISTO NÃO DEVOLVE O TOKEN JUNTO
// --------------------------------------
// São duas funções de propósito. `listarEmpresasDaConta` é o que a TELA vê, e
// ela não pode ver token: quem abre Configurações passaria a poder emitir por
// qualquer um dos CNPJs da conta. `tokensDaConta` é o que o IMPORTADOR usa,
// no servidor, e o token vai direto do fetch para a coluna cifrada sem passar
// pelo navegador. Mesma separação de lib/db/integracoes.js.

/** O que a tela precisa de cada empresa. Sem token — ver o cabeçalho. */
function normalizarEmpresaDaConta(bruto) {
  if (!bruto || typeof bruto !== 'object') return null;
  return {
    id: bruto.id,
    nome: bruto.nome || '',
    nomeFantasia: bruto.nome_fantasia || '',
    cnpj: String(bruto.cnpj || bruto.cpf || '').replace(/\D/g, ''),
    inscricaoEstadual: bruto.inscricao_estadual || '',
    inscricaoMunicipal: bruto.inscricao_municipal || '',
    email: bruto.email || '',
    telefone: bruto.telefone || '',
    // O ENDEREÇO COMPLETO, e não só município/UF. Ele existe aqui porque a
    // tela usa esta mesma linha para abrir o cadastro do estabelecimento já
    // preenchido: com 10 CNPJs, redigitar dez endereços é dez oportunidades de
    // errar um número que vai sair em TODA nota emitida por aquela filial.
    // `codigo_municipio` é o código IBGE de verdade (conferido: 4208906 para
    // Jaraguá do Sul) — não confundir com o SIAFI da BrasilAPI, que a SEFAZ
    // rejeitaria. O CEP vem formatado ("89251-600"); quem grava normaliza.
    logradouro: bruto.logradouro || '',
    numero: bruto.numero || '',
    complemento: bruto.complemento || '',
    bairro: bruto.bairro || '',
    cep: bruto.cep || '',
    codigoMunicipio: bruto.codigo_municipio || '',
    municipio: bruto.municipio || '',
    uf: bruto.uf || '',
    regimeTributario: bruto.regime_tributario ?? null,
    habilitaNfe: bruto.habilita_nfe === true,
    habilitaNfce: bruto.habilita_nfce === true,
    // A NUMERAÇÃO. É o campo que mais importa nesta tela: quem numera a NF-e é
    // a Focus, e um sistema que veio de outro ERP começa com o contador dela
    // zerado — a primeira nota real bate de frente com o que o sistema antigo
    // já emitiu. Mostrar isso é metade do valor da tela.
    serieNfeProducao: bruto.serie_nfe_producao ?? null,
    proximoNumeroNfeProducao: bruto.proximo_numero_nfe_producao ?? null,
    serieNfeHomologacao: bruto.serie_nfe_homologacao ?? null,
    proximoNumeroNfeHomologacao: bruto.proximo_numero_nfe_homologacao ?? null,
    // Vazio significa SEM CERTIFICADO, e essa empresa não emite. Não é um
    // detalhe de exibição: é o motivo pelo qual uma filial vai falhar.
    certificadoCnpj: bruto.certificado_cnpj || '',
    certificadoValidoAte: bruto.certificado_valido_ate || null,
    // Nulo = nunca emitiu por este CNPJ. Junto com o próximo número, diz se a
    // numeração da Focus é confiável ou se foi só nunca usada.
    dataUltimaEmissao: bruto.data_ultima_emissao || null,
    temTokenProducao: Boolean(bruto.token_producao),
    temTokenHomologacao: Boolean(bruto.token_homologacao)
  };
}

/**
 * As empresas da conta Focus.
 *
 * SEMPRE PRODUÇÃO, e não é descuido: a API de empresas da Focus só existe lá
 * (não há `homologacao.focusnfe.com.br/v2/empresas`). O token de homologação
 * de cada empresa vem DENTRO dessa mesma resposta de produção — é por isso que
 * dá para importar os dois ambientes com uma chamada só.
 *
 * Exige a chave mestra de PRODUÇÃO. O FOCUS_NFE_TOKEN do .env não serve aqui e
 * a fila de reserva não se aplica: ele é token de uma empresa, e a Focus
 * responde 404 a token comum neste endpoint (ver checkStatus). Cair na reserva
 * daria "não encontrado" para um problema que é de configuração.
 */
async function chaveMestraDeProducao() {
  try {
    const { getChaveMestra } = require('./db/integracoes');
    // `getChaveMestra('producao')` DIRETO, e não via chaveMestraCredentials.
    //
    // Aquela passa por normalizeAmbiente, que devolve o ambiente EFETIVO — com
    // a trava ligada, 'producao' vira 'homologacao'. O efeito seria silencioso
    // e duplo: ler a coluna errada (a chave de homologação) e mandá-la para a
    // URL errada. Aqui produção não é uma preferência que a trava possa
    // rebaixar; é o único lugar onde este endpoint existe.
    return await getChaveMestra('producao');
  } catch (erro) {
    // Mesma degradação de chaveMestraCredentials: banco sem a fase CF é o
    // sistema de antes dela. Qualquer outro erro sobe.
    if (ehTabelaAusente(erro)) return null;
    throw erro;
  }
}

async function empresasDaContaBrutas() {
  const mestra = await chaveMestraDeProducao();
  if (!mestra || !mestra.token) {
    const err = new Error(
      'Falta a chave mestra de PRODUÇÃO da Focus NFe. A lista de empresas da conta só existe no ambiente de produção — '
      + 'cadastre a chave principal da conta em Configurações › Empresa › Integração. '
      + 'Isso não emite nada: a trava de homologação continua valendo para as notas.'
    );
    err.status = 501;
    throw err;
  }
  const { data } = await focusRequest('GET', '/empresas', undefined, mestra, { leituraDeConta: true });
  // A Focus devolve um array puro; os outros formatos ficam aceitos porque
  // custam uma linha e evitam uma tela vazia sem explicação.
  if (Array.isArray(data)) return data;
  if (Array.isArray(data && data.empresas)) return data.empresas;
  if (Array.isArray(data && data.data)) return data.data;
  return [];
}

/** Para a TELA. Nunca devolve token. */
async function listarEmpresasDaConta() {
  const brutas = await empresasDaContaBrutas();
  return brutas.map(normalizarEmpresaDaConta).filter((e) => e && e.cnpj.length === 14);
}

/**
 * Para o IMPORTADOR, no servidor. USO INTERNO — devolve segredo em texto.
 *
 * Mapa de CNPJ (14 dígitos) para os dois tokens daquele CNPJ. Quem chama grava
 * cifrado e descarta; nada disto pode chegar a uma resposta HTTP.
 */
async function tokensDaConta() {
  const brutas = await empresasDaContaBrutas();
  const porCnpj = new Map();
  for (const bruta of brutas) {
    const cnpj = String((bruta && (bruta.cnpj || bruta.cpf)) || '').replace(/\D/g, '');
    if (cnpj.length !== 14) continue;
    porCnpj.set(cnpj, {
      producao: bruta.token_producao || '',
      homologacao: bruta.token_homologacao || ''
    });
  }
  return porCnpj;
}

/**
 * Cliente das operações de CONTA, com a chave mestra.
 *
 * É o que `listarEmpresas` sempre pediu e nunca teve: GET /empresas exige token
 * de conta parceira e responde 404 para o token comum de uma empresa (ver o
 * comentário em checkStatus). Antes da fase CF não havia onde guardar esse
 * token; agora há.
 *
 * Note que aqui NÃO entra emissão: emitir é sempre por estabelecimento.
 */
async function comChaveMestra(ambiente) {
  const creds = await contaCredentials(ambiente);
  if (!creds.token) {
    const err = new Error(
      'Nenhuma chave mestra da Focus NFe cadastrada. Configurações › Integrações, ou FOCUS_NFE_TOKEN no .env.'
    );
    err.status = 501;
    throw err;
  }
  return {
    origem: creds.origem,
    ambiente: creds.ambiente,
    checkStatus: () => checkStatus(creds),
    listarEmpresas: () => listarEmpresas(creds),
    listarWebhooks: () => listarWebhooks(creds)
  };
}

module.exports = {
  isConfigured,
  somenteHomologacao,
  assertTokenValido,
  ambienteEfetivo,
  checkStatus,
  // Fase CF — a chave mestra da conta.
  contaCredentials,
  checkStatusDaConta,
  comChaveMestra,
  listarEmpresas,
  // Fase CH — importar as empresas da conta em vez de digitar token a token.
  listarEmpresasDaConta,
  normalizarEmpresaDaConta,
  ehLeituraDeContaPermitida,
  // Uso interno (server.js, no importador): devolve token em texto.
  tokensDaConta,
  emitirNfe,
  consultarNfe,
  cancelarNfe,
  emitirCartaCorrecao,
  inutilizarNumeracao,
  criarWebhook,
  listarWebhooks,
  excluirWebhook,
  baixarArquivo,
  forEstabelecimento,
  // Fase AR — ver o bloco de comentário acima de CAMPOS_DFE.
  distribuicaoDfe,
  manifestarNfe,
  normalizarDocumento,
  normalizarMdeAutomacao,
  CAMPOS_DFE
};
