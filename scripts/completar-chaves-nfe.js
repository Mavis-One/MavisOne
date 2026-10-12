#!/usr/bin/env node
// COMPLETA A CHAVE DAS NF-e IMPORTADAS QUE VIERAM SEM ELA (12/10/2026).
//
//   node scripts/completar-chaves-nfe.js --pasta "C:\Users\...\Downloads\NFe's"
//       lê os PDFs (DANFE, carta de correção), extrai as chaves e mostra o
//       resumo por CNPJ. Não grava nada.
//
//   ... --enviar [--url https://mavisone.cloud]
//       manda as chaves para a API (só administrador; IMPORT_USER/IMPORT_PASS
//       ou a senha pedida na tela). A API só PREENCHE nota importada que já
//       existe — mesmo CNPJ, número e mês — e nunca cria nota.
//
// Por que PDFs: a SEFAZ não lista as notas que nós emitimos, e a chave tem 8
// dígitos aleatórios — ela só sai de um documento da própria nota. As notas
// que o Viper listou sem chave (filiais e Electric) ganham a chave do DANFE.
//
// Precisa do pdftotext (vem com o Git para Windows). Os PDFs NÃO entram no
// repositório.
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');
const { chavesDoTexto, partesDaChave } = require('../lib/importacao-nfe-viper');

const TAMANHO_DO_LOTE = 300;
const argumento = (nome) => { const i = process.argv.indexOf('--' + nome); return i >= 0 ? process.argv[i + 1] : undefined; };
const tem = (nome) => process.argv.includes('--' + nome);

function acharPdftotext() {
  const candidatos = ['pdftotext', 'C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe', '/mingw64/bin/pdftotext', '/usr/bin/pdftotext'];
  for (const c of candidatos) {
    try { execFileSync(c, ['-v'], { stdio: 'pipe' }); return c; } catch (e) { if (e.status !== undefined && e.status !== null) return c; }
  }
  return null;
}

function pdfsDa(pasta) {
  const lista = [];
  (function varrer(dir) {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome);
      if (fs.statSync(p).isDirectory()) varrer(p);
      else if (/\.pdf$/i.test(nome)) lista.push(p);
    }
  })(pasta);
  return lista;
}

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) => rl.question(texto, (r) => { rl.close(); ok(r); }));
}

async function main() {
  const pasta = argumento('pasta');
  if (!pasta || !fs.existsSync(pasta)) {
    console.error('Uso: node scripts/completar-chaves-nfe.js --pasta <pasta com os PDFs> [--enviar --url <endereço>]');
    process.exit(2);
  }
  const pdftotext = acharPdftotext();
  if (!pdftotext) {
    console.error('pdftotext não encontrado. Ele vem com o Git para Windows (C:\\Program Files\\Git\\mingw64\\bin).');
    process.exit(2);
  }

  const arquivos = pdfsDa(pasta);
  console.log(`Lendo ${arquivos.length} PDF(s)...`);
  const porChave = new Map();
  let semChave = 0;
  for (const arquivo of arquivos) {
    let texto = '';
    try { texto = execFileSync(pdftotext, ['-layout', '-enc', 'UTF-8', arquivo, '-'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'); } catch (e) { texto = ''; }
    const chaves = chavesDoTexto(texto);
    if (!chaves.length) semChave += 1;
    for (const chave of chaves) if (!porChave.has(chave)) porChave.set(chave, path.basename(arquivo));
  }
  const chaves = [...porChave.entries()].map(([chave, origem]) => ({ chave, origem }));
  const porCnpj = {};
  chaves.forEach(({ chave }) => { const { cnpj } = partesDaChave(chave); porCnpj[cnpj] = (porCnpj[cnpj] || 0) + 1; });
  console.log(`Chaves encontradas: ${chaves.length} (PDFs sem chave legível: ${semChave})`);
  Object.entries(porCnpj).sort().forEach(([cnpj, n]) => console.log(`  ${cnpj}: ${n}`));

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
  const relatorio = path.join(path.resolve(pasta), '..', `completar-chaves-relatorio-${Date.now()}.json`);
  fs.writeFileSync(relatorio, JSON.stringify({ url, geradoEm: new Date().toISOString(), ...total }, null, 1));
  console.log(`\nPronto: ${total.completadas} notas completadas, ${total.jaTinham} chaves já estavam no sistema, ${total.semNota.length} sem nota correspondente, ${total.ambiguas.length} ambíguas.`);
  console.log(`Relatório: ${relatorio}`);
}

// exitCode, e não process.exit(): sair à força com a conexão aberta faz o Node
// no Windows imprimir "Assertion failed ... UV_HANDLE_CLOSING" (ruído, mas assusta).
main().catch((erro) => { console.error('\nFALHOU:', erro.message); process.exitCode = 1; });
