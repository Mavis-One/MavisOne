window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.purchases = window.MavisSubscreenRegistry.purchases || {};

window.MavisSubscreenRegistry.purchases.suppliers = async function renderPurchasesSuppliers(ctx) {
  const { content, data, escapeHtml } = ctx;

  const suppliers = [...new Map(data.purchases.map((purchase) => [purchase.supplier, { name: purchase.supplier, purchases: 0, total: 0 }])).values()];
  data.purchases.forEach((purchase) => {
    const supplier = suppliers.find((entry) => entry.name === purchase.supplier);
    if (supplier) {
      supplier.purchases += 1;
      supplier.total += Number(purchase.total || 0);
    }
  });

  // ESTADO VAZIO, QUE FALTAVA.
  //
  // Medido no navegador com os dados reais: a tela inteira tinha 37 letras e 9
  // nós — o título e os três cabeçalhos da tabela, mais nada. Uma tabela com
  // cabeçalho e nenhuma linha, sem uma palavra de explicação, é indistinguível
  // de uma tela que falhou ao carregar: foi por isso que ela entrou na lista de
  // "telas que não carregam direito", mesmo carregando.
  //
  // E o texto diz O QUE a tela lista, porque o nome dela promete outra coisa.
  // Aqui estão os fornecedores DE QUEM JÁ SE COMPROU, somados a partir dos
  // documentos de compra — e não o cadastro de fornecedores, que vive em
  // Cadastros > Pessoas. Sem essa frase, quem tem 1.225 pessoas jurídicas
  // cadastradas e vê a tela vazia conclui que o cadastro sumiu.
  const vazia = `
    <tr><td colspan="3" class="muted">
      Nenhuma compra registrada ainda. Esta lista é montada a partir dos
      documentos de compra — cada fornecedor aparece aqui na primeira ordem
      lançada para ele, com o total acumulado. Para ver ou cadastrar
      fornecedores, use Cadastros &rsaquo; Pessoas.
    </td></tr>
  `;

  content.innerHTML = `
    <div class="panel">
      <h3>Fornecedores</h3>
      <p class="muted">De quem já se comprou, com o que cada um somou em compras.</p>
      <table class="table">
        <thead><tr><th>Fornecedor</th><th>Compras</th><th>Total</th></tr></thead>
        <tbody>
          ${suppliers.length
    ? suppliers.map((supplier) => `<tr><td>${escapeHtml(supplier.name)}</td><td>${supplier.purchases}</td><td>R$ ${supplier.total.toFixed(2)}</td></tr>`).join('')
    : vazia}
        </tbody>
      </table>
    </div>
  `;
};
