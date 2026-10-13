#!/usr/bin/env node
// ESTOQUE DA ELECTRIC PELA PLANILHA "PRODUTOS" DO VIPER — 13/10/2026.
//
//   node scripts/importar-estoque-electric.js --planilha produtos.xlsx
//       só lê a planilha e mostra o que ela tem.
//
//   ... --url https://mavisone.cloud
//       CONFERE no servidor (login de administrador), sem gravar: a empresa e o
//       depósito da Electric, os códigos que casam com o cadastro e o valor
//       pelo custo do cadastro.
//
//   ... --url ... --enviar
//       grava: cria a empresa e o "Depósito Electric" se faltarem, abre UMA
//       contagem nesse depósito com os itens e FECHA — o fechamento lança o
//       ajuste "contado − saldo do depósito" pelo caminho normal do estoque,
//       com o custo do cadastro. Nenhum outro depósito é tocado.
//
//   --data AAAA-MM-DD   data da contagem (padrão: hoje).
//   --nao-fechar        deixa a contagem aberta, para fechar na tela.
//
// Rodar de novo: se a carga já foi fechada neste depósito, o script para (a
// Electric pode ter vendido desde então, e recontar pela planilha velha
// desfaria a venda). Se parou no meio, a contagem aberta é retomada.
//
// Por que a coluna Estoque é da Electric: lib/importacao-estoque-electric.js.
//
// TAMBÉM LÊ O RELATÓRIO "ESTOQUES" DO VIPER (posição atual de UM depósito,
// 13/10/2026). Com ele o depósito fica IGUAL ao relatório: além dos itens com
// saldo, a contagem leva com ZERO todo produto que tem saldo no depósito daqui
// e não está no relatório com saldo (decisão do usuário). A marca da contagem
// é outra, então esta carga roda mesmo depois da carga da planilha Produtos.
// A planilha NÃO entra no repositório.
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { lerXlsx } = require('../lib/xlsx-leitor');
const { lerPlanilha, lerPlanilhaEstoques, CNPJ_ELECTRIC } = require('../lib/importacao-estoque-electric');

const argumento = (nome) => { const i = process.argv.indexOf('--' + nome); return i >= 0 ? process.argv[i + 1] : undefined; };
const tem = (nome) => process.argv.includes('--' + nome);
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtd = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
// Marca na observação da contagem: é por ela que uma segunda rodada reconhece
// a carga já feita.
const MARCA_PRODUTOS = 'Carga do estoque da Electric (planilha Produtos do Viper)';
const MARCA_ESTOQUES = 'Estoque da Electric igualado ao relatório Estoques do Viper';

// Os dados da Electric para o cadastro de empresa de Vendas, se faltar —
// os mesmos do emitente fiscal (ver a fase DV).
const EMPRESA_ELECTRIC = {
  name: 'SAL INFINITY ELECTRIC LTDA',
  tradeName: 'SAL INFINITY ELECTRIC',
  document: CNPJ_ELECTRIC,
  stateRegistration: '261760769',
  taxRegime: 'simples',
  address: 'Rua Bernardo Dornbusch',
  addressNumber: '2054',
  neighborhood: 'Vila Lalau',
  city: 'Jaraguá do Sul',
  state: 'SC',
  status: 'ativo'
};

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) => rl.question(texto, (r) => { rl.close(); ok(r); }));
}

async function main() {
  const arquivo = argumento('planilha');
  if (!arquivo || !fs.existsSync(arquivo)) {
    console.error('Uso: node scripts/importar-estoque-electric.js --planilha <xlsx> [--url <endereço> [--enviar] [--data AAAA-MM-DD] [--nao-fechar]]');
    if (arquivo) console.error('Não encontrado: ' + arquivo);
    process.exitCode = 2;
    return;
  }
  // O formato pelo cabeçalho: planilha Produtos ou relatório Estoques.
  const abas = lerXlsx(arquivo);
  let lido;
  try {
    lido = { formato: 'produtos', ...lerPlanilha(abas) };
  } catch (erroProdutos) {
    try {
      lido = lerPlanilhaEstoques(abas);
    } catch (erroEstoques) {
      throw new Error(`${erroProdutos.message} / ${erroEstoques.message}`);
    }
  }
  const igualar = lido.formato === 'estoques';
  const MARCA = igualar ? MARCA_ESTOQUES : MARCA_PRODUTOS;
  console.log(`Planilha: ${path.basename(arquivo)} — ${lido.empresa}${igualar ? ` — relatório Estoques do depósito ${lido.depositoDoViper}` : ''}`);
  console.log(`  com estoque: ${lido.itens.length} produtos, ${qtd(lido.unidades)} unidades`);
  console.log(`  estoque zero: ${lido.zerados} | negativos (ficam de fora): ${lido.negativos.length}`);
  lido.negativos.forEach((n) => console.log(`    negativo ${n.sku}  ${n.nome}  ${qtd(n.quantidade)}`));
  lido.invalidos.forEach((n) => console.log(`    FORA ${n.sku}  ${n.nome} — ${n.motivo}`));

  const url = argumento('url');
  if (!url) {
    console.log('\nSó leitura da planilha. Com --url <endereço>, o servidor confere (sem gravar).');
    return;
  }
  const data = argumento('data') || new Date().toLocaleDateString('sv-SE');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('--data no formato AAAA-MM-DD.');
  const enviar = tem('enviar');
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

  // 1. A empresa e o depósito da Electric.
  const { companies } = await chamar('GET', '/api/cadastros/companies');
  let empresa = (companies || []).find((c) => String(c.document || '').replace(/\D/g, '') === CNPJ_ELECTRIC);
  const { deposits } = await chamar('GET', '/api/cadastros/deposits');
  let depositos = empresa ? (deposits || []).filter((d) => d.companyId === empresa.id) : [];
  const nomeEscolhido = argumento('deposito');
  if (nomeEscolhido) depositos = depositos.filter((d) => d.name === nomeEscolhido);
  if (depositos.length > 1) {
    throw new Error(`A Electric tem ${depositos.length} depósitos (${depositos.map((d) => d.name).join(', ')}).`
      + ' Diga qual com --deposito "<nome>".');
  }
  let deposito = depositos[0] || null;

  console.log(`\nEmpresa: ${empresa ? `${empresa.name} (já cadastrada)` : `${EMPRESA_ELECTRIC.name} — NÃO cadastrada em Vendas; ${enviar ? 'será cadastrada' : 'seria cadastrada'}`}`);
  console.log(`Depósito: ${deposito ? `${deposito.name} (já existe)` : `"Depósito Electric" — não existe; ${enviar ? 'será criado' : 'seria criado'}`}`);

  // 2. Os produtos, pelo código do Viper = SKU daqui.
  const { products } = await chamar('GET', '/api/stock/meta');
  const porSku = new Map();
  const repetidos = new Set();
  for (const p of products || []) {
    const sku = String(p.sku || '').trim();
    if (!sku) continue;
    if (porSku.has(sku)) repetidos.add(sku);
    porSku.set(sku, p);
  }
  const casados = [];
  const semCadastro = [];
  const ambiguos = [];
  for (const item of lido.itens) {
    if (repetidos.has(item.sku)) { ambiguos.push(item); continue; }
    const p = porSku.get(item.sku);
    if (!p) { semCadastro.push(item); continue; }
    casados.push({ ...item, productId: p.id, custo: Number(p.costPrice || 0) });
  }
  const valor = casados.reduce((t, i) => t + i.quantidade * i.custo, 0);
  console.log(`\nCasam com o cadastro: ${casados.length} de ${lido.itens.length}`);
  console.log(`  valor pelo custo do cadastro: ${brl(valor)}  (inventário do Viper em 12/10: R$ 756.452,97 a custo médio)`);
  const semCusto = casados.filter((i) => !(i.custo > 0));
  if (semCusto.length) console.log(`  sem custo no cadastro (entram com valor zero): ${semCusto.map((i) => i.sku).join(', ')}`);
  semCadastro.forEach((i) => console.log(`  FORA (código não cadastrado) ${i.sku}  ${i.nome}  ${qtd(i.quantidade)}`));
  ambiguos.forEach((i) => console.log(`  FORA (SKU repetido no cadastro) ${i.sku}  ${i.nome}`));

  // 2b. IGUALAR: quem tem saldo no depósito daqui e não está no relatório com
  // saldo entra na contagem com ZERO. A lista inteira de produtos traz o saldo
  // de cada depósito (`balances`); negativo também vai a zero.
  const zerar = [];
  if (igualar && deposito) {
    const { products: comSaldos } = await chamar('GET', '/api/stock/products');
    const naPlanilha = new Set(casados.map((i) => i.productId));
    for (const p of comSaldos || []) {
      const saldo = Number(((p.balances || []).find((b) => b.depositId === deposito.id) || {}).quantity || 0);
      if (saldo !== 0 && !naPlanilha.has(p.id)) zerar.push({ sku: p.sku, nome: p.name, productId: p.id, quantidade: 0, saldoAtual: saldo });
    }
    console.log(`\nVão a ZERO em ${deposito.name} (têm saldo aqui e não estão no relatório com saldo): ${zerar.length} produtos, ${qtd(zerar.reduce((t, i) => t + i.saldoAtual, 0))} unidades`);
    zerar.slice(0, 15).forEach((i) => console.log(`    ${i.sku}  ${String(i.nome).slice(0, 50)}  ${qtd(i.saldoAtual)} -> 0`));
    if (zerar.length > 15) console.log(`    ... e mais ${zerar.length - 15}`);
  }

  // 3. Carga já feita?
  let aberta = null;
  if (deposito) {
    const { counts } = await chamar('GET', `/api/stock/counts?depositId=${encodeURIComponent(deposito.id)}`);
    const nossas = (counts || []).filter((c) => String(c.note || '').startsWith(MARCA));
    const fechada = nossas.find((c) => c.status === 'fechada');
    if (fechada) {
      console.log(`\nA carga JÁ FOI FEITA neste depósito: contagem ${fechada.code}, fechada. Nada a fazer.`);
      return;
    }
    aberta = nossas.find((c) => c.status === 'aberta') || null;
    const outraAberta = (counts || []).find((c) => c.status === 'aberta' && !String(c.note || '').startsWith(MARCA));
    if (outraAberta) {
      throw new Error(`Há outra contagem aberta (${outraAberta.code}) em ${deposito.name}. Feche ou cancele antes.`);
    }
    if (aberta) console.log(`\nContagem ${aberta.code} aberta por uma rodada anterior: ${enviar ? 'será retomada' : 'seria retomada'}.`);
  }

  if (!enviar) {
    console.log('\nCONFERÊNCIA — nada foi gravado. Para gravar, rode de novo com --enviar.');
    return;
  }

  // 4. Grava.
  if (!empresa) {
    ({ company: empresa } = await chamar('POST', '/api/cadastros/companies', EMPRESA_ELECTRIC));
    console.log(`\nEmpresa cadastrada: ${empresa.name}`);
  }
  if (!deposito) {
    ({ deposit: deposito } = await chamar('POST', '/api/cadastros/deposits', {
      name: 'Depósito Electric', companyId: empresa.id, status: 'ativo', city: 'Jaraguá do Sul', state: 'SC',
      notes: 'Estoque da SAL INFINITY ELECTRIC. Criado na carga da planilha Produtos do Viper (13/10/2026).'
    }));
    console.log(`Depósito criado: ${deposito.name}`);
  }
  if (!aberta) {
    ({ count: aberta } = await chamar('POST', '/api/stock/counts', {
      depositId: deposito.id, date: data,
      note: `${MARCA} — ${lido.itens.length} itens${zerar.length ? ` + ${zerar.length} a zero` : ''}, ${path.basename(arquivo)}`
    }));
    console.log(`Contagem aberta: ${aberta.code} em ${deposito.name}, data ${data}`);
  }
  const { items: jaContados } = await chamar('GET', `/api/stock/counts/${encodeURIComponent(aberta.id)}`);
  const feitos = new Set((jaContados || []).map((i) => i.productId));
  const faltam = [...casados, ...zerar].filter((i) => !feitos.has(i.productId));
  let n = 0;
  for (const item of faltam) {
    await chamar('POST', `/api/stock/counts/${encodeURIComponent(aberta.id)}/items`, {
      productId: item.productId, countedQuantity: item.quantidade
    });
    n += 1;
    if (n % 50 === 0 || n === faltam.length) process.stdout.write(`\r  itens lançados: ${feitos.size + n} de ${casados.length + zerar.length}`);
  }
  console.log(`\n  itens na contagem: ${feitos.size + n}`);

  if (tem('nao-fechar')) {
    console.log(`\nContagem ${aberta.code} ficou ABERTA. Confira e feche em Estoque › Contagens de Estoque.`);
    return;
  }
  const fechamento = await chamar('POST', `/api/stock/counts/${encodeURIComponent(aberta.id)}/close`, {});
  console.log(`\nGRAVADO em ${base}: contagem ${aberta.code} fechada, ${fechamento.ajustes} ajuste(s) de estoque lançados em ${deposito.name}.`);
}

// exitCode, e não process.exit(): ver scripts/completar-chaves-nfe.js.
main().catch((erro) => { console.error('\nFALHOU:', erro.message); process.exitCode = 1; });
