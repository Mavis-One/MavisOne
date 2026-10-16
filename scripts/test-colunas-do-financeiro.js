#!/usr/bin/env node
/**
 * LANÇAMENTOS, CONTAS A PAGAR E A RECEBER: AS COLUNAS (16/10/2026). Pedido do
 * usuário: "inverta os campos de descrição e empresa em contas a pagar/contas
 * a receber e lançamentos, também retire o código e coloque as contas
 * bancárias".
 *
 * As três telas são a mesma lista (lancamentos.js) e desenham as colunas na
 * ordem do catálogo. A Conta bancária ficou no lugar do Código, Empresa veio
 * antes de Descrição, e o Código deixou de ser fixo (fica no seletor, no fim).
 *
 * Quem já tinha escolhido as colunas tem o Código salvo na preferência (a
 * caixa travada contava como marcada). Para a troca valer para essas pessoas,
 * uma vez: preferência sem `layout` (ou menor que 2) perde o Código e ganha a
 * Conta bancária; mexer no seletor grava o layout 2, e dali em diante a
 * escolha é da pessoa.
 *
 * Provado no navegador: as três telas com "Conta bancária, Data, Vencimento,
 * Empresa, (Tipo,) Categoria, Cliente/Fornecedor, Descrição, ..." e sem
 * Código; uma escolha antiga com o Código virou "Conta bancária, Data,
 * Empresa, Descrição, Valor previsto"; a mesma escolha com layout 2 manteve o
 * Código.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const fonte = fs.readFileSync(path.join(__dirname, '..', 'public/modules/finance/subs/lancamentos.js'), 'utf8');

// O catálogo e as constantes, avaliados de verdade.
const inicio = fonte.indexOf('const FINANCE_LISTA_COLUNAS = [');
const fim = fonte.indexOf('const FINANCE_LAYOUT_DAS_COLUNAS = 2;') + 'const FINANCE_LAYOUT_DAS_COLUNAS = 2;'.length;
const ctx = {};
vm.runInNewContext(`${fonte.slice(inicio, fim)}; saida.colunas = FINANCE_LISTA_COLUNAS; saida.padrao = FINANCE_COLUNAS_PADRAO; saida.layout = FINANCE_LAYOUT_DAS_COLUNAS;`, { saida: ctx });
const ordem = ctx.colunas.map((c) => c.chave);

console.log('\n--- a ordem ---');
check('Conta bancária no lugar do Código (primeira)', ordem[0] === 'bankAccount', ordem.slice(0, 3).join());
check('Empresa antes de Descrição', ordem.indexOf('empresa') < ordem.indexOf('description'));
check('  e Descrição onde ficava a Empresa (depois do Cliente/Fornecedor)', ordem.indexOf('description') === ordem.indexOf('clienteFornecedor') + 1);
check('Empresa logo depois do Vencimento', ordem.indexOf('empresa') === ordem.indexOf('dueDate') + 1);
check('Código no fim e opcional', ordem[ordem.length - 1] === 'codigo' && !ctx.colunas.find((c) => c.chave === 'codigo').fixa);
check('nenhuma coluna travada', !ctx.colunas.some((c) => c.fixa));
check('padrão: com Conta bancária, sem Código', ctx.padrao.includes('bankAccount') && !ctx.padrao.includes('codigo'));

console.log('\n--- quem já tinha escolhido ---');
check('preferência antiga perde o Código e ganha a Conta bancária, uma vez',
  /if \(validas\.length && layout < FINANCE_LAYOUT_DAS_COLUNAS\) \{\s*validas = validas\.filter\(\(c\) => c !== 'codigo'\);\s*if \(!validas\.includes\('bankAccount'\)\) validas\.push\('bankAccount'\);/.test(fonte));
check('mexer no seletor grava o layout novo', /conhecidas: FINANCE_LISTA_COLUNAS\.map\(\(c\) => c\.chave\),\s*layout: FINANCE_LAYOUT_DAS_COLUNAS/.test(fonte));
check('o mínimo é uma coluna, sem exceção do código', /if \(escolhidas\.length === 0\) \{\s*showToast\('Deixe ao menos uma coluna\.'/.test(fonte));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
