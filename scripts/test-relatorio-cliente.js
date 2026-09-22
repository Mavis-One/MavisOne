// O NOME DO CLIENTE NO RELATÓRIO DE VENDAS — sem banco e sem servidor.
//
// O DEFEITO, medido em 22/09/2026 e reproduzido aqui: `linhasDoRegistro` lia
// `registro.clientSupplierName`, um campo que o servidor NÃO entrega. A rota
// /api/reports/vendas monta os registros com `serializeSalesRecord`
// (server.js:2467), que RESOLVE o nome do cliente — procura no cadastro pelo
// `clientSupplierId` e cai em `clientSupplierName` ou `customer` quando não
// acha — e publica o resultado em `customer`, e só nele.
//
// O estrago era maior do que uma coluna, e é por isso que este teste confere
// CINCO consequências: `clienteNome` alimenta a coluna Cliente, a coluna do
// CSV, a BUSCA por texto, a ORDENAÇÃO por cliente, o ranking "Clientes Mais
// Ativos" e as opções do <select> de cliente. Com o campo errado:
//
//   a coluna dizia "Sem cliente" em toda linha, com cliente vinculado ou não;
//   procurar uma venda pelo nome do cliente não achava nada;
//   ordenar por cliente não ordenava (todas as chaves eram iguais);
//   o ranking de clientes vinha com todas as barras rotuladas "Sem cliente";
//   o <select> de cliente listava N opções escritas "Sem cliente".
//
// Nada disso quebrava: a tela abria, os totais estavam certos, e o relatório
// simplesmente não sabia de quem era a venda. É o tipo de defeito que só um
// teste de CONTEÚDO pega, porque nenhum teste de status HTTP jamais o veria.
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const rv = require(path.join(RAIZ, 'lib/relatorios-vendas'));
const esc = require(path.join(RAIZ, 'lib/relatorios-escopo'));

let falhas = 0;
const check = (n, c, d) => { console.log(`${c ? '  OK ' : '  XX '} ${n}${d ? ' -> ' + d : ''}`); if (!c) falhas++; };

const escopo = esc.escopoDeVendas({ id: 'u1', name: 'Admin' }, { ehAdmin: true });

// Um registro NO FORMATO QUE O SERVIDOR ENTREGA: com `customer`, sem
// `clientSupplierName`. É esse o contrato que o defeito violava.
const pedido = (i, nome, valor) => ({
  id: `o${i}`,
  code: `1600${i}`,
  type: 'order',
  date: `2026-09-0${i}`,
  status: 'pedido-faturado',
  clientSupplierId: `p${i}`,
  customer: nome,
  amount: valor,
  totalAmount: valor,
  sellerId: 'v1',
  sellerName: 'Ana',
  items: [{ productId: `x${i}`, name: `Item ${i}`, quantity: 1, unitPrice: valor, total: valor }]
});

const REGISTROS = [pedido(1, 'ACME LTDA', 300), pedido(2, 'BETA SA', 200), pedido(3, 'GAMA ME', 100)];
const montar = (filtros) => rv.montarRelatorio({ registros: REGISTROS, filtros: filtros || {}, escopo });

console.log('\n--- 1. a coluna Cliente ---');
const base = montar();
const nomes = base.linhas.map((l) => l.clienteNome);
check('traz o nome de cada cliente', !nomes.includes('Sem cliente'), nomes.join(' | '));
check('e são os três nomes esperados',
  ['ACME LTDA', 'BETA SA', 'GAMA ME'].every((n) => nomes.includes(n)));

console.log('\n--- 2. a busca por texto ---');
// O nome do cliente está na lista de campos que a busca varre. Com o campo
// errado, procurar por cliente devolvia zero.
const busca = montar({ busca: 'beta' });
check('acha a venda pelo nome do cliente', busca.linhas.length === 1, `${busca.linhas.length} linha(s)`);
check('e é a linha certa', busca.linhas[0] && busca.linhas[0].clienteNome === 'BETA SA');
const buscaAcento = montar({ busca: 'ACME' });
check('a busca ignora caixa', buscaAcento.linhas.length === 1);

console.log('\n--- 3. a ordenação por cliente ---');
const asc = montar({ ordem: 'cliente', direcao: 'asc' }).linhas.map((l) => l.clienteNome);
check('ordena de verdade', asc.join('<') === 'ACME LTDA<BETA SA<GAMA ME', asc.join(' < '));

console.log('\n--- 4. o ranking Clientes Mais Ativos ---');
const top = base.topClientes || [];
check('tem três clientes', top.length === 3, `${top.length}`);
check('cada barra tem o nome do cliente, não "Sem cliente"',
  top.every((c) => c.label && c.label !== 'Sem cliente'),
  top.map((c) => `${c.label}=${c.valor}`).join(' | '));
check('e ordenado por valor', top[0] && top[0].label === 'ACME LTDA', top[0] && top[0].label);

console.log('\n--- 5. as opções do filtro de cliente ---');
const opcoes = (base.opcoes && base.opcoes.clientes) || [];
check('lista os três', opcoes.length === 3, `${opcoes.length}`);
check('com nomes distintos (o <select> não vira N vezes "Sem cliente")',
  new Set(opcoes.map((c) => c.nome || c.label)).size === 3,
  JSON.stringify(opcoes.map((c) => c.nome || c.label)));

console.log('\n--- 6. o CSV ---');
const csv = rv.montarCsv(rv.linhasDoRegistro(pedido(1, 'ACME LTDA', 300)));
const colunaCliente = csv.split('\n')[1].split(';')[3];
check('a coluna Cliente do CSV traz o nome', colunaCliente === 'ACME LTDA', colunaCliente);

console.log('\n--- 7. os outros formatos de entrada continuam servidos ---');
// A reserva existe para quem chamar `linhasDoRegistro` com linha CRUA do banco,
// que tem `client_supplier_name` mapeado para `clientSupplierName` e nenhum
// `customer` resolvido.
const cru = { ...pedido(9, undefined, 50), clientSupplierName: 'ANTIGO LTDA' };
delete cru.customer;
check('registro cru cai em clientSupplierName',
  rv.linhasDoRegistro(cru)[0].clienteNome === 'ANTIGO LTDA');
// E a ordem importa: `customer` é o nome RESOLVIDO no cadastro, e
// `clientSupplierName` é a cópia gravada no pedido, que envelhece quando o
// cliente é renomeado. O resolvido tem de ganhar.
const osDois = { ...pedido(8, 'NOVO LTDA', 50), clientSupplierName: 'ANTIGO LTDA' };
check('com os dois, o resolvido ganha do gravado',
  rv.linhasDoRegistro(osDois)[0].clienteNome === 'NOVO LTDA',
  rv.linhasDoRegistro(osDois)[0].clienteNome);

console.log('\n--- 8. sem cliente continua dizendo "Sem cliente" ---');
// `serializeSalesRecord` publica '-' quando não há cliente. Sem tratar isso, o
// relatório trocaria "Sem cliente" por um traço solto — parece coluna quebrada.
const traco = { ...pedido(7, '-', 50) };
delete traco.clientSupplierId;
check('o traço do serializer é lido como vazio',
  rv.linhasDoRegistro(traco)[0].clienteNome === 'Sem cliente',
  rv.linhasDoRegistro(traco)[0].clienteNome);
const vazio = { ...pedido(6, undefined, 50) };
delete vazio.customer;
delete vazio.clientSupplierId;
check('e ausência também', rv.linhasDoRegistro(vazio)[0].clienteNome === 'Sem cliente');

console.log('\n--- 9. o campo errado não voltou ao fonte ---');
const fs = require('fs');
const fonte = fs.readFileSync(path.join(RAIZ, 'lib/relatorios-vendas.js'), 'utf8').replace(/\r\n/g, '\n');
// Sem comentários: o comentário que EXPLICA o defeito cita o campo antigo, e um
// teste que reclama de texto ensina a esconder a palavra, não a corrigir o bug.
const { semComentarios } = require('./sem-comentarios');
const codigo = semComentarios(fonte);
check('clienteNome não lê mais clientSupplierName direto',
  !/clienteNome: texto\(registro\.clientSupplierName\)/.test(codigo));
check('e passa por nomeDeCliente', /clienteNome: nomeDeCliente\(registro\)/.test(codigo));

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
process.exit(falhas === 0 ? 0 : 1);
