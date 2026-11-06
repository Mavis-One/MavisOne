#!/usr/bin/env node
/**
 * O CAMPO EMPRESA EM TODOS OS RELATÓRIOS (06/11/2026). Pedido do usuário:
 * "ainda na parte de relatórios, quero que você verifique e coloque opção de
 * seleção de empresas em todos os modulos".
 *
 * Um campo só, o mesmo em todo relatório: a empresa inteira (a raiz do CNPJ,
 * "todas as lojas"), uma loja (o CNPJ inteiro) ou "Empresa não identificada".
 * O que muda é de onde a empresa sai em cada módulo:
 *   - Vendas e CRM: a do faturamento do pedido (comum.js, empresaDoPedidoSql);
 *   - Financeiro e lançamentos de contrato: a da coluna Empresa de Contas a
 *     Pagar e a Receber (o servidor devolve os títulos dela);
 *   - Compras: a destinatária da nota de entrada; a Empresa da ordem de compra;
 *   - Estoque e PCP: a do depósito;
 *   - Fiscal: a emitente da nota (era o campo Estabelecimento);
 *   - Serviços: a da NF-e que vendeu o equipamento, ou a do depósito.
 * Fica sem o campo só o que não tem empresa nenhuma nos dados: o catálogo de
 * produtos (que é do grupo), contatos, agenda, RH, frota e o cadastro de
 * contratos.
 *
 * Provado no banco local pela rota (porta 3999): nenhuma das 79 consultas
 * quebra, e as partes somam o todo — Pedidos Faturados 14.031 = Plus 3.815 +
 * Electric 10.059 + só do Viper 157; Contas a Pagar 922 = 714 + 188 + 20;
 * Extrato 25.709; Estoque por Depósito 902 = 11 + 891; a pagar e a receber da
 * Síntese e o Valor em Estoque (871.287,18) também.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const comum = require('../lib/relatorios/comum');
const catalogo = require('../lib/relatorios');
const motor = require('../lib/relatorios/motor');
const relatoriosVendas = require('../lib/relatorios-vendas');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

console.log('--- 1. todo relatório que tem empresa nos dados tem o campo ---');
const SEM_EMPRESA_NOS_DADOS = new Set([
  'precificacao', 'aniversariantes', 'dados-fiscais-produtos', 'composicao-de-produtos',
  'agendamentos', 'tarefas', 'colaboradores', 'afastamentos-e-ferias', 'controle-de-ferias',
  'contratos', 'vencimentos-de-contratos', 'abastecimentos', 'manutencoes', 'despesas-por-veiculo'
]);
const comuns = catalogo.RELATORIOS.filter((r) => !r.especial);
const faltando = comuns.filter((r) => !SEM_EMPRESA_NOS_DADOS.has(r.key) && !(r.filtros || []).includes('filial')).map((r) => r.key);
check('nenhum relatório com empresa nos dados ficou sem o campo', faltando.length === 0, faltando.join(', '));
const aMais = comuns.filter((r) => SEM_EMPRESA_NOS_DADOS.has(r.key) && (r.filtros || []).includes('filial')).map((r) => r.key);
check('  e a lista dos que não têm empresa está certa', aMais.length === 0 && [...SEM_EMPRESA_NOS_DADOS].every((k) => catalogo.relatorio(k)), aMais.join(', '));
check(`  ${comuns.length - SEM_EMPRESA_NOS_DADOS.size} relatórios com o campo`, comuns.filter((r) => (r.filtros || []).includes('filial')).length === comuns.length - SEM_EMPRESA_NOS_DADOS.size);
check('o Fiscal não tem mais o campo Estabelecimento (virou Empresa)', !comuns.some((r) => (r.filtros || []).includes('estabelecimento')));
check('todo relatório do Financeiro lê só os títulos da empresa',
  comuns.filter((r) => r.grupo === 'financeiro').every((r) => r.titulosPelaEmpresa)
  && catalogo.relatorio('lancamentos-de-contratos').titulosPelaEmpresa && catalogo.relatorio('saidas-x-receitas').titulosPelaEmpresa);

console.log('\n--- 2. o nome do campo diz de onde a empresa sai ---');
const visiveis = catalogo.catalogoVisivel({ allowedModules: [] }, true).flatMap((g) => g.relatorios);
const rotulo = (k) => (visiveis.find((r) => r.key === k) || {}).rotuloDaEmpresa;
const doViper = (k) => (visiveis.find((r) => r.key === k) || {}).empresasDoViper;
check('vendas e CRM: "Empresa (faturamento)", com as empresas só do Viper',
  rotulo('pedidos-faturados') === 'Empresa (faturamento)' && rotulo('clientes-sem-comprar') === 'Empresa (faturamento)'
  && doViper('pedidos-faturados') === true && doViper('pedidos-x-nfe') === true);
check('  o orçamento, que não fatura: "Empresa", sem as do Viper', rotulo('orcamentos') === 'Empresa' && doViper('orcamentos') === false);
check('fiscal: "Empresa (emitente)"; compras: "Empresa (destinatária)"', rotulo('nfe-emitidas') === 'Empresa (emitente)' && rotulo('notas-de-entrada') === 'Empresa (destinatária)');
check('o resto: "Empresa", sem as do Viper', rotulo('contas-a-pagar') === 'Empresa' && rotulo('estoque-por-deposito') === 'Empresa'
  && doViper('contas-a-pagar') === false && doViper('estoque-por-deposito') === false);

console.log('\n--- 3. o valor e a regra ---');
check('a raiz do CNPJ (8 dígitos) é a empresa inteira', comum.empresaPedida('43.792.899') === '43792899' && comum.empresaPedida('43792899') === '43792899');
check('  a loja continua pelo CNPJ inteiro', comum.empresaPedida('43.792.899/0002-16') === '43792899000216');
check('  e o resto vira "todas"', comum.empresaPedida('4379') === '' && comum.empresaPedida('Araquari') === '');
check('empresaConfere: a raiz pega as lojas e o título que só sabe a empresa',
  comum.empresaConfere('43792899000216', '43792899') && comum.empresaConfere('43792899', '43792899') && !comum.empresaConfere('46877837000114', '43792899'));
check('  a loja, só ela (o título que só sabe a empresa não entra)', comum.empresaConfere('43792899000216', '43792899000216') && !comum.empresaConfere('43792899', '43792899000216'));
check('  "não identificada", só o que não tem', comum.empresaConfere('', comum.SEM_EMPRESA) && !comum.empresaConfere('43792899000135', comum.SEM_EMPRESA));
const condicao = comum.condicaoDeEmpresaSql('EXPR', '$7');
check('a condição SQL compara 8 dígitos na raiz e a expressão aparece uma vez só',
  /left\(coalesce\(EXPR, ''\), case when \$7 ~ '\^\[0-9\]\{8\}\$' then 8 else 200 end\)/.test(condicao) && condicao.split('EXPR').length === 2);
const doDeposito = comum.depositoDaEmpresaSql('m.deposit_id', '$2', [{ id: 'company-1', document: '43.792.899/0001-35' }]);
check('o depósito: uma lista dos depósitos da empresa (in), e não a empresa linha a linha do razão',
  /coalesce\(m\.deposit_id, ''\) in \(select dd\.id from deposits dd where/.test(doDeposito) && /"company-1":"43792899000135"/.test(doDeposito));
check('  em "não identificada" entram o movimento sem depósito e o depósito que não existe mais',
  /\$2 = 'sem-empresa' and coalesce\(m\.deposit_id, ''\) not in \(select dd\.id from deposits dd\)/.test(doDeposito));
check('a NF-e do pedido é achada pela chave (uuid), e não por n.id::text',
  !/n\.id::text/.test(comum.empresaDoPedidoSql('o', [])) && /n\.id = \(case when o\.nfe_id ~\*/.test(comum.empresaDoPedidoSql('o', [])));

console.log('\n--- 4. os títulos da empresa ---');
(async () => {
  const pedidas = [];
  const sql = async (texto, parametros) => { pedidas.push({ texto, parametros }); return [{ saldo: 0 }]; };
  const recortado = comum.sqlSoComOsTitulos(sql, ['t1', 't2'], ['c1']);
  await recortado(`select 1 from financial_payments p join financial_entries e on e.id = p.entry_id where $1 = ''`, ['x']);
  check('cada "financial_entries e" vira só os títulos da empresa, num parâmetro a mais',
    /join \(select \* from financial_entries where id = any\(\$2::text\[\]\)\) e on/.test(pedidas[0].texto) && JSON.stringify(pedidas[0].parametros) === '["x",["t1","t2"]]');
  await recortado(`select (select sum(b.initial_balance) from bank_accounts b where ($1 = '' or b.id = $1)) + (select 1 from financial_entries e)`, ['']);
  check('  e o saldo inicial, só as contas da empresa',
    /from \(select \* from bank_accounts where id = any\(\$3::text\[\]\)\) b where/.test(pedidas[1].texto) && JSON.stringify(pedidas[1].parametros) === '["",["t1","t2"],["c1"]]');
  await recortado('select 1 from orders o', []);
  check('  consulta sem lançamento passa como veio', pedidas[2].texto === 'select 1 from orders o' && pedidas[2].parametros.length === 0);

  let perguntou = null;
  const def = { key: 'x', grupo: 'financeiro', titulo: 'X', filtros: ['periodo', 'filial'], titulosPelaEmpresa: true, colunas: [{ campo: 'n', tipo: 'inteiro' }],
    executar: async ({ sql: s }) => { await s('select count(*) as n from financial_entries e', []); return [{ n: 1 }]; } };
  pedidas.length = 0;
  await motor.executar(def, motor.normalizarFiltros(def, { filial: '43792899' }), { sql, titulosDaEmpresa: async (v) => { perguntou = v; return { titulos: ['t9'], contas: [] }; } });
  check('o motor pede os títulos da empresa e recorta a consulta', perguntou === '43792899' && /any\(\$1::text\[\]\)/.test(pedidas[0].texto));
  pedidas.length = 0;
  perguntou = null;
  await motor.executar(def, motor.normalizarFiltros(def, {}), { sql, titulosDaEmpresa: async (v) => { perguntou = v; return null; } });
  check('  sem empresa, não pergunta e não recorta', perguntou === null && pedidas[0].texto === 'select count(*) as n from financial_entries e');

  console.log('\n--- 5. o servidor ---');
  const servidor = ler('server.js');
  const ini = servidor.indexOf('  function empresasDoFiltroDosRelatorios(');
  // eslint-disable-next-line no-new-func
  const lista = new Function(`${servidor.slice(ini, servidor.indexOf('\n  }\n', ini) + 4)}; return empresasDoFiltroDosRelatorios;`)()([
    { id: '43792899000216', name: 'SAL INFINITY PLUS (MARCOLLA)' },
    { id: '46877837000114', name: 'SAL INFINITY ELECTRIC' },
    { id: '43792899000135', name: 'SAL INFINITY PLUS COMERCIO LTDA (MATRIZ)' }
  ]);
  check('a lista: a empresa de várias lojas inteira, antes das lojas; a de uma loja só, direto',
    lista.map((e) => e.id).join(',') === '46877837000114,43792899,43792899000216,43792899000135'
    && lista[1].name === 'SAL INFINITY PLUS COMERCIO LTDA — todas as lojas', JSON.stringify(lista.map((e) => e.name)));
  check('os títulos da empresa: a regra da coluna Empresa, em todos os títulos e nas contas',
    /async function titulosEContasDaEmpresa\(valor\) \{[\s\S]{0,1600}const empresaDe = await resolvedorDeEmpresas\(titulos, dados\);[\s\S]{0,300}relatoriosComum\.empresaConfere/.test(servidor));
  check('  e chegam ao catálogo', /titulosDaEmpresa: titulosEContasDaEmpresa/.test(servidor));
  check('a mesma lista no catálogo, em Pedidos e na Síntese/Estoque (estas sem as do Viper)',
    /empresasDosRelatorios\(\)\s*\]\);/.test(servidor) && /relatorio\.opcoes = \{ \.\.\.relatorio\.opcoes, empresas: await empresasDosRelatorios\(\) \};/.test(servidor)
    && /empresas: await empresasDosRelatorios\(\{ doViper: false \}\)/.test(servidor));
  check('Pedidos e Vendas por Vendedor: os pedidos e orçamentos da empresa', /pedidosDaEmpresa: await pedidosDaEmpresaDoRelatorio\(/.test(servidor));
  check('a Síntese: os títulos da empresa; o Valor em Estoque: o razão nos depósitos dela',
    /titulosEContasDaEmpresa\(params\.get\('empresa'\)\)/.test(servidor)
    && /async function baseDeEstoqueDosRelatorios\(params\) \{[\s\S]{0,900}depositoDaEmpresaSql\('m\.deposit_id'/.test(servidor)
    && !/baseDeEstoqueDosRelatorios\(\)/.test(servidor));

  const linhas = [{ pedidoId: 'a', tipo: 'order', data: '2026-10-01', status: 'pedido-faturado' }, { pedidoId: 'b', tipo: 'order', data: '2026-10-01', status: 'pedido-faturado' }];
  const escopo = require('../lib/relatorios-escopo').escopoDeVendas({ id: 'u', allowedModules: ['reports'] }, { ehAdmin: true });
  check('o relatório de vendas filtra pelos pedidos da empresa',
    relatoriosVendas.filtrar(linhas, { pedidosDaEmpresa: new Set(['b']) }, escopo).map((l) => l.pedidoId).join() === 'b'
    && relatoriosVendas.filtrar(linhas, { pedidosDaEmpresa: null }, escopo).length === 2);

  console.log('\n--- 6. a tela ---');
  const tela = ler('public/modules/reports/subs/catalogo.js');
  check('o catálogo: o nome do campo vem do relatório, e as do Viper só onde se lê pedido',
    /select\('filial', def\.rotuloDaEmpresa \|\| 'Empresa',\s*\(opcoes\.empresasDeFaturamento \|\| \[\]\)\.filter\(\(o\) => def\.empresasDoViper \|\| !String\(o\.id\)\.startsWith\('viper:'\)\)/.test(tela));
  const especiais = ler('public/modules/reports/subs/relatorios.js');
  check('Pedidos e Vendas por Vendedor: o campo na barra, e ele vai na consulta e na exportação',
    /empresa: '',/.test(especiais) && /<select data-rel-filtro="empresa">/.test(especiais));
  check('Síntese e Valor em Estoque: o campo no topo, na consulta e na exportação',
    /\$\{relCampoEmpresaGeral\(ctx\)\}/.test(especiais) && (especiais.match(/relLigarEmpresaGeral\(ctx\);/g) || []).length === 2
    && /&empresa=\$\{encodeURIComponent\(state\.reportsEmpresaGeral\)\}/.test(ler('public/modules/reports/index.js')));

  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})();
