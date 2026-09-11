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

// LIBERAR MÓDULO DEIXOU DE SER TUDO OU NADA (fase AN)
// ---------------------------------------------------
// Marcar "Vendas" dava as 9 telas de Vendas. Quem precisasse liberar o
// lançamento de pedido sem liberar o Relatório escolhia entre dar tudo ou negar
// tudo — e na prática dava tudo, porque negar impedia a pessoa de trabalhar.
//
// Agora cada módulo marcado abre a lista das telas dele. O que é gravado é a
// lista das telas DESMARCADAS (ver a migração fase-an): módulo liberado
// continua trazendo tudo, inclusive as telas que nascerem depois, menos o que
// alguém tirou de propósito.
//
// ISTO É NAVEGAÇÃO, NÃO É A TRANCA. Esconder a tela tira o convite; as rotas do
// módulo continuam abertas para quem souber chamá-las. Quem barra de verdade é
// o portão do servidor, que enxerga módulo e AÇÃO (Papéis e Permissões).
//
// Cadastro e edição de usuário são o mesmo formulário — só muda se o "Usuário"
// (login) pode ser editado e se a Senha é obrigatória ou opcional.
function renderSettingsUserForm(ctx, mode) {
  const { content, data, api, showToast, loadModule, moduleLabels, state, escapeHtml } = ctx;
  const vendedores = data?.sellers || [];
  // Fase CD: de qual estabelecimento a pessoa e'. Vazio e' uma escolha
  // legitima — quem nao tem vinculo nao tem conta filtrada, que e' como o
  // sistema inteiro funcionava antes desta fase.
  const estabelecimentos = data?.estabelecimentos || [];
  const nomeDoEstab = (e) => {
    const nome = e.nomeFantasia || e.razaoSocial || 'Sem nome';
    return String(e.tipo || '').toUpperCase() === 'MATRIZ' ? `${nome} (matriz)` : nome;
  };
  const isEditing = mode === 'edit';
  const editUser = isEditing ? state.settingsDraft?.editUser : null;
  // Quando se está CRIANDO a partir de "Duplicar", este é o usuário de origem:
  // ele preenche os acessos, e só os acessos. Ver o botão em users.js.
  const copiaDe = !isEditing ? state.settingsDraft?.copiarDe : null;
  const modelo = editUser || copiaDe;

  // Telas bloqueadas em edição, na cópia inteira. O clone é para que fechar o
  // formulário sem salvar não deixe a alteração pendurada no objeto do estado.
  let telasBloqueadas = JSON.parse(JSON.stringify(modelo?.blockedSubs || {}));

  if (isEditing && !editUser) {
    // Chegou direto nessa tela sem passar por "editar" na lista (ex.: refresh) — volta pra lista.
    state.activeSub = 'users';
    loadModule('settings');
    return;
  }

  const goBack = () => {
    state.settingsDraft = { ...state.settingsDraft, editUser: null, copiarDe: null };
    state.activeSub = 'users';
    loadModule('settings');
  };

  content.innerHTML = `
    <div class="cadastro-page-head">
      <div>
        <h3>${isEditing ? `Editar usuário — ${escapeHtml(editUser.name)}` : (copiaDe ? `Novo usuário — copiando os acessos de ${escapeHtml(copiaDe.name)}` : 'Novo usuário')}</h3>
        <p class="muted">${isEditing
          ? 'O usuário de login não pode ser alterado.'
          // O vínculo com vendedor NÃO é copiado, e dizer isso aqui é mais
          // barato do que descobrir depois: ele responde "quem esta pessoa é"
          // no Meu Painel, não "o que ela pode". Dois usuários apontando para o
          // mesmo vendedor veriam as vendas um do outro como suas.
          : (copiaDe
            ? 'Módulos, telas, função e permissões fiscais vieram prontos. Falta o nome, o login e a senha — e o vínculo com vendedor, que não é copiado porque diz quem a pessoa é, não o que ela pode.'
            : 'Preencha os dados e os módulos liberados para o novo usuário.')}</p>
      </div>
    </div>

    <div class="panel">
      <form id="userFormPage" class="form-grid">
        <div class="row">
          <label>Nome<input name="name" required value="${escapeHtml(editUser?.name || '')}" /></label>
          <label>Usuário<input name="username" required value="${escapeHtml(editUser?.username || '')}" ${isEditing ? 'disabled' : ''} /></label>
          <label>Senha${isEditing ? ' (deixe em branco para manter a atual)' : ''}<input name="password" type="password" ${isEditing ? '' : 'required'} /></label>
        </div>
        <div class="row">
          <label>Função
            <select name="role">
              <option value="user" ${(modelo?.role || 'user') === 'user' ? 'selected' : ''}>Usuário</option>
              <option value="admin" ${modelo?.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
          </label>
          <!-- O vínculo com o vendedor do Cadastros. É ele que decide quais
               vendas esta pessoa vê no Relatório de Vendas — sem vínculo, e não
               sendo admin, ela não vê venda nenhuma. E é dele que o Meu Painel
               tira "o que EU vendi", para admin inclusive. Ver
               lib/relatorios-escopo.js. -->
          <label>Vendedor vinculado
            <select name="sellerId">
              <option value="">Nenhum — não vê vendas nos relatórios</option>
              ${vendedores.map((v) => `<option value="${escapeHtml(v.id)}" ${v.id === editUser?.sellerId ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}
            </select>
          </label>
        </div>

        ${estabelecimentos.length ? `
        <!-- FASE CD — O ESTABELECIMENTO DA PESSOA.
             É o que entra preenchido no lançamento financeiro e o que filtra a
             lista de contas bancárias. Sem vínculo, nada é filtrado: é o
             comportamento anterior a esta fase, e não um bloqueio silencioso.
             A regra de quais contas cada estabelecimento pode usar está em
             Configurações › Contas por Estabelecimento. -->
        <div class="row">
          <label>Estabelecimento
            <select name="estabelecimentoId">
              <option value="">Nenhum — não filtra contas bancárias</option>
              ${estabelecimentos.map((e) => `<option value="${escapeHtml(e.id)}" ${e.id === editUser?.estabelecimentoId ? 'selected' : ''}>${escapeHtml(nomeDoEstab(e))}</option>`).join('')}
            </select>
          </label>
          <label class="user-form-switch">
            <input type="checkbox" name="podeTrocarEstabelecimento" ${editUser?.podeTrocarEstabelecimento ? 'checked' : ''} />
            Pode lançar por outro estabelecimento
          </label>
          <label>&nbsp;
            <span class="muted">Quem administra o sistema pode sempre, independente desta caixa.</span>
          </label>
        </div>` : ''}
        <div class="checkbox-grid">
          ${SETTINGS_USER_MODULES.map((module) => `<label><input type="checkbox" name="module" class="user-form-module" value="${module}" ${(modelo?.allowedModules || []).includes(module) ? 'checked' : ''} /> ${moduleLabels[module]}</label>`).join('')}
        </div>
        <div id="telasPorModulo"></div>
        <div id="fiscalPermissionsSection" hidden>
          <h4>Permissões fiscais</h4>
          <p class="muted">Só vale se o usuário tiver acesso a Fiscal, Financeiro ou Configurações — os mesmos módulos que o servidor aceita.</p>
          <div class="checkbox-grid">
            ${SETTINGS_FISCAL_PERMISSIONS.map((perm) => `<label title="${escapeHtml(perm.descricao || '')}"><input type="checkbox" name="fiscalPermission" value="${perm.value}" ${(modelo?.fiscalPermissions || []).includes(perm.value) ? 'checked' : ''} /> ${perm.label}</label>`).join('')}
          </div>
        </div>
        <div class="row">
          <button type="submit">${isEditing ? 'Salvar alterações' : 'Criar usuário'}</button>
          <button type="button" class="secondary" id="userFormCancel">Cancelar</button>
        </div>
      </form>
    </div>
  `;

  // As telas de cada módulo, do catálogo do app.js. `somenteAdmin` fica de fora:
  // são telas que usuário comum nunca vê, e oferecê-las aqui daria a entender
  // que dá para liberá-las marcando a caixa.
  function telasDoModulo(modulo) {
    if (typeof moduleSubItems === 'undefined') return [];
    return (moduleSubItems[modulo] || []).filter((tela) => !tela.somenteAdmin);
  }

  function modulosMarcados() {
    return Array.from(document.querySelectorAll('.user-form-module:checked')).map((el) => el.value);
  }

  function modulosSemAcesso() {
    const marcados = modulosMarcados();
    return Object.keys(telasBloqueadas).filter((modulo) => !marcados.includes(modulo));
  }

  function atualizarContagem(modulo) {
    const alvo = document.querySelector(`[data-contagem="${modulo}"]`);
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
    if (document.querySelector('[name="role"]')?.value === 'admin') {
      caixa.innerHTML = '<p class="muted">Administrador vê todas as telas dos módulos marcados. O recorte por tela vale para a função "Usuário".</p>';
      return;
    }

    // Módulo de uma tela só não tem o que recortar: ou a pessoa tem o módulo,
    // ou não tem.
    const modulos = modulosMarcados().filter((m) => telasDoModulo(m).length > 1);
    if (!modulos.length) {
      caixa.innerHTML = '<p class="muted">Marque um módulo acima para escolher quais telas dele este usuário vê.</p>';
      return;
    }

    caixa.innerHTML = `
      <h4>Telas liberadas</h4>
      <p class="muted">Todas as telas vêm marcadas. Desmarque o que este usuário não deve ver — o módulo continua liberado, e tela criada depois nasce visível.</p>
      ${modulos.map((modulo) => {
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
            <div class="checkbox-grid">
              ${telas.map((tela) => `
                <label title="${escapeHtml(tela.desc || '')}">
                  <input type="checkbox" class="tela-do-modulo" data-modulo="${escapeHtml(modulo)}" value="${escapeHtml(tela.key)}" ${bloqueadas.includes(tela.key) ? '' : 'checked'} />
                  ${escapeHtml(tela.label)}
                </label>
              `).join('')}
            </div>
          </details>
        `;
      }).join('')}
    `;

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

  function atualizarVisibilidadePermissoesFiscais() {
    const marcados = Array.from(document.querySelectorAll('.user-form-module:checked')).map((el) => el.value);
    const secao = document.getElementById('fiscalPermissionsSection');
    if (secao) secao.hidden = !window.MavisFiscalPermissoes.habilitadoPor(marcados);
  }
  document.querySelectorAll('.user-form-module').forEach((el) => el.addEventListener('change', () => {
    atualizarVisibilidadePermissoesFiscais();
    // Desmarcar o módulo apaga o recorte dele: guardar telas bloqueadas de um
    // módulo que a pessoa nem tem deixaria o bloqueio pendurado, invisível,
    // para voltar sozinho no dia em que alguém remarcasse o módulo.
    modulosSemAcesso().forEach((modulo) => delete telasBloqueadas[modulo]);
    pintarTelasPorModulo();
  }));
  document.querySelector('[name="role"]')?.addEventListener('change', pintarTelasPorModulo);
  atualizarVisibilidadePermissoesFiscais();
  pintarTelasPorModulo();

  document.getElementById('userFormCancel')?.addEventListener('click', goBack);

  document.getElementById('userFormPage')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const selectedModules = formData.getAll('module');
    const selectedFiscalPermissions = formData.getAll('fiscalPermission');
    const password = formData.get('password');

    try {
      if (isEditing) {
        await api(`/api/users/${editUser.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: formData.get('name'),
            role: formData.get('role'),
            allowedModules: selectedModules,
            fiscalPermissions: selectedFiscalPermissions,
            sellerId: formData.get('sellerId') || '',
            estabelecimentoId: formData.get('estabelecimentoId') || '',
            podeTrocarEstabelecimento: formData.get('podeTrocarEstabelecimento') === 'on',
            blockedSubs: telasBloqueadas,
            password: password || undefined
          })
        });
        showToast('Usuário atualizado com sucesso.', 'success');
      } else {
        await api('/api/settings', {
          method: 'POST',
          body: JSON.stringify({
            type: 'user',
            payload: {
              name: formData.get('name'), username: formData.get('username'), password,
              role: formData.get('role'), allowedModules: selectedModules,
              fiscalPermissions: selectedFiscalPermissions,
              sellerId: formData.get('sellerId') || '',
              estabelecimentoId: formData.get('estabelecimentoId') || '',
              podeTrocarEstabelecimento: formData.get('podeTrocarEstabelecimento') === 'on',
              blockedSubs: telasBloqueadas
            }
          })
        });
        showToast('Usuário criado com sucesso.', 'success');
      }
      goBack();
    } catch (error) {
      showToast(error.message || `Erro ao ${isEditing ? 'atualizar' : 'criar'} usuário.`, 'error');
    }
  });
}

window.MavisSubscreenRegistry.settings.users_register = async function renderSettingsUserRegister(ctx) {
  renderSettingsUserForm(ctx, 'register');
};

window.MavisSubscreenRegistry.settings.users_edit = async function renderSettingsUserEdit(ctx) {
  renderSettingsUserForm(ctx, 'edit');
};
