#!/usr/bin/env node
// Fase DD — filtro de filial e linha de meta no Fluxo de Vendas do Início.
//
// O QUE ESTE TESTE PROVA
// ----------------------
// 1. A filial sai do FIM DA CATEGORIA, porque `orders.company_id` está vazio
//    em todos os pedidos. Venda sem "/" (transferência, remessa) não tem filial
//    e não é empurrada para nenhuma.
// 2. "Timbo" e "Timbó" são a mesma filial — a categoria é digitada à mão.
// 3. A meta que o gráfico e o cartão usam é escolhida pela MESMA regra
//    (metasDoRecorte), e nunca soma empresa com filial.
// 4. A rota e a tela estão ligadas: filial vai na URL, meta vira linha.
const fs = require('fs');
const path = require('path');
const F = require('../lib/filial-da-venda');
const metas = require('../lib/metas');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log('--- 1. a filial é o fim da categoria ---');
check('Araquari', F.filialDaCategoria('Venda de Materiais e Serviços / Araquari') === 'Araquari');
check('Joinville Centro (nome com espaço)', F.filialDaCategoria('Venda de Materiais e Serviços / Joinville Centro') === 'Joinville Centro');
check('sem barra, sem filial', F.filialDaCategoria('Transferencia entre Filiais') === '');
check('categoria vazia, sem filial', F.filialDaCategoria('') === '' && F.filialDaCategoria(null) === '');
check('espaço sobrando some', F.filialDaCategoria('X /   São Bento  do Sul ') === 'São Bento do Sul');

console.log('\n--- 2. grafia ---');
check('Timbo = Timbó', F.chaveDaFilial('Timbo') === F.chaveDaFilial('Timbó'));
check('caixa não importa', F.chaveDaFilial('ARAQUARI') === F.chaveDaFilial('Araquari'));
const lista = F.listarFiliais([
  { category: 'V / Timbo' }, { category: 'V / Timbo' }, { category: 'V / Timbó' },
  { category: 'V / Araquari' }, { category: 'Remessa' }, { category: '' }
]);
check('uma Timbó só, com as três vendas', lista.length === 2 && lista.find((f) => f.nome === 'Timbo')?.pedidos === 3, JSON.stringify(lista));
check('  com a grafia mais usada', lista.some((f) => f.nome === 'Timbo'));
check('  e em ordem alfabética', lista[0].nome === 'Araquari');
check('sem filial não entra na lista', !lista.some((f) => !f.nome));
check('filtro vazio deixa tudo passar', F.daFilial({ category: 'Remessa' }, ''));
check('filtro por filial pega a grafia com acento', F.daFilial({ category: 'V / Timbó' }, 'Timbo'));
check('  e recusa a outra loja', !F.daFilial({ category: 'V / Araquari' }, 'Timbo'));
check('  e recusa a venda sem filial', !F.daFilial({ category: 'Remessa' }, 'Timbo'));

console.log('\n--- 3. qual meta vale ---');
const M = [
  { escopo: 'filial', referenciaId: 'Araquari', competencia: '2026-09-01', valor: 300 },
  { escopo: 'filial', referenciaId: 'Timbo', competencia: '2026-09-01', valor: 600 },
  { escopo: 'vendedor', referenciaId: 'v1', competencia: '2026-09-01', valor: 50 }
];
const mesma = (a, b) => F.chaveDaFilial(a) === F.chaveDaFilial(b);
const soma = (l) => l.reduce((s, m) => s + m.valor, 0);
check('Todas, sem meta de empresa: soma das filiais', soma(metas.metasDoRecorte(M)) === 900);
check('com meta de empresa, ela vence — e não soma com as filiais',
  soma(metas.metasDoRecorte([...M, { escopo: 'empresa', referenciaId: 'e', competencia: '2026-09-01', valor: 1000 }])) === 1000);
check('filial escolhida: só a dela', soma(metas.metasDoRecorte(M, { filial: 'Timbó', mesmaFilial: mesma })) === 600);
check('vendedor restrito: a meta dele', soma(metas.metasDoRecorte(M, { sellerIds: ['v1'] })) === 50);
check('vendedor restrito com filial: nenhuma (a dele não se divide por loja)',
  metas.metasDoRecorte(M, { sellerIds: ['v1'], filial: 'Timbo', mesmaFilial: mesma }).length === 0);
// O rateio do gráfico é o de sempre: um dia de setembro é 1/30 do mês.
check('um dia de setembro recebe 1/30 da meta',
  metas.metaDoPeriodo(metas.metasDoRecorte(M), { from: '2026-09-25', to: '2026-09-25' }) === 30);

console.log('\n--- 4. ligado na rota, no banco e na tela ---');
const server = ler('server.js');
const tela = ler('public/modules/dashboard/index.js');
const grafico = ler('public/modules/shared/painel.js');
const migracao = ler('banco/migrations/fase-dd-meta-por-filial.sql');
const vendasDb = ler('lib/db/vendas-compras.js');
check('a carga enxuta traz a categoria', /const COLUNAS_DE_AGREGADO = '[^']*\bcategory\b/.test(vendasDb));
check('o banco admite o escopo filial', /check \(escopo in \('empresa', 'vendedor', 'filial'\)\)/.test(migracao));
check('a série do gráfico recebe filial e metas',
  /buildSalesChartSeries\(data, granularity, escopoVendas, \{ filial, metas \}\)/.test(server));
check('a filial recorta DEPOIS do escopo, nunca no lugar dele',
  /escopoLib\.vendaVisivel\(escopo, record\.sellerId\) && filialDaVenda\.daFilial\(record, filial\)/.test(server));
check('cartão e gráfico escolhem a meta pela mesma regra',
  (server.match(/metasLib\.metasDoRecorte\(/g) || []).length >= 2);
check('só administrador vê o botão de meta', /podeDefinirMeta: Boolean\(canSales && admin\)/.test(server));
check('a tela manda a filial na URL', /&filial=\$\{encodeURIComponent\(filialPedida\)\}/.test(tela));
check('a linha de meta só entra com meta cadastrada', /temMeta \? \[\{ key: 'meta'/.test(tela));
check('o gráfico parte a linha onde não há valor, em vez de desenhar zero', /vazio: !temValor\(s\[key\]\)/.test(grafico));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
