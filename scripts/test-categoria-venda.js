#!/usr/bin/env node
// A CATEGORIA DE VENDA DIZ O QUE FAZ (fase EF, 13/10/2026).
//
// Pedido do usuário: a categoria (ex.: "Transferência") diz se altera o
// estoque, se gera financeiro, a utilidade dela, e se liga aos outros módulos.
// Provado no banco local: transferência faturada baixou o estoque sem conta a
// receber; venda (com a filial no nome) gerou a conta com a categoria
// financeira; "não altera estoque" não baixou; categoria não cadastrada seguiu
// como sempre. Na tela: lista com finalidade/estoque/financeiro, a edição
// abre (não abria), a finalidade sugere os efeitos, e a NF-e do pedido de
// transferência abre em Transferência.
'use strict';
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');
const CV = require('../public/modules/shared/categoria_venda');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');
const ler = (a) => fs.readFileSync(path.join(RAIZ, a), 'utf8');

console.log('\n--- 1. a regra ---');
const cats = [
  { name: 'Venda de Materiais e Serviços', finalidade: 'venda', alteraEstoque: true, geraFinanceiro: true, operacaoFiscal: 'VENDA', financialCategoryId: 'cat-venda' },
  { name: 'Transferência entre Filiais', finalidade: 'transferencia', alteraEstoque: true, geraFinanceiro: false, operacaoFiscal: 'TRANSFERENCIA' },
  { name: 'Serviço', finalidade: 'outros', alteraEstoque: false, geraFinanceiro: true }
];
const rV = CV.regraDaCategoria('Venda de Materiais e Serviços / Timbo', cats);
check('nome com filial casa pela categoria sem a filial', rV.cadastrada && rV.contaComoVenda && rV.financialCategoryId === 'cat-venda');
const rT = CV.regraDaCategoria('transferencia entre filiais', cats);
check('sem acento e sem maiúscula também', rT.cadastrada && !rT.geraFinanceiro && rT.alteraEstoque && rT.operacaoFiscal === 'TRANSFERENCIA' && rT.contaComoVenda === false);
check('não altera estoque', CV.regraDaCategoria('Serviço', cats).alteraEstoque === false);
const rN = CV.regraDaCategoria('Garantia', cats);
check('não cadastrada: sem regra (o status decide, como sempre)', !rN.cadastrada && rN.alteraEstoque && rN.geraFinanceiro && rN.contaComoVenda === null);
check('sugestões por finalidade', CV.finalidade('transferencia').financeiro === false && CV.finalidade('venda').financeiro === true && CV.finalidade('garantia').operacao === '');

console.log('\n--- 2. banco ---');
const mig = ler('banco/migrations/fase-ef-categoria-de-venda-com-efeitos.sql');
check('as categorias que existiam começam como venda que mexe em tudo', /finalidade text not null default 'venda'/.test(mig) && /altera_estoque boolean not null default true/.test(mig) && /gera_financeiro boolean not null default true/.test(mig));
check('operação fiscal só as que um pedido gera', /operacao_fiscal in \('VENDA', 'TRANSFERENCIA', 'REMESSA', 'RETORNO', 'DEVOLUCAO', 'BONIFICACAO'\)/.test(mig));
check('RECRIAR-DO-ZERO inclui a fase EF', ler('banco/RECRIAR-DO-ZERO.sql').includes('fase-ef-categoria-de-venda-com-efeitos.sql'));
const db = ler('lib/db/categorias-venda.js');
check('o cadastro lê e grava os campos', /alteraEstoque: row\.altera_estoque !== false/.test(db) && /gera_financeiro: payload\.geraFinanceiro !== false/.test(db));

console.log('\n--- 3. ligações ---');
const server = semComentarios(ler('server.js'));
check('pedido: estoque e financeiro pela categoria, sem desfazer o já aplicado',
  /salesStatus\.baixaEstoque\(statusNovo\)\s*&& \(Boolean\(current\.stockApplied\) \|\| regraCategoria\.alteraEstoque\)/.test(server)
  && /salesStatus\.geraFinanceiro\(statusNovo\)\s*&& \(eraFaturado \|\| regraCategoria\.geraFinanceiro\)/.test(server));
check('  também no pedido que já nasce faturado', /const geraFinanceiroAgora = type === 'order' && salesStatus\.geraFinanceiro\(status\) && regraCategoria\.geraFinanceiro;/.test(server));
check('financeiro: conta a receber com a categoria financeira', /category: categoriaFinanceira,/.test(server));
check('relatórios em memória recarregam ao subir e ao mudar o cadastro', (server.match(/await recarregarCategoriasDosRelatorios\(\);/g) || []).length === 3 && /recarregarCategoriasDosRelatorios\(\);\s*\}\);/.test(server));
const filial = ler('lib/filial-da-venda.js');
check('relatórios: cadastrada decide pela finalidade, a outra pelo texto', /if \(regra\.cadastrada\) return !regra\.contaComoVenda;/.test(filial));
const comum = ler('lib/relatorios/comum.js');
check('  e o SQL faz o mesmo', /select sc\.finalidade = 'venda' from sales_categories sc/.test(comum) && /!~\* '\(transfer\|remessa\)'\)`;/.test(comum));
const app = ler('public/app.js');
const nfe = ler('public/modules/finance/subs/emitir_nfe_focus.js');
check('fiscal: a NF-e do pedido abre com a operação da categoria', /tipoOperacao: window\.MavisCategoriaVenda/.test(app) && /tipoOperacao = doPedido\.tipoOperacao;/.test(nfe));
check('a edição da categoria abre (rota por id)', /pathname\.startsWith\('\/api\/sales\/categories\/'\) && req\.method === 'GET'/.test(server));

console.log('\n--- 4. telas ---');
const form = ler('public/modules/sales/subs/new_sales_category.js');
check('formulário: finalidade, estoque, financeiro, operação e categoria financeira',
  ['name="finalidade"', 'name="alteraEstoque"', 'name="geraFinanceiro"', 'name="operacaoFiscal"', 'name="financialCategoryId"'].every((n) => form.includes(n)));
check('  a finalidade sugere só na categoria nova', /if \(atual\) return;\s*const f = CV\.finalidade\(e\.target\.value\);/.test(form));
const lista = ler('public/modules/sales/subs/sales_categories.js');
check('lista: finalidade, estoque e financeiro', /label: 'Finalidade'/.test(lista) && /label: 'Estoque'/.test(lista) && /label: 'Financeiro'/.test(lista));
const html = ler('public/index.html');
check('script da regra antes das telas de categoria', html.indexOf('/modules/shared/categoria_venda.js') > 0 && html.indexOf('/modules/shared/categoria_venda.js') < html.indexOf('/modules/sales/subs/sales_categories.js'));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
