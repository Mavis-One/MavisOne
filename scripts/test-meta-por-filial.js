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
// A META DE EMPRESA DEIXOU DE VENCER (30/09/2026), e este check inverteu.
//
// Ele afirmava: "com meta de empresa, ela vence -- e nao soma com as
// filiais". A justificativa era que a meta da empresa ja contem a das lojas.
// A PREMISSA ERA FALSA: o escopo `empresa` se compara com
// `orders.company_id`, vazio em 14.864 de 14.864 pedidos (medido). Ela nao
// contem a das lojas; nao contem nada.
//
// O EFEITO era este: duas metas de filial de 300 e 600 davam 900 no "Todas".
// Bastava UMA meta de empresa de 1000 -- cadastravel em Configuracoes, onde
// "Loja" era a PRIMEIRA opcao do seletor -- e o numero virava 1000. As duas
// de filial eram descartadas sem nada na tela dizendo isso, e o alvo passava
// a ser um numero que nenhuma venda podia alcancar.
const comEmpresa = [...M, { escopo: 'empresa', referenciaId: 'e', competencia: '2026-09-01', valor: 1000 }];
check('meta de empresa NAO vence: o "Todas" segue somando as filiais',
  soma(metas.metasDoRecorte(comEmpresa)) === 900, String(soma(metas.metasDoRecorte(comEmpresa))));
check('  e ela nao entra na soma (1000 nao aparece)',
  !metas.metasDoRecorte(comEmpresa).some((m) => m.escopo === 'empresa'));
// A lista de referencias e' o que permite ao numerador cobrir as MESMAS
// filiais do denominador.
check('referenciasDaMeta devolve as filiais que tem meta',
  metas.referenciasDaMeta(metas.metasDoRecorte(comEmpresa)).sort().join(',') === 'Araquari,Timbo',
  metas.referenciasDaMeta(metas.metasDoRecorte(comEmpresa)).sort().join(','));
check('  e nao repete referencia',
  metas.referenciasDaMeta([{ referenciaId: 'X' }, { referenciaId: 'X' }]).length === 1);
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
  /escopoLib\.vendaVisivel\(escopo, record\.sellerId\)\s*\n\s*&& filialDaVenda\.daFilial\(record, filial\)/.test(server));
// E MOVIMENTACAO INTERNA FICA FORA DAS TRES LINHAS (30/09/2026).
//
// A linha "Pedidos" somava todo pedido nao cancelado, e nisso entrava a
// transferencia entre filiais: R$ 8.778.283,24 em 2026, 37,7% da linha
// (medido). Era por isso que "Pedidos" ficava tao acima de "Faturado".
//
// O filtro e' o MESMO para orders e quotes, num lugar so: aplicado linha por
// linha, a proxima linha nasceria sem ele.
check('  e movimentacao interna fica fora das tres linhas',
  /&& filialDaVenda\.ehVenda\(record\)/.test(server));
check('  pela CATEGORIA, e nao pelo status',
  /ehMovimentacaoInterna/.test(ler('lib/filial-da-venda.js')),
  'o status nao identifica transferencia: 35 vendas de verdade usam o mesmo');
check('cartão e gráfico escolhem a meta pela mesma regra',
  (server.match(/metasLib\.metasDoRecorte\(/g) || []).length >= 2);
check('só administrador vê o botão de meta', /podeDefinirMeta: Boolean\(canSales && admin\)/.test(server));
check('a tela manda a filial na URL', /&filial=\$\{encodeURIComponent\(filialPedida\)\}/.test(tela));
check('a linha de meta só entra com meta cadastrada', /temMeta \? \[\{ key: 'meta'/.test(tela));
check('o gráfico parte a linha onde não há valor, em vez de desenhar zero', /vazio: !temValor\(s\[key\]\)/.test(grafico));

// ---------------------------------------------------------------------------
console.log('\n--- 5. movimentação interna não é venda (30/09/2026) ---');

// A REGRA, EXERCITADA. Os checks acima conferem que ela está LIGADA; estes
// conferem o que ela RESPONDE — e as duas perguntas são diferentes.
const INTERNAS = ['Transferencia entre Filiais', 'Transferência entre Filiais', 'TRANSFERENCIA', 'Remessa', 'REMESSA', 'remessa'];
for (const c of INTERNAS) check(`  "${c}" é interna`, F.ehMovimentacaoInterna(c) === true);
// Venda com sufixo de filial continua venda: a regra olha o texto inteiro, e
// "Venda ... / Araquari" não tem nem transferência nem remessa dentro.
const VENDAS = ['Venda de Materiais e Serviços', 'Venda de Materiais e Serviços / Araquari', 'Garantia', 'DOAÇÕES E BRINDES', '', null, undefined];
for (const c of VENDAS) check(`  ${JSON.stringify(c)} é venda`, F.ehMovimentacaoInterna(c) === false);
check('`ehVenda` é o contrário, e recebe o REGISTRO',
  F.ehVenda({ category: 'Remessa' }) === false && F.ehVenda({ category: 'Venda' }) === true);
check('  e aguenta registro sem categoria', F.ehVenda({}) === true && F.ehVenda(null) === true);

// GARANTIA E DOAÇÃO FICAM DE FORA DA REGRA, de propósito: a medição de
// 30/09/2026 deu R$ 8.665 e R$ 25.950 em 2026 — 0,15% da linha. Recortar o que
// não muda o desenho só aumenta a chance de recortar errado. Se alguém as
// acrescentar, é aqui que a decisão tem de ser revista junto.
check('a regra tem DUAS entradas, e não quatro',
  F.MOVIMENTACAO_INTERNA.length === 2, `${F.MOVIMENTACAO_INTERNA.length}`);

console.log('\n--- 6. o comparador de filial tem um dono ---');
// Estava escrito à mão em server.js num lugar e o default de metasDoRecorte
// (`a === b`, sem chave) valia no outro. O segundo compara cru: uma meta em
// "Timbó" não casaria com a filial "Timbo" dos pedidos.
check('mesmaFilial ignora acento e caixa',
  F.mesmaFilial('Timbó', 'timbo') === true && F.mesmaFilial('Araquari', 'Timbo') === false);
check('  e os dois chamadores de metasDoRecorte o usam',
  (server.match(/mesmaFilial: filialDaVenda\.mesmaFilial/g) || []).length === 2,
  `${(server.match(/mesmaFilial: filialDaVenda\.mesmaFilial/g) || []).length} de 2`);
check('  e ninguém mais escreve a comparação à mão',
  !/chaveDaFilial\(a\) === filialDaVenda\.chaveDaFilial\(b\)/.test(server));

console.log('\n--- 7. a barra do cartão compara coisas iguais ---');
const kpisSrc = ler('lib/kpis.js');
check('a faixa usa metaCobre quando ele existe',
  /faixa: metas\.faixaDaMeta\(metaCobre === null \? valor : metaCobre, meta\)/.test(kpisSrc));
check('  e o cartão informa a cobertura', /metaCobertura:/.test(kpisSrc));
check('  a rota calcula o numerador com a MESMA lista de referências',
  /metasLib\.referenciasDaMeta\(minhas\)/.test(server));
check('  e só quando a meta é por filial (vendedor compara com a dele)',
  /escopoVendas\.sellerIds === null \? metasLib\.referenciasDaMeta\(minhas\) : \[\]/.test(server));
check('a tela só mostra a nota quando a cobertura é parcial',
  /metaCobertura && kpi\.metaCobertura\.percentual < 99\.5/.test(tela));

console.log('\n--- 8. meta de Loja não se cria mais ---');
check('a rota recusa o escopo empresa no POST',
  /if \(escopo === 'empresa'\) \{[\s\S]{0,400}?company_id do pedido/.test(server));
check('  e o formulário não oferece a opção',
  !/<option value="empresa">Loja<\/option>/.test(ler('public/modules/settings/subs/metas.js')));
check('  mas o FILTRO ainda oferece, para achar e remover as antigas',
  /<option value="empresa"[^>]*>Só lojas/.test(ler('public/modules/settings/subs/metas.js')));
check('  e `empresa` continua em ESCOPOS (o GET e o DELETE precisam)',
  metas.ESCOPOS.includes('empresa'), metas.ESCOPOS.join(', '));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
