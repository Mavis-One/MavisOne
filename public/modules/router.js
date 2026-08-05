window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

window.MavisModuleRouter = {
  async render(moduleName, ctx) {
    const handler = window.MavisModuleRegistry[moduleName];
    if (!handler) return false;
    await handler(ctx);
    return true;
  }
};
