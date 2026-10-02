#!/usr/bin/env node
/**
 * O CATÁLOGO DE RELATÓRIOS (lib/relatorios), sem banco.
 *
 * A consulta de cada relatório é provada contra o banco por
 * scripts/prova-relatorios-catalogo.js. Aqui fica o que não precisa de banco:
 * o menu da tela concorda com os grupos do servidor, a porta de cada grupo,
 * os filtros padrão, os totais e o lugar onde o escopo de vendas entra.
 */
const fs = require('fs');
const path = require('path');
const catalogo = require('../lib/relatorios');
const motor = require('../lib/relatorios/motor');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

console.log('\n--- 1. o menu da tela é o catálogo do servidor ---');
const app = ler('public/app.js');
const bloco = /\n  reports: \[([\s\S]*?)\n  \],/.exec(app);
const itens = bloco ? [...bloco[1].matchAll(/\{ key: '([^']+)', label: '([^']+)'[^}]*requerModulo: '([^']+)' \}/g)] : [];
check('um item de menu por grupo, na mesma ordem', JSON.stringify(itens.map((m) => m[1])) === JSON.stringify(catalogo.GRUPOS.map((g) => g.key)),
  itens.map((m) => m[1]).join(','));
check('  com o mesmo título', itens.every((m) => catalogo.grupoDe(m[1]) && catalogo.grupoDe(m[1]).titulo === m[2]));
check('  e o mesmo módulo exigido', itens.every((m) => catalogo.grupoDe(m[1]) && catalogo.grupoDe(m[1]).modulo === m[3]));
check('o menu esconde o grupo de quem não tem o módulo', /!item\.requerModulo \|\| modulos\.includes\(item\.requerModulo\)/.test(app));
check('todo grupo tem ao menos um relatório', catalogo.GRUPOS.every((g) => catalogo.RELATORIOS.some((r) => r.grupo === g.key)),
  catalogo.GRUPOS.filter((g) => !catalogo.RELATORIOS.some((r) => r.grupo === g.key)).map((g) => g.key).join(','));

console.log('\n--- 2. as quatro telas que já existiam continuam alcançáveis ---');
const especiais = catalogo.RELATORIOS.filter((r) => r.especial).map((r) => r.especial).sort();
check('Pedidos, Vendas por Vendedor, Síntese Financeira e Valor em Estoque', JSON.stringify(especiais) === JSON.stringify(['estoque', 'financeiro', 'vendas', 'vendedores']), especiais.join(','));
const telas = ler('public/modules/reports/subs/relatorios.js');
check('  e cada uma está registrada com o nome que o catálogo chama',
  especiais.every((e) => new RegExp(`window\\.MavisRelatoriosEspeciais\\.${e} = `).test(telas)));
check('o script da tela genérica está na página', /\/modules\/reports\/subs\/catalogo\.js/.test(ler('public/index.html')));

console.log('\n--- 3. a porta de cada grupo ---');
const vendedor = { allowedModules: ['reports', 'sales'] };
const visivel = catalogo.catalogoVisivel(vendedor, false).map((g) => g.key);
check('quem só tem Vendas vê só o grupo Vendas', JSON.stringify(visivel) === JSON.stringify(['vendas']), visivel.join(','));
check('o administrador vê todos', catalogo.catalogoVisivel({ allowedModules: [] }, true).length === catalogo.GRUPOS.length);
check('o que vai para a tela não leva a função de consulta',
  catalogo.catalogoVisivel({ allowedModules: [] }, true).every((g) => g.relatorios.every((r) => !('executar' in r))));
const servidor = ler('server.js');
check('a rota confere o grupo ANTES de executar',
  /podeVerGrupo\(porta\.user, catalogoDeRelatorios\.grupoDe\(def\.grupo\), porta\.ehAdministrador\)[\s\S]{0,600}motorDeRelatorios\.executar/.test(servidor));
check('  e passa os vendedores do escopo, não o que a tela pediu',
  /vendedores: escopoLib\.vendedoresPermitidos\(escopo, filtros\.vendedorId\)/.test(servidor));
check('relatório de venda filtra pelos vendedores recebidos',
  /o\.seller_id = any\(/.test(ler('lib/relatorios/vendas.js')) && /vendedores: ctx\.vendedores/.test(ler('lib/relatorios/comum.js')));

console.log('\n--- 4. filtros ---');
const def = (extra) => ({ key: 't', grupo: 'vendas', titulo: 'T', filtros: ['periodo', 'dias'], colunas: [], ...extra });
const agora = '2026-10-02T15:00:00Z';
const mes = motor.normalizarFiltros(def({ periodoPadrao: 'mes' }), {}, agora);
check('sem período pedido, o padrão "mes" vai do dia 1 até hoje', mes.de === '2026-10-01' && mes.ate === '2026-10-02', `${mes.de}..${mes.ate}`);
const ano = motor.normalizarFiltros(def({ periodoPadrao: 'ano' }), {}, agora);
check('  e o "ano" do 1º de janeiro até hoje', ano.de === '2026-01-01' && ano.ate === '2026-10-02');
check('sem padrão, período vazio é sem limite', motor.normalizarFiltros(def({}), {}, agora).de === '');
const trocado = motor.normalizarFiltros(def({}), { de: '2026-09-30', ate: '2026-09-01' }, agora);
check('de/até invertidos são trocados', trocado.de === '2026-09-01' && trocado.ate === '2026-09-30');
check('data torta vira vazia, não erro', motor.normalizarFiltros(def({}), { de: "2026-09-01'; drop table x" }, agora).de === '');
check('dias fora do limite são contidos', motor.normalizarFiltros(def({}), { dias: '99999' }, agora).dias === 3650);
check('"hoje" é a data do Brasil, não a de Londres', motor.hojeNoBrasil('2026-10-03T01:30:00Z') === '2026-10-02');

console.log('\n--- 5. totais ---');
(async () => {
  const r = await motor.executar({
    key: 't', grupo: 'vendas', titulo: 'T', totais: 'numericas',
    colunas: [
      { campo: 'nome', tipo: 'texto' }, { campo: 'valor', tipo: 'moeda' },
      { campo: 'margem', tipo: 'percentual' }, { campo: 'unitario', tipo: 'moeda', semTotal: true }
    ],
    executar: async () => [{ nome: 'a', valor: 0.1, margem: 10, unitario: 5 }, { nome: 'b', valor: 0.2, margem: 20, unitario: 7 }]
  }, motor.normalizarFiltros({ filtros: [] }, {}, agora));
  check('"numericas" soma dinheiro e quantidade', r.totais.valor === 0.3, String(r.totais.valor));
  check('  mas não percentual nem coluna marcada semTotal', !('margem' in r.totais) && !('unitario' in r.totais));

  console.log(falhas ? `\n===== ${falhas} CHECK(S) FALHARAM =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})();
