#!/usr/bin/env node
// PRODUTO INATIVO SAI DAS BUSCAS; A LIXEIRA OFERECE INATIVAR (22/10/2026).
//
// O usuário: "o estoque está zerado por que eu não consigo excluir" — o
// AUTOPROPELIDO MAVIS AYLA 500W (9194) tinha uma entrada e uma saída no razão,
// e produto com histórico não se exclui. Decidido com ele ("pode ser"): o
// inativo some das buscas do pedido, da emissão de NF-e e da entrada de NF-e
// (continua na lista de produtos, no histórico e nos relatórios), e a lixeira,
// recusada, oferece "Inativar" ali mesmo.
//
// Provado no servidor local: a lixeira do 9194 deu 409 com podeInativar; o
// segundo aviso perguntou se inativa, e confirmar deixou a linha "Inativo";
// a lixeira de novo só avisou que já está inativo. Na Nova Venda e na emissão
// de NF-e, buscar "AYLA 500W" trouxe o 9589 e o 9030, sem o 9194; a nota com o
// 9194 já na linha mostrou o nome dele. Na entrada pelo XML (item com o nome
// do 9194 e sem GTIN), o 9194 não foi sugerido nem veio na lista; reativado,
// voltou sugerido por descrição. Tudo desfeito depois.
'use strict';
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');
const ler = (a) => fs.readFileSync(path.join(RAIZ, a), 'utf8');
const servidor = semComentarios(ler('server.js'));

console.log('\n--- 1. quem é inativo (stockCore.produtosInativos) ---');
const stockCore = require('../lib/stock-core');
const data = {
  productMeta: {
    a: { status: 'ativo' },
    b: { status: 'inativo' },
    c: { status: ' INATIVO ' },
    d: {},
    e: null
  }
};
const inativos = stockCore.produtosInativos(data);
check('só o status inativo conta (com espaço e maiúscula também)', inativos.size === 2 && inativos.has('b') && inativos.has('c'), [...inativos].join(','));
check('sem meta nenhum, ninguém é inativo', stockCore.produtosInativos({}).size === 0);

console.log('\n--- 2. as listas marcam, não tiram (marcarInativos) ---');
const inicio = servidor.indexOf('function marcarInativos(');
check('marcarInativos existe no servidor', inicio > 0);
const corpo = servidor.slice(inicio, servidor.indexOf('\n}\n', inicio) + 2);
const marcarInativos = new Function('stockCore', `${corpo}; return marcarInativos;`)(stockCore);
const lista = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'x', name: 'X' }];
const marcada = marcarInativos(lista, data);
check('o inativo continua na lista, marcado', marcada.length === 3 && marcada[1].inativo === true && marcada[0].inativo === undefined && marcada[2].inativo === undefined);
check('sem inativos, a lista volta a mesma', marcarInativos(lista, {}) === lista);

console.log('\n--- 3. onde o servidor marca e filtra ---');
check('Nova Venda (/api/sales/meta) marca', /products: marcarInativos\(products, data\)/.test(servidor));
check('emissão de NF-e (/api/finance/meta) marca nas duas formas da lista',
  (servidor.match(/produtos: marcarInativos\(\(await db\.getProducts\(\)\)\.map/g) || []).length === 2);
check('Compras (/api/purchases, entrada manual) marca', /products: marcarInativos\(products\.map\(\(p\) => \(\{\s*id: p\.id, name: p\.name, sku: p\.sku, costPrice: p\.costPrice/.test(servidor));
const conferir = servidor.slice(servidor.indexOf('async function conferirNotaDeEntrada('), servidor.indexOf('function decisoesDosItens('));
check('a entrada não sugere inativo (montarConferencia sem eles)',
  /produtos: inativos\.size \? produtos\.filter\(\(p\) => !inativos\.has\(p\.id\)\) : produtos/.test(conferir));
check('  e a gravação ainda lê o catálogo inteiro', /return \{ conferencia, data, produtos \};/.test(conferir));
const analisar = servidor.slice(servidor.indexOf("pathname === '/api/purchases/entrada-nfe/analisar'"), servidor.indexOf("pathname === '/api/purchases/entrada-nfe/analisar'") + 6000);
check('a lista de escolha da entrada vem sem inativos', /\.filter\(\(p\) => !inativos\.has\(p\.id\)\)\s*\.map\(\(p\) => \(\{ id: p\.id, name: p\.name, sku: p\.sku \|\| '', ean: p\.ean \|\| '' \}\)\)/.test(analisar));

console.log('\n--- 4. a lixeira e a rota de situação ---');
const del = servidor.slice(servidor.indexOf("/^\\/api\\/stock\\/products\\/[^/]+$/.test(pathname) && req.method === 'DELETE'"));
check('a recusa por movimento diz podeInativar e se já está inativo',
  /podeInativar: true,\s*inativo: stockCore\.productMeta\(data, id\)\.status === 'inativo'/.test(del.slice(0, 2000)));
const rota = servidor.slice(servidor.indexOf('\\/situacao$/.test(pathname)'), servidor.indexOf('\\/situacao$/.test(pathname)') + 2000);
check('a rota de situação existe (POST) e pede Estoque', /req\.method === 'POST'/.test(rota.slice(0, 120)) && /if \(!userCanStock\(user\)\)/.test(rota));
check('  só aceita ativo ou inativo', /\['ativo', 'inativo'\]\.includes\(status\)/.test(rota));
check('  mexe só no meta, guardando o resto', /stockCore\.buildProductMeta\(\{ status \}, stockCore\.productMeta\(data, id\)\)/.test(rota));
check('  e audita a troca', /action: 'produto\.situacao'/.test(rota));

console.log('\n--- 5. as telas ---');
const app = semComentarios(ler('public/app.js'));
check('Nova Venda: inativo fora da busca, menos o que o pedido já tem',
  /\.filter\(\(p\) => \(p\.podeVender !== false && p\.inativo !== true\) \|\| produtosJaNoPedido\.has\(p\.id\)\)/.test(app));
const nfe = semComentarios(ler('public/modules/finance/subs/emitir_nfe_focus.js'));
check('NF-e: a busca sem os inativos', /opcoesDeProdutoComAvulso = \[ITEM_AVULSO\]\.concat\(opcoesDeProduto\.filter\(\(o\) => !o\.inativo\)\)/.test(nfe));
check('  e o rótulo da linha ainda de todos', /options: opcoesDeProduto,\s*selectedValue: item\.produtoId/.test(nfe));
const manual = semComentarios(ler('public/modules/purchases/subs/entrada_nfe_manual.js'));
check('entrada manual: a busca sem os inativos', /const produtosAtivos = produtos\.filter\(\(p\) => p\.inativo !== true\);/.test(manual)
  && /opcoes\(produtosAtivos\)/.test(manual));
const lixeira = semComentarios(ler('public/modules/stock/subs/products.js'));
check('lista de produtos: recusa com podeInativar pergunta e inativa',
  /dados\.podeInativar/.test(lixeira) && /\/situacao`, \{ method: 'POST', body: JSON\.stringify\(\{ status: 'inativo' \}\) \}/.test(lixeira));
check('  e o já inativo só avisa', /if \(dados\.inativo\) \{/.test(lixeira));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
