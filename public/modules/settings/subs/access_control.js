window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.settings = window.MavisSubscreenRegistry.settings || {};

// Papéis e Permissões.
//
// Duas telas em uma, porque são os dois lados da mesma pergunta:
//   - por PAPEL: o que "Gerente" pode fazer (vale para todo mundo com o papel);
//   - por USUÁRIO: quais papéis a pessoa tem, e as exceções pontuais dela.
//
// O que esta tela mostra é informação, não é o controle: quem decide é o
// servidor a cada requisição. Esconder um botão nunca bloqueou ninguém.
window.MavisSubscreenRegistry.settings.access_control = async function renderAccessControl(ctx) {
  const { content, api, showToast, loadModule, state, escapeHtml } = ctx;

  let dados;
  try {
    dados = await api('/api/access-control');
  } catch (error) {
    content.innerHTML = `<div class="panel"><p class="muted">${escapeHtml(error.message || 'Erro ao carregar o controle de acesso.')}</p></div>`;
    return;
  }

  if (!dados.disponivel || !dados.permissions.length) {
    content.innerHTML = `
      <div class="cadastro-page-head"><div><h3>Papéis e Permissões</h3></div></div>
      <div class="panel">
        <p class="sales-totals-alerta">
          As tabelas de controle de acesso ainda não existem no banco. Enquanto isso, o sistema
          continua com o modelo antigo — acesso por módulo inteiro, sem trilha de auditoria.
        </p>
        <p class="muted">Rode <code>supabase/migrations/fase-l-controle-de-acesso.sql</code> no SQL Editor do Supabase e recarregue esta tela.</p>
      </div>`;
    return;
  }

  const aba = state.settingsDraft?.accessTab || 'papeis';
  const papelSelecionado = state.settingsDraft?.accessRole || dados.roles.find((p) => p.slug !== 'admin')?.slug || '';
  const usuarioSelecionado = state.settingsDraft?.accessUser || dados.users[0]?.id || '';

  // Permissões agrupadas por recurso — a lista corrida de 60 slugs é ilegível.
  const porRecurso = dados.permissions.reduce((mapa, permissao) => {
    (mapa[permissao.resource] = mapa[permissao.resource] || []).push(permissao);
    return mapa;
  }, {});

  // O recurso é um slug técnico ("fleet", "pcp"). Quem administra acesso
  // conhece o módulo pelo nome do menu, então o título sai de moduleLabels —
  // assim módulo novo já aparece nomeado aqui, sem lista para atualizar.
  // Só "usuarios" e "auditoria" não são módulos do menu e precisam de nome.
  const NOME_FORA_DO_MENU = { usuarios: 'Usuários e acessos', auditoria: 'Auditoria de acesso' };
  const nomeDoRecurso = (recurso) =>
    (typeof moduleLabels !== 'undefined' && moduleLabels[recurso]) || NOME_FORA_DO_MENU[recurso] || recurso;

  // Ordem do menu, com o que não é módulo no fim. O banco devolve em ordem
  // alfabética de slug, e "contracts" antes de "sales" não diz nada a ninguém.
  const ORDEM_RECURSOS = [
    ...(typeof MENU_MODULOS !== 'undefined' ? MENU_MODULOS : []),
    'settings', 'usuarios', 'auditoria'
  ];
  const posicaoRecurso = (recurso) => {
    const i = ORDEM_RECURSOS.indexOf(recurso);
    return i === -1 ? ORDEM_RECURSOS.length : i; // recurso novo cai no fim
  };

  // Dentro do recurso: do menos para o mais poderoso. Alfabético colocava
  // "excluir" antes de "ler", e a leitura da linha ficava sem sentido.
  const ORDEM_ACOES = ['ler', 'visualizar', 'criar', 'editar', 'excluir', 'gerenciar'];
  const posicaoAcao = (acao) => {
    const i = ORDEM_ACOES.indexOf(acao);
    return i === -1 ? ORDEM_ACOES.length : i;
  };

  const recursosOrdenados = Object.entries(porRecurso)
    .sort(([a], [b]) => posicaoRecurso(a) - posicaoRecurso(b) || a.localeCompare(b))
    .map(([recurso, lista]) => [
      recurso,
      [...lista].sort((x, y) => posicaoAcao(x.action) - posicaoAcao(y.action) || x.action.localeCompare(y.action))
    ]);

  const doPapel = new Set(dados.rolePermissions.filter((rp) => rp.role_slug === papelSelecionado).map((rp) => rp.permission_slug));
  const acessoDoUsuario = dados.userAccess[usuarioSelecionado] || { roles: [], permitidas: [], negadas: [] };
  const usuarioAtual = dados.users.find((u) => u.id === usuarioSelecionado);
  const papeisDoUsuario = new Set(acessoDoUsuario.roles);
  const negadasDoUsuario = new Set(acessoDoUsuario.negadas);
  // Vem do papel, sem exceção pontual: mostrado marcado e explicado, para o
  // admin entender de ONDE veio a permissão antes de tentar mexer nela.
  const heradadas = new Set(
    dados.rolePermissions.filter((rp) => papeisDoUsuario.has(rp.role_slug)).map((rp) => rp.permission_slug)
  );
  const extras = new Set(acessoDoUsuario.permitidas.filter((slug) => !heradadas.has(slug)));

  const gradeDePermissoes = (marcadas, nomeCampo, extraPorPermissao = () => '') => `
    <div class="rbac-recursos">
      ${recursosOrdenados.map(([recurso, lista]) => `
        <section class="rbac-recurso">
          <h4>${escapeHtml(nomeDoRecurso(recurso))} <small class="rbac-recurso-slug">${escapeHtml(recurso)}</small></h4>
          ${lista.map((permissao) => `
            <label class="rbac-permissao">
              <input type="checkbox" name="${nomeCampo}" value="${escapeHtml(permissao.slug)}" ${marcadas.has(permissao.slug) ? 'checked' : ''} />
              <span>${escapeHtml(permissao.action)}</span>
              <small>${escapeHtml(permissao.description)}</small>
              ${extraPorPermissao(permissao)}
            </label>
          `).join('')}
        </section>
      `).join('')}
    </div>`;

  content.innerHTML = `
    <div class="cadastro-page-head">
      <div>
        <h3>Papéis e Permissões</h3>
        <p class="muted">Cada permissão é um par recurso + ação. O administrador tem acesso total por definição.</p>
      </div>
    </div>

    <div class="sales-tabs" role="tablist">
      <button type="button" class="sales-tab ${aba === 'papeis' ? 'is-active' : ''}" data-rbac-aba="papeis">Por papel</button>
      <button type="button" class="sales-tab ${aba === 'usuarios' ? 'is-active' : ''}" data-rbac-aba="usuarios">Por usuário</button>
    </div>

    <div class="panel">
      ${aba === 'papeis' ? `
        <div class="row">
          <label>Papel
            <select id="rbacPapel">
              ${dados.roles.map((papel) => `<option value="${escapeHtml(papel.slug)}" ${papelSelecionado === papel.slug ? 'selected' : ''}>${escapeHtml(papel.name)}${papel.system ? ' (do sistema)' : ''}</option>`).join('')}
            </select>
          </label>
        </div>
        ${papelSelecionado === 'admin' ? `
          <p class="sales-totals-nota">O papel de administrador libera tudo por definição — não recebe lista de permissões.</p>
        ` : `
          <form id="rbacFormPapel">
            ${gradeDePermissoes(doPapel, 'permissao')}
            <div class="row" style="margin-top: 16px;">
              <button type="submit">Salvar permissões do papel</button>
            </div>
          </form>
        `}
      ` : `
        <div class="row">
          <label>Usuário
            <select id="rbacUsuario">
              ${dados.users.map((u) => `<option value="${escapeHtml(u.id)}" ${usuarioSelecionado === u.id ? 'selected' : ''}>${escapeHtml(u.name)} (${escapeHtml(u.username)})${u.active ? '' : ' — BLOQUEADO'}</option>`).join('')}
            </select>
          </label>
        </div>

        <form id="rbacFormUsuario">
          <h4>Papéis</h4>
          <div class="checkbox-grid">
            ${dados.roles.map((papel) => `
              <label><input type="checkbox" name="papel" value="${escapeHtml(papel.slug)}" ${papeisDoUsuario.has(papel.slug) ? 'checked' : ''} /> ${escapeHtml(papel.name)}</label>
            `).join('')}
          </div>

          <h4 style="margin-top: 18px;">Acesso</h4>
          <div class="sales-total-toggle">
            <button type="button" role="switch" aria-checked="${Boolean(usuarioAtual?.active)}" class="switch ${usuarioAtual?.active ? 'is-on' : ''}" id="rbacAtivo"><span></span></button>
            <span>Usuário ativo${usuarioAtual?.active ? '' : ' — bloqueado, não consegue entrar'}</span>
          </div>

          <h4 style="margin-top: 18px;">Exceções desta pessoa</h4>
          <p class="muted">
            Marcado = permitido. Desmarcar o que vem do papel cria uma negação explícita para
            esta pessoa — e negação vence qualquer papel, inclusive o de administrador.
          </p>
          ${gradeDePermissoes(
            new Set([...heradadas, ...extras].filter((slug) => !negadasDoUsuario.has(slug))),
            'permissaoUsuario',
            (permissao) => heradadas.has(permissao.slug) ? '<em class="rbac-origem">do papel</em>' : ''
          )}
          <div class="row" style="margin-top: 16px;">
            <button type="submit">Salvar acesso do usuário</button>
          </div>
        </form>
      `}
    </div>
  `;

  const guardar = (chave, valor) => { state.settingsDraft = { ...state.settingsDraft, [chave]: valor }; };

  content.querySelectorAll('[data-rbac-aba]').forEach((botao) => {
    botao.addEventListener('click', () => {
      guardar('accessTab', botao.dataset.rbacAba);
      loadModule('settings');
    });
  });
  document.getElementById('rbacPapel')?.addEventListener('change', (event) => {
    guardar('accessRole', event.target.value);
    loadModule('settings');
  });
  document.getElementById('rbacUsuario')?.addEventListener('change', (event) => {
    guardar('accessUser', event.target.value);
    loadModule('settings');
  });

  let ativo = Boolean(usuarioAtual?.active);
  const botaoAtivo = document.getElementById('rbacAtivo');
  botaoAtivo?.addEventListener('click', () => {
    ativo = !ativo;
    botaoAtivo.classList.toggle('is-on', ativo);
    botaoAtivo.setAttribute('aria-checked', String(ativo));
  });

  document.getElementById('rbacFormPapel')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const marcadas = Array.from(event.target.querySelectorAll('[name="permissao"]:checked')).map((el) => el.value);
    try {
      await api(`/api/access-control/roles/${encodeURIComponent(papelSelecionado)}`, {
        method: 'PUT', body: JSON.stringify({ permissions: marcadas })
      });
      showToast('Permissões do papel atualizadas.', 'success');
      loadModule('settings');
    } catch (error) {
      showToast(error.message || 'Erro ao salvar as permissões.', 'error');
    }
  });

  document.getElementById('rbacFormUsuario')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const papeis = Array.from(event.target.querySelectorAll('[name="papel"]:checked')).map((el) => el.value);
    const marcadas = new Set(Array.from(event.target.querySelectorAll('[name="permissaoUsuario"]:checked')).map((el) => el.value));

    // Só o que difere do papel vira exceção gravada. Assim, mexer no papel
    // depois continua valendo para esta pessoa em tudo que não foi excepcionado.
    const excecoes = [];
    dados.permissions.forEach((permissao) => {
      const vemDoPapel = papeis.some((papel) => dados.rolePermissions.some((rp) => rp.role_slug === papel && rp.permission_slug === permissao.slug));
      const marcada = marcadas.has(permissao.slug);
      if (marcada && !vemDoPapel) excecoes.push({ permission_slug: permissao.slug, effect: 'PERMITIR' });
      if (!marcada && vemDoPapel) excecoes.push({ permission_slug: permissao.slug, effect: 'NEGAR' });
    });

    try {
      await api(`/api/access-control/users/${encodeURIComponent(usuarioSelecionado)}`, {
        method: 'PUT', body: JSON.stringify({ roles: papeis, exceptions: excecoes, active: ativo })
      });
      showToast('Acesso do usuário atualizado.', 'success');
      loadModule('settings');
    } catch (error) {
      showToast(error.message || 'Erro ao salvar o acesso.', 'error');
    }
  });
};
