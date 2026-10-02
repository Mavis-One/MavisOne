#!/usr/bin/env node
/**
 * OS ITENS QUE TÊM SALDO NO VIPER E NÃO EXISTEM AQUI.
 *
 * Fonte: o relatório "Estoque" do ViperERP de 02/10/2026 00:33, SEM FILTRO de
 * depósito, em duas vias (Estoque_de_1_ate_1000 e Estoque_de_1001_ate_1033).
 * Ele só lista item com saldo, ordenado por Valor Venda decrescente.
 *
 * O QUE ESTE SCRIPT FAZ: cadastra os códigos do relatório que não existem no
 * cadastro, com custo e preço. SÓ ISSO.
 *
 * O QUE ELE NÃO FAZ, E POR QUÊ
 * ----------------------------
 * a) NÃO LANÇA SALDO. Sem filtro, o saldo de cada linha é a SOMA de todos os
 *    depósitos do Viper, e aqui há dez. Pôr a soma num depósito só seria
 *    inventar onde a mercadoria está. Saldo entra por depósito, com o
 *    relatório filtrado por depósito, pelo scripts/importar-estoque-viper.js.
 *
 * b) AS DUAS VIAS DISCORDAM EM 8 PRODUTOS, sempre por um fator de exatamente
 *    4 (100329 CARENAGEM FAROL INDY: 96 numa, 24 na outra). São os 8 primeiros
 *    da segunda via, todos a R$ 220,00 -- a paginação do Viper corta no meio
 *    de um empate de preço. Os 8 já existem aqui, e saldo não entra (a), então
 *    a discordância não toca este script; ela é conferida para que não passe
 *    em silêncio num produto A CADASTRAR.
 *
 * c) NÃO GRAVA PREÇO DE VENDA quando o Viper traz venda igual ao custo: é o
 *    campo vazio espelhando o custo, não preço (ver (c) no cabeçalho de
 *    scripts/importar-estoque-viper.js).
 *
 * d) NÃO GRAVA O GÊNERO. Ele é o TIPO_ITEM do 0200 da EFD (00 revenda, 07 uso e
 *    consumo, 08 ativo...) e o cadastro não tem campo para ele. Sai listado.
 *
 * COMO RODAR
 * ----------
 *   node scripts/cadastrar-itens-viper.js              confere, não grava
 *   node scripts/cadastrar-itens-viper.js --confirmo   grava
 *   --pdfs="<pasta>"   onde estão os PDFs (padrão: ~/Downloads)
 *
 * Precisa do servidor de pé (passa pela rota de produto) e do `pdftotext -table`
 * do Xpdf no PATH. Os PDFs não entram no repositório.
 */

require('dotenv').config();
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const viper = require('../lib/relatorio-viper');

const PORTA = Number(process.env.PORTA_IMPORT || 3000);
const USUARIO = process.env.IMPORT_USER || 'admin';
const SENHA = process.env.IMPORT_PASS || 'admin123';

const VIAS = ['Estoque_de_1_ate_1000.pdf', 'Estoque_de_1001_ate_1033.pdf'];

// A coluna "Categoria Padrão" só vem preenchida em ~45 linhas, e o leitor a
// cola no fim do nome ("SCOOTER CHOPPER 4000W AUTOPROPELIDO"). Produto novo
// com nome terminando nela fica de fora até alguém olhar.
const CATEGORIAS_DO_RELATORIO = ['AUTOPROPELIDO', 'SISTEMA DE FREIO'];

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const iguais = (a, b) => Math.round(Number(a || 0) * 100) === Math.round(Number(b || 0) * 100);

function req(method, caminho, body, token) {
  return new Promise((ok, bad) => {
    const d = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: PORTA, path: caminho, method,
      headers: Object.assign({ 'content-type': 'application/json' },
        d ? { 'content-length': Buffer.byteLength(d) } : {},
        token ? { 'x-auth-token': token } : {}),
    }, (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => ok({ status: res.statusCode, body: s })); });
    r.on('error', bad);
    if (d) r.write(d);
    r.end();
  });
}

(async () => {
  const argumentos = process.argv.slice(2);
  const confirmo = argumentos.includes('--confirmo');
  const arg = argumentos.find((x) => x.startsWith('--pdfs='));
  const pasta = arg ? arg.replace('--pdfs=', '').replace(/^["']|["']$/g, '') : path.join(os.homedir(), 'Downloads');
  const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'viper-'));

  console.log('--- 1. lendo as duas vias ---');
  console.log(`      pasta: ${pasta}`);
  const vias = VIAS.map((arquivo) => {
    const pdf = path.join(pasta, arquivo);
    if (!fs.existsSync(pdf)) {
      console.error(`  XX  não achei ${pdf} (passe a pasta com --pdfs="<caminho>")`);
      process.exit(1);
    }
    const txt = path.join(temporario, arquivo.replace(/\.pdf$/i, '.txt'));
    execFileSync('pdftotext', ['-table', '-enc', 'UTF-8', '-nopgbrk', pdf, txt], { stdio: 'pipe' });
    return viper.parseRelatorio(fs.readFileSync(txt, 'utf8'), arquivo);
  });
  fs.rmSync(temporario, { recursive: true, force: true });

  // As provas de lib/relatorio-viper.js. A aritmética quebra numa linha só,
  // 1209 (2 × R$ 9.900,00 impresso como R$ 19.829,70 -- o Viper soma duas
  // vendas de preços diferentes); ela pesa apenas se cair num produto novo.
  const quebrasDaAritmetica = [];
  for (const r of vias) {
    const nome = r.linhas[0] ? r.linhas[0].arquivo.replace('Estoque_de_', '').replace('.pdf', '') : '?';
    const totais = viper.conferirTotais(r);
    const codigos = viper.conferirCodigos(r);
    check(`${nome.padEnd(13)} TOTAIS bate`, totais.ok, totais.ok ? `${totais.linhas} linhas` : JSON.stringify(totais.diferencas || totais.motivo));
    check(`${nome.padEnd(13)} toda linha tem código, e um só`, codigos.ok && !codigos.repetidos.length && !codigos.semCodigo,
      JSON.stringify({ repetidos: codigos.repetidos, semCodigo: codigos.semCodigo }));
    quebrasDaAritmetica.push(...viper.conferirAritmetica(r.linhas).quebras);
  }
  const { linhas, conflitos } = viper.unir(vias);
  console.log(`      ${linhas.length} códigos distintos; ${conflitos.length} discordância(s) entre as vias`);
  if (falhas) {
    console.error('\n  XX  a leitura não passou nas provas. NADA foi gravado.');
    process.exit(1);
  }

  console.log('\n--- 2. conferindo com o cadastro ---');
  const login = await req('POST', '/api/login', { username: USUARIO, password: SENHA });
  if (login.status !== 200) {
    console.error(`  XX  login respondeu ${login.status} — o servidor está de pé na porta ${PORTA}?`);
    process.exit(1);
  }
  const token = JSON.parse(login.body).token;
  const produtos = JSON.parse((await req('GET', '/api/sales/meta', null, token)).body).products || [];
  const porSku = new Map(produtos.map((p) => [String(p.sku || '').trim(), p]));
  const novos = linhas.filter((l) => !porSku.has(l.codigo));
  console.log(`      produtos no cadastro ......: ${produtos.length}`);
  console.log(`      códigos que já existem ....: ${linhas.length - novos.length}`);
  console.log(`      códigos a cadastrar .......: ${novos.length}`);

  const codigosNovos = new Set(novos.map((l) => l.codigo));
  const conflitoEmNovo = conflitos.filter((c) => codigosNovos.has(c.codigo));
  const aritmeticaEmNovo = quebrasDaAritmetica.filter((q) => codigosNovos.has(q.codigo));
  const comCategoria = novos.filter((l) => CATEGORIAS_DO_RELATORIO.some((c) => l.nome.toUpperCase().endsWith(` ${c}`)));
  const negativos = novos.filter((l) => l.saldo < 0);
  check('nenhum produto novo com valores diferentes nas duas vias', !conflitoEmNovo.length, JSON.stringify(conflitoEmNovo));
  check('nenhum produto novo com a aritmética quebrada', !aritmeticaEmNovo.length, JSON.stringify(aritmeticaEmNovo));
  check('nenhum nome novo com a categoria colada', !comCategoria.length, comCategoria.map((l) => l.codigo).join(', '));
  check('nenhum produto novo com saldo negativo', !negativos.length, negativos.map((l) => l.codigo).join(', '));
  if (falhas) {
    console.error('\n  XX  NADA foi gravado.');
    process.exit(1);
  }

  console.log('\n--- 3. os produtos a cadastrar ---');
  const porGenero = new Map();
  for (const l of novos) {
    const g = l.genero ? `${l.genero} – ${l.generoTexto}` : 'sem gênero legível';
    if (!porGenero.has(g)) porGenero.set(g, []);
    porGenero.get(g).push(l);
  }
  for (const [g, lista] of [...porGenero.entries()].sort()) {
    console.log(`\n      ${g}: ${lista.length}`);
    for (const l of lista) {
      const preco = iguais(l.venda, l.custo) ? 'sem preço' : brl(l.venda);
      console.log(`         ${l.codigo.padEnd(7)} custo ${brl(l.custo).padStart(11)}  venda ${preco.padStart(11)}  ${l.nomeCompleto}`);
    }
  }
  const semPreco = novos.filter((l) => iguais(l.venda, l.custo)).length;
  console.log(`\n      ${novos.length} produto(s); ${semPreco} sem preço de venda (o Viper espelha o custo)`);
  console.log('      todos nascem sem NCM e sem saldo');

  if (!confirmo) {
    console.log('\n======================================================================');
    console.log('  CONFERÊNCIA — nada foi gravado. Para gravar:');
    console.log('    node scripts/cadastrar-itens-viper.js --confirmo');
    console.log('======================================================================');
    process.exit(0);
  }

  console.log('\n--- 4. GRAVANDO ---');
  for (const l of novos) {
    const r = await req('POST', '/api/stock', {
      name: l.nomeCompleto, sku: l.codigo, stockQuantity: 0,
      costPrice: l.custo, salePrice: iguais(l.venda, l.custo) ? 0 : l.venda,
    }, token);
    if (r.status !== 200) {
      console.error(`    XX  ${l.codigo}: ${r.status} ${r.body.slice(0, 160)}`);
      falhas += 1;
    }
  }

  const depois = JSON.parse((await req('GET', '/api/sales/meta', null, token)).body).products || [];
  const depoisPorSku = new Map(depois.map((p) => [String(p.sku || '').trim(), p]));
  const errados = novos.filter((l) => {
    const p = depoisPorSku.get(l.codigo);
    return !p || !iguais(p.costPrice, l.custo) || !iguais(p.salePrice, iguais(l.venda, l.custo) ? 0 : l.venda);
  });
  check('cada produto novo existe com o custo e o preço do relatório', !errados.length,
    errados.length ? errados.map((l) => l.codigo).join(', ') : `${novos.length} de ${novos.length}`);
  check('o cadastro cresceu exatamente o que foi cadastrado', depois.length === produtos.length + novos.length,
    `${produtos.length} -> ${depois.length}`);

  console.log(falhas === 0 ? '\nCADASTRO CONCLUÍDO' : `\n${falhas} PROBLEMA(S) — leia acima`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
