#!/usr/bin/env node
// ZERA O ESTOQUE DE UM DEPÓSITO, POR CONTAGEM — 13/10/2026.
//
// Pedido do usuário: "quero apagar todo o estoque que consta no depósito
// matriz - caixa". Decidido com ele: ZERAR (o estoque sai do sistema), e o
// depósito continua sendo o de desmontados do PCP, só que vazio.
//
//   node scripts/zerar-deposito.js --deposito "DEPÓSITO MATRIZ - CAIXA" --url https://mavisone.cloud
//       CONFERE (login de administrador), sem gravar: quantos produtos têm
//       saldo nele, quantas unidades e quanto vale pelo custo do cadastro.
//
//   ... --enviar
//       grava: abre uma contagem no depósito com todo produto que tem saldo,
//       contado ZERO, e FECHA — o fechamento lança os ajustes pelo caminho
//       normal do estoque (custo do cadastro). Nada é apagado: os movimentos
//       antigos ficam, e a contagem diz quem zerou e quando.
//
// POR QUE ATÉ DUAS CONTAGENS. Produto com saldo POR COR é contado cor por
// cor (a contagem sem cor ajustaria o TOTAL e deixaria +5 numa cor e −5 no
// "sem cor"). Mas o fechamento calcula todos os ajustes pelo saldo de antes,
// então o "sem cor" que sobrar ao lado das cores não dá para zerar na mesma
// folha — a segunda contagem pega o resto. No fim, o script confere que o
// depósito ficou em zero.
//
// O nome do depósito tem de bater exatamente (sem diferença de maiúscula).
'use strict';
const readline = require('readline');

const argumento = (nome) => { const i = process.argv.indexOf('--' + nome); return i >= 0 ? process.argv[i + 1] : undefined; };
const tem = (nome) => process.argv.includes('--' + nome);
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtd = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const chave = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
const MARCA = 'Depósito zerado a pedido do usuário';

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) => rl.question(texto, (r) => { rl.close(); ok(r); }));
}

async function main() {
  const nomeDoDeposito = argumento('deposito');
  const url = argumento('url');
  if (!nomeDoDeposito || !url) {
    console.error('Uso: node scripts/zerar-deposito.js --deposito "<nome>" --url <endereço> [--enviar]');
    process.exitCode = 2;
    return;
  }
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

  // 1. O depósito, pelo nome exato.
  const { deposits } = await chamar('GET', '/api/cadastros/deposits');
  const achados = (deposits || []).filter((d) => chave(d.name) === chave(nomeDoDeposito));
  if (achados.length !== 1) {
    const nomes = (deposits || []).map((d) => d.name).join(' | ');
    throw new Error(achados.length ? `Há ${achados.length} depósitos com esse nome.` : `Depósito "${nomeDoDeposito}" não encontrado. Existem: ${nomes}`);
  }
  const deposito = achados[0];
  console.log(`Depósito: ${deposito.name}${deposito.code ? ` (${deposito.code})` : ''}${deposito.classificacao ? ` — ${deposito.classificacao}` : ''}`);

  // 2. O que tem saldo nele (a lista inteira traz o saldo de cada depósito).
  const comSaldo = async () => {
    const { products } = await chamar('GET', '/api/stock/products');
    return (products || [])
      .map((p) => ({ p, saldo: Number(((p.balances || []).find((b) => b.depositId === deposito.id) || {}).quantity || 0) }))
      .filter((x) => x.saldo !== 0);
  };
  const antes = await comSaldo();
  const unidades = antes.reduce((t, x) => t + x.saldo, 0);
  const valor = antes.reduce((t, x) => t + x.saldo * Number(x.p.costPrice || 0), 0);
  const negativos = antes.filter((x) => x.saldo < 0);
  console.log(`\nCom saldo neste depósito: ${antes.length} produtos, ${qtd(unidades)} unidades, ${brl(valor)} pelo custo do cadastro`);
  if (negativos.length) console.log(`  com saldo NEGATIVO (voltam a zero por entrada): ${negativos.length}`);
  antes.slice(0, 20).forEach((x) => console.log(`    ${x.p.sku || '-'}  ${String(x.p.name).slice(0, 50)}  ${qtd(x.saldo)} -> 0`));
  if (antes.length > 20) console.log(`    ... e mais ${antes.length - 20}`);
  if (!antes.length) {
    console.log('\nO depósito já está zerado. Nada a fazer.');
    return;
  }

  const { counts } = await chamar('GET', `/api/stock/counts?depositId=${encodeURIComponent(deposito.id)}`);
  const aberta = (counts || []).find((c) => c.status === 'aberta');
  if (aberta) throw new Error(`Há uma contagem aberta (${aberta.code}) neste depósito. Feche ou cancele antes.`);

  if (!tem('enviar')) {
    console.log('\nCONFERÊNCIA — nada foi gravado. Para zerar, rode de novo com --enviar.');
    return;
  }

  // 3. Até duas contagens: cores primeiro, o resto depois.
  for (let passada = 1; passada <= 2; passada += 1) {
    const pendentes = passada === 1 ? antes : await comSaldo();
    if (!pendentes.length) break;
    const linhas = [];
    for (const { p } of pendentes) {
      let cores = [];
      if (passada === 1) {
        const r = await chamar('GET', `/api/stock/products/${encodeURIComponent(p.id)}/classes?depositId=${encodeURIComponent(deposito.id)}`);
        cores = Object.entries(r.saldos || {}).filter(([, q]) => Number(q) !== 0).map(([classValueId]) => classValueId);
      }
      if (cores.length) cores.forEach((classValueId) => linhas.push({ productId: p.id, classValueId }));
      else linhas.push({ productId: p.id });
    }
    const { count } = await chamar('POST', '/api/stock/counts', {
      depositId: deposito.id,
      date: new Date().toLocaleDateString('sv-SE'),
      note: `${MARCA} (${passada}ª passada) — ${pendentes.length} produtos`
    });
    let n = 0;
    for (const linha of linhas) {
      await chamar('POST', `/api/stock/counts/${encodeURIComponent(count.id)}/items`, { ...linha, countedQuantity: 0 });
      n += 1;
      if (n % 25 === 0 || n === linhas.length) process.stdout.write(`\r  ${count.code}: ${n} de ${linhas.length} linhas`);
    }
    const fechamento = await chamar('POST', `/api/stock/counts/${encodeURIComponent(count.id)}/close`, {});
    console.log(`\n  ${count.code} fechada: ${fechamento.ajustes} ajuste(s) lançados.`);
  }

  const depois = await comSaldo();
  if (depois.length) {
    console.log(`\nATENÇÃO: ainda ficaram ${depois.length} produtos com saldo em ${deposito.name}:`);
    depois.forEach((x) => console.log(`    ${x.p.sku || '-'}  ${x.p.name}  ${qtd(x.saldo)}`));
    process.exitCode = 1;
    return;
  }
  console.log(`\nGRAVADO em ${base}: ${deposito.name} está zerado.`);
}

// exitCode, e não process.exit(): ver scripts/completar-chaves-nfe.js.
main().catch((erro) => { console.error('\nFALHOU:', erro.message); process.exitCode = 1; });
