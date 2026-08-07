window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

window.MavisModuleRouter = {
  async render(moduleName, ctx) {
    // Módulo aberto sem sub-tela escolhida cai na sua Área de Trabalho. Fica
    // aqui, e não dentro de cada módulo, porque o desvio é o mesmo para todos —
    // inclusive para Vendas e Cadastros, que ainda renderizam pelo app.js e
    // nem chegam a ter um handler próprio no registro.
    if (window.MavisWorkspace?.deveAbrir(moduleName, ctx.state)) {
      window.MavisWorkspace.render(ctx, moduleName);
      return true;
    }

    // Sub-tela marcada como `pendente` no moduleSubItems: existe no menu e na
    // Área de Trabalho, mas ainda não foi construída. Também fica aqui porque
    // os módulos novos (Frota, RH, PCP, Contratos, CRM) nem têm handler
    // próprio ainda — sem este desvio a tela abriria em branco.
    const pendente = window.MavisWorkspace?.telaPendente(moduleName, ctx.state);
    if (pendente) {
      window.MavisWorkspace.renderPendente(ctx, moduleName, pendente);
      return true;
    }

    const handler = window.MavisModuleRegistry[moduleName];
    if (!handler) return false;
    // Um módulo pode devolver false para dizer "esta sub-tela não é minha" e
    // deixar o app.js renderizar a versão legada (é o caso de Cadastros, cujas
    // telas de Pessoas/Depósitos ainda vivem no app.js).
    const result = await handler(ctx);
    return result !== false;
  }
};
