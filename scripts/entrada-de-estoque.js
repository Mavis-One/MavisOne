#!/usr/bin/env node
// ENTRADA DE ESTOQUE EM LOTE NUM DEPÓSITO — 13/10/2026.
//
// Pedido do usuário: "adicionar ao estoque da matriz montados" onze modelos
// (Street 7, Eleven 5, Nicky 5, ...). Os códigos foram escolhidos com ele
// onde havia mais de um (Nicky 9588, Ayla 500W 9194, Flic 9193, Abacook 9204).
//
//   node scripts/entrada-de-estoque.js --deposito "DEPÓSITO MATRIZ" \
//        --itens "101247:7,101218:5" --url https://mavisone.cloud
//       CONFERE (login de administrador), sem gravar: cada código, o
//       produto, o saldo de hoje no depósito e o saldo depois.
//
//   ... --lote correcao-codigos --itens "9194:-5,9193:-10,9589:5,9587:10"
//       um segundo lote no mesmo dia; quantidade negativa é SAÍDA.
//
//   ... --enviar
//       grava uma movimentação de ENTRADA por item, pelo mesmo caminho da
//       tela Estoque › Nova Movimentação, com o custo do cadastro.
//
// SOMA ao saldo — não é contagem. Rodar duas vezes lança duas vezes: o
// script recusa se já houver entrada com a mesma marca no depósito hoje.
'use strict';
const readline = require('readline');

const argumento = (nome) => { const i = process.argv.indexOf('--' + nome); return i >= 0 ? process.argv[i + 1] : undefined; };
const tem = (nome) => process.argv.includes('--' + nome);
const qtd = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const chave = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
// CORREÇÃO (13/10/2026): a carga dos montados entrou em produção com dois
// códigos errados (Ayla 500 em 9194 e Flic em 9193; os certos são 9589 e
// 9587). Quantidade NEGATIVA vira SAÍDA, e `--lote <nome>` separa um segundo
// lote no mesmo dia — a trava de repetição olha a marca COM o lote, então a
// correção não esbarra na carga original, e rodá-la duas vezes é recusado.
const LOTE = argumento('lote') ? String(argumento('lote')).trim() : '';
const MARCA = `Entrada em lote a pedido do usuário${LOTE ? ` (${LOTE})` : ''}`;

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) => rl.question(texto, (r) => { rl.close(); ok(r); }));
}

/** "101247:7, 101218:5" -> [{ sku: '101247', quantidade: 7 }, ...] */
function lerItens(texto) {
  const itens = [];
  for (const parte of String(texto || '').split(',').map((p) => p.trim()).filter(Boolean)) {
    const [sku, q] = parte.split(':').map((p) => String(p || '').trim());
    const quantidade = Number(String(q).replace(',', '.'));
    if (!sku || !Number.isFinite(quantidade) || quantidade === 0) throw new Error(`Item inválido: "${parte}" (use código:quantidade; negativo é saída).`);
    if (itens.some((i) => i.sku === sku)) throw new Error(`Código repetido: ${sku}.`);
    itens.push({ sku, quantidade });
  }
  if (!itens.length) throw new Error('Nenhum item. Use --itens "código:quantidade,código:quantidade".');
  return itens;
}

async function main() {
  const nomeDoDeposito = argumento('deposito');
  const url = argumento('url');
  if (!nomeDoDeposito || !url || !argumento('itens')) {
    console.error('Uso: node scripts/entrada-de-estoque.js --deposito "<nome>" --itens "código:qtd,..." --url <endereço> [--enviar]');
    process.exitCode = 2;
    return;
  }
  const itens = lerItens(argumento('itens'));
  const base = String(url).replace(/\/+$/, '');
  const usuario = process.env.IMPORT_USER || 'admin';
  const senha = process.env.IMPORT_PASS || await perguntar(`Senha do usuário ${usuario} em ${base}: `);
  let token = '';
  const chamar = async (metodo, rota, corpo) => {
    const r = await fetch(base + rota, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-auth-token': token } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo)
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${metodo} ${rota} respondeu ${r.status}: ${json.error || ''}`);
    return json;
  };
  ({ token } = await chamar('POST', '/api/login', { username: usuario, password: senha }));

  const { deposits } = await chamar('GET', '/api/cadastros/deposits');
  const achados = (deposits || []).filter((d) => chave(d.name) === chave(nomeDoDeposito));
  if (achados.length !== 1) {
    throw new Error(achados.length ? `Há ${achados.length} depósitos com esse nome.`
      : `Depósito "${nomeDoDeposito}" não encontrado. Existem: ${(deposits || []).map((d) => d.name).join(' | ')}`);
  }
  const deposito = achados[0];
  console.log(`Depósito: ${deposito.name}${deposito.code ? ` (${deposito.code})` : ''}${deposito.classificacao ? ` — ${deposito.classificacao}` : ''}`);

  const { products } = await chamar('GET', '/api/stock/products');
  const porSku = new Map();
  for (const p of products || []) {
    const sku = String(p.sku || '').trim();
    if (!sku) continue;
    porSku.set(sku, porSku.has(sku) ? null : p); // null = SKU repetido no cadastro
  }
  let problemas = 0;
  const linhas = [];
  console.log('');
  for (const item of itens) {
    const p = porSku.get(item.sku);
    if (p === undefined) { console.log(`  XX ${item.sku}: código não cadastrado`); problemas += 1; continue; }
    if (p === null) { console.log(`  XX ${item.sku}: código repetido no cadastro`); problemas += 1; continue; }
    const saldo = Number(((p.balances || []).find((b) => b.depositId === deposito.id) || {}).quantity || 0);
    console.log(`  ${item.sku}  ${String(p.name).slice(0, 48).padEnd(48)}  ${item.quantidade > 0 ? '+' : ''}${qtd(item.quantidade)}  (${qtd(saldo)} -> ${qtd(saldo + item.quantidade)})`);
    // Saída maior que o saldo do depósito: o servidor recusaria no meio do
    // lote, com parte já gravada. Melhor parar aqui, antes de gravar nada.
    if (saldo + item.quantidade < 0) { console.log(`  XX ${item.sku}: saída de ${qtd(-item.quantidade)} com saldo ${qtd(saldo)} neste depósito`); problemas += 1; continue; }
    linhas.push({ ...item, produto: p });
  }
  const total = linhas.reduce((t, l) => t + l.quantidade, 0);
  const valor = linhas.reduce((t, l) => t + l.quantidade * Number(l.produto.costPrice || 0), 0);
  console.log(`\nTotal: ${linhas.length} itens, ${qtd(total)} unidades, ${brl(valor)} pelo custo do cadastro`);
  if (problemas) {
    console.log(`\n${problemas} código(s) com problema — corrija a lista. Nada foi gravado.`);
    process.exitCode = 1;
    return;
  }

  const hoje = new Date().toLocaleDateString('sv-SE');
  const { movements } = await chamar('GET', `/api/stock/movements?depositId=${encodeURIComponent(deposito.id)}&dateFrom=${hoje}&dateTo=${hoje}&limit=200`).catch(() => ({ movements: [] }));
  const jaFeitas = (movements || []).filter((m) => String(m.note || '').startsWith(`${MARCA} — `));
  if (jaFeitas.length) {
    console.log(`\nJÁ HÁ ${jaFeitas.length} entrada(s) desta carga hoje neste depósito. Nada foi gravado (rodar de novo somaria em dobro).`);
    process.exitCode = 1;
    return;
  }

  if (!tem('enviar')) {
    console.log('\nCONFERÊNCIA — nada foi gravado. Para lançar, rode de novo com --enviar.');
    return;
  }
  for (const l of linhas) {
    await chamar('POST', '/api/stock/movements', {
      type: l.quantidade > 0 ? 'entrada' : 'saida',
      productId: l.produto.id,
      depositId: deposito.id,
      date: hoje,
      quantity: Math.abs(l.quantidade),
      unitCost: Number(l.produto.costPrice || 0),
      note: `${MARCA} — ${l.sku}`
    });
  }
  const entradas = linhas.filter((l) => l.quantidade > 0).length;
  console.log(`\nGRAVADO em ${base}: ${entradas} entrada(s) e ${linhas.length - entradas} saída(s), saldo ${total >= 0 ? '+' : ''}${qtd(total)} unidades em ${deposito.name}.`);
}

// exitCode, e não process.exit(): ver scripts/completar-chaves-nfe.js.
main().catch((erro) => { console.error('\nFALHOU:', erro.message); process.exitCode = 1; });
