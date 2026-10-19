#!/usr/bin/env node
/**
 * NOVA MOVIMENTAÇÃO COM VÁRIOS ITENS (16/10/2026). Pedido do usuário: "quero
 * poder adicionar mais de um item em uma única movimentação, para não precisar
 * abrir 15 movimentações de 15 itens diferentes".
 *
 * A tela segue a transferência entre depósitos: em cima o que é da
 * movimentação (entrada/saída, depósito, data, categoria, documento,
 * observação), embaixo a lista de itens (produto, cor, quantidade, custo).
 * O servidor recebe `items` e grava TODOS ou NENHUM: valida todos antes, com
 * produto + cor repetidos somados, e o commit é uma transação só. Os
 * movimentos ficam ligados por referência ('movimentacao' + id do grupo).
 *
 * Provado no navegador contra o servidor (movimentos estornados depois):
 * entrada de 2 produtos, um adicionado duas vezes (somou 2+1=3), virou
 * MOV-1446 e MOV-1447 com o mesmo grupo e documento, saldos 5→8; saída com um
 * item sem saldo no depósito foi recusada com o nome do produto, e nada foi
 * gravado — nem o item que tinha saldo.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const RAIZ = path.join(__dirname, '..');
const server = semComentarios(fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8'));
const ini = server.indexOf("pathname === '/api/stock/movements' && req.method === 'POST'");
const rota = server.slice(ini, server.indexOf("/^\\/api\\/stock\\/movements\\/[^/]+$/.test(pathname) && req.method === 'DELETE'", ini));

console.log('\n--- o servidor ---');
check('a rota existe', ini > 0 && rota.length > 500);
check('aceita `items`, e sem ele o formato de antes', /\(Array\.isArray\(body\.items\) && body\.items\.length \? body\.items : \[body\]\)\.map/.test(rota));
check('limite de 200 itens', /if \(linhas\.length > 200\)/.test(rota));
check('carrega o razão só dos produtos da movimentação', /loadStockContextDosProdutos\(idsDosProdutos\)/.test(rota));
// Fase ER: e a condição (montado/desmontado) entra na chave.
check('produto + cor repetidos somam antes de conferir', /const chave = `\$\{linha\.productId\}\|\$\{linha\.classValueId\}\|\$\{linha\.condicao\}`;[\s\S]{0,200}atual\.quantity = Number\(atual\.quantity \|\| 0\) \+ Number\(linha\.quantity \|\| 0\);/.test(rota));
check('confere TODAS as linhas antes de gravar qualquer uma', rota.indexOf('assertMovementIsPossible(') < rota.indexOf('commitStockMovements('));
check('a recusa diz qual produto', /erroDaLinha\.message = `\$\{produto\.name\}: \$\{erroDaLinha\.message\}`;/.test(rota));
check('grava todas numa transação só', (rota.match(/commitStockMovements\(/g) || []).length === 1 && /await commitStockMovements\(data, movements, productsById\);/.test(rota));
check('ligadas pela mesma referência', /referenceType: grupo \? 'movimentacao' : body\.referenceType,\s*referenceId: grupo \|\| body\.referenceId/.test(rota));
check('o cabeçalho vale para todas (depósito, data, categoria, documento)', /depositId: body\.depositId,[\s\S]{0,300}categoryId: body\.categoryId,\s*date: body\.date,\s*document: body\.document,\s*note: body\.note,/.test(rota));

console.log('\n--- a tela ---');
const tela = semComentarios(fs.readFileSync(path.join(RAIZ, 'public/modules/stock/subs/new_movement.js'), 'utf8'));
check('lista de itens com produto, cor, quantidade e custo', /<h3>Itens da movimentação<\/h3>/.test(tela) && /id="movementItemQtd"/.test(tela) && /id="movementItemCusto"/.test(tela) && /id="movementAdicionar"/.test(tela));
check('envia os itens', /items: itens\.map\(\(item\) => \(\{\s*productId: item\.productId,\s*quantity: item\.quantity,\s*unitCost: item\.unitCost,/.test(tela));
check('não envia sem item', /if \(!itens\.length\) \{\s*showToast\('Adicione ao menos um produto à movimentação\.'/.test(tela));
check('o mesmo produto e cor somam na lista', /const existente = itens\.find\(\(i\) => i\.productId === productId && i\.classValueId === classValueId && \(i\.condicao \|\| ''\) === condicao\);/.test(tela));
check('na saída, a linha sem saldo no depósito avisa', /const falta = type === 'saida' && saldo !== null && item\.quantity > saldo;/.test(tela));
check('Enter na quantidade adiciona, não envia', /\['movementItemQtd', 'movementItemCusto'\]\.forEach/.test(tela));
check('trocar entrada/saída não apaga a lista', /type = btn\.dataset\.movType;[\s\S]{0,400}pintarItens\(\);/.test(tela) && !/data-mov-type[\s\S]{0,300}render\(\)/.test(tela));
const css = fs.readFileSync(path.join(RAIZ, 'public/app.css'), 'utf8');
check('o nome longo do produto quebra (o saldo fica à vista)', /\.movimento-itens td:first-child \{ white-space: normal;/.test(css));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
