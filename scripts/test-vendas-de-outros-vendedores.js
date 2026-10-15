#!/usr/bin/env node
/**
 * QUANDO UM VENDEDOR PODE MEXER NAS VENDAS DE OUTRO (fase EQ, 15/10/2026).
 * Pedido do usuário: "faça uma regra aplicável pela tela de usuários quando um
 * vendedor pode mexer nas vendas de outro".
 *
 * Provado (banco local): sem a chave, o vendedor não mexe na venda do colega;
 * com ela, mexe, e a venda continua do colega (S2); venda nova sai no nome
 * dele (S1); os relatórios continuam só com as vendas dele. A chave aparece
 * em Configurações › Usuários, abaixo de "Vendedor vinculado", e grava.
 */
const fs = require('fs');
const path = require('path');
const escopoLib = require('../lib/relatorios-escopo');
const V = require('../lib/venda-do-vendedor');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const sem = escopoLib.escopoDeVendas({ sellerId: 'S1' }, { ehAdmin: false });
const com = escopoLib.escopoDeVendas({ sellerId: 'S1', podeAlterarVendasDeOutros: true }, { ehAdmin: false });
const admin = escopoLib.escopoDeVendas({ sellerId: 'S1' }, { ehAdmin: true });

check('sem a chave: não mexe na venda do colega', V.podeMexerNaVenda(sem, 'S2') === false);
check('  mexe na própria e na sem vendedor', V.podeMexerNaVenda(sem, 'S1') && V.podeMexerNaVenda(sem, ''));
check('  e o que grava é sempre ele', V.vendedorAoGravar(sem, 'S9', 'S2') === 'S1');
check('com a chave: mexe na venda do colega', V.podeMexerNaVenda(com, 'S2') === true);
check('  e a venda continua do colega (não a toma para si)', V.vendedorAoGravar(com, 'S9', 'S2') === 'S2');
check('  venda nova sai no nome dele', V.vendedorAoGravar(com, 'S9') === 'S1' && V.vendedorAoGravar(com, 'S9', '') === 'S1');
check('  e o que ele VÊ não muda (relatórios: só as dele)', JSON.stringify(com.sellerIds) === '["S1"]' && com.tipo === sem.tipo);
check('administrador continua mexendo em todas', V.podeMexerNaVenda(admin, 'S2') && V.vendedorAoGravar(admin, 'S9', 'S2') === 'S9');

const servidor = ler('server.js');
check('a alteração do pedido manda o vendedor da venda (fica do colega)',
  servidor.includes('sellerId: vendaDoVendedor.vendedorAoGravar(escopoDoUsuario, body.sellerId, current.sellerId),'));
check('o meta da venda diz à tela que ele pode', servidor.includes('podeAlterarDeOutros: vendaDoVendedor.podeAlterarDeOutros(escopoDoUsuario)'));
check('usuário: criar, alterar (ausente não mexe) e listar levam a chave',
  servidor.includes('podeAlterarVendasDeOutros: body.payload.podeAlterarVendasDeOutros === true,')
  && /podeAlterarVendasDeOutros: body\.podeAlterarVendasDeOutros === undefined\s*\? undefined : body\.podeAlterarVendasDeOutros === true,/.test(servidor)
  && servidor.includes('podeAlterarVendasDeOutros: entry.podeAlterarVendasDeOutros === true,'));
const auth = ler('lib/db/auth.js');
check('banco: lê, grava só quando veio e explica a migração que falta',
  auth.includes('podeAlterarVendasDeOutros: row.pode_alterar_vendas_de_outros === true,')
  && /if \(payload\.podeAlterarVendasDeOutros !== undefined\) \{\s*updates\.pode_alterar_vendas_de_outros/.test(auth)
  && auth.includes('fase-eq-vendas-de-outros-vendedores.sql'));
check('migração: coluna desligada por padrão', ler('banco/migrations/fase-eq-vendas-de-outros-vendedores.sql')
  .includes('add column if not exists pode_alterar_vendas_de_outros boolean not null default false'));
check('tela de Usuários: a chave, que a cópia leva', ler('public/modules/settings/subs/users_form.js').includes("'Pode alterar vendas de outros vendedores')")
  && ler('public/modules/settings/subs/users_form.js').includes("podeAlterarVendasDeOutros: formData.get('podeAlterarVendasDeOutros') === 'on',"));
const app = ler('public/app.js');
check('pedido: venda do colega abre para edição com a chave, e mostra o vendedor dela',
  app.includes('const deOutroVendedor = vendaDeColega && meuVendedor.podeAlterarDeOutros !== true;')
  && /const vendedorInicial = vendaDeColega\s*\? editRecord\.sellerId/.test(app));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
