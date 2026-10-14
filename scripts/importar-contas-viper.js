#!/usr/bin/env node
// IMPORTA CONTAS A PAGAR E A RECEBER DO VIPER (TÍTULOS EM ABERTO) — 13/10/2026.
//
//   node scripts/importar-contas-viper.js --pagar contas_a_pagar.xlsx --receber contas_a_receber.xlsx
//       só lê as planilhas e mostra o que elas têm.
//
//   ... --url https://mavisone.cloud
//       CONFERE no servidor (login de administrador), sem gravar: quantos são
//       novos e quantos já existem no Financeiro.
//
//   ... --url ... --enviar
//       grava. Reimportar não duplica.
//
// Exporte do Viper SEM filtro de vencimento (todo o em aberto). KACCAU e
// Blumenau ficam de fora. O porquê de cada regra: lib/importacao-contas-viper.js.
//
// ESPELHO (14/10/2026): o financeiro fica igual à planilha — além dos novos,
// reabre o que a carga de 11/09 deu como pago por suposição, baixa o que foi
// quitado no Viper e ajusta valor que mudou lá. Baixa real (de gente, ou a
// importada como baixa de verdade) não é desfeita: só aparece como divergência
// no relatório. Rodar duas vezes não muda nada na segunda.
// As planilhas NÃO entram no repositório.
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { lerXlsx } = require('../lib/xlsx-leitor');
const { lerPlanilha } = require('../lib/importacao-contas-viper');

const argumento = (nome) => { const i = process.argv.indexOf('--' + nome); return i >= 0 ? process.argv[i + 1] : undefined; };
const tem = (nome) => process.argv.includes('--' + nome);
const real = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) => rl.question(texto, (r) => { rl.close(); ok(r); }));
}

async function main() {
  const arquivos = [['DESPESA', argumento('pagar')], ['RECEITA', argumento('receber')]].filter(([, a]) => a);
  const faltando = arquivos.filter(([, a]) => !fs.existsSync(a));
  if (!arquivos.length || faltando.length) {
    console.error('Uso: node scripts/importar-contas-viper.js --pagar <xlsx> --receber <xlsx> [--url <endereço> [--enviar]]');
    if (faltando.length) console.error('Não encontrado: ' + faltando.map(([, a]) => a).join(', '));
    process.exitCode = 2;
    return;
  }
  let titulos = [];
  let quitados = [];
  const ignorados = [];
  for (const [tipo, arquivo] of arquivos) {
    const r = lerPlanilha(lerXlsx(arquivo), tipo);
    const vencs = r.titulos.map((t) => t.vencimento).sort();
    console.log(`${tipo === 'DESPESA' ? 'A PAGAR' : 'A RECEBER'} (${path.basename(arquivo)}): ${r.titulos.length} título(s) em aberto, ${real(r.titulos.reduce((s, t) => s + t.aberto, 0))}`
      + (vencs.length ? ` | vencimentos de ${vencs[0]} a ${vencs[vencs.length - 1]}` : ''));
    const motivos = r.ignorados.reduce((m, x) => { m[x.motivo] = (m[x.motivo] || 0) + 1; return m; }, {});
    if (r.ignorados.length) console.log('  fora:', JSON.stringify(motivos));
    titulos = titulos.concat(r.titulos);
    quitados = quitados.concat(r.quitados || []);
    ignorados.push(...r.ignorados);
  }

  const url = argumento('url');
  if (!url) {
    console.log('\nSó leitura das planilhas. Com --url <endereço>, o servidor confere (sem gravar).');
    return;
  }
  const base = String(url).replace(/\/+$/, '');
  const usuario = process.env.IMPORT_USER || 'admin';
  const senha = process.env.IMPORT_PASS || await perguntar(`Senha do usuário ${usuario} em ${base}: `);
  const chamar = async (rota, corpo, token) => {
    const r = await fetch(base + rota, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-auth-token': token } : {}) },
      body: JSON.stringify(corpo)
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${rota} respondeu ${r.status}: ${json.error || ''}`);
    return json;
  };
  const { token } = await chamar('/api/login', { username: usuario, password: senha });
  const enviar = tem('enviar');
  const r = await chamar('/api/finance/importacao/viper', { titulos, quitados, simular: !enviar }, token);

  console.log(`\n${enviar ? 'GRAVADO' : 'CONFERÊNCIA (nada gravado)'} em ${base}:`);
  for (const [rotulo, x] of [['A PAGAR:  ', r.pagar], ['A RECEBER:', r.receber]]) {
    console.log(`  ${rotulo} ${x.novos} novo(s) (${real(x.valorNovos)}) | ${x.jaExistiam} já existia(m) no Financeiro`);
    // O espelho (14/10/2026): o que muda no que já existe.
    console.log(`             reabre ${x.reaberturas} com baixa presumida da carga de 11/09 (${real(x.valorReaberto)} em aberto no Viper)`);
    console.log(`             baixa de ${x.baixas} quitado(s) no Viper (${real(x.valorBaixas)}) | ${x.ajustes} valor(es) ajustado(s) | ${x.divergencias} divergência(s) só reportada(s)`);
  }
  console.log(`  sem a pessoa no Cadastros (entram só com o nome): ${r.semPessoaNoCadastro}`);
  if (r.semEmpresa.length) console.log(`  empresa sem estabelecimento correspondente: ${r.semEmpresa.join(', ')}`);
  if (enviar) {
    console.log(`  gravados: ${r.criados} novo(s), ${r.reabertos} reaberto(s), ${r.baixados} baixa(s), ${r.ajustados} ajuste(s)${r.falhas.length ? ` | FALHAS: ${r.falhas.length}` : ''}`);
    r.falhas.forEach((f) => console.log(`    ${f.documento}: ${f.motivo}`));
  }
  const relatorio = path.join(path.dirname(path.resolve(arquivos[0][1])), `importacao-contas-relatorio-${Date.now()}.json`);
  fs.writeFileSync(relatorio, JSON.stringify({ url: base, enviado: enviar, geradoEm: new Date().toISOString(), ignorados, ...r }, null, 1));
  console.log(`Relatório: ${relatorio}`);
  if (!enviar) console.log('Para gravar, rode de novo com --enviar.');
}

// exitCode, e não process.exit(): ver scripts/completar-chaves-nfe.js.
main().catch((erro) => { console.error('\nFALHOU:', erro.message); process.exitCode = 1; });
