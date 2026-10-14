#!/usr/bin/env node
/**
 * O CEP PREENCHE O ENDEREÇO NA EMISSÃO DE NF-e (14/10/2026).
 *
 * Queixa do usuário: "na emissão de NF não está puxando os dados pelo CEP". Só
 * o botão "Buscar CEP" consultava; digitar ou colar um CEP novo deixava o
 * endereço antigo na nota.
 *
 * Provado no navegador (servidor local): com "RUA ANTIGA / JARAGUA DO SUL" na
 * tela, digitar 89358230 trocou para Rua Presidente Costa e Silva, Testo Rega,
 * Pomerode/SC, IBGE 4213203, sem clicar. Console limpo.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const tela = fs.readFileSync(path.join(__dirname, '..', 'public/modules/finance/subs/emitir_nfe_focus.js'), 'utf8');
const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

check('com 8 dígitos novos o CEP consulta sozinho',
  tela.includes("if (digitos.length === 8 && digitos !== ultimoCepConsultado) buscarCep({ automatico: true });"));
check('  e o CEP que veio do cadastro não dispara ao abrir',
  tela.includes("let ultimoCepConsultado = (document.querySelector('#nfeFocusForm [name=\"destCep\"]')?.value || '').replace(/\\D/g, '');"));
check('o botão continua consultando', tela.includes("document.getElementById('nfeFocusBuscarCep')?.addEventListener('click', () => buscarCep());"));
check('o CEP novo sobrescreve o endereço (não só preenche o vazio)',
  /form\.querySelector\('\[name="destLogradouro"\]'\)\.value = addr\.street \|\| '';/.test(tela));
check('quem só tem o módulo Fiscal também consulta', servidor.includes("['cadastros', 'finance', 'sales', 'fiscal']"));
check('ViaCEP fora do ar: tenta a BrasilAPI (CEP inexistente não)',
  servidor.includes('return await fetchCepViaCep(cep);') && servidor.includes('if (erro.status === 404) throw erro;')
  && servidor.includes('https://brasilapi.com.br/api/cep/v1/'));
check('  e traz o IBGE de lá', servidor.includes("ibgeCityCode: String((payload.ibge && payload.ibge.city) || ''),"));

// O DESTINATÁRIO TRAZ O ENDEREÇO DO CADASTRO (14/10/2026). Escolher a pessoa
// só preenchia nome, documento, UF, município e IE. Provado no navegador: a
// KACCAU veio com CEP 89270000, RUA 28 de Agosto, 3015, SALA 1, Amizade,
// Guaramirim/SC, IBGE 4206504. No banco local, 5.372 cadastros com número e
// 5.831 com IBGE passaram a chegar (antes, zero: as chaves não eram lidas).
check('o diretório da emissão leva o endereço do cadastro',
  servidor.includes('endereco: enderecoDaPessoa(cruPorId.get(id))'));
check('enderecoDaPessoa lê streetNumber e ibgeCityCode (as chaves do cadastro)',
  servidor.includes('numero: primeiro(p.streetNumber, p.number, p.addressNumber, p.numero),')
  && servidor.includes('codigoMunicipio: primeiro(p.ibgeCityCode, p.cityCode, p.codigoMunicipio, p.ibge)'));
check('escolher o destinatário preenche CEP e endereço',
  tela.includes("por('destCep', e.cep);") && tela.includes("por('destNumero', e.numero);") && tela.includes("por('destCodigoMunicipio', e.codigoMunicipio);"));
check('  cadastro com CEP e sem rua completa pela busca do CEP',
  tela.includes('if (cep.length === 8 && !e.logradouro) buscarCep({ automatico: true });'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
