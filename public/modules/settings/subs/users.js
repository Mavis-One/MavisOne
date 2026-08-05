window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.settings = window.MavisSubscreenRegistry.settings || {};

window.MavisSubscreenRegistry.settings.users = async function renderSettingsUsers(ctx) {
  if (window.MavisSubscreenRegistry.settings.company) {
    await window.MavisSubscreenRegistry.settings.company(ctx);
  }
};
