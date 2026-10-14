#!/usr/bin/env node
/**
 * A FORMA DE PAGAMENTO DO TÍTULO (fase EN, 14/10/2026).
 *
 * Pedido do usuário: "adicione um campo de formas de pagamento para contas a
 * receber e contas a pagar e lançamentos".
 *
 * Provado no navegador (servidor local): Contas a Pagar ganhou a coluna; uma
 * despesa criada com "Boleto Bancário" mostrou a forma na lista, na janela do
 * título e na Edição de Título. O título de teste foi apagado e a numeração
 * restaurada.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const servidor = ler('server.js');
const banco = ler('lib/db/financeiro.js');
const novo = ler('public/modules/finance/subs/novo_lancamento.js');
const lista = ler('public/modules/finance/subs/lancamentos.js');
const migracao = ler('banco/migrations/fase-en-forma-de-pagamento-no-titulo.sql');

console.log('--- banco e servidor ---');
check('o título guarda o id da forma e o nome', /add column if not exists payment_method_id text,\s*add column if not exists payment_method_name text;/.test(migracao));
check('lê, cria e edita os dois', banco.includes("paymentMethodId: row.payment_method_id || '',")
  && banco.includes('payment_method_id: payload.paymentMethodId || null,')
  && banco.includes('row.payment_method_name = payload.paymentMethodName || null;'));
check('forma que não existe no cadastro é recusada', servidor.includes("const erro = new Error('Forma de pagamento não encontrada no cadastro.');"));
check('criar e editar (inclusive o vinculado a pedido/NF-e) aceitam a forma',
  servidor.includes('...formaDoTitulo(data, body.paymentMethodId),')
  && (servidor.match(/if \(body\.paymentMethodId !== undefined\) Object\.assign\(entry, formaDoTitulo\(data, body\.paymentMethodId\)\);/g) || []).length === 2);
check('o título do pedido nasce com a forma da parcela', servidor.includes("paymentMethodId: parcela.methodId || '',"));
check('a meta do Financeiro manda as formas ativas', servidor.includes("formasDePagamento: (data.paymentMethods || [])"));

console.log('\n--- telas ---');
check('campo de busca "Forma de pagamento" com o "+" do cadastro',
  novo.includes("financePaymentMethod: { name: 'paymentMethodId', kind: 'paymentMethod', opcoes: opcoesDeForma, rotulo: 'Forma de pagamento' }")
  && novo.includes('data-inline-alvo="financePaymentMethod"')
  && novo.includes("paymentMethod: { modulo: 'cadastros', tela: 'nova_forma_pagamento', nome: 'forma de pagamento' }"));
check('vai no envio', novo.includes("payload.paymentMethodId = formData.get('paymentMethodId') || '';"));
check('coluna nas três listas (padrão de quem nunca escolheu)',
  lista.includes("{ chave: 'paymentMethod', rotulo: 'Forma de pagamento',") && /FINANCE_COLUNAS_PADRAO = \[[^\]]*'paymentMethod'/.test(lista));
check('e na janela do título', lista.includes('<span class="muted">Forma de pagamento</span>'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
