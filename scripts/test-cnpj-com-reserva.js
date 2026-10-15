#!/usr/bin/env node
/**
 * CONSULTA DE CNPJ COM RESERVA (14/10/2026).
 *
 * Queixa do usuário: "Consulta CNPJ SEFAZ não está funcionando". Medido: a
 * BrasilAPI, única fonte, respondia "Request failed with status code 503". A
 * consulta agora tenta BrasilAPI -> CNPJ.ws pública -> ReceitaWS, no mesmo
 * formato. Provado no navegador com a BrasilAPI fora: 43.792.899/0002-16 veio
 * pela CNPJ.ws com razão social, situação, CNAE, endereço, e-mail e telefone.
 *
 * 15/10/2026 (cadastro de pessoa jurídica): a BrasilAPI caía depois de 5,3 s,
 * a tela gravava logradouro e número em campos que o formulário não usa, e
 * salvar reconsultava e sobrescrevia o que foi digitado. Provado no navegador:
 * consulta em 2 s com logradouro, número, IBGE e IE; gravar não sobrescreve.
 *
 * Sem internet neste teste: as funções do servidor rodam com as fontes
 * simuladas (vm), cenário por cenário.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const documento = fs.readFileSync(path.join(__dirname, '..', 'public/modules/shared/documento.js'), 'utf8');

// 15/10/2026: a BrasilAPI respondia 500 depois de 5,3 s e toda consulta
// esperava isso. A ordem passou a ser CNPJ.ws (traz IE e IBGE) -> BrasilAPI
// em corrida depois de 1,5 s -> ReceitaWS. O comportamento é provado abaixo,
// rodando as funções do servidor com as fontes simuladas.
check('as três no mesmo formato', (servidor.match(/return resultadoDoCnpj\(cnpj, \{/g) || []).length === 3);
check('o IBGE vai separado do SIAFI, venha de onde vier',
  servidor.includes('codigoMunicipioIbge: payload.codigo_municipio_ibge,') && servidor.includes('codigoMunicipioIbge: e.cidade && e.cidade.ibge_id,')
  && documento.includes('codigoMunicipioIbge: String(oficial.codigoMunicipioIbge || oficial?.raw?.codigo_municipio_ibge || \'\'),'));

// --- o comportamento, com as fontes simuladas -------------------------------
// As funções reais de server.js (de fetchWithTimeout ao fim de fetchCepViaCep),
// num contexto isolado em que `fetch` responde o que cada cenário manda.
const vm = require('vm');
const ini = servidor.indexOf('async function fetchWithTimeout(');
const fimCep = servidor.indexOf('\n}\n', servidor.indexOf('async function fetchCepViaCep(')) + 3;
const trecho = servidor.slice(ini, fimCep);

function montar(cenario) {
  const chamadas = [];
  const fetchFalso = (url) => {
    const regra = Object.entries(cenario).find(([pedaco]) => url.includes(pedaco));
    chamadas.push(url);
    const [status, corpo, atraso] = regra ? regra[1] : [503, {}, 0];
    return new Promise((resolve) => setTimeout(() => resolve({
      ok: status >= 200 && status < 300, status, json: async () => corpo, text: async () => JSON.stringify(corpo)
    }), atraso || 0));
  };
  const ctx = vm.createContext({
    fetch: fetchFalso, setTimeout, clearTimeout, AbortController, Promise, AggregateError, Error, String, Number, Array, Object, JSON,
    sanitizeDigits: (v) => String(v || '').replace(/\D/g, '')
  });
  vm.runInContext(trecho + '\n;this.f = { fetchCnpjOfficialData, fetchCepData };', ctx);
  return { ...ctx.f, chamadas };
}

const WS_OK = [200, { razao_social: 'SAL INFINITY PLUS COMERCIO LTDA', estabelecimento: {
  cnpj: '43792899000135', nome_fantasia: null, situacao_cadastral: 'Ativa', tipo_logradouro: 'RUA', logradouro: 'REINOLDO RAU', numero: '696',
  complemento: 'SALA  01', bairro: 'CENTRO', cep: '89251600', cidade: { nome: 'Jaraguá do Sul', ibge_id: 4208906 }, estado: { sigla: 'SC' },
  inscricoes_estaduais: [{ inscricao_estadual: '999', ativo: false, estado: { sigla: 'SC' } }, { inscricao_estadual: '261345958', ativo: true, estado: { sigla: 'SC' } }]
} }];
const BRASIL_OK = [200, { cnpj: '43792899000135', razao_social: 'SAL INFINITY PLUS COMERCIO LTDA', logradouro: 'RUA REINOLDO RAU', numero: '696', municipio: 'JARAGUA DO SUL', uf: 'SC', cep: '89251600', codigo_municipio_ibge: 4208906 }];
const RECEITA_OK = [200, { nome: 'SAL INFINITY PLUS COMERCIO LTDA', logradouro: 'RUA REINOLDO RAU', numero: '696', municipio: 'JARAGUA DO SUL', uf: 'SC', cep: '89.251-600', abertura: '06/10/2021' }];
const VIACEP_OK = [200, { cep: '89251-600', logradouro: 'Rua Reinoldo Rau', complemento: 'até 478/479', bairro: 'Centro', localidade: 'Jaraguá do Sul', uf: 'SC', ibge: '4208906' }];

(async () => {
  console.log('\n--- CNPJ: a ordem e a corrida (fontes simuladas) ---');
  let t = montar({ 'cnpj.ws': WS_OK, brasilapi: BRASIL_OK });
  let r = await t.fetchCnpjOfficialData('43792899000135');
  check('CNPJ.ws responde: vale ela, com a IE ATIVA da UF e o IBGE, sem gastar a BrasilAPI',
    r.fonte === 'CNPJ.ws' && r.inscricaoEstadual === '261345958' && r.codigoMunicipioIbge === '4208906' && !t.chamadas.some((u) => u.includes('brasilapi')));
  check('  espaços repetidos da Receita saem ("SALA  01" -> "SALA 01")', r.endereco.complemento === 'SALA 01');

  t = montar({ 'cnpj.ws': [200, WS_OK[1], 4000], brasilapi: [200, BRASIL_OK[1], 100] });
  let t0 = Date.now();
  r = await t.fetchCnpjOfficialData('43792899000135');
  check('CNPJ.ws lenta: a BrasilAPI entra depois de 1,5 s e vale a primeira', r.fonte === 'BrasilAPI' && Date.now() - t0 < 2500);

  t = montar({ 'cnpj.ws': [429, {}], brasilapi: [500, { message: 'Request failed with status code 503' }], receitaws: RECEITA_OK, viacep: VIACEP_OK });
  r = await t.fetchCnpjOfficialData('43792899000135');
  check('as duas caídas: ReceitaWS, e o IBGE que ela não traz vem do CEP', r.fonte === 'ReceitaWS' && r.codigoMunicipioIbge === '4208906');

  t = montar({ 'cnpj.ws': [404, {}], brasilapi: [404, { message: 'CNPJ não encontrado' }], receitaws: [200, { status: 'ERROR', message: 'CNPJ inválido' }] });
  let erro = null;
  try { await t.fetchCnpjOfficialData('11111111000191'); } catch (e) { erro = e; }
  check('CNPJ que ninguém acha: 404 "não encontrado na Receita"', erro && erro.status === 404 && /não encontrado/.test(erro.message));

  t = montar({ 'cnpj.ws': [503, {}], brasilapi: [500, {}], receitaws: [502, {}] });
  erro = null;
  try { await t.fetchCnpjOfficialData('43792899000135'); } catch (e) { erro = e; }
  check('todas fora do ar: 503 com mensagem clara', erro && erro.status === 503 && /não estão respondendo/.test(erro.message));

  console.log('\n--- CEP ---');
  t = montar({ viacep: [503, {}], 'brasilapi.com.br/api/cep': [200, { cep: '89251600', street: 'Rua Reinoldo Rau', neighborhood: 'Centro', city: 'Jaraguá do Sul', state: 'SC', ibge: { city: '4208906' } }] });
  r = await t.fetchCepData('89251600');
  check('ViaCEP com erro de servidor: a BrasilAPI responde (antes virava "CEP não encontrado")', r.city === 'Jaraguá do Sul' && r.ibgeCityCode === '4208906');
  t = montar({ viacep: [200, { erro: 'true' }], 'brasilapi.com.br/api/cep': [200, { city: 'X' }] });
  erro = null;
  try { await t.fetchCepData('99999999'); } catch (e) { erro = e; }
  check('CEP que o ViaCEP diz não existir: 404, sem ir à reserva', erro && erro.status === 404 && !t.chamadas.some((u) => u.includes('/api/cep')));
  t = montar({ viacep: VIACEP_OK });
  r = await t.fetchCepData('89251600');
  check('a faixa do CEP ("até 478/479") não vira complemento do endereço', r.complement === '' && r.street === 'Rua Reinoldo Rau');

  console.log('\n--- a gravação do cadastro ---');
  check('o que foi digitado vence: os dados oficiais só preenchem o vazio',
    servidor.includes("if (vazio(valor) || !vazio(saida[campo]) || (jaTem && !vazio(jaTem))) return;"));
  check('  consulta só na criação e só se faltar obrigatório',
    (servidor.match(/lookupCnpj !== false && faltaDadoObrigatorio\(digitado\)/g) || []).length === 2
    && (servidor.match(/Editar não reconsulta o CNPJ/g) || []).length === 2);
  check('  logradouro e número em street/streetNumber (o que a NF-e lê), não no address concatenado',
    servidor.includes("preencher('street', e.logradouro, saida.address);") && servidor.includes("preencher('streetNumber', e.numero, saida.addressNumber);")
    && !/address: \(\w+ && \w+\.enderecoCompleto\)/.test(servidor));
  const app = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');
  check('a tela preenche os campos do formulário (street, streetNumber, IBGE, IE)',
    app.includes("street: official.endereco?.logradouro || formData.get('street') || '',")
    && app.includes("ibgeCityCode: official.codigoMunicipioIbge || formData.get('ibgeCityCode') || '',")
    && app.includes("stateRegistration: official.inscricaoEstadual || formData.get('stateRegistration') || '',"));
  check('o CEP só reescreve o endereço quando muda', app.includes('if (cep.length !== 8 || cep === cepAplicado) return;'));
  const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  check('a IE também chega à NF-e, ao cliente rápido e ao estabelecimento (só no campo vazio)',
    documento.includes("inscricaoEstadual: String(oficial.inscricaoEstadual || ''),")
    && ler('public/modules/finance/subs/emitir_nfe_focus.js').includes("preencher('destIe', dados.inscricaoEstadual);")
    && ler('public/modules/shared/atalhos.js').includes("preencher('stateRegistration', dados.inscricaoEstadual);")
    && ler('public/modules/settings/subs/fiscal.js').includes("preencher('inscricaoEstadual', dados.inscricaoEstadual);"));

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
  process.exit(falhas ? 1 : 0);
})();
