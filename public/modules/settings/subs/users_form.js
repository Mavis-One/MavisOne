window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.settings = window.MavisSubscreenRegistry.settings || {};

// Módulos que um usuário pode receber acesso. Módulo novo tem que entrar aqui,
// senão ele existe no menu mas nenhum admin consegue liberá-lo para ninguém.
const SETTINGS_USER_MODULES = [
  'dashboard', 'sales', 'purchases', 'stock', 'finance', 'fiscal', 'reports',
  'fleet', 'crm', 'hr', 'pcp', 'contracts', 'cadastros', 'settings'
];

// A lista mora em modules/shared/fiscal_permissoes.js, que o server.js também
// carrega. Enquanto ela vivia aqui, a tela oferecia 15 permissões e o portão do
// servidor só sabia exigir 10 — as outras 5 podiam ser marcadas e salvas sem
// controlar nada. Duas listas para a mesma decisão divergem na primeira
// alteração feita de um lado.
const SETTINGS_FISCAL_PERMISSIONS = window.MavisFiscalPermissoes.CATALOGO;

// A FICHA DO USUÁRIO, NO LAYOUT DO VIPER (fase DR)
// ------------------------------------------------
// Editar uma pessoa era abrir duas telas: aqui ficavam nome, senha, módulos e
// vínculos; o papel, as exceções de permissão e o "ativo" ficavam em Papéis e
// Permissões. Agora é uma ficha só, em abas, como a do Viper:
//
//   Dados Básicos         quem é, tipo, senha, ativo, empresas
//   Restrições de Acesso  módulos e as telas de cada um
//   Permissões            permissões fiscais e as exceções ao papel
//
// As abas do Viper que falam de PDV, comissão e PDV offline não entraram: são
// módulos que este sistema não tem (comissão está fora por decisão).
//
// LIBERAR MÓDULO DEIXOU DE SER TUDO OU NADA (fase AN)
// ---------------------------------------------------
// Cada módulo marcado abre a lista das telas dele. O que é gravado é a lista
// das telas DESMARCADAS (ver a migração fase-an): módulo liberado continua
// trazendo tudo, inclusive as telas que nascerem depois, menos o que alguém
// tirou de propósito.
//
// ISTO É NAVEGAÇÃO, NÃO É A TRANCA. Esconder a tela tira o convite; as rotas do
// módulo continuam abertas para quem souber chamá-las. Quem barra de verdade é
// o portão do servidor, que enxerga módulo e AÇÃO (a aba Permissões).
//
// Cadastro e edição de usuário são o mesmo formulário — só muda se o Login pode
// ser editado e se a Senha é obrigatória ou opcional.
const ABAS_DA_FICHA_DE_USUARIO = [
  { key: 'dados', label: 'Dados Básicos' },
  { key: 'restricoes', label: 'Restrições de Acesso' },
  { key: 'permissoes', label: 'Permissões' }
];

async function renderSettingsUserForm(ctx, mode) {
  const { content, data, api, showToast, loadModule, moduleLabels, state, escapeHtml } = ctx;
  const vendedores = data?.sellers || [];
  // Fase CD: de qual estabelecimento a pessoa e'. Vazio e' uma escolha
  // legitima — quem nao tem vinculo nao tem conta filtrada, que e' como o
  // sistema inteiro funcionava antes desta fase.
  const estabelecimentos = data?.estabelecimentos || [];
  // "(matriz)" só quando o nome já não diz: o cadastro da matriz costuma vir
  // como "... LTDA (MATRIZ)", e a grade mostrava as duas.
  const nomeDoEstab = (e) => {
    const nome = e.nomeFantasia || e.razaoSocial || 'Sem nome';
    return String(e.tipo || '').toUpperCase() === 'MATRIZ' && !/matriz/i.test(nome) ? `${nome} (matriz)` : nome;
  };
  const isEditing = mode === 'edit';
  const editUser = isEditing ? state.settingsDraft?.editUser : null;
  // Quando se está CRIANDO a partir de "Duplicar", este é o usuário de origem:
  // ele preenche os acessos, e só os acessos. Ver o botão em users.js.
  const copiaDe = !isEditing ? state.settingsDraft?.copiarDe : null;
  const modelo = editUser || copiaDe;
  const ehOProprio = isEditing && editUser?.id === state.user?.id;

  if (isEditing && !editUser) {
    // Chegou direto nessa tela sem passar por "editar" na lista (ex.: refresh) — volta pra lista.
    state.activeSub = 'users';
    loadModule('settings');
    return;
  }

  // Telas bloqueadas em edição, na cópia inteira. O clone é para que fechar o
  // formulário sem salvar não deixe a alteração pendurada no objeto do estado.
  let telasBloqueadas = JSON.parse(JSON.stringify(modelo?.blockedSubs || {}));

  // PAPÉIS E EXCEÇÕES. Vêm do controle de acesso; sem as tabelas dele
  // (migração pendente) a ficha cai no modelo antigo: Administrador ou Usuário
  // pela coluna `role`, e a aba Permissões fica só com as fiscais.
  let rbac = null;
  try {
    rbac = await api('/api/access-control');
  } catch (erro) {
    rbac = null;
  }
  const comRbac = Boolean(rbac && rbac.disponivel && (rbac.roles || []).length && (rbac.permissions || []).length);
  const papeisDisponiveis = comRbac
    ? rbac.roles
    : [{ slug: 'admin', name: 'Administrador', level: 100 }, { slug: 'usuario', name: 'Usuário', level: 10 }];
  const nivelDoPapel = (slug) => (papeisDisponiveis.find((p) => p.slug === slug) || {}).level || 0;
  const acessoDoModelo = (comRbac && modelo && rbac.userAccess[modelo.id]) || { roles: [], permitidas: [], negadas: [] };
  const papeisIniciais = acessoDoModelo.roles.length ? acessoDoModelo.roles : [modelo?.role === 'admin' ? 'admin' : 'usuario'];
  // O Tipo de Usuário é UM papel. Quem tem mais de um (admin + gerente, por
  // exemplo) aparece pelo mais alto, e a lista inteira só é trocada se o tipo
  // for trocado — abrir e salvar a ficha não pode apagar um papel.
  const tipoInicial = [...papeisIniciais].sort((a, b) => nivelDoPapel(b) - nivelDoPapel(a))[0] || 'usuario';
  const permissoesDosPapeis = (slugs) => new Set(
    (comRbac ? rbac.rolePermissions : []).filter((rp) => slugs.includes(rp.role_slug)).map((rp) => rp.permission_slug)
  );
  // Exceção = o que difere do papel. Guardar só a diferença é o que deixa uma
  // mudança no papel continuar valendo para esta pessoa em todo o resto.
  const excecoes = new Map();
  if (comRbac && modelo) {
    const doPapel = permissoesDosPapeis(papeisIniciais);
    acessoDoModelo.permitidas.filter((slug) => !doPapel.has(slug)).forEach((slug) => excecoes.set(slug, 'PERMITIR'));
    acessoDoModelo.negadas.forEach((slug) => excecoes.set(slug, 'NEGAR'));
  }

  // EMPRESAS DO USUÁRIO (fase DR). O principal entra preenchido no lançamento;
  // as chaves dizem por quais outros a pessoa pode lançar; "Todas" é o antigo
  // "pode lançar por outro estabelecimento", que inclui filial cadastrada
  // depois. Empresas são acesso, então a cópia leva — o principal não, porque
  // diz onde a pessoa está.
  const liberados = new Set(modelo?.estabelecimentosLiberados || []);
  let todasAsEmpresas = modelo?.podeTrocarEstabelecimento === true;

  const goBack = () => {
    state.settingsDraft = { ...state.settingsDraft, editUser: null, copiarDe: null };
    state.activeSub = 'users';
    loadModule('settings');
  };

  const campo = (rotulo, controle, extra = '') => `
    <label class="cadastro-field ${extra}"><span>${rotulo}</span>${controle}</label>`;
  const chave = (input, rotulo, titulo = '') => `
    <label class="usuario-chave" ${titulo ? `title="${escapeHtml(titulo)}"` : ''}>${input}<span>${rotulo}</span></label>`;
  const secao = (titulo, corpo, { id = '', direita = '', escondida = false } = {}) => `
    <section class="cadastro-section" ${id ? `id="${id}"` : ''} ${escondida ? 'hidden' : ''}>
      <div class="cadastro-section-header usuario-secao-topo"><h4>${titulo}</h4>${direita}</div>
      <div class="cadastro-section-body">${corpo}</div>
    </section>`;

  const titulo = isEditing ? 'Editar Usuário' : 'Novo Usuário';
  content.innerHTML = `
    <div class="panel cadastros-shell usuario-ficha">
      <div class="cadastro-page-head">
        <div>
          <h3>${titulo}</h3>
          ${copiaDe ? `<p class="muted">Acessos copiados de ${escapeHtml(copiaDe.name)}</p>` : ''}
        </div>
        ${isEditing ? `<div class="cadastro-page-chip">${escapeHtml(editUser.username)}</div>` : ''}
      </div>

      <form id="userFormPage" class="cadastro-form" novalidate>
        <div class="cadastro-tabs" role="tablist">
          ${ABAS_DA_FICHA_DE_USUARIO.map((aba, i) => `
            <button type="button" class="cadastro-tab ${i === 0 ? 'active' : ''}" data-tab="${aba.key}" role="tab" aria-selected="${i === 0}">
              <span>${aba.label}</span>
              <svg class="cadastro-tab-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
          `).join('')}
        </div>

        <div class="cadastro-tab-panel" data-tab-panel="dados">
          <div class="cadastro-grid cadastro-grid-2">
            ${campo('Nome do Usuário *', `<input name="name" maxlength="120" value="${escapeHtml(editUser?.name || '')}" />`)}
            ${campo('Tipo de Usuário', `
              <select name="tipo">
                ${papeisDisponiveis.map((p) => `<option value="${escapeHtml(p.slug)}" ${p.slug === tipoInicial ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
              </select>`)}
            ${campo('Login *', `<input name="username" autocomplete="off" value="${escapeHtml(editUser?.username || '')}" ${isEditing ? 'disabled' : ''} />`)}
            ${campo(isEditing ? 'Nova Senha' : 'Senha *', '<input name="password" type="password" autocomplete="new-password" />')}
            ${campo(isEditing ? 'Repita a Nova Senha' : 'Repita a Senha *', '<input name="passwordConfirm" type="password" autocomplete="new-password" />')}
            <!-- O vínculo com o vendedor do Cadastros. É ele que decide quais
                 vendas esta pessoa vê no Relatório de Vendas — sem vínculo, e não
                 sendo admin, ela não vê venda nenhuma. E é dele que o Meu Painel
                 tira "o que EU vendi", para admin inclusive. A cópia NÃO leva:
                 ele diz quem a pessoa é, não o que ela pode. Ver
                 lib/relatorios-escopo.js. -->
            ${campo('Vendedor vinculado', `
              <select name="sellerId">
                <option value="">Nenhum</option>
                ${vendedores.map((v) => `<option value="${escapeHtml(v.id)}" ${v.id === editUser?.sellerId ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}
              </select>`)}
          </div>

          ${chave(`<input type="checkbox" name="active" ${editUser?.active === false ? '' : 'checked'} ${ehOProprio ? 'disabled' : ''} />`, 'Ativo')}

          ${estabelecimentos.length ? `
          <!-- FASE CD — O ESTABELECIMENTO DA PESSOA. É o que entra preenchido
               no lançamento financeiro e o que filtra a lista de contas
               bancárias. Sem vínculo, nada é filtrado. A regra de quais contas
               cada estabelecimento usa está em Configurações › Contas por
               Estabelecimento. -->
          <div class="cadastro-grid cadastro-grid-2">
            ${campo('Estabelecimento principal', `
              <select name="estabelecimentoId">
                <option value="">Nenhum</option>
                ${estabelecimentos.map((e) => `<option value="${escapeHtml(e.id)}" ${e.id === editUser?.estabelecimentoId ? 'selected' : ''}>${escapeHtml(nomeDoEstab(e))}</option>`).join('')}
              </select>`)}
          </div>
          ${secao('Empresas do Usuário', '<div class="usuario-chaves" id="usuarioEmpresas"></div>', {
            direita: chave('<input type="checkbox" name="podeTrocarEstabelecimento" />', 'Todas')
          })}` : ''}
        </div>

        <div class="cadastro-tab-panel" data-tab-panel="restricoes" hidden>
          ${secao('Módulos', `
            <div class="usuario-chaves">
              ${SETTINGS_USER_MODULES.map((module) => chave(
                `<input type="checkbox" name="module" class="user-form-module" value="${module}" ${(modelo?.allowedModules || []).includes(module) ? 'checked' : ''} />`,
                escapeHtml(moduleLabels[module] || module)
              )).join('')}
            </div>`)}
          <div id="telasPorModulo"></div>
        </div>

        <div class="cadastro-tab-panel" data-tab-panel="permissoes" hidden>
          ${secao('Permissões fiscais', `
            <div class="usuario-chaves">
              ${SETTINGS_FISCAL_PERMISSIONS.map((perm) => chave(
                `<input type="checkbox" name="fiscalPermission" value="${perm.value}" ${(modelo?.fiscalPermissions || []).includes(perm.value) ? 'checked' : ''} />`,
                perm.label,
                perm.descricao || ''
              )).join('')}
            </div>`, { id: 'fiscalPermissionsSection', escondida: true })}
          <div id="usuarioPermissoes"></div>
        </div>

        <div class="cadastro-actions">
          <button type="button" class="secondary" id="userFormCancel">Cancelar</button>
          <button type="submit">${isEditing ? 'Salvar alterações' : 'Criar usuário'}</button>
        </div>
      </form>
    </div>
  `;

  const form = document.getElementById('userFormPage');
  const tipoAtual = () => form.querySelector('[name="tipo"]').value;
  // O papel que vai ser gravado: a lista original enquanto o tipo não mudar.
  const papeisPedidos = () => (tipoAtual() === tipoInicial ? papeisIniciais : [tipoAtual()]);

  function abrirAba(chaveDaAba) {
    form.querySelectorAll('.cadastro-tab').forEach((botao) => {
      const alvo = botao.dataset.tab === chaveDaAba;
      botao.classList.toggle('active', alvo);
      botao.setAttribute('aria-selected', String(alvo));
    });
    form.querySelectorAll('.cadastro-tab-panel').forEach((painel) => {
      painel.hidden = painel.dataset.tabPanel !== chaveDaAba;
    });
  }
  form.querySelectorAll('.cadastro-tab').forEach((botao) => botao.addEventListener('click', () => abrirAba(botao.dataset.tab)));

  // ---------------------------------------------------------------- empresas
  function pintarEmpresas() {
    const caixa = document.getElementById('usuarioEmpresas');
    if (!caixa) return;
    // Administrador lança por qualquer estabelecimento por definição (ver
    // podeTrocarDeEstabelecimento no server.js): as chaves dele aparecem todas
    // ligadas e travadas, e o que estava gravado fica como está.
    const admin = tipoAtual() === 'admin';
    const todas = form.querySelector('[name="podeTrocarEstabelecimento"]');
    todas.checked = admin || todasAsEmpresas;
    todas.disabled = admin;
    const principal = form.querySelector('[name="estabelecimentoId"]').value;
    caixa.innerHTML = estabelecimentos.map((e) => {
      const fixa = admin || todasAsEmpresas || e.id === principal;
      return chave(
        `<input type="checkbox" class="usuario-empresa" value="${escapeHtml(e.id)}" ${fixa || liberados.has(e.id) ? 'checked' : ''} ${fixa ? 'disabled' : ''} />`,
        escapeHtml(nomeDoEstab(e))
      );
    }).join('');
    caixa.querySelectorAll('.usuario-empresa').forEach((el) => el.addEventListener('change', () => {
      if (el.checked) liberados.add(el.value); else liberados.delete(el.value);
    }));
  }
  form.querySelector('[name="podeTrocarEstabelecimento"]')?.addEventListener('change', (evento) => {
    todasAsEmpresas = evento.target.checked;
    pintarEmpresas();
  });
  form.querySelector('[name="estabelecimentoId"]')?.addEventListener('change', pintarEmpresas);

  // ------------------------------------------------------- telas por módulo
  // As telas de cada módulo, do catálogo do app.js. `somenteAdmin` fica de fora:
  // são telas que usuário comum nunca vê, e oferecê-las aqui daria a entender
  // que dá para liberá-las marcando a caixa.
  function telasDoModulo(modulo) {
    if (typeof moduleSubItems === 'undefined') return [];
    return (moduleSubItems[modulo] || []).filter((tela) => !tela.somenteAdmin);
  }

  function modulosMarcados() {
    return Array.from(form.querySelectorAll('.user-form-module:checked')).map((el) => el.value);
  }

  function modulosSemAcesso() {
    const marcados = modulosMarcados();
    return Object.keys(telasBloqueadas).filter((modulo) => !marcados.includes(modulo));
  }

  function atualizarContagem(modulo) {
    const alvo = form.querySelector(`[data-contagem="${modulo}"]`);
    if (!alvo) return;
    const telas = telasDoModulo(modulo);
    const bloqueadas = telasBloqueadas[modulo] || [];
    alvo.textContent = `${telas.length - bloqueadas.length} de ${telas.length} telas`;
  }

  function pintarTelasPorModulo() {
    const caixa = document.getElementById('telasPorModulo');
    if (!caixa) return;

    // Admin enxerga tudo por definição (ver telasVisiveis() no app.js), então
    // oferecer o recorte aqui seria um controle que não controla nada.
    if (tipoAtual() === 'admin') {
      caixa.innerHTML = secao('Telas liberadas', '<p class="muted">Administrador vê todas as telas dos módulos marcados.</p>');
      return;
    }

    // Módulo de uma tela só não tem o que recortar: ou a pessoa tem o módulo,
    // ou não tem.
    const modulos = modulosMarcados().filter((m) => telasDoModulo(m).length > 1);
    if (!modulos.length) {
      caixa.innerHTML = '';
      return;
    }

    caixa.innerHTML = secao('Telas liberadas', modulos.map((modulo) => {
      const telas = telasDoModulo(modulo);
      const bloqueadas = telasBloqueadas[modulo] || [];
      const visiveis = telas.length - telas.filter((t) => bloqueadas.includes(t.key)).length;
      return `
        <details class="telas-modulo" ${visiveis < telas.length ? 'open' : ''}>
          <summary>
            ${escapeHtml(moduleLabels[modulo] || modulo)}
            <span class="muted" data-contagem="${escapeHtml(modulo)}">${visiveis} de ${telas.length} telas</span>
          </summary>
          <div class="telas-modulo-acoes">
            <button type="button" class="secondary telas-todas" data-modulo="${escapeHtml(modulo)}">Marcar todas</button>
            <button type="button" class="secondary telas-nenhuma" data-modulo="${escapeHtml(modulo)}">Desmarcar todas</button>
          </div>
          <div class="usuario-chaves">
            ${telas.map((tela) => chave(
              `<input type="checkbox" class="tela-do-modulo" data-modulo="${escapeHtml(modulo)}" value="${escapeHtml(tela.key)}" ${bloqueadas.includes(tela.key) ? '' : 'checked'} />`,
              escapeHtml(tela.label),
              tela.desc || ''
            )).join('')}
          </div>
        </details>
      `;
    }).join(''));

    caixa.querySelectorAll('.tela-do-modulo').forEach((el) => el.addEventListener('change', () => {
      const modulo = el.dataset.modulo;
      const bloqueadas = new Set(telasBloqueadas[modulo] || []);
      if (el.checked) bloqueadas.delete(el.value); else bloqueadas.add(el.value);
      // Lista vazia é o mesmo que módulo ausente ("vê todas"); guardar a chave
      // vazia daria dois jeitos de dizer a mesma coisa. O servidor limpa igual,
      // mas deixar a tela mandar sujeira e confiar na limpeza do outro lado é
      // exatamente como os dois lados divergem.
      if (bloqueadas.size) telasBloqueadas[modulo] = [...bloqueadas];
      else delete telasBloqueadas[modulo];
      atualizarContagem(modulo);
    }));

    caixa.querySelectorAll('.telas-todas').forEach((btn) => btn.addEventListener('click', () => {
      delete telasBloqueadas[btn.dataset.modulo];
      pintarTelasPorModulo();
    }));
    caixa.querySelectorAll('.telas-nenhuma').forEach((btn) => btn.addEventListener('click', () => {
      telasBloqueadas[btn.dataset.modulo] = telasDoModulo(btn.dataset.modulo).map((t) => t.key);
      pintarTelasPorModulo();
    }));
  }

  // ------------------------------------------------------------- permissões
  // O nome do módulo é o que o admin reconhece; o slug fica junto, discreto,
  // porque é ele que aparece na Auditoria de Acesso. Mesma grade de Papéis e
  // Permissões, na mesma ordem do menu.
  const NOME_FORA_DO_MENU = { usuarios: 'Usuários e acessos', auditoria: 'Auditoria de acesso' };
  const ORDEM_RECURSOS = [...(typeof MENU_MODULOS !== 'undefined' ? MENU_MODULOS : []), 'settings', 'usuarios', 'auditoria'];
  const ORDEM_ACOES = ['ler', 'visualizar', 'criar', 'editar', 'excluir', 'gerenciar'];
  const posicao = (lista, valor) => (lista.indexOf(valor) === -1 ? lista.length : lista.indexOf(valor));
  const recursosOrdenados = comRbac
    ? Object.entries(rbac.permissions.reduce((mapa, permissao) => {
      (mapa[permissao.resource] = mapa[permissao.resource] || []).push(permissao);
      return mapa;
    }, {}))
      .sort(([a], [b]) => posicao(ORDEM_RECURSOS, a) - posicao(ORDEM_RECURSOS, b) || a.localeCompare(b))
      .map(([recurso, lista]) => [recurso, [...lista].sort((x, y) => posicao(ORDEM_ACOES, x.action) - posicao(ORDEM_ACOES, y.action) || x.action.localeCompare(y.action))])
    : [];

  function pintarPermissoes() {
    const caixa = document.getElementById('usuarioPermissoes');
    if (!caixa || !comRbac) return;
    if (tipoAtual() === 'admin') {
      caixa.innerHTML = secao('Permissões', '<p class="muted">Administrador: acesso total.</p>');
      return;
    }
    const doPapel = permissoesDosPapeis(papeisPedidos());
    caixa.innerHTML = secao('Permissões', `
      <div class="rbac-recursos">
        ${recursosOrdenados.map(([recurso, lista]) => `
          <section class="rbac-recurso">
            <h4>${escapeHtml((typeof moduleLabels !== 'undefined' && moduleLabels[recurso]) || NOME_FORA_DO_MENU[recurso] || recurso)} <small class="rbac-recurso-slug">${escapeHtml(recurso)}</small></h4>
            ${lista.map((permissao) => {
              const excecao = excecoes.get(permissao.slug);
              const marcada = excecao ? excecao === 'PERMITIR' : doPapel.has(permissao.slug);
              return `
                <label class="rbac-permissao">
                  <input type="checkbox" class="usuario-permissao" value="${escapeHtml(permissao.slug)}" ${marcada ? 'checked' : ''} />
                  <span>${escapeHtml(permissao.action)}</span>
                  ${doPapel.has(permissao.slug) ? '<em class="rbac-origem">do papel</em>' : ''}
                  <small>${escapeHtml(permissao.description)}</small>
                </label>`;
            }).join('')}
          </section>
        `).join('')}
      </div>`);
    caixa.querySelectorAll('.usuario-permissao').forEach((el) => el.addEventListener('change', () => {
      // Marcar o que o papel já dá (ou desmarcar o que ele não dá) não é
      // exceção: some do mapa em vez de virar uma linha redundante.
      if (el.checked === doPapel.has(el.value)) excecoes.delete(el.value);
      else excecoes.set(el.value, el.checked ? 'PERMITIR' : 'NEGAR');
    }));
  }

  function atualizarVisibilidadePermissoesFiscais() {
    const marcados = modulosMarcados();
    const secaoFiscal = document.getElementById('fiscalPermissionsSection');
    if (secaoFiscal) secaoFiscal.hidden = !window.MavisFiscalPermissoes.habilitadoPor(marcados);
  }

  form.querySelectorAll('.user-form-module').forEach((el) => el.addEventListener('change', () => {
    atualizarVisibilidadePermissoesFiscais();
    // Desmarcar o módulo apaga o recorte dele: guardar telas bloqueadas de um
    // módulo que a pessoa nem tem deixaria o bloqueio pendurado, invisível,
    // para voltar sozinho no dia em que alguém remarcasse o módulo.
    modulosSemAcesso().forEach((modulo) => delete telasBloqueadas[modulo]);
    pintarTelasPorModulo();
  }));
  form.querySelector('[name="tipo"]').addEventListener('change', () => {
    pintarTelasPorModulo();
    pintarPermissoes();
    pintarEmpresas();
  });
  atualizarVisibilidadePermissoesFiscais();
  pintarTelasPorModulo();
  pintarPermissoes();
  pintarEmpresas();

  document.getElementById('userFormCancel')?.addEventListener('click', goBack);

  // O formulário é novalidate porque o `required` do navegador não sabe abrir
  // a aba: com o Nome vazio e a pessoa em Permissões, o Salvar simplesmente
  // não fazia nada. A conferência é esta, e ela leva até o campo.
  function recusar(nome, mensagem) {
    abrirAba('dados');
    const input = form.querySelector(`[name="${nome}"]`);
    input?.closest('.cadastro-field')?.classList.add('cadastro-field-invalid');
    input?.focus();
    showToast(mensagem, 'error');
  }
  form.querySelectorAll('.cadastro-field input').forEach((input) => input.addEventListener('input', () => {
    input.closest('.cadastro-field')?.classList.remove('cadastro-field-invalid');
  }));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const password = formData.get('password') || '';
    const name = String(formData.get('name') || '').trim();

    if (!name) return recusar('name', 'Informe o nome do usuário.');
    if (!isEditing && !String(formData.get('username') || '').trim()) return recusar('username', 'Informe o login.');
    if (!isEditing && !password) return recusar('password', 'Informe a senha.');
    if (password !== (formData.get('passwordConfirm') || '')) return recusar('passwordConfirm', 'As senhas não conferem.');

    const tipo = tipoAtual();
    const principal = formData.get('estabelecimentoId') || '';
    const campos = {
      name,
      role: tipo === 'admin' ? 'admin' : 'user',
      allowedModules: formData.getAll('module'),
      fiscalPermissions: formData.getAll('fiscalPermission'),
      sellerId: formData.get('sellerId') || '',
      estabelecimentoId: principal,
      podeTrocarEstabelecimento: todasAsEmpresas,
      estabelecimentosLiberados: [...liberados].filter((id) => id !== principal),
      blockedSubs: telasBloqueadas,
      // O próprio usuário vem com a chave travada (e o disabled some do
      // FormData): não mandar é o que mantém o "ativo" dele como está.
      ...(ehOProprio ? {} : { active: formData.get('active') === 'on' })
    };
    if (comRbac) {
      const doPapel = permissoesDosPapeis(papeisPedidos());
      campos.roles = papeisPedidos();
      campos.exceptions = [...excecoes]
        .filter(([slug, efeito]) => (efeito === 'PERMITIR') !== doPapel.has(slug))
        .map(([slug, efeito]) => ({ permission_slug: slug, effect: efeito }));
    }

    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
      if (isEditing) {
        await api(`/api/users/${encodeURIComponent(editUser.id)}`, {
          method: 'PUT',
          body: JSON.stringify({ ...campos, password: password || undefined })
        });
        showToast('Usuário atualizado com sucesso.', 'success');
      } else {
        await api('/api/settings', {
          method: 'POST',
          body: JSON.stringify({
            type: 'user',
            payload: { ...campos, username: formData.get('username'), password }
          })
        });
        showToast('Usuário criado com sucesso.', 'success');
      }
      goBack();
    } catch (error) {
      botao.disabled = false;
      showToast(error.message || `Erro ao ${isEditing ? 'atualizar' : 'criar'} usuário.`, 'error');
    }
  });
}

window.MavisSubscreenRegistry.settings.users_register = async function renderSettingsUserRegister(ctx) {
  await renderSettingsUserForm(ctx, 'register');
};

window.MavisSubscreenRegistry.settings.users_edit = async function renderSettingsUserEdit(ctx) {
  await renderSettingsUserForm(ctx, 'edit');
};
