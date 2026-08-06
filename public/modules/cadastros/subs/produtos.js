window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

// Produto é uma entidade só: o cadastro vive no Estoque e aqui é a mesma tela,
// para não existirem dois cadastros de produto divergindo. O proxy abaixo
// mantém o usuário dentro de Cadastros quando a tela navega para si mesma.
window.MavisCadastros.stockProxyCtx = function stockProxyCtx(ctx, subMap) {
  return {
    ...ctx,
    loadModule(moduleName) {
      if (moduleName === 'stock') {
        const mapped = subMap[ctx.state.activeSub];
        if (mapped) {
          ctx.state.activeSub = mapped;
          return ctx.loadModule('cadastros');
        }
      }
      return ctx.loadModule(moduleName);
    }
  };
};

window.MavisSubscreenRegistry.cadastros.produtos = async function renderCadastroProdutos(ctx) {
  const renderer = window.MavisSubscreenRegistry.stock?.products;
  if (!renderer) {
    ctx.content.innerHTML = '<div class="panel"><p class="muted">Tela de produtos indisponível.</p></div>';
    return;
  }
  await renderer(window.MavisCadastros.stockProxyCtx(ctx, {
    products: 'produtos',
    new_product: 'novo_produto'
  }));
};
