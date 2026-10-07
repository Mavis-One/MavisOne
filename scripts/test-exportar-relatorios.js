#!/usr/bin/env node
/**
 * EXPORTAÇÃO DO FINANCEIRO E DO ESTOQUE (fase DB) — sem banco e sem servidor.
 *
 * O QUE FALTAVA. O botão "Excel (CSV)" morava dentro da barra de FILTROS do
 * relatório de Vendas, e só Vendas e Por Vendedor a chamam. Financeiro e
 * Estoque não tinham exportação nenhuma — e o Financeiro não tinha nem tabela:
 * os números do fluxo existiam apenas como desenho do gráfico, então quem
 * precisava do valor de um mês media a altura da linha com o olho.
 *
 * O QUE ESTE TESTE PROTEGE, E POR QUE CADA COISA
 * ---------------------------------------------
 * 1. A TELA E O ARQUIVO SAEM DA MESMA CONTA. Os dois caminhos de cada
 *    relatório passam pela mesma base (`baseFinanceiraDosRelatorios`,
 *    `baseDeEstoqueDosRelatorios`). Montar cada um por conta própria é o jeito
 *    conhecido de a exportação passar a discordar do que estava na tela — e
 *    discordar em silêncio, porque ninguém compara uma planilha com um gráfico.
 *
 * 2. A PERMISSÃO VEM ANTES DOS SYNCS. A rota de overview carregava NF-e e
 *    compras e só então conferia se a pessoa podia ver relatório: trabalho
 *    feito para quem vai levar 403, com os dados já em memória.
 *
 * 3. O ESTOQUE EXPORTA A LISTA INTEIRA, e a tela diz isso. A tela mostra os 15
 *    que mais prendem dinheiro porque é a pergunta dela; ninguém abre uma
 *    planilha para reler quinze linhas. Sem o aviso, quem exportasse contaria
 *    5.475 linhas onde viu 15 e acharia defeito.
 *
 * 4. O FINANCEIRO LEVA AS DATAS DO BALDE. "03/08" é legível no gráfico e
 *    ambíguo numa planilha que vai circular: no recorte semanal, o rótulo não
 *    diz de quando até quando.
 *
 * 5. O SALDO É CALCULADO das duas colunas ao lado, não lido da série. Elas
 *    valem o mesmo hoje; no dia em que a série trouxer um saldo com outra regra
 *    (acumulado), o arquivo teria uma coluna que não fecha com as vizinhas.
 *
 * 6. NÚMERO NÃO PASSA PELA NEUTRALIZAÇÃO DE FÓRMULA. Apóstrofo num número faz a
 *    planilha tratá-lo como texto e a soma da coluna dar zero — ver
 *    test-csv-sem-formula.js.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const { semComentarios } = require('./sem-comentarios');

const relCsv = require(path.join(RAIZ, 'lib/relatorios-csv'));

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`  ${cond ? 'OK  ' : 'XX  '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// ---------------------------------------------------------------------------
console.log('--- 1. o CSV do Financeiro ---');
const SERIE = [
  { label: '03/08', from: '2026-08-03', to: '2026-08-09', receitas: 1500.5, despesas: 400.25, saldo: 1100.25 },
  { label: '10/08', from: '2026-08-10', to: '2026-08-16', receitas: 200, despesas: 900, saldo: -700 }
];
const fin = relCsv.financeiro(SERIE);
const linhasFin = fin.split('\r\n');
check('cabeçalho com Período, De e Até',
  linhasFin[0].replace(/^﻿/, '') === 'Período;De;Até;Receitas;Despesas;Saldo',
  linhasFin[0].replace(/^﻿/, ''));
check('  as datas do balde entram', linhasFin[1].includes('2026-08-03;2026-08-09'), linhasFin[1]);
check('receitas e despesas com vírgula decimal', linhasFin[1].includes('1500,50;400,25'), linhasFin[1]);
check('saldo calculado das duas colunas ao lado', linhasFin[1].endsWith(';1100,25'), linhasFin[1]);
check('  e negativo mantém o sinal, sem apóstrofo', linhasFin[2].endsWith(';-700,00'), linhasFin[2]);
// O SALDO NÃO É LIDO DA SÉRIE. Aqui a série mente de propósito: se o arquivo
// copiasse `saldo`, sairia 99 em vez de 100.
const serieMentirosa = [{ label: 'X', from: 'a', to: 'b', receitas: 300, despesas: 200, saldo: 99 }];
check('  e ignora o `saldo` da série quando ele discorda',
  relCsv.financeiro(serieMentirosa).split('\r\n')[1].endsWith(';100,00'),
  relCsv.financeiro(serieMentirosa).split('\r\n')[1]);
check('série vazia devolve só o cabeçalho', relCsv.financeiro([]).split('\r\n').filter(Boolean).length === 1);
check('  e série ausente não quebra', typeof relCsv.financeiro(undefined) === 'string');

console.log('\n--- 2. o CSV do Estoque ---');
const PRODUTOS = [
  { name: 'Bike Aro 29', sku: 'BK29', quantidade: 4, custo: 1200.5, valor: 4802 },
  { name: 'Câmara; de ar', sku: 'CAM', quantidade: 0, custo: 0, valor: 0 }
];
const est = relCsv.estoque(PRODUTOS);
const linhasEst = est.split('\r\n');
check('cabeçalho esperado',
  linhasEst[0].replace(/^﻿/, '') === 'Produto;SKU;Quantidade;Custo;Valor parado',
  linhasEst[0].replace(/^﻿/, ''));
check('quantidade inteira sai sem casas', linhasEst[1].includes(';4;'), linhasEst[1]);
check('custo com duas casas', linhasEst[1].includes(';1200,50;'), linhasEst[1]);
// O ponto e vírgula no nome do produto quebraria o arquivo sem as aspas.
check('nome com ponto e vírgula vira campo citado', linhasEst[2].startsWith('"Câmara; de ar"'), linhasEst[2]);
check('produto sem custo entra com zero, e não é omitido',
  linhasEst[2].endsWith(';0;0,00;0,00'), linhasEst[2]);
check('lista vazia devolve só o cabeçalho', relCsv.estoque([]).split('\r\n').filter(Boolean).length === 1);

console.log('\n--- 3. uma conta só para a tela e para o arquivo ---');
// UMA BASE POR RELATÓRIO (06/10/2026). Era uma base só para os dois, que lia o
// sistema inteiro (cinco syncs: NF-e, compras, cadastro, vendas e o
// financeiro com todas as baixas) a cada abertura de qualquer um deles — 1,1 s.
// A invariante que este bloco protege continua a mesma, só que por relatório:
// a tela e o arquivo de cada um saem da MESMA função.
const servidor = semComentarios(ler('server.js'));
check('a base da Síntese Financeira existe', /async function baseFinanceiraDosRelatorios\(params\)/.test(servidor));
check('a base do Valor em Estoque existe', /async function baseDeEstoqueDosRelatorios\(\)/.test(servidor));
const trecho = (inicio, fim) => {
  const de = servidor.slice(servidor.indexOf(inicio));
  return de.slice(0, de.indexOf(fim));
};
const corpoFin = trecho('async function baseFinanceiraDosRelatorios', '\n  }\n');
const corpoEst = trecho('async function baseDeEstoqueDosRelatorios', '\n  }\n');
check('  a da Síntese devolve a série do financeiro pronta',
  /serieFinanceiro: buildFinanceChartSeries\(lancamentos, granularity\)/.test(corpoFin));
check('  e a do Estoque, os produtos com o valor parado', /produtosComSaldo/.test(corpoEst));
// SÓ O QUE CADA UMA LÊ. O `select *` dos lançamentos com as baixas era 690 ms
// por abertura; as colunas que a conta lê, 85 ms.
check('  nenhuma das duas volta ao sync do sistema inteiro',
  !/sync(?:Financ|Nfe|Purchases|Cadastro|Sales)\w*\(/.test(corpoFin + corpoEst),
  'leitura enxuta de lib/relatorios-cargas.js');
check('  nem lê coleção do db.json', !/loadData\(\)|data\.finance/.test(corpoFin + corpoEst));
// A PERMISSÃO ANTES DE LER: trabalho feito para quem vai levar 403.
const porta = trecho('async function portaDosRelatoriosGerais', '\n  }\n');
check('a porta confere a permissão', /podeVerRelatorios\(user, await ehAdmin\(user\)\)/.test(porta));
const overview = trecho("if (pathname === '/api/reports/overview'", '\n  }\n');
check('  e o overview passa por ela ANTES de ler',
  overview.indexOf('portaDosRelatoriosGerais(req)') > -1
  && overview.indexOf('portaDosRelatoriosGerais(req)') < overview.indexOf('baseFinanceiraDosRelatorios('));
const exportacao = trecho('const exportacaoGeral = ', '\n  }\n');
check('  e a exportação também',
  exportacao.indexOf('portaDosRelatoriosGerais(req)') > -1
  && exportacao.indexOf('portaDosRelatoriosGerais(req)') < exportacao.indexOf('baseFinanceiraDosRelatorios('));
// DUAS chamadas de cada base: a do overview e a da exportação.
check('a tela e o arquivo da Síntese saem da mesma base',
  (servidor.match(/baseFinanceiraDosRelatorios\(url\.searchParams\)/g) || []).length === 2);
check('a tela e o arquivo do Estoque saem da mesma base',
  (servidor.match(/await baseDeEstoqueDosRelatorios\(\)/g) || []).length === 1
  && /parte === 'financeiro' \? null : baseDeEstoqueDosRelatorios\(\)/.test(overview));
// A rota de overview não pode ter voltado a montar a série por conta própria.
check('o overview não recalcula a série', /resposta\.serieFinanceiro = financeira\.serieFinanceiro;/.test(overview),
  'ele repassa a que veio da base');
// `vendas`, `vendedores` e `serieVendas` saíram: nenhuma tela os lia, e eram
// os números que precisavam do escopo de vendedor. Se voltarem, voltam com a
// leitura de pedidos e com o risco de vazar faturamento de colega.
check('  e não calcula vendas que nenhuma tela lê',
  !/buildSalesDashboardSummary|buildSalesChartSeries|serieVendas/.test(overview));

console.log('\n--- 4. as duas rotas ---');
check('uma rota só, para os dois relatórios',
  /pathname\.match\(\/\^\\\/api\\\/reports\\\/\(financeiro\|estoque\)\\\/export\$\/\)/.test(servidor));
check('  o Financeiro leva a série', /relatoriosCsv\.financeiro\(base\.serieFinanceiro\)/.test(servidor));
// A LISTA INTEIRA, e não o slice(0,15) da tela.
check('  o Estoque leva a lista INTEIRA',
  /relatoriosCsv\.estoque\(\s*\n?\s*base\.produtosComSaldo\.slice\(\)\.sort\(\(a, b\) => b\.valor - a\.valor\)\s*\n?\s*\)/.test(servidor));
check('  sem o filtro de valor > 0 que a tela usa',
  !/produtosComSaldo\.filter\(\(p\) => p\.valor > 0\)/.test(servidor),
  'produto sem custo e justamente o que se procura numa planilha de estoque');
// O `filename="..."` passou a ser montado por enviarCsv (o CSV sai comprimido,
// como o JSON); o que a rota decide é o NOME, e é ele que importa aqui.
check('  e o nome do arquivo diz qual é', /enviarCsv\(res, conteudo, `relatorio-de-\$\{qual\}-\$\{hoje\}\.csv`\)/.test(servidor));

console.log('\n--- 5. a tela ---');
const tela = ler('public/modules/reports/subs/relatorios.js');
// A LINHA DE AÇÕES TEM UM DONO. Estava dentro da barra de filtros de Vendas, e
// era por isso que dar o botão aos outros dois exigiria arrastar os filtros de
// vendedor, cliente e produto junto.
check('relAcoes existe', /function relAcoes\(antes\)/.test(tela));
check('  e os três relatórios a usam',
  (tela.match(/\$\{relAcoes\(/g) || []).length === 3,
  'vendas (com Aplicar/Limpar), financeiro e estoque');
check('o download tem um dono só', /function relLigarExportacao\(ctx, endpoint, nome, aviso\)/.test(tela));
check('  fetch + blob, e não <a href>', /headers: \{ 'x-auth-token'/.test(tela));
// CONTADO PELOS ENDPOINTS, e não por `relLigar...(ctx, `: aquele padrão casa
// também com a DEFINIÇÃO das duas funções e com a chamada de uma dentro da
// outra — pedia 3 e achava 6. Contar o que a pergunta quer saber ("quantas
// telas exportam?") é o que responde a pergunta.
for (const rota of ['/api/reports/vendas/export', '/api/reports/financeiro/export', '/api/reports/estoque/export']) {
  check(`  ${rota} está ligado numa tela`, tela.includes(rota));
}

console.log('\n--- 6. o Financeiro passou a ter tabela ---');
check('a tabela do fluxo existe', /<h3>Fluxo período a período<\/h3>/.test(tela));
check('  com as datas do balde embaixo do rótulo',
  /\$\{relData\(ponto\.from\)\} a \$\{relData\(ponto\.to\)\}/.test(tela));
check('  saldo calculado na tela também, das mesmas duas colunas',
  /const saldo = Number\(ponto\.receitas \|\| 0\) - Number\(ponto\.despesas \|\| 0\);/.test(tela));
check('  e negativo em vermelho', /saldo < 0 \? ' style="color:var\(--danger-text\);"'/.test(tela));

console.log('\n--- 7. a tela avisa quando o arquivo tem mais do que ela ---');
// Sem isto, quem exportasse contaria 5.475 linhas onde viu 15 e acharia defeito.
check('o Estoque diz quantos a exportação leva',
  /a exportação leva os \$\{Number\(e\.totalProdutos \|\| 0\)/.test(tela));
check('  e o aviso do download repete', /a tela mostra só os maiores/.test(tela));
check('o Financeiro avisa que é o mesmo recorte',
  /mesmo recorte de período da tela/.test(tela));
// A mensagem de Vendas NÃO pode ser a mesma: lá o arquivo tem os mesmos
// filtros, aqui tem mais linhas. Dizer o mesmo nos dois faria uma ser falsa.
check('  e Vendas mantém a sua', /mesmos filtros da tela/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
