// Conexão com o CRM externo.
//
// Este módulo é a ÚNICA coisa que o CRM guarda no nosso banco. Oportunidades e
// contas continuam no outro sistema por decisão de projeto: duplicá-las aqui
// criaria duas fontes da verdade, e ninguém saberia qual está certa quando
// divergissem.
//
// A tabela tem uma linha só (id = 1), garantido por CHECK na migração.
const { banco, assertNoError } = require('./client');

// O token nunca sai daqui para a tela: a resposta diz se EXISTE token salvo,
// não qual é. Devolver o segredo a cada carregamento o deixaria no histórico do
// navegador e em qualquer log de rede pelo caminho.
function mapConexao(row) {
  return {
    baseUrl: row?.base_url || '',
    temToken: Boolean(row?.api_token),
    active: Boolean(row?.active),
    lastOkAt: row?.last_ok_at || null,
    lastError: row?.last_error || null
  };
}

async function lerLinha() {
  const { data, error } = await banco.from('crm_connection').select('*').eq('id', 1).maybeSingle();
  // Sem a migração Fase R a tabela não existe: a tela mostra o formulário
  // vazio em vez de quebrar.
  if (error && /does not exist|Could not find|schema cache/i.test(error.message || '')) return null;
  assertNoError(error, 'crm/lerLinha');
  return data;
}

async function getConexao() {
  return mapConexao(await lerLinha());
}

async function salvarConexao(payload) {
  const linha = {
    id: 1,
    base_url: payload.baseUrl || null,
    active: Boolean(payload.active)
  };
  // Token em branco significa "não mexer no que já está salvo". Sem isto, abrir
  // a tela e salvar qualquer outro campo apagaria a credencial.
  if (payload.apiToken) linha.api_token = payload.apiToken;
  const { error } = await banco.from('crm_connection').upsert(linha);
  assertNoError(error, 'crm/salvarConexao');
  return getConexao();
}

/**
 * Bate no CRM externo e guarda o resultado, para a tela dizer se ele está no ar
 * sem precisar testar de novo a cada abertura.
 */
async function testarConexao() {
  const linha = await lerLinha();
  if (!linha?.base_url) {
    return { ok: false, error: 'Informe o endereço do CRM antes de testar.' };
  }

  let ok = false;
  let detalhe = '';
  try {
    const resposta = await fetch(linha.base_url, {
      headers: linha.api_token ? { Authorization: `Bearer ${linha.api_token}` } : {},
      // Sem limite de tempo, um endereço que não responde deixaria a tela
      // travada esperando para sempre.
      signal: AbortSignal.timeout(8000)
    });
    ok = resposta.ok;
    detalhe = ok ? '' : `O CRM respondeu ${resposta.status}.`;
  } catch (erroRede) {
    detalhe = `Não foi possível alcançar o endereço: ${erroRede.message}`;
  }

  const { error } = await banco.from('crm_connection').upsert({
    id: 1,
    // Só sobrescreve o "última vez OK" quando realmente foi OK: um teste que
    // falha não pode apagar a memória de que um dia funcionou.
    last_ok_at: ok ? new Date().toISOString() : linha.last_ok_at,
    last_error: ok ? null : detalhe
  });
  assertNoError(error, 'crm/testarConexao');

  return { ok, error: detalhe || null };
}

module.exports = { getConexao, salvarConexao, testarConexao };
