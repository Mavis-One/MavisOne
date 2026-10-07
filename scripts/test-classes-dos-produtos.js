#!/usr/bin/env node
/**
 * classesDosProdutos DEVOLVE, PARA CADA PRODUTO, O QUE classesDoProduto DEVOLVE.
 *
 * A transferência entre depósitos validava cada item com classesDoProduto, um
 * de cada vez e em fila — quatro consultas por item, duas delas lendo os
 * catálogos inteiros. 20 itens custavam 24 ms; a rota aceita 200. Desde a fase
 * de desempenho ela pede as classes de todos os itens numa ida só.
 *
 * As duas funções montam a mesma estrutura em dois lugares (lib/db/classes.js),
 * e é exatamente o tipo de cópia que diverge na primeira correção feita de um
 * lado só. Este teste roda as DUAS sobre as mesmas linhas — um banco de mentira
 * no lugar de lib/db/client — e exige a mesma resposta, produto a produto:
 * classe obrigatória e opcional, classe que sumiu do catálogo, valor desativado,
 * valor que sumiu, atribuição inativa, produto sem classe nenhuma.
 *
 * Sem banco de verdade: as linhas são escritas aqui, e o que se prova é a
 * montagem. A consulta (`in` em vez de `eq`) é do construtor de lib/db/consulta.js.
 */
const path = require('path');
const assert = require('assert');

const RAIZ = path.join(__dirname, '..');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// --- as linhas do "banco" -----------------------------------------------------
const TABELAS = {
  product_classes: [
    { id: 'pc-cor', name: 'COR', active: true },
    { id: 'pc-volt', name: 'VOLTAGEM', active: true }
  ],
  product_class_values: [
    { id: 'v-preto', class_id: 'pc-cor', name: 'Preto', code: 'PT', metadata: { hex: '#000' }, active: true },
    { id: 'v-branco', class_id: 'pc-cor', name: 'Branco', code: null, metadata: null, active: true },
    { id: 'v-rosa', class_id: 'pc-cor', name: 'Rosa', code: null, metadata: null, active: false },
    { id: 'v-110', class_id: 'pc-volt', name: '110V', code: null, metadata: null, active: true },
    { id: 'v-220', class_id: 'pc-volt', name: '220V', code: null, metadata: null, active: true }
  ],
  product_class_assignments: [
    { product_id: 'p1', class_id: 'pc-cor', required: true, active: true },
    { product_id: 'p2', class_id: 'pc-volt', required: false, active: true },
    { product_id: 'p1', class_id: 'pc-volt', required: null, active: true },
    { product_id: 'p3', class_id: 'pc-sumiu', required: true, active: true },
    { product_id: 'p4', class_id: 'pc-cor', required: true, active: false },
    { product_id: 'p2', class_id: 'pc-cor', required: true, active: true }
  ],
  product_class_value_assignments: [
    { product_id: 'p1', class_id: 'pc-cor', class_value_id: 'v-preto', active: true },
    { product_id: 'p1', class_id: 'pc-cor', class_value_id: 'v-rosa', active: true },
    { product_id: 'p2', class_id: 'pc-volt', class_value_id: 'v-220', active: true },
    { product_id: 'p1', class_id: 'pc-cor', class_value_id: 'v-branco', active: true },
    { product_id: 'p1', class_id: 'pc-volt', class_value_id: 'v-110', active: true },
    { product_id: 'p2', class_id: 'pc-cor', class_value_id: 'v-sumiu', active: true },
    { product_id: 'p2', class_id: 'pc-cor', class_value_id: 'v-branco', active: false },
    { product_id: 'p3', class_id: 'pc-sumiu', class_value_id: 'v-preto', active: true }
  ]
};

// Um construtor mínimo com a mesma forma do de lib/db/consulta.js: filtra na
// ordem das linhas (a "ordem física") e é thenable.
function de(tabela) {
  const filtros = [];
  const consulta = {
    select() { return consulta; },
    eq(coluna, valor) { filtros.push((l) => l[coluna] === valor); return consulta; },
    in(coluna, valores) { filtros.push((l) => valores.includes(l[coluna])); return consulta; },
    then(ok, falha) {
      const data = (TABELAS[tabela] || []).filter((l) => filtros.every((f) => f(l)));
      return Promise.resolve({ data, error: null }).then(ok, falha);
    }
  };
  return consulta;
}

const clientPath = require.resolve(path.join(RAIZ, 'lib/db/client.js'));
const conexaoPath = require.resolve(path.join(RAIZ, 'lib/db/conexao.js'));
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: { banco: { from: de }, assertNoError: (erro) => { if (erro) throw erro; } }
};
require.cache[conexaoPath] = {
  id: conexaoPath, filename: conexaoPath, loaded: true,
  exports: { consultar: async () => ({ rows: [] }) }
};
const classes = require(path.join(RAIZ, 'lib/db/classes.js'));

(async () => {
  console.log('\n--- a mesma resposta, produto a produto ---');
  const ids = ['p1', 'p2', 'p3', 'p4', 'p-sem-classe'];
  const juntos = await classes.classesDosProdutos(ids);
  for (const id of ids) {
    const sozinho = await classes.classesDoProduto(id);
    let ok = true;
    try { assert.deepStrictEqual(juntos.get(id), sozinho); } catch { ok = false; }
    check(`${id}`, ok && JSON.stringify(juntos.get(id)) === JSON.stringify(sozinho),
      `${sozinho.length} classe(s), ${sozinho.reduce((s, c) => s + c.valores.length, 0)} valor(es)`);
  }

  console.log('\n--- os casos que o teste precisa estar exercitando ---');
  const p1 = juntos.get('p1');
  check('required null conta como obrigatória, como em classesDoProduto',
    p1.length === 2 && p1[0].required === true && p1[1].required === true);
  check('e required false é opcional', juntos.get('p2')[0].required === false);
  check('valor desativado no catálogo some', !p1[0].valores.some((v) => v.id === 'v-rosa'));
  check('classe que sumiu do catálogo vira "(classe removida)"', juntos.get('p3')[0].name === '(classe removida)');
  check('atribuição inativa não entra', juntos.get('p4').length === 0);
  check('produto sem classe vem com lista vazia, e não fica de fora', Array.isArray(juntos.get('p-sem-classe'))
    && juntos.get('p-sem-classe').length === 0);
  check('valor de OUTRO produto não vaza', !juntos.get('p2').some((c) => c.valores.some((v) => v.id === 'v-preto')));

  console.log('\n--- ids repetidos, vazios e lista vazia ---');
  const repetidos = await classes.classesDosProdutos(['p1', 'p1', '', null, ' p2 ']);
  check('um por produto, sem vazio', [...repetidos.keys()].join(',') === 'p1,p2');
  check('lista vazia não consulta e devolve Map vazio', (await classes.classesDosProdutos([])).size === 0);

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})().catch((erro) => { console.error(erro); process.exit(1); });
