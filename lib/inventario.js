/**
 * MONTAGEM DO INVENTÁRIO (fase EG) — a parte pura.
 *
 * Recebe o saldo de cada produto na data, o custo médio calculado do razão e o
 * cadastro, e devolve os itens com custo e valor. Sem banco, para o teste
 * conferir as contas sem precisar de um.
 *
 * SALDO NEGATIVO NÃO ENTRA. Inventário é o que existe na prateleira; "-3
 * unidades" é o sistema errado sobre o galpão, e somar isso ao livro reduziria
 * o valor do estoque com mercadoria que não existe. As linhas voltam separadas,
 * para a tela mostrar o que ficou de fora e por quê.
 */
'use strict';

const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const r6 = (v) => Math.round(v * 1e6) / 1e6;

/**
 * @param {object} p
 * @param {Array<{productId, saldo, nomeNoRazao}>} p.saldos
 * @param {Map<string, number|null>} p.medios  ver lib/custo-medio.js
 * @param {Map<string, {sku,name,ncm,unidade,costPrice}>} p.produtos
 * @param {'custo_medio'|'custo_cadastro'} p.valoracao
 */
function montarInventario({ saldos, medios, produtos, valoracao }) {
  const itens = [];
  const negativos = [];
  for (const s of saldos || []) {
    const produto = produtos.get(s.productId) || null;
    const nome = (produto && produto.name) || s.nomeNoRazao || '(produto removido)';
    const quantidade = r4(Number(s.saldo) || 0);
    if (quantidade === 0) continue;
    if (quantidade < 0) {
      negativos.push({ productId: s.productId, sku: produto ? produto.sku : '', productName: nome, quantidade });
      continue;
    }
    const doCadastro = produto ? Number(produto.costPrice) || 0 : 0;
    const medio = medios ? medios.get(s.productId) : null;
    let custo;
    let origem;
    if (valoracao === 'custo_medio' && medio !== null && medio !== undefined && medio > 0) {
      custo = medio;
      origem = 'medio';
    } else if (doCadastro > 0) {
      custo = doCadastro;
      origem = 'cadastro';
    } else {
      custo = 0;
      origem = 'sem_custo';
    }
    itens.push({
      productId: s.productId,
      sku: produto ? produto.sku : '',
      productName: nome,
      ncm: produto ? produto.ncm : '',
      unidade: produto ? produto.unidade : '',
      quantidade,
      custoUnitario: r6(custo),
      valor: r2(quantidade * custo),
      origemCusto: origem
    });
  }
  itens.sort((a, b) => a.productName.localeCompare(b.productName, 'pt-BR') || a.sku.localeCompare(b.sku, 'pt-BR'));
  return {
    itens,
    negativos,
    quantidadeTotal: r4(itens.reduce((t, i) => t + i.quantidade, 0)),
    valorTotal: r2(itens.reduce((t, i) => t + i.valor, 0)),
    pelaOrigem: {
      medio: itens.filter((i) => i.origemCusto === 'medio').length,
      cadastro: itens.filter((i) => i.origemCusto === 'cadastro').length,
      semCusto: itens.filter((i) => i.origemCusto === 'sem_custo').length
    }
  };
}

module.exports = { montarInventario };
