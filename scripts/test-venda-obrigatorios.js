#!/usr/bin/env node
/**
 * EMPRESA, CATEGORIA, DEPÓSITO, VENDEDOR E PAGAMENTO OBRIGATÓRIOS (13/10/2026).
 *
 * Pedido do usuário: "coloque empresa, categoria, depósito (mesmo que puxado
 * automaticamente), vendedor (mesmo que puxado automaticamente) e pagamentos
 * como campo obrigatório". Regra única em
 * public/modules/shared/venda_obrigatorios.js — a tela confere antes de salvar
 * e o servidor recusa na gravação (criação e edição). Cancelar continua
 * possível com o pedido incompleto.
 */
const fs = require('fs');
const path = require('path');
const O = require('../public/modules/shared/venda_obrigatorios.js');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const completo = {
  companyId: 'emp1', category: 'Venda de Materiais', depositId: 'dep1', sellerId: 'v1',
  payments: [{ methodId: 'f1', amount: 100 }]
};

console.log('--- 1. a regra ---');
check('pedido completo passa', O.faltando(completo) === null);
[['companyId', 'empresa'], ['category', 'categoria'], ['depositId', 'depósito'], ['sellerId', 'vendedor']].forEach(([campo, nome]) => {
  const falta = O.faltando({ ...completo, [campo]: '' });
  check(`sem ${nome} é recusado`, falta && falta.campo === campo, falta && falta.mensagem);
});
check('  espaço em branco não conta como preenchido', O.faltando({ ...completo, category: '   ' })?.campo === 'category');
check('sem pagamento é recusado', O.faltando({ ...completo, payments: [] })?.campo === 'payments');
check('  linha sem forma não conta', O.faltando({ ...completo, payments: [{ methodId: '', amount: 100 }] })?.campo === 'payments');
check('  linha de valor zero não conta', O.faltando({ ...completo, payments: [{ methodId: 'f1', amount: 0 }] })?.campo === 'payments');
check('  e a mensagem leva à aba Pagamentos', O.faltando({ ...completo, payments: [] })?.aba === 'pagamentos');
check('a ordem é a da tela: empresa primeiro', O.faltando({})?.campo === 'companyId');

console.log('\n--- 2. o servidor recusa ---');
const servidor = ler('server.js');
check('na criação e na edição', (servidor.match(/const obrigatorioQueFalta = (?:vaiCancelar \? null : )?vendaObrigatorios\.faltando\(body\);/g) || []).length === 2);
check('  menos para cancelar um pedido incompleto',
  /const vaiCancelar = salesStatus\.ehCancelado\(/.test(servidor) && /vaiCancelar \? null : vendaObrigatorios\.faltando\(body\)/.test(servidor));

console.log('\n--- 3. a tela ---');
const app = ler('public/app.js');
['Empresa *', 'Categoria *', 'Depósito *', 'Vendedor *'].forEach((rotulo) => {
  check(`rótulo "${rotulo}"`, app.includes(`<label>${rotulo}`) || app.includes(`campo-somente-leitura">${rotulo}`));
});
check('confere antes de salvar e leva à aba do campo',
  /window\.MavisVendaObrigatorios\.faltando\(payload\)/.test(app) && /abrirAba\(obrigatorioQueFalta\.aba \|\| 'dados'\)/.test(app));
const html = ler('public/index.html');
check('o script carrega antes do app.js',
  html.indexOf('shared/venda_obrigatorios.js') > 0 && html.indexOf('shared/venda_obrigatorios.js') < html.indexOf('src="/app.js"'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
