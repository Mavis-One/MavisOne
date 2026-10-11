#!/usr/bin/env node
// IMPORTA AS NF-e DO VIPER PARA O MAVISONE (fase DX, 11/10/2026).
//
//   node scripts/importar-nfe-viper.js --detalhada NFe_SAL_Infinity.xlsx --listagem documentos_fiscais.xlsx
//       só CONFERE: lê as planilhas, mostra o que entraria e o que fica de
//       fora, e não grava nada.
//
//   ... --enviar [--url http://127.0.0.1:3000] [--lote viper-2026-10-11]
//       grava, pela API, com login de administrador (IMPORT_USER, padrão
//       "admin", e IMPORT_PASS no ambiente). --url aceita o endereço do VPS:
//       a planilha não precisa ir para o servidor.
//
// As duas planilhas são opcionais (pelo menos uma). O que vira documento e por
// quê está em lib/importacao-nfe-viper.js; o que a API confere e grava, em
// lib/db/nfe-importadas.js. REIMPORTAR NÃO DUPLICA: nota já gravada conta como
// "já existia".
//
// Ao fim, um relatório JSON (ignorados e recusados, linha a linha) é escrito
// ao lado da primeira planilha.
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { lerXlsx } = require('../lib/xlsx-leitor');
const { montarImportacao } = require('../lib/importacao-nfe-viper');

const TAMANHO_DO_LOTE = 200;

function argumento(nome) {
  const i = process.argv.indexOf('--' + nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const tem = (nome) => process.argv.includes('--' + nome);

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) => rl.question(texto, (r) => { rl.close(); ok(r); }));
}

async function main() {
  const arqDetalhada = argumento('detalhada');
  const arqListagem = argumento('listagem');
  if (!arqDetalhada && !arqListagem) {
    console.error('Uso: node scripts/importar-nfe-viper.js --detalhada <xlsx> --listagem <xlsx> [--enviar --url <endereço>]');
    process.exit(2);
  }
  console.log('Lendo as planilhas...');
  const { documentos, ignorados, resumo } = montarImportacao({
    detalhada: arqDetalhada ? lerXlsx(arqDetalhada) : null,
    listagem: arqListagem ? lerXlsx(arqListagem) : null
  });

  console.log(`\nDocumentos a importar: ${resumo.total}`);
  // Todas entram como histórico, fora do SPED (fase DY).
  console.log(`  completas (chave + itens): ${resumo.completas}`);
  console.log(`  só cabeçalho (sem chave):  ${resumo.soCabecalho}`);
  console.log(`  itens: ${resumo.itens} | canceladas: ${resumo.canceladas}`);
  console.log('  por tipo:', resumo.porTipo);
  console.log('  por estabelecimento:', resumo.porEstabelecimento);
  console.log(`Ficam de fora: ${ignorados.length}`);
  const motivos = {};
  ignorados.forEach((x) => { const k = x.motivo.replace(/\s*\(.*$/, ''); motivos[k] = (motivos[k] || 0) + 1; });
  Object.entries(motivos).forEach(([k, v]) => console.log(`  ${v} — ${k}`));

  // O maior número EMITIDO por CNPJ e série: é contra ele que a numeração
  // da Focus tem de estar acima, senão a próxima nota repete um número.
  const maiores = {};
  documentos.filter((d) => d.emissaoPropria && d.sentido === 'SAIDA').forEach((d) => {
    const k = `${d.estabelecimentoCnpj} série ${d.serie || '?'}`;
    maiores[k] = Math.max(maiores[k] || 0, Number(d.numero));
  });
  console.log('\nMaior número de NF-e de saída por CNPJ/série (compare com a numeração da Focus):');
  Object.entries(maiores).sort().forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  const relatorio = { geradoEm: new Date().toISOString(), resumo, ignorados, recusados: [] };
  const arqRelatorio = path.join(path.dirname(path.resolve(arqDetalhada || arqListagem)), `importacao-nfe-relatorio-${Date.now()}.json`);

  if (!tem('enviar')) {
    fs.writeFileSync(arqRelatorio, JSON.stringify(relatorio, null, 1));
    console.log(`\nSó conferência — nada foi gravado. Relatório: ${arqRelatorio}`);
    console.log('Para gravar, rode de novo com --enviar.');
    return;
  }

  const url = String(argumento('url') || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, '');
  const lote = argumento('lote') || `viper-${new Date().toISOString().slice(0, 10)}`;
  const usuario = process.env.IMPORT_USER || 'admin';
  const senha = process.env.IMPORT_PASS || await perguntar(`Senha do usuário ${usuario} em ${url}: `);

  const chamar = async (metodo, rota, corpo, token) => {
    const r = await fetch(url + rota, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-auth-token': token } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${rota} respondeu ${r.status}: ${json.error || ''}`);
    return json;
  };

  const { token } = await chamar('POST', '/api/login', { username: usuario, password: senha });
  console.log(`\nEnviando para ${url} (lote "${lote}"), ${TAMANHO_DO_LOTE} por vez...`);
  const total = { criados: 0, existentes: 0, recusados: 0 };
  for (let i = 0; i < documentos.length; i += TAMANHO_DO_LOTE) {
    const parte = documentos.slice(i, i + TAMANHO_DO_LOTE);
    const r = await chamar('POST', '/api/fiscal/importacao/nfe', { lote, documentos: parte }, token);
    total.criados += r.criados; total.existentes += r.existentes; total.recusados += r.recusados.length;
    relatorio.recusados.push(...r.recusados);
    console.log(`  ${Math.min(i + TAMANHO_DO_LOTE, documentos.length)}/${documentos.length} — novos ${r.criados}, já existiam ${r.existentes}, recusados ${r.recusados.length}`);
  }
  relatorio.envio = { url, lote, ...total };
  fs.writeFileSync(arqRelatorio, JSON.stringify(relatorio, null, 1));
  console.log(`\nPronto: ${total.criados} gravados, ${total.existentes} já existiam, ${total.recusados} recusados.`);
  console.log(`Relatório: ${arqRelatorio}`);
}

main().catch((erro) => { console.error('\nFALHOU:', erro.message); process.exit(1); });
