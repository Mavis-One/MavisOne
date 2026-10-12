#!/usr/bin/env node
// A LISTA DE NF-e (Fiscal/Financeiro › NF-e Emitidas) — 11/10/2026.
//
// Pedidos do usuário, com as 7 mil notas do Viper na lista:
//   - ordenar "por número" de verdade: em texto, 30100 vem antes de 3100 e
//     225 depois de 1224 — a ordem tem de ser NUMÉRICA;
//   - dizer de qual empresa é cada nota (a 124 de Araquari e a 124 de
//     Marcolla eram iguais na tela), e filtrar por ela;
//   - de 30 a 250 notas por página;
//   - o Filtrar alinhado aos campos (caía sozinho numa segunda linha), e o
//     interruptor de seleção inteiro (a coluna o achatava para 16px).
//
// SEM BANCO: a ordenação é extraída do server.js e roda de verdade.
'use strict';
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');
const server = ler('server.js');

const ini = server.indexOf('const ORDENS_DA_LISTA_DE_NFE = {');
const fim = server.indexOf('\n}\n', server.indexOf('function ordenarNfes(')) + 2;
check('a ordenação foi encontrada no server.js', ini > 0 && fim > ini);
// eslint-disable-next-line no-new-func
const ordenarNfes = new Function(`${server.slice(ini, fim)}\nreturn ordenarNfes;`)();
const q = (o) => new URLSearchParams(o);
const notas = [
  { id: 'a', number: '225', series: '1', date: '2026-10-09', customer: 'Bia', empresa: 'TIMBO', amount: 10 },
  { id: 'b', number: '1224', series: '1', date: '2026-10-08', customer: 'ana', empresa: 'ARAQUARI', amount: 30 },
  { id: 'c', number: '30100', series: '1', date: '2026-10-07', customer: 'Caio', empresa: 'MARCOLLA', amount: 20 },
  { id: 'd', number: '3100', series: '1', date: '2026-10-09', customer: 'Davi', empresa: 'barra', amount: 5 }
];
const numeros = (l) => l.map((n) => n.number).join(',');

console.log('\n--- 1. a ordem ---');
check('por número, crescente, como NÚMERO', numeros(ordenarNfes(notas.slice(), q({ sort: 'numero', dir: 'asc' }))) === '225,1224,3100,30100',
  numeros(ordenarNfes(notas.slice(), q({ sort: 'numero', dir: 'asc' }))));
check('por número, decrescente', numeros(ordenarNfes(notas.slice(), q({ sort: 'numero', dir: 'desc' }))) === '30100,3100,1224,225');
check('padrão: data, a mais recente primeiro (como a lista sempre abriu)', ordenarNfes(notas.slice(), q({}))[0].date === '2026-10-09' && ordenarNfes(notas.slice(), q({})).slice(-1)[0].date === '2026-10-07');
check('empate de data desempata de forma estável (id)', numeros(ordenarNfes(notas.slice(), q({}))).startsWith('3100,225'));
check('cliente sem diferenciar maiúscula', ordenarNfes(notas.slice(), q({ sort: 'cliente', dir: 'asc' }))[0].customer === 'ana');
check('empresa', ordenarNfes(notas.slice(), q({ sort: 'empresa', dir: 'asc' }))[0].empresa === 'ARAQUARI');
check('valor', numeros(ordenarNfes(notas.slice(), q({ sort: 'valor', dir: 'desc' }))) === '1224,30100,225,3100');
check('campo desconhecido cai na data, sem quebrar', ordenarNfes(notas.slice(), q({ sort: 'xpto' }))[0].date === '2026-10-09');

console.log('\n--- 2. a rota ---');
const rota = server.slice(server.indexOf("if (pathname === '/api/finance/nfe' && req.method === 'GET')"), server.indexOf("if (pathname === '/api/finance/nfe' && req.method === 'POST')"));
check('de 30 a 250 por página, no servidor', /Math\.min\(250, Math\.max\(30, pedido\.limit\)\)/.test(rota));
check('a empresa de cada nota vem do estabelecimento', /nfe\.empresa = nomeDoEstabelecimento\.get\(nfe\.estabelecimentoId\)/.test(rota));
check('  e sem estabelecimentos a lista não cai', /try \{ estabelecimentos = await fiscalDb\.getEstabelecimentos\(\); \} catch/.test(rota));
check('ordena depois de filtrar', /ordenarNfes\(filterNfes\(data, url\.searchParams, todas\), url\.searchParams\)/.test(rota));
check('devolve as empresas para o filtro', /empresas: estabelecimentos\.map/.test(rota));
check('filtro por estabelecimento', /if \(estabelecimentoId\) list = list\.filter\(\(nfe\) => nfe\.estabelecimentoId === estabelecimentoId\);/.test(server));
check('as três origens dizem o estabelecimento (fiscal, manual, importada)',
  /origem: 'fiscal',\s*estabelecimentoId: nfe\.estabelecimentoId/.test(server)
  && /function nfeParaTela\(nfe, linkedEntries\) \{\s*return \{\s*id: nfe\.id,\s*estabelecimentoId/.test(server)
  && /estabelecimentoId: r\.estabelecimento_id/.test(ler('lib/db/nfe-importadas.js')));

console.log('\n--- 3. a tela ---');
const tela = ler('public/modules/finance/subs/nfe_emitidas.js');
check('as opções de página são 30 a 250', /const POR_PAGINA = \[30, 50, 100, 150, 200, 250\];/.test(tela));
check('cabeçalhos ordenáveis (número, data, empresa, cliente, valor, status)',
  ['numero', 'data', 'empresa', 'cliente', 'valor', 'status'].every((c) => tela.includes(`cabecalhoOrdenavel('${c}')`)));
check('coluna Empresa nas linhas', /<td class="nfe-empresa">\$\{escapeHtml\(nfe\.empresa \|\| '-'\)\}<\/td>/.test(tela));
check('a ordem e o tamanho de página vão na consulta', /sort: ordem\.campo, dir: ordem\.direcao/.test(tela));
check('o colspan da linha vazia acompanha as 13 colunas', /colspan="13"/.test(tela));
check('coluna e filtro de modelo (NF-e / NFC-e)',
  tela.includes("Number(nfe.modelo) === 65 ? 'NFC-e' : 'NF-e'") && tela.includes('<select name="modelo">')
  && server.includes("if (modelo === '55' || modelo === '65') list = list.filter((nfe) => String(nfe.modelo || 55) === modelo);"));
const css = ler('public/app.css');
check('filtros em linha flexível, Filtrar alinhado pela base', /\.nfe-filtros \{ display: flex; flex-wrap: wrap;[^}]*align-items: flex-end; \}/.test(css) && /id="nfeFilterForm" class="nfe-filtros"/.test(tela));
check('a coluna de seleção não achata mais o interruptor', /\.nfe-check-col input \{ cursor: pointer; \}/.test(css) && !/\.nfe-check-col input \{[^}]*height:/.test(css));
check('botão com a mesma folga e borda do campo (13px + 1px)', /button \{[^}]*padding: 13px 16px;[^}]*border: 1px solid transparent;/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
