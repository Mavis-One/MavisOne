window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

window.MavisModuleRouter = {
  async render(moduleName, ctx) {
    const handler = window.MavisModuleRegistry[moduleName];
    if (!handler) return false;
    // Um módulo pode devolver false para dizer "esta sub-tela não é minha" e
    // deixar o app.js renderizar a versão legada (é o caso de Cadastros, cujas
    // telas de Pessoas/Depósitos ainda vivem no app.js).
    const result = await handler(ctx);
    return result !== false;
  }
};
