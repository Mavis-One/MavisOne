// Helpers das telas do módulo Cadastros.
//
// Reproduzem a linguagem visual da tela de Pessoas (public/app.js): painel
// "cadastros-shell", cabeçalho com chip, seções, grid de 2/3 colunas, campos
// com marcação de obrigatório, abas e painel de filtros recolhível. As duas
// fábricas no fim montam lista e formulário a partir de uma descrição, para
// cada tela declarar só seus campos e colunas.

window.MavisCadastros = window.MavisCadastros || {};

(function (C) {
  C.escape = function escape(value = '') {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  };

  C.formatBRL = function formatBRL(value) {
    return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  C.formatDate = function formatDate(value) {
    if (!value) return '-';
    const raw = String(value).slice(0, 10);
    const [y, m, d] = raw.split('-');
    return y && m && d ? `${d}/${m}/${y}` : value;
  };

  C.badge = function badge(label, tone = 'muted') {
    return `<span class="finance-badge finance-badge-${tone}">${C.escape(label)}</span>`;
  };

  const STATUS_TONES = {
    ativo: 'success', inativo: 'muted', manutencao: 'warning', baixado: 'danger',
    pendente: 'warning', 'em-andamento': 'info', concluida: 'success', cancelada: 'muted',
    agendado: 'info', confirmado: 'warning', realizado: 'success', cancelado: 'muted'
  };
  const STATUS_LABELS = {
    ativo: 'Ativo', inativo: 'Inativo', manutencao: 'Em manutenção', baixado: 'Baixado',
    pendente: 'Pendente', 'em-andamento': 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada',
    agendado: 'Agendado', confirmado: 'Confirmado', realizado: 'Realizado', cancelado: 'Cancelado'
  };
  C.statusBadge = function statusBadge(status) {
    const key = String(status || 'ativo').toLowerCase();
    return C.badge(STATUS_LABELS[key] || key, STATUS_TONES[key] || 'muted');
  };

  C.trashIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"></path></svg>';
  C.editIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';

  // --- blocos visuais herdados da tela de Pessoas -----------------------------

  C.pageHead = function pageHead(title, subtitle, chip = '', actionsHtml = '') {
    return `
      <div class="cadastro-page-head">
        <div>
          <h3>${C.escape(title)}</h3>
          ${subtitle ? `<p class="muted">${C.escape(subtitle)}</p>` : ''}
        </div>
        ${actionsHtml ? `<div class="cadastro-list-actions">${actionsHtml}</div>` : ''}
        ${!actionsHtml && chip ? `<div class="cadastro-page-chip">${C.escape(chip)}</div>` : ''}
      </div>
    `;
  };

  C.section = function section(title, body, description = '') {
    return `
      <section class="cadastro-section">
        <div class="cadastro-section-header">
          <div>
            <h4>${C.escape(title)}</h4>
            ${description ? `<p>${C.escape(description)}</p>` : ''}
          </div>
        </div>
        <div class="cadastro-section-body">${body}</div>
      </section>
    `;
  };

  C.options = function options(list, selectedId, { empty = 'Selecione', labelKey = 'name', valueKey = 'id' } = {}) {
    const head = empty === null ? '' : `<option value="">${C.escape(empty)}</option>`;
    return head + (list || []).map((item) => {
      const value = item[valueKey] ?? item.value;
      const label = item[labelKey] ?? item.label;
      return `<option value="${C.escape(value)}" ${String(selectedId ?? '') === String(value) ? 'selected' : ''}>${C.escape(label)}</option>`;
    }).join('');
  };

  // Campo declarativo. `def.options` aceita lista pronta ou função(meta).
  C.field = function field(def, value, meta, hasError) {
    const val = value ?? def.default ?? '';
    const errorClass = hasError ? ' cadastro-field-invalid' : '';
    const errorMsg = hasError ? '<span class="cadastro-field-error-msg">Campo obrigatório*</span>' : '';
    const hint = def.hint ? `<span class="cadastro-field-hint muted">${C.escape(def.hint)}</span>` : '';

    if (def.type === 'checkbox') {
      return `
        <label class="cadastro-check">
          <input type="checkbox" name="${def.name}" ${val ? 'checked' : ''} />
          <span>${C.escape(def.label)}</span>
        </label>
      `;
    }

    const inner = (() => {
      if (def.type === 'select') {
        const list = typeof def.options === 'function' ? def.options(meta) : (def.options || []);
        return `<select name="${def.name}" ${def.attrs || ''}>${C.options(list, val, { empty: def.empty ?? 'Selecione' })}</select>`;
      }
      if (def.type === 'textarea') {
        return `<textarea name="${def.name}" rows="${def.rows || 3}" ${def.attrs || ''}>${C.escape(val)}</textarea>`;
      }
      const step = def.type === 'number' ? `step="${def.step || '1'}"` : '';
      const min = def.min !== undefined ? `min="${def.min}"` : '';
      return `<input type="${def.type || 'text'}" name="${def.name}" value="${C.escape(val)}" ${step} ${min} ${def.attrs || ''} />`;
    })();

    return `
      <label class="cadastro-field${errorClass}${def.full ? ' cadastro-field-full' : ''}">
        <span>${C.escape(def.label)}${def.required ? ' *' : ''}</span>
        ${inner}
        ${hint}
        ${errorMsg}
      </label>
    `;
  };

  // Distribui os campos em linhas de N colunas, como a tela de Pessoas faz.
  C.fieldGrid = function fieldGrid(fields, values, meta, errors, columns = 3) {
    const rows = [];
    for (let i = 0; i < fields.length; i += columns) {
      rows.push(fields.slice(i, i + columns));
    }
    return rows.map((row) => `
      <div class="cadastro-grid cadastro-grid-${columns}">
        ${row.map((def) => C.field(def, values[def.name], meta, Boolean(errors[def.name]))).join('')}
      </div>
    `).join('');
  };

  const META_VAZIA = { directory: [], products: [], deposits: [], bankAccounts: [], paymentMethods: [], saleStatuses: [], companies: [], users: [] };

  // `endpoint` null pula a busca: as telas dos módulos novos (Frota, RH, PCP,
  // Contratos) não precisam dos dados de apoio de Cadastros, e pedi-los faria
  // quem tem acesso só àquele módulo tomar um aviso de erro na cara — a rota
  // /api/cadastros/meta exige permissão de Cadastros.
  C.loadMeta = async function loadMeta(api, showToast, endpoint = '/api/cadastros/meta') {
    if (!endpoint) return { ...META_VAZIA };
    try {
      return await api(endpoint);
    } catch (error) {
      if (showToast) showToast('Não foi possível carregar os dados de apoio dos cadastros.', 'warning');
      return { ...META_VAZIA };
    }
  };

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLocaleLowerCase('pt-BR')
      .trim();
  }
  C.normalizeText = normalizeText;

  // --------------------------------------------------------------------------
  // Fábrica: tela de LISTA
  // --------------------------------------------------------------------------
  // config: { title, subtitle, endpoint, listKey, newSub, newLabel, editStateKey,
  //           columns: [{label, render(item, meta, todosOsItens)}],
  //           filters: [{name, label, type, options}], searchFields,
  //           rowActions: [{icon, title, tone, run(item, ctx)}] }
  C.makeListScreen = function makeListScreen(config) {
    return async function renderList(ctx) {
      const { content, api, showToast, state, loadModule, confirmModal } = ctx;
      // As fábricas nasceram dentro de Cadastros, mas hoje Frota, RH, PCP e
      // Contratos usam as mesmas. Sem isto, salvar um veículo devolvia o
      // usuário para a tela de Cadastros.
      const modulo = config.module || 'cadastros';
      const meta = await C.loadMeta(api, showToast, config.metaEndpoint === undefined ? '/api/cadastros/meta' : config.metaEndpoint);

      state.cadastroDraft = state.cadastroDraft || {};
      const filterKey = `${config.listKey}Filters`;
      const saved = state.cadastroDraft[filterKey] || {};
      const filters = { show: Boolean(saved.show), query: saved.query || '' };
      (config.filters || []).forEach((def) => { filters[def.name] = saved[def.name] || ''; });

      let items = [];
      try {
        const res = await api(config.endpoint);
        items = res[config.listKey] || [];
      } catch (error) {
        showToast(error.message || 'Erro ao carregar a lista.', 'error');
      }

      function visibleItems() {
        return items.filter((item) => {
          const matchesFilters = (config.filters || []).every((def) => {
            const value = filters[def.name];
            if (!value) return true;
            if (def.type === 'select') return String(item[def.name] || '') === value;
            return normalizeText(item[def.name]).includes(normalizeText(value));
          });
          if (!matchesFilters) return false;
          const query = normalizeText(filters.query);
          if (!query) return true;
          return (config.searchFields || ['name'])
            .some((key) => normalizeText(item[key]).includes(query));
        });
      }

      function render() {
        const list = visibleItems();
        const colCount = config.columns.length + 1;
        // O render de coluna recebe a lista INTEIRA (`items`), não a filtrada:
        // há coluna derivada que depende das outras linhas — consumo entre dois
        // abastecimentos, por exemplo. Com a filtrada, o número mudaria ao
        // filtrar, o que seria simplesmente errado.
        content.innerHTML = `
          <div class="panel cadastros-shell">
            ${C.pageHead(config.title, config.subtitle, '', `
              ${config.newSub ? `<button type="button" class="success" id="cadastroListNew">+ ${C.escape(config.newLabel || 'Novo')}</button>` : ''}
              <button type="button" class="secondary" id="cadastroListFilterToggle">Filtros</button>
            `)}

            ${filters.show ? `
              <form id="cadastroFilterForm" class="cadastro-filter-panel">
                <div class="cadastro-filter-grid-5">
                  <label class="cadastro-field">
                    <span>Busca geral</span>
                    <input name="query" value="${C.escape(filters.query)}" placeholder="${C.escape(config.searchPlaceholder || 'Nome')}" />
                  </label>
                  ${(config.filters || []).map((def) => `
                    <label class="cadastro-field">
                      <span>${C.escape(def.label)}</span>
                      ${def.type === 'select'
                        ? `<select name="${def.name}">${C.options(typeof def.options === 'function' ? def.options(meta) : def.options, filters[def.name], { empty: 'Todos' })}</select>`
                        : `<input name="${def.name}" value="${C.escape(filters[def.name])}" />`}
                    </label>
                  `).join('')}
                </div>
                <div class="cadastro-filter-actions">
                  <button type="submit">Buscar</button>
                  <button type="button" class="secondary" id="cadastroFilterClear">Limpar filtros</button>
                </div>
              </form>
            ` : ''}

            <section class="cadastro-section">
              <div class="cadastro-section-header">
                <div>
                  <h4>${C.escape(config.tableTitle || config.title)}</h4>
                  <p>${list.length} de ${items.length} registro(s).</p>
                </div>
              </div>
              <div class="cadastro-section-body">
                <div class="table-scroll">
                  <table class="table table-actions">
                    <thead><tr>${config.columns.map((c) => `<th>${C.escape(c.label)}</th>`).join('')}<th>Ações</th></tr></thead>
                    <tbody>
                      ${list.length === 0
                        ? `<tr><td colspan="${colCount}" class="muted" style="text-align:center; padding:24px;">${items.length === 0 ? 'Nenhum registro cadastrado ainda.' : 'Nenhum registro para este filtro.'}</td></tr>`
                        : list.map((item) => `
                          <tr>
                            ${config.columns.map((c) => `<td>${c.render(item, meta, items)}</td>`).join('')}
                            <td>
                              ${(config.rowActions || []).map((acao, indice) => `
                                <button type="button" class="icon-button ${acao.tone || 'edit'}" data-acao="${indice}" data-acao-id="${C.escape(item.id)}" title="${C.escape(acao.title)}">${acao.icon}</button>
                              `).join('')}
                              <button type="button" class="icon-button edit" data-edit="${item.id}" title="Editar">${C.editIcon}</button>
                              <button type="button" class="icon-button" data-delete="${item.id}" title="Excluir">${C.trashIcon}</button>
                            </td>
                          </tr>
                        `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </div>
        `;

        document.getElementById('cadastroListFilterToggle')?.addEventListener('click', () => {
          filters.show = !filters.show;
          state.cadastroDraft[filterKey] = { ...filters };
          render();
        });

        document.getElementById('cadastroFilterForm')?.addEventListener('submit', (event) => {
          event.preventDefault();
          const formData = new FormData(event.target);
          filters.query = formData.get('query') || '';
          (config.filters || []).forEach((def) => { filters[def.name] = formData.get(def.name) || ''; });
          state.cadastroDraft[filterKey] = { ...filters };
          render();
        });

        document.getElementById('cadastroFilterClear')?.addEventListener('click', () => {
          filters.query = '';
          (config.filters || []).forEach((def) => { filters[def.name] = ''; });
          state.cadastroDraft[filterKey] = { ...filters };
          render();
        });

        document.getElementById('cadastroListNew')?.addEventListener('click', () => {
          state[config.editStateKey] = null;
          state.activeSub = config.newSub;
          loadModule(modulo);
        });

        // Ações próprias da linha, antes de editar/excluir. Recebem o item e o
        // ctx inteiro, então podem chamar API, confirmar e navegar. `recarregar`
        // redesenha a lista sem sair da tela.
        content.querySelectorAll('[data-acao]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const acao = (config.rowActions || [])[Number(btn.dataset.acao)];
            const item = items.find((entry) => entry.id === btn.dataset.acaoId);
            if (!acao || !item) return;
            btn.disabled = true;
            try {
              await acao.run(item, { ...ctx, meta, recarregar: () => loadModule(modulo) });
            } finally {
              btn.disabled = false;
            }
          });
        });

        content.querySelectorAll('[data-edit]').forEach((btn) => {
          btn.addEventListener('click', () => {
            state[config.editStateKey] = btn.dataset.edit;
            state.activeSub = config.newSub;
            loadModule(modulo);
          });
        });

        content.querySelectorAll('[data-delete]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const item = items.find((entry) => entry.id === btn.dataset.delete);
            const label = item ? (item.name || item.title || 'registro') : 'registro';
            const confirmed = await confirmModal(`Excluir "${label}"? Esta ação não pode ser desfeita.`);
            if (!confirmed) return;
            try {
              await api(`${config.endpoint}/${btn.dataset.delete}`, { method: 'DELETE' });
              showToast('Registro excluído.', 'success');
              loadModule(modulo);
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
  // Fábrica: CADASTRO SIMPLES (lista + formulário na MESMA tela)
  // --------------------------------------------------------------------------
  // Para as tabelas de apoio — departamento, tipo, categoria, profissão. São
  // três ou quatro campos, e mandar o usuário para outra tela só para digitar
  // um nome custa dois cliques e o contexto da lista que ele acabou de ver.
  //
  // Também é o que permite essas telas existirem SOZINHAS no menu: uma tela de
  // lista com `newSub` precisa do par "Novo X" cadastrado ao lado dela, e o
  // menu de RH ficaria com o dobro de itens só de formulários de duas linhas.
  //
  // config: { module, metaEndpoint, title, subtitle, tableTitle, entityLabel,
  //           endpoint, listKey, itemKey, searchFields, searchPlaceholder,
  //           columns: [{label, render(item, meta)}],
  //           filters: [{name, label, type:'select', options}],
  //           fields: [...], formColumns }
  C.makeInlineRegisterScreen = function makeInlineRegisterScreen(config) {
    return async function renderInlineRegister(ctx) {
      const { content, api, showToast, confirmModal } = ctx;
      const meta = await C.loadMeta(api, showToast, config.metaEndpoint === undefined ? '/api/cadastros/meta' : config.metaEndpoint);
      const campos = config.fields || [];
      const definicoesFiltro = config.filters || [];
      const filtros = {};
      definicoesFiltro.forEach((def) => { filtros[def.name] = ''; });

      let itens = [];
      let editando = null;   // registro em edição, ou null para "novo"
      let valores = {};
      let erros = {};
      let erroForm = '';
      let busca = '';

      const zerar = () => {
        editando = null;
        valores = {};
        campos.forEach((def) => { valores[def.name] = def.default ?? ''; });
        erros = {};
        erroForm = '';
      };
      zerar();

      async function carregar() {
        try {
          const res = await api(config.endpoint);
          itens = res[config.listKey] || [];
        } catch (error) {
          showToast(error.message || 'Erro ao carregar a lista.', 'error');
          itens = [];
        }
      }

      function visiveis() {
        const termo = normalizeText(busca);
        return itens.filter((item) => {
          const passaFiltros = definicoesFiltro.every((def) => {
            const valor = filtros[def.name];
            return !valor || String(item[def.name] ?? '') === valor;
          });
          if (!passaFiltros) return false;
          if (!termo) return true;
          return (config.searchFields || ['name'])
            .some((chave) => normalizeText(item[chave]).includes(termo));
        });
      }

      function render() {
        const lista = visiveis();
        const colunas = config.columns.length + 1;
        content.innerHTML = `
          <div class="panel cadastros-shell">
            ${C.pageHead(config.title, config.subtitle, '', `
              ${definicoesFiltro.map((def) => `
                <label class="cadastro-inline-filtro">
                  <span>${C.escape(def.label)}</span>
                  <select data-filtro="${def.name}">${C.options(typeof def.options === 'function' ? def.options(meta) : def.options, filtros[def.name], { empty: 'Todos' })}</select>
                </label>
              `).join('')}
              <input type="search" id="cadastroInlineBusca" class="cadastro-inline-busca"
                     value="${C.escape(busca)}" placeholder="${C.escape(config.searchPlaceholder || 'Buscar')}"
                     aria-label="Buscar em ${C.escape(config.title)}" />
            `)}

            <section class="cadastro-section">
              <div class="cadastro-section-header">
                <div>
                  <h4>${C.escape(config.tableTitle || config.title)}</h4>
                  <p>${lista.length} de ${itens.length} registro(s).</p>
                </div>
              </div>
              <div class="cadastro-section-body">
                <div class="table-scroll">
                  <table class="table table-actions">
                    <thead><tr>${config.columns.map((c) => `<th>${C.escape(c.label)}</th>`).join('')}<th>Ações</th></tr></thead>
                    <tbody>
                      ${lista.length === 0
                        ? `<tr><td colspan="${colunas}" class="muted" style="text-align:center; padding:24px;">${itens.length === 0 ? 'Nenhum registro cadastrado ainda.' : 'Nenhum registro para esta busca.'}</td></tr>`
                        : lista.map((item) => `
                          <tr class="${editando && editando.id === item.id ? 'active-row' : ''}">
                            ${config.columns.map((c) => `<td>${c.render(item, meta, itens)}</td>`).join('')}
                            <td>
                              <button type="button" class="icon-button edit" data-edit="${C.escape(item.id)}" title="Editar">${C.editIcon}</button>
                              <button type="button" class="icon-button" data-delete="${C.escape(item.id)}" title="Excluir">${C.trashIcon}</button>
                            </td>
                          </tr>
                        `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <form id="cadastroInlineForm" class="cadastro-form">
              ${C.section(
                editando ? `Editar ${config.entityLabel || 'registro'}` : `Novo ${config.entityLabel || 'registro'}`,
                C.fieldGrid(campos, valores, meta, erros, config.formColumns || 3),
                editando ? 'Alterando um registro que já existe.' : 'Preencha e salve — a lista acima atualiza na hora.'
              )}
              ${erroForm ? `<p class="form-error">${C.escape(erroForm)}</p>` : ''}
              <div class="cadastro-actions">
                ${editando ? '<button type="button" class="secondary" id="cadastroInlineCancel">Cancelar edição</button>' : ''}
                <button type="submit">${editando ? 'Salvar alterações' : `Adicionar ${C.escape(config.entityLabel || 'registro')}`}</button>
              </div>
            </form>
          </div>
        `;
        ligar();
      }

      function lerValores() {
        const form = document.getElementById('cadastroInlineForm');
        if (!form) return;
        const dados = new FormData(form);
        campos.forEach((def) => {
          if (def.type === 'checkbox') {
            valores[def.name] = form.querySelector(`[name="${def.name}"]`)?.checked || false;
          } else if (def.type === 'number') {
            const bruto = dados.get(def.name);
            valores[def.name] = bruto === '' || bruto === null ? '' : Number(bruto);
          } else {
            valores[def.name] = dados.get(def.name) ?? '';
          }
        });
      }

      function ligar() {
        const campoBusca = content.querySelector('#cadastroInlineBusca');
        campoBusca?.addEventListener('input', () => {
          busca = campoBusca.value;
          const cursor = campoBusca.selectionStart;
          render();
          const novo = content.querySelector('#cadastroInlineBusca');
          novo?.focus();
          novo?.setSelectionRange(cursor, cursor);
        });

        content.querySelectorAll('[data-filtro]').forEach((seletor) => {
          seletor.addEventListener('change', () => {
            filtros[seletor.dataset.filtro] = seletor.value;
            render();
          });
        });

        content.querySelectorAll('[data-edit]').forEach((botao) => {
          botao.addEventListener('click', () => {
            const item = itens.find((entrada) => entrada.id === botao.dataset.edit);
            if (!item) return;
            editando = item;
            erros = {};
            erroForm = '';
            campos.forEach((def) => { valores[def.name] = item[def.name] ?? (def.default ?? ''); });
            render();
            content.querySelector('#cadastroInlineForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        });

        content.querySelector('#cadastroInlineCancel')?.addEventListener('click', () => {
          zerar();
          render();
        });

        content.querySelectorAll('[data-delete]').forEach((botao) => {
          botao.addEventListener('click', async () => {
            const item = itens.find((entrada) => entrada.id === botao.dataset.delete);
            const rotulo = item ? (item.name || 'registro') : 'registro';
            const ok = await confirmModal(`Excluir "${rotulo}"? Esta ação não pode ser desfeita.`);
            if (!ok) return;
            try {
              await api(`${config.endpoint}/${encodeURIComponent(botao.dataset.delete)}`, { method: 'DELETE' });
              showToast('Registro excluído.', 'success');
              // Apagou justo o que estava aberto no formulário: volta para novo,
              // senão o próximo "Salvar alterações" iria para um id que sumiu.
              if (editando && editando.id === botao.dataset.delete) zerar();
              await carregar();
              render();
            } catch (error) {
              showToast(error.message || 'Erro ao excluir.', 'error');
            }
          });
        });

        content.querySelector('#cadastroInlineForm')?.addEventListener('submit', async (evento) => {
          evento.preventDefault();
          const botao = evento.target.querySelector('button[type="submit"]');
          if (botao?.disabled) return;

          lerValores();
          erros = {};
          campos.filter((def) => def.required).forEach((def) => {
            const valor = valores[def.name];
            if (valor === '' || valor === null || valor === undefined) erros[def.name] = true;
          });
          if (Object.keys(erros).length) {
            erroForm = 'Preencha os campos obrigatórios destacados.';
            render();
            return;
          }

          if (botao) botao.disabled = true;
          try {
            if (editando) {
              await api(`${config.endpoint}/${encodeURIComponent(editando.id)}`, { method: 'PUT', body: JSON.stringify(valores) });
            } else {
              await api(config.endpoint, { method: 'POST', body: JSON.stringify(valores) });
            }
            showToast(editando ? 'Registro atualizado.' : 'Registro criado.', 'success');
            zerar();
            await carregar();
            render();
          } catch (error) {
            erroForm = error.message || 'Erro ao salvar.';
            render();
          }
        });
      }

      await carregar();
      render();
    };
  };

  // --------------------------------------------------------------------------
  // Fábrica: tela de FORMULÁRIO
  // --------------------------------------------------------------------------
  // config: { title, subtitle, endpoint, itemKey, listSub, editStateKey,
  //           sections: [{title, description, columns, fields: [...]}],
  //           tabs: [{key, label, sections: [...]}] }
  C.makeFormScreen = function makeFormScreen(config) {
    return async function renderForm(ctx) {
      const { content, api, showToast, state, loadModule } = ctx;
      const modulo = config.module || 'cadastros';
      const meta = await C.loadMeta(api, showToast, config.metaEndpoint === undefined ? '/api/cadastros/meta' : config.metaEndpoint);

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

      const allFields = [
        ...(config.sections || []).flatMap((s) => s.fields),
        ...(config.tabs || []).flatMap((tab) => tab.sections.flatMap((s) => s.fields))
      ];
      const values = {};
      allFields.forEach((def) => {
        values[def.name] = current ? current[def.name] : (def.default ?? '');
      });
      let errors = {};
      let formError = '';

      function renderSections(sections) {
        return sections.map((s) => C.section(
          s.title,
          C.fieldGrid(s.fields, values, meta, errors, s.columns || 3),
          s.description || ''
        )).join('');
      }

      function render() {
        const tabs = config.tabs || [];
        content.innerHTML = `
          <div class="panel cadastros-shell">
            ${C.pageHead(
              current ? `Editar ${config.title}` : config.title,
              config.subtitle,
              current && current.code ? `Código ${current.code}` : (current ? 'Edição' : 'Novo')
            )}
            <form id="cadastroEntityForm" class="cadastro-form">
              ${renderSections(config.sections || [])}

              ${tabs.length ? `
                <div class="cadastro-tabs" role="tablist">
                  ${tabs.map((tab, index) => `
                    <button type="button" class="cadastro-tab ${index === 0 ? 'active' : ''}" data-tab="${tab.key}" role="tab" aria-selected="${index === 0}">
                      <span>${C.escape(tab.label)}</span>
                      <svg class="cadastro-tab-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </button>
                  `).join('')}
                </div>
                ${tabs.map((tab, index) => `
                  <div class="cadastro-tab-panel" data-tab-panel="${tab.key}" ${index === 0 ? '' : 'hidden'}>
                    ${renderSections(tab.sections)}
                  </div>
                `).join('')}
              ` : ''}

              ${formError ? `<p class="form-error">${C.escape(formError)}</p>` : ''}

              <div class="cadastro-actions">
                <button type="button" class="secondary" id="cadastroFormCancel">Cancelar</button>
                <button type="submit">${current ? 'Salvar alterações' : `Salvar ${C.escape(config.entityLabel || 'registro')}`}</button>
              </div>
            </form>
          </div>
        `;
        attachHandlers();
      }

      function readValues() {
        const form = document.getElementById('cadastroEntityForm');
        if (!form) return;
        const formData = new FormData(form);
        allFields.forEach((def) => {
          if (def.type === 'checkbox') {
            values[def.name] = form.querySelector(`[name="${def.name}"]`)?.checked || false;
          } else if (def.type === 'number') {
            const raw = formData.get(def.name);
            values[def.name] = raw === '' || raw === null ? '' : Number(raw);
          } else {
            values[def.name] = formData.get(def.name) ?? '';
          }
        });
      }

      function attachHandlers() {
        content.querySelectorAll('.cadastro-tab').forEach((btn) => {
          btn.addEventListener('click', () => {
            content.querySelectorAll('.cadastro-tab').forEach((other) => {
              const isTarget = other === btn;
              other.classList.toggle('active', isTarget);
              other.setAttribute('aria-selected', String(isTarget));
            });
            content.querySelectorAll('.cadastro-tab-panel').forEach((panel) => {
              panel.hidden = panel.dataset.tabPanel !== btn.dataset.tab;
            });
          });
        });

        document.getElementById('cadastroFormCancel')?.addEventListener('click', () => {
          state.activeSub = config.listSub;
          loadModule(modulo);
        });

        document.getElementById('cadastroEntityForm')?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const submitBtn = event.target.querySelector('button[type="submit"]');
          if (submitBtn?.disabled) return;

          readValues();
          errors = {};
          allFields.filter((def) => def.required).forEach((def) => {
            const value = values[def.name];
            if (value === '' || value === null || value === undefined) errors[def.name] = true;
          });
          if (Object.keys(errors).length) {
            formError = 'Preencha os campos obrigatórios destacados.';
            render();
            return;
          }

          if (submitBtn) submitBtn.disabled = true;
          try {
            if (current) {
              await api(`${config.endpoint}/${current.id}`, { method: 'PUT', body: JSON.stringify(values) });
            } else {
              await api(config.endpoint, { method: 'POST', body: JSON.stringify(values) });
            }
            showToast(current ? 'Registro atualizado.' : 'Registro criado.', 'success');
            state.activeSub = config.listSub;
            loadModule(modulo);
          } catch (error) {
            formError = error.message || 'Erro ao salvar.';
            render();
          }
        });
      }

      render();
    };
  };
})(window.MavisCadastros);
