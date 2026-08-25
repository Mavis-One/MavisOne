// Barra de ações do topo dos formulários: [ Mais Ações ▾ ] [ Salvar ] [ Voltar ]
//
// Componente genérico — a tela passa o catálogo de ações dela. Serve para
// Pedido/Orçamento, NF-e e qualquer cadastro que precise do mesmo padrão.
//
// Mesma regra do painel de NF-e: ação indisponível aparece esmaecida com o
// motivo no title, em vez de sumir. O menu não muda de tamanho conforme o
// estado do formulário, e o usuário descobre o que existe.
window.MavisActionsMenu = (function () {
  const icon = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

  const ICONS = {
    cart: icon('<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>'),
    tool: icon('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
    cancel: icon('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>'),
    money: icon('<circle cx="12" cy="12" r="10"/><path d="M12 6v12"/><path d="M15 9.5a2.5 2.5 0 0 0-2.5-2h-1a2.5 2.5 0 0 0 0 5h1a2.5 2.5 0 0 1 0 5h-1a2.5 2.5 0 0 1-2.5-2"/>'),
    check: icon('<path d="M20 6 9 17l-5-5"/>'),
    printer: icon('<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>'),
    mail: icon('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>'),
    whatsapp: icon('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
    download: icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'),
    copy: icon('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    note: icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
    clock: icon('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
    // Da fase do painel de acoes em lote: o quadrado precisa de um desenho, e
    // reaproveitar `note` (que e uma lupa) em oito acoes diferentes deixaria a
    // grade sem distincao nenhuma. Todos no mesmo traco 1.7 do conjunto.
    trash: icon('<polyline points="3 6 5 6 21 6"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
    edit: icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>'),
    file: icon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
    truck: icon('<path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>'),
    factory: icon('<path d="M2 20h20"/><path d="M4 20V9l6 4V9l6 4V4h4v16"/>'),
    tag: icon('<path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
    barcode: icon('<path d="M3 5v14"/><path d="M7 5v14"/><path d="M11 5v14"/><path d="M14 5v14"/><path d="M18 5v14"/><path d="M21 5v14"/>'),
    undo: icon('<path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 0 2.3-6.3L3 10"/>'),
    split: icon('<path d="M12 3v18"/><path d="M6 8 3 12l3 4"/><path d="m18 8 3 4-3 4"/>'),
    comment: icon('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>'),
    list: icon('<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>')
  };

  function motivoBloqueio(action, ctx) {
    if (typeof action.enabled === 'function') {
      const r = action.enabled(ctx);
      if (r !== true) return r || 'Indisponível.';
    }
    if (!action.run) return action.motivo || 'Ação ainda não implementada.';
    return null;
  }

  // Devolve o HTML da barra. A tela injeta onde quiser (normalmente no head).
  function barHtml(config, ctx) {
    const itens = config.actions.map((action) => {
      const motivo = motivoBloqueio(action, ctx);
      return `
        <button type="button" role="menuitem" class="actions-menu-item ${action.tone ? 'tone-' + action.tone : ''} ${motivo ? 'is-disabled' : ''}"
                data-menu-action="${action.id}" ${motivo ? 'disabled' : ''}
                title="${ctx.escapeHtml(motivo || action.label)}">
          <span class="actions-menu-icon">${action.icon || ICONS.note}</span>
          <span>${ctx.escapeHtml(action.label)}</span>
        </button>`;
    }).join('');

    return `
      <div class="actions-bar">
        <div class="actions-menu-wrap">
          <button type="button" class="secondary actions-menu-toggle" id="${config.id}Toggle" aria-haspopup="true" aria-expanded="false">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            Mais Ações
          </button>
          <div class="actions-menu" id="${config.id}Menu" role="menu" hidden>${itens}</div>
        </div>
        <button type="button" class="actions-save" id="${config.id}Save">${ctx.escapeHtml(config.saveLabel || 'Salvar')}</button>
        <button type="button" class="actions-back" id="${config.id}Back">Voltar</button>
      </div>`;
  }

  function attach(config, ctx) {
    const toggle = document.getElementById(`${config.id}Toggle`);
    const menu = document.getElementById(`${config.id}Menu`);
    if (!toggle || !menu) return;

    const fechar = () => {
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', aoClicarFora, true);
      document.removeEventListener('keydown', aoTeclar, true);
    };
    const abrir = () => {
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      document.addEventListener('click', aoClicarFora, true);
      document.addEventListener('keydown', aoTeclar, true);
    };
    function aoClicarFora(event) {
      if (!menu.contains(event.target) && !toggle.contains(event.target)) fechar();
    }
    function aoTeclar(event) {
      if (event.key === 'Escape') { fechar(); toggle.focus(); }
    }

    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      if (menu.hidden) abrir(); else fechar();
    });

    menu.querySelectorAll('[data-menu-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = config.actions.find((a) => a.id === btn.dataset.menuAction);
        if (!action || motivoBloqueio(action, ctx)) return;
        fechar();
        try {
          await action.run(ctx);
        } catch (error) {
          ctx.showToast(error.message || 'Erro ao executar a ação.', 'error');
        }
      });
    });

    document.getElementById(`${config.id}Save`)?.addEventListener('click', () => config.onSave?.());
    document.getElementById(`${config.id}Back`)?.addEventListener('click', () => config.onBack?.());
  }

  return { ICONS, barHtml, attach, motivoBloqueio };
})();
