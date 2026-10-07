#!/usr/bin/env node
/**
 * NOVA VENDA: CLIENTE POR CPF/CNPJ, EMPRESA PELA FILIAL E AS ORIGENS DA LOJA
 * (07/10/2026).
 *
 *   1. O campo Cliente/Fornecedor achava só pelo nome. Agora acha também pelo
 *      CPF/CNPJ, com ou sem pontuação, e mostra o documento ao lado do nome.
 *   2. O campo Empresa mostrava dez linhas iguais (a razão social das dez lojas
 *      é a mesma). Agora mostra o nome da filial (nome fantasia).
 *   3. Origem da Venda: só LOJA, INDICAÇÃO, WHATSAPP, INSTAGRAM, FACEBOOK,
 *      GOOGLE, SITE e CLIENTE ANTIGO, nessa ordem. As antigas ficam inativas —
 *      o histórico continua filtrável por elas.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
let falhas = 0;
const check = (nome, cond, detalhe) => {
  if (cond) console.log(`  OK  ${nome}`);
  else { falhas += 1; console.log(`  XX  ${nome}${detalhe !== undefined ? ` -> ${detalhe}` : ''}`); }
};

const app = ler('public/app.js');
const server = ler('server.js');
const funcao = (src, nome) => {
  const m = src.match(new RegExp(`function ${nome}\\([\\s\\S]*?\\n\\}\\n`));
  if (!m) throw new Error(`não achei ${nome}`);
  return m[0];
};

(async () => {
  console.log('--- 1. cliente por CPF/CNPJ ---');
  const ctx = {};
  vm.runInNewContext(`${funcao(app, 'formatarDocumentoParaBusca')}${funcao(app, 'rotuloDaEmpresa')}saida.fmt = formatarDocumentoParaBusca; saida.empresa = rotuloDaEmpresa;`, { saida: ctx });
  check('CPF com máscara', ctx.fmt('12345678900') === '123.456.789-00', ctx.fmt('12345678900'));
  check('CNPJ com máscara', ctx.fmt('43792899000135') === '43.792.899/0001-35', ctx.fmt('43792899000135'));
  check('vazio fica vazio', ctx.fmt('') === '' && ctx.fmt(null) === '');
  check('o servidor manda o documento (só dígitos) no diretório da Nova Venda',
    /const documento = String\(c\.document \|\| ''\)\.replace\(\/\\D\/g, ''\);\s*\n\s*return documento \? \{ id: c\.id, name: c\.name, document: documento \}/.test(server));
  check('as opções de cliente levam o documento para a busca',
    /documento: entry\.document \|\| '',\s*\n\s*detalhe: formatarDocumentoParaBusca\(entry\.document\)/.test(app));
  check('a busca compara só os dígitos de uma parte numérica com o documento',
    /const digitosDaParte = \(parte\) => \(\/\^\[\\d\.\\-\/\]\+\$\/\.test\(parte\)/.test(app)
    && /i\.documento && digitosDaParte\(parte\)\.length >= 3 && i\.documento\.includes\(digitosDaParte\(parte\)\)/.test(app));
  check('o campo avisa que aceita CPF/CNPJ', /placeholder: 'Buscar por nome ou CPF\/CNPJ\.\.\.'/.test(app));

  console.log('\n--- 2. empresa pelo nome da filial ---');
  check('nome fantasia quando existe', ctx.empresa({ name: 'SAL INFINITY PLUS COMERCIO LTDA', tradeName: 'SAL INFINITY PLUS (MARCOLLA)' }) === 'SAL INFINITY PLUS (MARCOLLA)');
  check('razão social quando não há fantasia', ctx.empresa({ name: 'X LTDA', tradeName: '  ' }) === 'X LTDA');
  const usos = (app.match(/label: rotuloDaEmpresa\(c\)/g) || []).length;
  check('o campo Empresa do formulário usa o nome da filial (desenho e busca)', usos === 2, usos);
  check('o filtro de Empresa da busca avançada também', /\$\{escapeHtml\(rotuloDaEmpresa\(c\)\)\}<\/option>/.test(app));
  check('nenhum campo de escolha de empresa ficou com a razão social',
    !/meta\.companies\.map\(\(c\) => \(\{ value: c\.id, label: c\.name \}\)\)/.test(app));

  console.log('\n--- 3. origens da venda ---');
  const migracao = ler('banco/migrations/fase-dt-origens-da-venda-da-loja.sql');
  const OITO = ['LOJA', 'INDICAÇÃO', 'WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'GOOGLE', 'SITE', 'CLIENTE ANTIGO'];
  check('a migração cria as oito com código 01-08', OITO.every((n, i) => migracao.includes(`'${n}'`) && migracao.includes(`'0${i + 1}'`)));
  check('  e inativa as outras, sem apagar', /set status = 'inativo'/.test(migracao) && !/delete from sales_origins/i.test(migracao));
  check('a reserva do app.js é a mesma lista, na mesma ordem',
    app.includes(`const ORIGENS_VENDA_PADRAO = [${OITO.map((n) => `'${n}'`).join(', ')}];`));
  check('o filtro da lista recebe TODAS as origens (as inativas filtram o histórico)',
    /salesOrigins: origens \|\| \[\]/.test(server) && /return \(await origensVendaDb\.listar\(\)\)\.map\(\(o\) => o\.name\);/.test(server));

  if (process.env.DATABASE_URL) {
    const origens = require(path.join(RAIZ, 'lib/db/origens-venda'));
    const { fecharPool } = require(path.join(RAIZ, 'lib/db/conexao'));
    try {
      const ativas = (await origens.listar({ apenasAtivas: true })).map((o) => o.name);
      check('no banco: as ativas são as oito, na ordem pedida', JSON.stringify(ativas) === JSON.stringify(OITO), ativas.join(', '));
      const todas = await origens.listar();
      const venda = todas.find((o) => o.name === 'Venda Direta');
      check('  e Venda Direta continua no cadastro, inativa', !venda || venda.status === 'inativo', venda && venda.status);
      const primeiraInativa = todas.findIndex((o) => o.status !== 'ativo');
      check('  com as de código antes das sem código', primeiraInativa === -1 || todas.slice(0, primeiraInativa).every((o) => o.code));
    } finally {
      await fecharPool();
    }
  }

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
