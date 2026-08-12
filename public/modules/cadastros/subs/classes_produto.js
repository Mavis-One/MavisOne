window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

// Classe de produto é uma entidade só: o catálogo vive no Estoque e aqui é a
// MESMA tela, pelo mesmo motivo de Produtos — dois cadastros da mesma coisa
// divergem na primeira alteração feita de um lado. O proxy mantém o usuário
// dentro de Cadastros quando a tela navega para si mesma ou para o produto.
window.MavisSubscreenRegistry.cadastros.classes_produto = async function renderCadastroClasses(ctx) {
  const renderer = window.MavisSubscreenRegistry.stock?.classes;
  if (!renderer) {
    ctx.content.innerHTML = '<div class="panel"><p class="muted">Tela de classes indisponível.</p></div>';
    return;
  }
  await renderer(window.MavisCadastros.stockProxyCtx(ctx, {
    classes: 'classes_produto',
    new_product: 'novo_produto',
    products: 'produtos'
  }));
};
