#!/usr/bin/env node
// IMPORTA PRODUTOS DO VIPER (PLANILHA "PRODUTOS") — 12/10/2026.
//
//   node scripts/importar-produtos-viper.js --planilha produtos1.xlsx
//       só lê a planilha e mostra o que ela tem.
//
//   ... --url https://mavisone.cloud
//       CONFERE no servidor (login de administrador), sem gravar: quantos
//       produtos são novos e quantos NCM vazios seriam preenchidos.
//
//   ... --url ... --enviar
//       grava. Reimportar não duplica.
//
// Entram: os produtos cujo código não existe no MavisONE, e o NCM nos que
// estão sem NCM aqui. NÃO entram estoque, preço dos que já existem nem NCM
// diferente — o porquê está em lib/importacao-produtos-viper.js. A planilha
// NÃO entra no repositório.
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { lerXlsx } = require('../lib/xlsx-leitor');
const { lerPlanilha } = require('../lib/importacao-produtos-viper');

const argumento = (nome) => { const i = process.argv.indexOf('--' + nome); return i >= 0 ? process.argv[i + 1] : undefined; };
const tem = (nome) => process.argv.includes('--' + nome);
const real = (n) => `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) => rl.question(texto, (r) => { rl.close(); ok(r); }));
}

async function main() {
  const arquivo = argumento('planilha');
  if (!arquivo || !fs.existsSync(arquivo)) {
    console.error('Uso: node scripts/importar-produtos-viper.js --planilha <xlsx> [--url <endereço> [--enviar]]');
    if (arquivo) console.error('Não encontrado: ' + arquivo);
    process.exitCode = 2;
    return;
  }
  const { empresa, itens, ignorados } = lerPlanilha(lerXlsx(arquivo));
  console.log(`Planilha: ${path.basename(arquivo)} — ${empresa || 'empresa não identificada'}`);
  console.log(`  produtos: ${itens.length} | ativos: ${itens.filter((i) => i.ativo).length} | inativos: ${itens.filter((i) => !i.ativo).length} | sem NCM: ${itens.filter((i) => !i.ncm).length}`);
  ignorados.forEach((x) => console.log(`  fora: ${x.codigo} — ${x.motivo}`));

  const url = argumento('url');
  if (!url) {
    console.log('\nSó leitura da planilha. Com --url <endereço>, o servidor confere (sem gravar).');
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

  // Uma chamada só: os novos e o NCM entram na mesma transação.
  const enviar = tem('enviar');
  const r = await chamar('/api/stock/importacao/viper', { itens, simular: !enviar }, token);

  console.log(`\n${enviar ? 'GRAVADO' : 'CONFERÊNCIA (nada gravado)'} em ${base}:`);
  console.log(`  já existiam: ${r.existentes}`);
  console.log(`  produtos novos: ${enviar ? r.criados + ' gravados' : r.novos.length + ' entrariam'} (${r.novos.filter((n) => !n.ativo).length} inativos, ${r.novos.filter((n) => !n.preco).length} sem preço, ${r.novos.filter((n) => !n.ncm).length} sem NCM)`);
  console.log(`  NCM preenchido onde estava vazio: ${enviar ? r.ncmPreenchidos + ' gravados' : r.ncm.length + ' seriam'}`);
  if (!enviar) {
    r.novos.slice(0, 15).forEach((n) => console.log(`    novo ${n.codigo}  ${n.nome.slice(0, 60)}  ${real(n.preco)}  NCM ${n.ncm || '-'}${n.ativo ? '' : '  (inativo)'}`));
    if (r.novos.length > 15) console.log(`    ... e mais ${r.novos.length - 15} (todos no relatório)`);
  }

  const relatorio = path.join(path.dirname(path.resolve(arquivo)), `importacao-produtos-relatorio-${Date.now()}.json`);
  fs.writeFileSync(relatorio, JSON.stringify({ url: base, enviado: enviar, geradoEm: new Date().toISOString(), empresa, ignorados, ...r }, null, 1));
  console.log(`Relatório: ${relatorio}`);
  if (!enviar) console.log('Para gravar, rode de novo com --enviar.');
}

// exitCode, e não process.exit(): ver scripts/completar-chaves-nfe.js.
main().catch((erro) => { console.error('\nFALHOU:', erro.message); process.exitCode = 1; });
