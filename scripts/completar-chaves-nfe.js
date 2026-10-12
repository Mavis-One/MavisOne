#!/usr/bin/env node
// COMPLETA A CHAVE DAS NF-e IMPORTADAS QUE VIERAM SEM ELA (12/10/2026).
//
//   node scripts/completar-chaves-nfe.js --pasta <pasta> [--pasta <outra>] [--arquivo <planilha/xml/txt>]
//       lê PDFs (DANFE, carta de correção), planilhas (.xlsx/.csv), XMLs e
//       textos (.txt, inclusive SPED) das pastas e arquivos indicados, extrai
//       as chaves e mostra o resumo por CNPJ. Não grava nada.
//
//   ... --enviar [--url https://mavisone.cloud] [--recebidas]
//       manda as chaves para a API (só administrador; IMPORT_USER/IMPORT_PASS
//       ou a senha pedida na tela). A API só PREENCHE nota importada que já
//       existe — mesmo CNPJ, número e mês — e nunca cria nota.
//       --recebidas completa também as ENTRADAS de fornecedor a partir das
//       notas recebidas já buscadas na SEFAZ (a busca em Notas contra CNPJ já
//       faz isso sozinha ao terminar).
//
// Por que documentos: a SEFAZ não lista as notas que nós emitimos, e a chave
// tem 8 dígitos aleatórios — ela só sai de um documento da própria nota.
//
// PDFs precisam do pdftotext (vem com o Git para Windows). Nada disso entra no
// repositório.
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');
const { chavesDoTexto, partesDaChave } = require('../lib/importacao-nfe-viper');
const { lerXlsx } = require('../lib/xlsx-leitor');

const TAMANHO_DO_LOTE = 300;
const LIDOS = /\.(pdf|xlsx|csv|xml|txt)$/i;
const argumento = (nome) => { const i = process.argv.indexOf('--' + nome); return i >= 0 ? process.argv[i + 1] : undefined; };
const argumentos = (nome) => process.argv.map((a, i) => (a === '--' + nome ? process.argv[i + 1] : null)).filter(Boolean);
const tem = (nome) => process.argv.includes('--' + nome);

function acharPdftotext() {
  const candidatos = ['pdftotext', 'C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe', '/mingw64/bin/pdftotext', '/usr/bin/pdftotext'];
  for (const c of candidatos) {
    try { execFileSync(c, ['-v'], { stdio: 'pipe' }); return c; } catch (e) { if (e.status !== undefined && e.status !== null) return c; }
  }
  return null;
}

function arquivosDa(pasta) {
  const lista = [];
  (function varrer(dir) {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome);
      if (fs.statSync(p).isDirectory()) varrer(p);
      else if (LIDOS.test(nome) && !/^~\$/.test(nome)) lista.push(p);
    }
  })(pasta);
  return lista;
}

function textoDe(arquivo, pdftotext) {
  try {
    if (/\.pdf$/i.test(arquivo)) return execFileSync(pdftotext, ['-layout', '-enc', 'UTF-8', arquivo, '-'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
    if (/\.xlsx$/i.test(arquivo)) return lerXlsx(arquivo).map((aba) => aba.linhas.map((l) => l.join(' ')).join('\n')).join('\n');
    return fs.readFileSync(arquivo, 'latin1');
  } catch (e) {
    return '';
  }
}

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) => rl.question(texto, (r) => { rl.close(); ok(r); }));
}

async function main() {
  const pastas = argumentos('pasta');
  const soltos = argumentos('arquivo');
  const faltando = [...pastas, ...soltos].filter((p) => !fs.existsSync(p));
  if ((!pastas.length && !soltos.length) || faltando.length) {
    console.error('Uso: node scripts/completar-chaves-nfe.js --pasta <pasta> [--arquivo <planilha/xml/txt>] [--enviar --url <endereço>] [--recebidas]');
    if (faltando.length) console.error('Não encontrado: ' + faltando.join(', '));
    process.exitCode = 2;
    return;
  }
  const arquivos = [...pastas.flatMap(arquivosDa), ...soltos];
  const temPdf = arquivos.some((a) => /\.pdf$/i.test(a));
  const pdftotext = temPdf ? acharPdftotext() : null;
  if (temPdf && !pdftotext) {
    console.error('pdftotext não encontrado. Ele vem com o Git para Windows (C:\\Program Files\\Git\\mingw64\\bin).');
    process.exitCode = 2;
    return;
  }

  console.log(`Lendo ${arquivos.length} arquivo(s)...`);
  const porChave = new Map();
  let semChave = 0;
  for (const arquivo of arquivos) {
    const chaves = chavesDoTexto(textoDe(arquivo, pdftotext));
    if (!chaves.length) semChave += 1;
    for (const chave of chaves) if (!porChave.has(chave)) porChave.set(chave, path.basename(arquivo));
  }
  const chaves = [...porChave.entries()].map(([chave, origem]) => ({ chave, origem }));
  const porCnpj = {};
  chaves.forEach(({ chave }) => { const { cnpj, modelo } = partesDaChave(chave); const k = `${cnpj} (modelo ${modelo})`; porCnpj[k] = (porCnpj[k] || 0) + 1; });
  console.log(`Chaves encontradas: ${chaves.length} (arquivos sem chave legível: ${semChave})`);
  Object.entries(porCnpj).sort().forEach(([k, n]) => console.log(`  ${k}: ${n}`));

  if (!tem('enviar')) {
    console.log('\nSó conferência — nada foi enviado. Para completar as notas, rode de novo com --enviar.');
    return;
  }

  const url = String(argumento('url') || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, '');
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
  const total = { completadas: 0, jaTinham: 0, semNota: [], ambiguas: [], invalidas: 0 };
  for (let i = 0; i < chaves.length; i += TAMANHO_DO_LOTE) {
    const r = await chamar('POST', '/api/fiscal/importacao/completar-chaves', { chaves: chaves.slice(i, i + TAMANHO_DO_LOTE) }, token);
    total.completadas += r.completadas; total.jaTinham += r.jaTinham; total.invalidas += r.invalidas;
    total.semNota.push(...r.semNota); total.ambiguas.push(...r.ambiguas);
  }
  if (tem('recebidas')) {
    const rec = await chamar('POST', '/api/fiscal/importacao/completar-chaves-recebidas', {}, token);
    total.entradasCompletadas = rec.completadas;
  }
  const base = pastas[0] ? path.join(path.resolve(pastas[0]), '..') : path.dirname(path.resolve(soltos[0]));
  const relatorio = path.join(base, `completar-chaves-relatorio-${Date.now()}.json`);
  fs.writeFileSync(relatorio, JSON.stringify({ url, geradoEm: new Date().toISOString(), ...total }, null, 1));
  console.log(`\nPronto: ${total.completadas} notas completadas, ${total.jaTinham} chaves já estavam no sistema, ${total.semNota.length} sem nota correspondente, ${total.ambiguas.length} ambíguas.`
    + (total.entradasCompletadas !== undefined ? ` Entradas de fornecedor completadas: ${total.entradasCompletadas}.` : ''));
  console.log(`Relatório: ${relatorio}`);
}

// exitCode, e não process.exit(): sair à força com a conexão aberta faz o Node
// no Windows imprimir "Assertion failed ... UV_HANDLE_CLOSING" (ruído, mas assusta).
main().catch((erro) => { console.error('\nFALHOU:', erro.message); process.exitCode = 1; });
