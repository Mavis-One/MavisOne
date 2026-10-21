// O ENDEREÇO INTEIRO DO CLIENTE NA IMPRESSÃO DO PEDIDO (21/10/2026, pedido do
// usuário, no print do pedido do DOROCIL BATISTA DE LIMA: "nos pedidos não
// está aparecendo o endereço completo do cliente"). Saía "RUA DOM PIO DE
// FREITAS, RIO NEGRINHO-SC - 89296-852": sem número, complemento e bairro.
//
// O cliente que a tela recebe (/api/sales/clientes/:id, indiceDoCadastro) passa
// a levar número, complemento e bairro, lidos pela enderecoDaPessoa da NF-e; e
// a impressão A4, o PDF e o cupom montam a linha com a mesma função.
//
// Provado na 3099 com o 16317 (MARINEIDE): impressão e cupom com "RUA ERNESTO
// PIZETA, 339, CASA, CENTRO, Guaramirim-SC - 89270-000".
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + JSON.stringify(det) : ''}`);
  if (!cond) falhas++;
};

console.log('\n--- o servidor ---');
const servidor = ler('server.js');
check('o cliente da venda leva número, complemento e bairro (pela enderecoDaPessoa da NF-e)',
  /const endereco = enderecoDaPessoa\(record\);\s*return \{ addressNumber: endereco\.numero, complement: endereco\.complemento, neighborhood: endereco\.bairro \};/.test(servidor));

console.log('\n--- a linha do endereço ---');
const app = ler('public/app.js');
const fonte = (app.match(/const enderecoCompletoDoCliente = \(cliente\) => \{[\s\S]*?\n {8}\};/) || [''])[0];
const ctx = {};
vm.createContext(ctx);
vm.runInContext(`${fonte}; this.f = enderecoCompletoDoCliente;`, ctx);
const f = ctx.f;
check('rua, número, complemento, bairro, cidade-UF e CEP',
  f({ address: 'RUA DOM PIO DE FREITAS', addressNumber: '120', complement: 'CASA 2', neighborhood: 'CENTRO', city: 'RIO NEGRINHO', state: 'SC', zipCode: '89296852' })
    === 'RUA DOM PIO DE FREITAS, 120, CASA 2, CENTRO, RIO NEGRINHO-SC - 89296-852');
check('  sem o que faltar no cadastro',
  f({ address: 'RUA DOM PIO DE FREITAS', city: 'RIO NEGRINHO', state: 'SC', zipCode: '89296-852' }) === 'RUA DOM PIO DE FREITAS, RIO NEGRINHO-SC - 89296-852');
check('  sem repetir o que a rua já traz (endereço da Receita)',
  f({ address: 'AV BRASIL, 500, SALA 3, CENTRO', addressNumber: '500', complement: 'SALA 3', neighborhood: 'CENTRO', city: 'X', state: 'SC' }) === 'AV BRASIL, 500, SALA 3, CENTRO, X-SC');
check('  e o número "1" não some por haver "15" na rua',
  f({ address: 'RUA 15 DE NOVEMBRO', addressNumber: '1', city: 'X', state: 'SC' }) === 'RUA 15 DE NOVEMBRO, 1, X-SC');
check('  sem cliente, vazio', f(null) === '');

console.log('\n--- onde ela vale ---');
check('impressão A4', /const enderecoDoCliente = \(\) => enderecoCompletoDoCliente\(cliente\);/.test(app));
check('PDF do pedido', /const enderecoCliente = enderecoCompletoDoCliente\(cliente\);/.test(app));
check('cupom', /endereco: enderecoCompletoDoCliente\(cliente\)\s*\} : null,/.test(app));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
