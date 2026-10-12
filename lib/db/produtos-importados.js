// PRODUTOS DO VIPER — o que a API confere e grava (12/10/2026).
// O que entra e o que não entra, e por quê: lib/importacao-produtos-viper.js.
//
// Uma TRANSAÇÃO para tudo: produtos novos e NCM preenchidos entram juntos ou
// nada entra. Reimportar a mesma planilha não duplica (o código vira SKU, e
// SKU que já existe é "existente"), e o NCM só é escrito onde está VAZIO —
// conferido de novo dentro do UPDATE, não só no plano.
'use strict';

const { consultar, emTransacao } = require('./conexao');
const { createId } = require('./client');
const { planejar } = require('../importacao-produtos-viper');

async function carregarCatalogo() {
  const { rows } = await consultar('select id, sku, ncm from products');
  return rows;
}

/**
 * @param itens   saída de lerPlanilha().itens
 * @param opcoes  { simular }
 * @returns { simulado, criados: [{id, codigo, ativo}], ncmPreenchidos, existentes, novos, ncm }
 */
async function gravarProdutos(itens, { simular = false } = {}) {
  if (!Array.isArray(itens) || !itens.length) {
    const erro = new Error('Nenhum produto recebido.');
    erro.status = 400;
    throw erro;
  }
  const plano = planejar(itens, await carregarCatalogo());
  const resumo = {
    existentes: plano.existentes,
    novos: plano.novos.map((i) => ({ codigo: i.codigo, nome: i.nome, preco: i.preco, ncm: i.ncm, ativo: i.ativo, tipo: i.tipo, tributo: i.tributo })),
    ncm: plano.ncmParaPreencher.map((x) => ({ codigo: x.codigo, nome: x.nome, ncm: x.ncm }))
  };
  if (simular) return { simulado: true, criados: [], ncmPreenchidos: 0, ...resumo };

  const { criados, ncmPreenchidos } = await emTransacao(async (cliente) => {
    const criados = [];
    for (const item of plano.novos) {
      const id = createId('prod');
      // `where not exists`: outra pessoa pode ter cadastrado o mesmo código
      // entre o plano e a gravação.
      const r = await cliente.query(
        `insert into products (id, name, sku, stock_quantity, cost_price, sale_price, ncm, unidade_comercial, unidade_tributavel)
         select $1, $2, $3, 0, 0, $4, nullif($5, ''), $6, $6
          where not exists (select 1 from products where lower(trim(sku)) = lower($3))`,
        [id, item.nome, item.codigo, item.preco, item.ncm, item.unidade]
      );
      if (r.rowCount) criados.push({ id, codigo: item.codigo, ativo: item.ativo });
    }
    let ncmPreenchidos = 0;
    for (const x of plano.ncmParaPreencher) {
      const r = await cliente.query(
        "update products set ncm = $2 where id = $1 and coalesce(trim(ncm), '') = ''",
        [x.id, x.ncm]
      );
      ncmPreenchidos += r.rowCount;
    }
    return { criados, ncmPreenchidos };
  });
  return { simulado: false, criados, ncmPreenchidos, ...resumo };
}

module.exports = { gravarProdutos };
