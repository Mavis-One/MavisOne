window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.settings = window.MavisSubscreenRegistry.settings || {};

const SETTINGS_USER_MODULES = ['dashboard', 'sales', 'purchases', 'stock', 'finance', 'settings', 'cadastros'];

// Cadastro e edição de usuário são o mesmo formulário — só muda se o "Usuário"
// (login) pode ser editado e se a Senha é obrigatória ou opcional.
function renderSettingsUserForm(ctx, mode) {
  const { content, api, showToast, loadModule, moduleLabels, state, escapeHtml } = ctx;
  const isEditing = mode === 'edit';
  const editUser = isEditing ? state.settingsDraft?.editUser : null;

  if (isEditing && !editUser) {
    // Chegou direto nessa tela sem passar por "editar" na lista (ex.: refresh) — volta pra lista.
    state.activeSub = 'company';
    loadModule('settings');
    return;
  }

  const goBack = () => {
    state.settingsDraft = { ...state.settingsDraft, editUser: null };
    state.activeSub = 'company';
    loadModule('settings');
  };

  content.innerHTML = `
    <div class="cadastro-page-head">
      <div>
        <h3>${isEditing ? `Editar usuário — ${escapeHtml(editUser.name)}` : 'Novo usuário'}</h3>
        <p class="muted">${isEditing ? 'O usuário de login não pode ser alterado.' : 'Preencha os dados e os módulos liberados para o novo usuário.'}</p>
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
              <option value="user" ${(editUser?.role || 'user') === 'user' ? 'selected' : ''}>Usuário</option>
              <option value="admin" ${editUser?.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
          </label>
        </div>
        <div class="checkbox-grid">
          ${SETTINGS_USER_MODULES.map((module) => `<label><input type="checkbox" name="module" value="${module}" ${(editUser?.allowedModules || []).includes(module) ? 'checked' : ''} /> ${moduleLabels[module]}</label>`).join('')}
        </div>
        <div class="row">
          <button type="submit">${isEditing ? 'Salvar alterações' : 'Criar usuário'}</button>
          <button type="button" class="secondary" id="userFormCancel">Cancelar</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById('userFormCancel')?.addEventListener('click', goBack);

  document.getElementById('userFormPage')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const selectedModules = formData.getAll('module');
    const password = formData.get('password');

    try {
      if (isEditing) {
        await api(`/api/users/${editUser.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: formData.get('name'),
            role: formData.get('role'),
            allowedModules: selectedModules,
            password: password || undefined
          })
        });
        showToast('Usuário atualizado com sucesso.', 'success');
      } else {
        await api('/api/settings', {
          method: 'POST',
          body: JSON.stringify({
            type: 'user',
            payload: { name: formData.get('name'), username: formData.get('username'), password, role: formData.get('role'), allowedModules: selectedModules }
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
