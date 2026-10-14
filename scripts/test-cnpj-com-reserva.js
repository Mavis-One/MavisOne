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
 * Sem internet neste teste: confere a cadeia e o formato no código.
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
const cadeia = servidor.slice(servidor.indexOf('async function fetchCnpjOfficialData(cnpj) {'), servidor.indexOf('async function fetchCnpjOfficialData(cnpj) {') + 900);

check('BrasilAPI primeiro, depois CNPJ.ws e ReceitaWS',
  cadeia.includes('return await cnpjPelaBrasilApi(cnpj);') && cadeia.includes('for (const reserva of [cnpjPelaCnpjWs, cnpjPelaReceitaWs]) {'));
check('CNPJ inexistente (404) não vai para as reservas', cadeia.includes('if (erroBrasilApi.status === 404) throw erroBrasilApi;'));
check('as três caem fora: mensagem clara, não a do provedor', cadeia.includes('Os serviços de consulta de CNPJ não estão respondendo agora'));
check('as três no mesmo formato', (servidor.match(/return resultadoDoCnpj\(cnpj, \{/g) || []).length === 3);
check('o IBGE vai separado do SIAFI, venha de onde vier',
  servidor.includes('codigoMunicipioIbge: payload.codigo_municipio_ibge,') && servidor.includes('codigoMunicipioIbge: e.cidade && e.cidade.ibge_id,')
  && documento.includes('codigoMunicipioIbge: String(oficial.codigoMunicipioIbge || oficial?.raw?.codigo_municipio_ibge || \'\'),'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
