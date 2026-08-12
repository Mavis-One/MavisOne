window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

window.MavisSubscreenRegistry.cadastros.novo_produto = async function renderCadastroNovoProduto(ctx) {
  const renderer = window.MavisSubscreenRegistry.stock?.new_product;
  if (!renderer) {
    ctx.content.innerHTML = '<div class="panel"><p class="muted">Tela de produtos indisponível.</p></div>';
    return;
  }
  await renderer(window.MavisCadastros.stockProxyCtx(ctx, {
    products: 'produtos',
    new_product: 'novo_produto',
    // O botão "Cadastrar nova classe ou cor" do bloco Classes: sem este
    // mapeamento ele jogaria o usuário para dentro do módulo Estoque.
    classes: 'classes_produto'
  }));
};
