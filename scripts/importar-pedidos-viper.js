#!/usr/bin/env node
// IMPORTA PEDIDOS E ORÇAMENTOS DO VIPER (LISTAGEM DE VENDAS) — 12/10/2026.
//
//   node scripts/importar-pedidos-viper.js --listagem listagem_de_vendas.xlsx [--listagem outra.xlsx]
//       só lê as planilhas e mostra o que entraria e o que fica de fora.
//
//   ... --url https://mavisone.cloud
//       CONFERE no servidor (login de administrador), sem gravar: quantos
//       entrariam, quantos já existiam e quais NÚMEROS JÁ SÃO DE OUTRO
//       DOCUMENTO no MavisONE (conflitos — não são gravados).
//
//   ... --url ... --enviar
//       grava. Conflito nunca é gravado; reimportar não duplica. Ao fim, a
//       numeração do MavisONE salta para depois do maior número importado.
//
// Histórico: sem itens (a listagem não traz), sem estoque e sem financeiro.
// O que vira documento: lib/importacao-pedidos-viper.js; o que a API confere
// e grava: lib/db/pedidos-importados.js. A planilha NÃO entra no repositório.
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { lerXlsx } = require('../lib/xlsx-leitor');
const { montarPedidos } = require('../lib/importacao-pedidos-viper');

const TAMANHO_DO_LOTE = 200;
const argumento = (nome) => { const i = process.argv.indexOf('--' + nome); return i >= 0 ? process.argv[i + 1] : undefined; };
const argumentos = (nome) => process.argv.map((a, i) => (a === '--' + nome ? process.argv[i + 1] : null)).filter(Boolean);
const tem = (nome) => process.argv.includes('--' + nome);
const real = (n) => `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) => rl.question(texto, (r) => { rl.close(); ok(r); }));
}

async function main() {
  const arquivos = argumentos('listagem');
  const faltando = arquivos.filter((a) => !fs.existsSync(a));
  if (!arquivos.length || faltando.length) {
    console.error('Uso: node scripts/importar-pedidos-viper.js --listagem <xlsx> [--listagem <xlsx>] [--url <endereço> [--enviar]]');
    if (faltando.length) console.error('Não encontrado: ' + faltando.join(', '));
    process.exitCode = 2;
    return;
  }

  let documentos = [];
  const ignorados = [];
  for (const arquivo of arquivos) {
    const r = montarPedidos(lerXlsx(arquivo));
    documentos = documentos.concat(r.documentos);
    ignorados.push(...r.ignorados.map((x) => ({ ...x, arquivo: path.basename(arquivo) })));
  }
  // O mesmo número em duas planilhas: fica o primeiro.
  const vistos = new Set();
  documentos = documentos.filter((d) => { if (vistos.has(d.codigo)) { ignorados.push({ numero: String(d.codigo), motivo: 'número repetido entre as planilhas' }); return false; } vistos.add(d.codigo); return true; });

  const conta = (f) => documentos.reduce((m, d) => { const k = f(d); m[k] = (m[k] || 0) + 1; return m; }, {});
  const codigos = documentos.map((d) => d.codigo);
  console.log(`Documentos na listagem: ${documentos.length} (nº ${Math.min(...codigos)} a ${Math.max(...codigos)})`);
  console.log('  por tipo:', conta((d) => d.tipo), '| por status:', conta((d) => d.status));
  console.log(`  com número de NF: ${documentos.filter((d) => d.nota).length}`);
  console.log(`Ficam de fora: ${ignorados.length}`);
  ignorados.forEach((x) => console.log(`  nº ${x.numero} — ${x.motivo}`));

  const url = argumento('url');
  if (!url) {
    console.log('\nSó leitura da planilha. Com --url <endereço>, o servidor confere os números (sem gravar).');
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
  const total = { criados: 0, existentes: 0, conflitos: [], recusados: [], notasLigadas: 0, clientesLigados: 0, vendedoresLigados: 0 };
  for (let i = 0; i < documentos.length; i += TAMANHO_DO_LOTE) {
    const r = await chamar('/api/sales/importacao/viper', { documentos: documentos.slice(i, i + TAMANHO_DO_LOTE), simular: !enviar }, token);
    for (const k of ['criados', 'existentes', 'notasLigadas', 'clientesLigados', 'vendedoresLigados']) total[k] += r[k] || 0;
    total.conflitos.push(...r.conflitos); total.recusados.push(...r.recusados);
  }

  console.log(`\n${enviar ? 'GRAVADO' : 'CONFERÊNCIA (nada gravado)'} em ${base}:`);
  console.log(`  ${enviar ? 'gravados' : 'entrariam'}: ${total.criados} | já existiam: ${total.existentes} | recusados: ${total.recusados.length}`);
  if (enviar) console.log(`  ligados: ${total.notasLigadas} à NF-e importada, ${total.clientesLigados} ao cliente, ${total.vendedoresLigados} ao vendedor`);
  console.log(`  CONFLITOS (número já é de outro documento no MavisONE, NÃO gravados): ${total.conflitos.length}`);
  total.conflitos.forEach((c) => console.log(`    nº ${c.codigo}: Viper ${c.viper.tipo} ${c.viper.data} ${c.viper.cliente} ${real(c.viper.total)}  x  MavisONE ${c.mavisone.tabela} ${c.mavisone.data} ${c.mavisone.cliente}`));
  total.recusados.forEach((x) => console.log(`    recusado nº ${x.codigo}: ${x.motivo}`));

  const relatorio = path.join(path.dirname(path.resolve(arquivos[0])), `importacao-pedidos-relatorio-${Date.now()}.json`);
  fs.writeFileSync(relatorio, JSON.stringify({ url: base, enviado: enviar, geradoEm: new Date().toISOString(), ignorados, ...total }, null, 1));
  console.log(`Relatório: ${relatorio}`);
  if (!enviar) console.log('Para gravar, rode de novo com --enviar.');
}

// exitCode, e não process.exit(): ver scripts/completar-chaves-nfe.js.
main().catch((erro) => { console.error('\nFALHOU:', erro.message); process.exitCode = 1; });
