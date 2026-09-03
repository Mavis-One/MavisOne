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

// Recusa em vez de rebaixar. Rebaixar produção para homologação mandaria um
// token de produção para a URL de homologação, e a Focus responderia 403 —
// um erro de autenticação para um problema que é de configuração. Melhor
// parar aqui, com o motivo escrito.
function assertAmbientePermitido(ambienteBruto) {
  const info = ambienteEfetivo(ambienteBruto);
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

async function focusRequest(method, path, body, credentials) {
  const creds = credentials || envCredentials();
  if (!creds.token) {
    const err = new Error('Focus NFe não está configurado — falta o token (FOCUS_NFE_TOKEN no .env ou token do estabelecimento).');
    err.status = 501;
    throw err;
  }

  const ambiente = assertAmbientePermitido(creds.ambiente);
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

// Cliente já vinculado ao token de um estabelecimento específico — usar isso
// (em vez das funções soltas acima) em qualquer fluxo real de emissão.
async function forEstabelecimento(estabelecimentoId) {
  const { getEstabelecimentoFocusCredentials } = require('./db/fiscal');
  let creds = await getEstabelecimentoFocusCredentials(estabelecimentoId);

  // Sem token próprio, cai no token global do .env — mas SÓ com a trava de
  // homologação ligada. Em produção o token é quem identifica o emitente para
  // a Focus: um token global emitindo por um estabelecimento que não é o dele
  // sairia com o CNPJ errado na nota, e nota autorizada não tem desfazer. Em
  // teste, esse mesmo atalho evita recadastrar o token em cada filial.
  if (!creds && somenteHomologacao()) {
    const global = envCredentials();
    if (global.token) creds = { token: global.token, ambiente: 'homologacao' };
  }

  if (!creds) {
    const err = new Error(
      somenteHomologacao()
        ? 'Este estabelecimento não tem token da Focus NFe configurado, e também não há FOCUS_NFE_TOKEN no .env para usar como padrão de teste.'
        : 'Este estabelecimento não tem token da Focus NFe configurado. Em produção cada estabelecimento precisa do token próprio — é ele que identifica o emitente para a Focus.'
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
  chave: ['chave_nfe', 'chave', 'chNFe', 'chave_acesso'],
  emitenteDocumento: ['cnpj_emitente', 'emitente_cnpj', 'CNPJ', 'cnpj'],
  emitenteNome: ['nome_emitente', 'emitente_nome', 'xNome', 'razao_social_emitente'],
  dataEmissao: ['data_emissao', 'dhEmi', 'data', 'emissao'],
  valorTotal: ['valor_total', 'valor', 'vNF', 'valor_nota'],
  // O XML completo, quando a nota já pode ser baixada.
  xml: ['xml', 'xml_nfe', 'procNFe', 'documento'],
  // O que a Focus chama de tipo/schema do documento devolvido.
  tipo: ['tipo', 'schema', 'tipo_documento']
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

module.exports = {
  isConfigured,
  somenteHomologacao,
  assertTokenValido,
  ambienteEfetivo,
  checkStatus,
  listarEmpresas,
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
  CAMPOS_DFE
};
