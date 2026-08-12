// Helpers compartilhados pelas telas do módulo Estoque.
//
// Boa parte das telas é o mesmo par "lista + formulário" em cima de coleções
// diferentes (categorias, depósitos, tabelas de preço, catálogos). As duas
// fábricas no fim do arquivo montam esse par a partir de uma descrição, para
// cada tela só precisar declarar seus campos e colunas.

window.MavisStock = window.MavisStock || {};

(function (Stock) {
  Stock.formatBRL = function formatBRL(value) {
    return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  Stock.formatQty = function formatQty(value) {
    const n = Number(value || 0);
    return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
  };

  Stock.formatDate = function formatDate(value) {
    if (!value) return '-';
    const [y, m, d] = String(value).slice(0, 10).split('-');
    return y && m && d ? `${d}/${m}/${y}` : value;
  };

  Stock.badge = function badge(label, tone = 'muted') {
    return `<span class="finance-badge finance-badge-${tone}">${label}</span>`;
  };

  const STATUS_TONES = { ativo: 'success', inativo: 'muted' };
  Stock.statusBadge = function statusBadge(status) {
    const value = String(status || 'ativo').toLowerCase();
    return Stock.badge(value.charAt(0).toUpperCase() + value.slice(1), STATUS_TONES[value] || 'muted');
  };

  const SITUATION_META = {
    normal: { label: 'Normal', tone: 'success' },
    'abaixo-minimo': { label: 'Abaixo do mínimo', tone: 'warning' },
    'acima-maximo': { label: 'Acima do máximo', tone: 'info' },
    zerado: { label: 'Zerado', tone: 'danger' }
  };
  Stock.situationBadge = function situationBadge(situation) {
    const meta = SITUATION_META[situation] || SITUATION_META.normal;
    return Stock.badge(meta.label, meta.tone);
  };

  Stock.trashIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"></path></svg>';
  Stock.editIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';

  Stock.emptyRow = function emptyRow(colspan, message) {
    return `<tr><td colspan="${colspan}" class="muted" style="text-align:center; padding:24px;">${message}</td></tr>`;
  };

  // Metadados (depósitos, categorias, produtos, tabelas) usados nos selects.
  Stock.loadMeta = async function loadMeta(api, showToast) {
    try {
      return await api('/api/stock/meta');
    } catch (error) {
      if (showToast) showToast('Não foi possível carregar os cadastros de apoio do estoque.', 'warning');
      return { deposits: [], classes: [], productCategories: [], movementCategories: [], priceTables: [], catalogs: [], products: [] };
    }
  };

  // O razão guarda o classValueId; o nome legível está no catálogo, que vem no
  // meta. Um índice em vez de um find por linha: a tabela de movimentações tem
  // 20 linhas por página e o catálogo cresce com o cadastro.
  Stock.indiceDeCores = function indiceDeCores(meta) {
    const indice = new Map();
    for (const classe of (meta?.classes || [])) {
      for (const valor of (classe.valores || [])) {
        indice.set(valor.id, { ...valor, className: classe.name });
      }
    }
    return indice;
  };

  // Selo da cor. Sem nome no catálogo o id aparece cru, de propósito: some da
  // tela seria pior — o movimento existe e alguém precisa conseguir rastreá-lo.
  Stock.corBadge = function corBadge(indice, classValueId) {
    if (!classValueId) return '';
    const valor = indice.get(classValueId);
    const hex = valor?.hex || '';
    const nome = valor?.name || classValueId;
    return `<span class="stock-cor-selo" title="${Stock.escape(valor?.className || 'Classe')}">`
      + (hex ? `<span class="stock-cor-bolinha" style="background:${Stock.escape(hex)}"></span>` : '')
      + `${Stock.escape(nome)}</span>`;
  };

  Stock.options = function options(list, selectedId, { labelKey = 'name', valueKey = 'id', empty = 'Selecione' } = {}) {
    const head = empty === null ? '' : `<option value="">${empty}</option>`;
    return head + (list || [])
      .map((item) => `<option value="${item[valueKey]}" ${String(selectedId) === String(item[valueKey]) ? 'selected' : ''}>${Stock.escape(item[labelKey])}</option>`)
      .join('');
  };

  Stock.escape = function escape(value = '') {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  };

  Stock.pageHead = function pageHead(title, subtitle, actionsHtml = '') {
    return `
      <div class="cadastro-page-head">
        <div>
          <h3>${Stock.escape(title)}</h3>
          ${subtitle ? `<p class="muted">${Stock.escape(subtitle)}</p>` : ''}
        </div>
        ${actionsHtml ? `<div class="finance-actions-row" style="margin:0;">${actionsHtml}</div>` : ''}
      </div>
    `;
  };

  // Campo de formulário a partir da descrição declarativa das fábricas.
  Stock.field = function field(def, value, meta) {
    const val = value ?? def.default ?? '';
    const required = def.required ? 'required' : '';
    if (def.type === 'select') {
      const list = typeof def.options === 'function' ? def.options(meta) : (def.options || []);
      return `<label>${def.label}<select name="${def.name}" ${required}>${Stock.options(list, val, { empty: def.empty ?? 'Selecione' })}</select></label>`;
    }
    if (def.type === 'textarea') {
      return `<label>${def.label}<textarea name="${def.name}" rows="${def.rows || 3}">${Stock.escape(val)}</textarea></label>`;
    }
    if (def.type === 'checkbox') {
      return `<label class="stock-check"><input type="checkbox" name="${def.name}" ${val ? 'checked' : ''} /> ${def.label}</label>`;
    }
    const step = def.type === 'number' ? `step="${def.step || '1'}"` : '';
    const min = def.min !== undefined ? `min="${def.min}"` : '';
    return `<label>${def.label}<input type="${def.type || 'text'}" name="${def.name}" ${step} ${min} ${required} value="${Stock.escape(val)}" /></label>`;
  };

  Stock.readForm = function readForm(form, fields) {
    const formData = new FormData(form);
    const payload = {};
    fields.forEach((def) => {
      if (def.type === 'checkbox') {
        payload[def.name] = form.querySelector(`[name="${def.name}"]`)?.checked || false;
      } else if (def.type === 'number') {
        const raw = formData.get(def.name);
        payload[def.name] = raw === '' || raw === null ? 0 : Number(raw);
      } else {
        payload[def.name] = formData.get(def.name) ?? '';
      }
    });
    return payload;
  };

  // --------------------------------------------------------------------------
  // Fábrica: tela de LISTA de um cadastro simples
  // --------------------------------------------------------------------------
  // config: { title, subtitle, endpoint, listKey, newSub, editStateKey,
  //           columns: [{ label, render(item, meta) }], searchFields, canDelete }
  Stock.makeListScreen = function makeListScreen(config) {
    return async function renderList(ctx) {
      const { content, api, showToast, state, loadModule, confirmModal } = ctx;
      const meta = config.needsMeta ? await Stock.loadMeta(api, showToast) : null;
      let items = [];
      try {
        const res = await api(config.endpoint);
        items = res[config.listKey] || [];
      } catch (error) {
        showToast(error.message || 'Erro ao carregar a lista.', 'error');
      }

      let search = '';

      function visibleItems() {
        if (!search) return items;
        const term = search.toLowerCase();
        return items.filter((item) => (config.searchFields || ['name', 'code'])
          .map((key) => String(item[key] || ''))
          .join(' ')
          .toLowerCase()
          .includes(term));
      }

      function render() {
        const list = visibleItems();
        const colCount = config.columns.length + 1;
        content.innerHTML = `
          <div class="panel">
            ${Stock.pageHead(config.title, config.subtitle, `<button type="button" id="stockListNew">${config.newLabel || 'Novo'}</button>`)}
            <label>Buscar<input type="search" id="stockListSearch" value="${Stock.escape(search)}" placeholder="${config.searchPlaceholder || 'Nome ou código'}" /></label>
          </div>
          <div class="panel">
            <div class="table-scroll">
              <table class="table table-actions">
                <thead><tr>${config.columns.map((c) => `<th>${c.label}</th>`).join('')}<th>Ações</th></tr></thead>
                <tbody>
                  ${list.length === 0
                    ? Stock.emptyRow(colCount, items.length === 0 ? 'Nenhum registro cadastrado ainda.' : 'Nenhum registro para esta busca.')
                    : list.map((item) => `
                      <tr>
                        ${config.columns.map((c) => `<td>${c.render(item, meta)}</td>`).join('')}
                        <td>
                          <button type="button" class="icon-button edit" data-edit="${item.id}" title="Editar">${Stock.editIcon}</button>
                          <button type="button" class="icon-button" data-delete="${item.id}" title="Excluir">${Stock.trashIcon}</button>
                        </td>
                      </tr>
                    `).join('')}
                </tbody>
              </table>
            </div>
            <p class="muted" style="margin-top:12px;">${list.length} de ${items.length} registro(s).</p>
          </div>
        `;

        document.getElementById('stockListNew')?.addEventListener('click', () => {
          state[config.editStateKey] = null;
          state.activeSub = config.newSub;
          loadModule('stock');
        });

        const searchInput = document.getElementById('stockListSearch');
        searchInput?.addEventListener('input', (event) => {
          search = event.target.value;
          const caret = event.target.selectionStart;
          render();
          const next = document.getElementById('stockListSearch');
          next?.focus();
          next?.setSelectionRange(caret, caret);
        });

        content.querySelectorAll('[data-edit]').forEach((btn) => {
          btn.addEventListener('click', () => {
            state[config.editStateKey] = btn.dataset.edit;
            state.activeSub = config.newSub;
            loadModule('stock');
          });
        });

        content.querySelectorAll('[data-delete]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const item = items.find((entry) => entry.id === btn.dataset.delete);
            const confirmed = await confirmModal(`Excluir "${item ? item.name : 'registro'}"? Esta ação não pode ser desfeita.`);
            if (!confirmed) return;
            try {
              await api(`${config.endpoint}/${btn.dataset.delete}`, { method: 'DELETE' });
              showToast('Registro excluído.', 'success');
              loadModule('stock');
            } catch (error) {
              showToast(error.message || 'Erro ao excluir.', 'error');
            }
          });
        });
      }

      render();
    };
  };

  // --------------------------------------------------------------------------
  // Fábrica: tela de FORMULÁRIO de um cadastro simples
  // --------------------------------------------------------------------------
  // config: { title, endpoint, itemKey, fields, listSub, editStateKey, rows }
  Stock.makeFormScreen = function makeFormScreen(config) {
    return async function renderForm(ctx) {
      const { content, api, showToast, state, loadModule } = ctx;
      const meta = config.needsMeta ? await Stock.loadMeta(api, showToast) : null;

      const editId = state[config.editStateKey] || null;
      state[config.editStateKey] = null;
      let current = null;
      if (editId) {
        try {
          const res = await api(`${config.endpoint}/${editId}`);
          current = res[config.itemKey];
        } catch (error) {
          showToast('Não foi possível carregar o registro para edição.', 'error');
        }
      }

      // Agrupa os campos em linhas conforme config.rows (índices dos campos).
      const rows = config.rows || config.fields.map((_, index) => [index]);
      content.innerHTML = `
        <div class="panel">
          ${Stock.pageHead(current ? `Editar ${config.title}` : config.title, config.subtitle)}
          <form id="stockEntityForm" class="form-grid">
            ${rows.map((row) => `<div class="row">${row.map((index) => Stock.field(config.fields[index], current ? current[config.fields[index].name] : undefined, meta)).join('')}</div>`).join('')}
            <div class="finance-actions-row">
              <button type="submit">${current ? 'Salvar alterações' : 'Salvar'}</button>
              <button type="button" class="secondary" id="stockFormCancel">Ver lista</button>
            </div>
          </form>
        </div>
      `;

      document.getElementById('stockFormCancel')?.addEventListener('click', () => {
        state.activeSub = config.listSub;
        loadModule('stock');
      });

      document.getElementById('stockEntityForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitBtn = event.target.querySelector('button[type="submit"]');
        if (submitBtn?.disabled) return;
        if (submitBtn) submitBtn.disabled = true;
        const payload = Stock.readForm(event.target, config.fields);
        try {
          if (current) {
            await api(`${config.endpoint}/${current.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          } else {
            await api(config.endpoint, { method: 'POST', body: JSON.stringify(payload) });
          }
          showToast(current ? 'Registro atualizado.' : 'Registro criado.', 'success');
          state.activeSub = config.listSub;
          loadModule('stock');
        } catch (error) {
          showToast(error.message || 'Erro ao salvar.', 'error');
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    };
  };
})(window.MavisStock);
