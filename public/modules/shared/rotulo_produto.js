// Como um produto se chama DENTRO DE UM SELETOR — fonte única.
//
// POR QUE O SKU ENTRA NO RÓTULO
// -----------------------------
// Depois da importação do ViperERP, medido no banco:
//
//     203 nomes aparecem mais de uma vez  ·  457 produtos envolvidos
//     "SETA (PISCA DE SINALIZACAO) PARA BICICLETA" .... 7 vezes
//     "PAINEL PARA BICICLETA ELETRICA DA POSICAO" ..... 7 vezes
//     "BATERIA DE" ................................... 5 vezes
//
// E os sete "SETA" têm sete custos diferentes (R$ 2,31 a R$ 8,05). Um seletor
// que mostra só o nome oferece sete linhas idênticas e deixa a escolha no
// chute. Quem lança a movimentação não descobre o erro ali: descobre quando o
// saldo do produto errado fica negativo, semanas depois.
//
// O SKU é o que distingue, então ele vai junto — e vai DEPOIS do nome, porque
// quem procura digita o nome. O campo de busca casa contra o rótulo inteiro,
// então digitar o SKU também acha.
//
// NÃO entra aqui o saldo nem a reserva. Vendas monta um rótulo próprio com
// esses números porque lá eles decidem a venda; no Estoque e em Compras eles
// seriam ruído numa lista de 5.476 — e um número a mais para ficar velho.
(function (raiz) {
  function limpar(valor) {
    return String(valor == null ? '' : valor).trim();
  }

  /**
   * `produto` é o objeto serializado da API (name, sku).
   *
   * Produto sem SKU sai só com o nome, sem separador solto: um rótulo
   * terminado em "·" pareceria um dado truncado.
   */
  function rotulo(produto) {
    if (!produto) return '';
    const nome = limpar(produto.name) || '(sem nome)';
    const sku = limpar(produto.sku);
    return sku ? `${nome} · ${sku}` : nome;
  }

  /**
   * A lista pronta para renderSearchableSelect. `product` vai junto porque
   * quem escolhe quase sempre precisa de outro campo do produto (o custo, na
   * ordem de compra) e buscá-lo de novo por id seria um find por clique.
   */
  function opcoes(produtos) {
    return (produtos || []).map((produto) => ({
      value: produto.id,
      label: rotulo(produto),
      product: produto
    }));
  }

  const api = { rotulo, opcoes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisRotuloProduto = api;
})(typeof window !== 'undefined' ? window : globalThis);
