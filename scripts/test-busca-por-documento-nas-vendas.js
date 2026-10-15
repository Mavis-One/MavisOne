#!/usr/bin/env node
/**
 * PEDIDOS E ORÇAMENTOS: O CLIENTE SE ACHA NA BUSCA GERAL, TAMBÉM PELO CPF/CNPJ
 * (15/10/2026). Pedido do usuário: "apague a busca por clientes/fornecedor dos
 * filtros de busca avançados e permita buscar no campo de busca geral por
 * cpf/cnpj".
 *
 * Provado no servidor local: "070.439.829-01" e "07043982901" acharam os 3
 * pedidos do cliente; "ALEX JUNIOR" também; "0704398" (7 dígitos) não — com
 * menos de 8 é o código do pedido. Na tela, a Busca Avançada abriu sem o campo
 * Cliente/Fornecedor e a busca geral diz "Código, cliente ou CPF/CNPJ".
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => semComentarios(fs.readFileSync(path.join(__dirname, '..', p), 'utf8'));
const server = ler('server.js');
const app = ler('public/app.js');

console.log('\n--- o servidor ---');
check('o pedido leva o CPF/CNPJ do cliente (do cadastro)', /customerDocument = String\(found\.document \|\| ''\)\.replace\(\/\\D\/g, ''\);/.test(server)
  && /customer: customerName \|\| '-',\s*customerDocument,/.test(server));
check('a busca geral acha pelo documento: só número e pontuação, 8 dígitos ou mais',
  /const digitosDaBusca = \/\^\[\\d\.\\-\/\\s\]\+\$\/\.test\(search\) \? search\.replace\(\/\\D\/g, ''\) : '';\s*const documentoBuscado = digitosDaBusca\.length >= 8 \? digitosDaBusca : '';/.test(server)
  && /\|\| \(documentoBuscado && String\(r\.customerDocument \|\| ''\)\.includes\(documentoBuscado\)\)/.test(server));
check('  e continua achando pelo código e pelo nome', /contem\(r\.code, search\) \|\| contem\(r\.customer, search\)/.test(server));

console.log('\n--- a tela ---');
check('a Busca Avançada não tem mais Cliente/Fornecedor', !/<select name="clientSupplierId">/.test(app));
check('  e o filtro saiu do catálogo (um valor antigo não fica valendo escondido)',
  !/const SALES_FILTROS = \[[^\]]*'clientSupplierId'/.test(app));
check('a busca geral diz que aceita CPF/CNPJ', /placeholder="Código, cliente ou CPF\/CNPJ"/.test(app));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
