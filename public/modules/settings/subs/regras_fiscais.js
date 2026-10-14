window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.settings = window.MavisSubscreenRegistry.settings || {};

// REGRAS FISCAIS DENTRO DAS CONFIGURAÇÕES (14/10/2026, pedido do usuário).
//
// É a MESMA tela de Fiscal › Regras Fiscais (modules/fiscal/subs/regras.js),
// não uma cópia: as duas entradas mostram, criam e simulam as mesmas regras, e
// uma correção lá vale aqui. Mesmo padrão de NF-e Emitidas em Vendas e no
// Fiscal (fiscal/subs/nfe_espelho.js). A delegação é resolvida na hora da
// chamada: se a tela do Fiscal não estiver carregada, aparece o aviso em vez de
// uma tela em branco.
window.MavisSubscreenRegistry.settings.regras_fiscais = async function renderRegrasFiscaisNasConfiguracoes(ctx) {
  const tela = window.MavisSubscreenRegistry.fiscal && window.MavisSubscreenRegistry.fiscal.regras;
  if (typeof tela !== 'function') {
    ctx.content.innerHTML = `
      <div class="panel">
        <h3>Regras Fiscais</h3>
        <p class="muted">Esta tela é a mesma do Fiscal e não está carregada agora.</p>
        <p class="muted">Verifique se <code>modules/fiscal/subs/regras.js</code> continua listado no <code>index.html</code>.</p>
      </div>`;
    return;
  }
  await tela(ctx);
};
