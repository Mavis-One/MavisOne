window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.settings = window.MavisSubscreenRegistry.settings || {};

// Usuários do sistema.
//
// ESTA TELA ERA A TELA "EMPRESA"
// ------------------------------
// O arquivo inteiro era três linhas chamando o renderizador de `company`, e o
// resultado é que os dois cartões de Configurações — "Usuários" e "Empresa" —
// abriam a MESMA página: dados da empresa, integração da Focus, lista de
// usuários e auditoria, tudo junto, nos dois. Dois caminhos, um destino, e
// nenhum aviso de que era o mesmo lugar.
//
// A lista de usuários agora mora aqui, e só aqui. O que sobrou em `company` é
// o que é de fato da empresa.
window.MavisSubscreenRegistry.settings.users = async function renderSettingsUsers(ctx) {
  const { content, data, api, showToast, loadModule, state, confirmModal, escapeHtml } = ctx;

  const podeGerenciar = Boolean((data.permissions || {}).users);
  if (!podeGerenciar) {
    content.innerHTML = '<div class="panel"><p>Sem permissão para visualizar dados de usuários.</p></div>';
    return;
  }

  const usuarios = data.users || [];
  const vendedores = data.sellers || [];
  // Fase CD: para mostrar o vinculo na coluna. So' leitura aqui — quem edita e'
  // a ficha do usuario, porque a caixa "pode lancar por outro" anda junto e as
  // duas decisoes nao deviam ficar em telas diferentes.
  const estabelecimentos = data.estabelecimentos || [];
  function resumoDeEstabelecimento(user) {
    if (!user.estabelecimentoId) return '<span class="muted">Todos</span>';
    const dono = estabelecimentos.find((e) => e.id === user.estabelecimentoId);
    if (!dono) return '<span class="muted">-</span>';
    const ehMatriz = String(dono.tipo || '').toUpperCase() === 'MATRIZ';
    const nome = escapeHtml(dono.nomeFantasia || dono.razaoSocial || 'Sem nome');
    const troca = user.podeTrocarEstabelecimento
      ? '<br><span class="muted" style="font-size:11px">pode lançar por outros</span>' : '';
    return `${nome} <span class="chip-estab ${ehMatriz ? 'is-matriz' : ''}">${ehMatriz ? 'matriz' : 'filial'}</span>${troca}`;
  }

  // "Todas" é o caso normal e precisa ser reconhecível de longe: sem isto, uma
  // coluna vazia e uma coluna com recorte se parecem, e o recorte é justamente
  // o que alguém procura quando pergunta "por que fulano não vê essa tela?".
  function resumoDeTelas(user) {
    const bloqueadas = user.blockedSubs || {};
    const modulos = Object.keys(bloqueadas).filter((m) => (bloqueadas[m] || []).length);
    if (!modulos.length) return '<span class="muted">Todas</span>';
    const total = modulos.reduce((soma, m) => soma + bloqueadas[m].length, 0);
    const nomes = modulos.map((m) => escapeHtml((typeof moduleLabels !== 'undefined' && moduleLabels[m]) || m));
    return `<span title="${nomes.join(', ')}">${total} tela${total === 1 ? '' : 's'} oculta${total === 1 ? '' : 's'}</span>`;
  }

  content.innerHTML = `
    <div class="cadastro-page-head">
      <div>
        <h3>Usuários</h3>
        <p class="muted">${usuarios.length} usuário${usuarios.length === 1 ? '' : 's'} com acesso ao sistema.</p>
      </div>
      <div class="cadastro-list-actions">
        <button type="button" id="newUserBtn">+ Novo usuário</button>
      </div>
    </div>

    <div class="panel">
      <div class="table-scroll">
        <table class="table table-actions">
          <!-- O seletor de vendedor aparece TAMBÉM para administrador. Antes
               ficava escondido, com uma frase dizendo que administrador enxerga
               todas as vendas no lugar dele — e aquilo estava certo para o
               Relatório de Vendas: lá o admin é irrestrito e o vínculo não muda
               nada para ele. (Não repita a frase aqui: um check de
               test-relatorio-vendas.js garante que ela não voltou.) Deixou de bastar
               quando nasceu o Meu Painel, que pergunta outra coisa — "o que EU
               vendi" — e responde a partir deste mesmo vínculo, para admin
               inclusive. Sem o seletor, um administrador que também vende não
               teria por onde se vincular, e o painel pessoal dele ficaria vazio
               para sempre sem explicação. Ver lib/relatorios-escopo.js. -->
          <thead><tr><th>Usuário</th><th>Nome</th><th>Função</th><th>Módulos</th><th>Telas</th><th>Estabelecimento</th><th>Vendedor vinculado</th><th>Ações</th></tr></thead>
          <tbody>
            ${usuarios.length ? usuarios.map((user) => `
              <tr data-user-id="${user.id}">
                <td>${escapeHtml(user.username)}</td>
                <td>${escapeHtml(user.name)}</td>
                <td>${escapeHtml(user.role)}</td>
                <td>${escapeHtml((user.allowedModules || []).join(', '))}</td>
                <td>${resumoDeTelas(user)}</td>
                <td>${resumoDeEstabelecimento(user)}</td>
                <td>
                  <select class="user-seller" data-id="${escapeHtml(user.id)}">
                    <option value="">Nenhum</option>
                    ${vendedores.map((v) => `<option value="${escapeHtml(v.id)}" ${v.id === user.sellerId ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}
                  </select>
                  ${user.role === 'admin' ? '<div class="muted" style="margin-top:6px">Admin vê todas as vendas nos relatórios; o vínculo aqui é o que enche o Meu Painel dele.</div>' : ''}
                </td>
                <td>
                  <button class="copy-user icon-button" data-id="${user.id}" title="Duplicar acessos deste usuário" aria-label="Duplicar acessos deste usuário">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                  <button class="edit-user icon-button edit" data-id="${user.id}" title="Editar usuário" aria-label="Editar usuário">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                  </button>
                  <button class="delete-user icon-button" data-id="${user.id}" title="Excluir usuário" aria-label="Excluir usuário" ${state.user?.role !== 'admin' || state.user?.id === user.id ? 'disabled' : ''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M10 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                  </button>
                </td>
              </tr>
            `).join('') : '<tr><td colspan="8" class="muted">Nenhum usuário cadastrado.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('newUserBtn')?.addEventListener('click', () => {
    state.activeSub = 'users_register';
    loadModule('settings');
  });

  // Vínculo usuário -> vendedor. Grava na hora, sem botão Salvar: é um campo
  // só, e um formulário inteiro para uma escolha faria a pessoa achar que
  // precisa confirmar mais alguma coisa.
  document.querySelectorAll('.user-seller').forEach((select) => {
    select.addEventListener('change', async () => {
      const alvo = usuarios.find((u) => u.id === select.dataset.id);
      if (!alvo) return;
      try {
        // Manda os campos que a rota exige junto do vínculo: mandar só o
        // sellerId faria o servidor recusar por falta de nome.
        await api(`/api/users/${encodeURIComponent(alvo.id)}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: alvo.name,
            role: alvo.role,
            allowedModules: alvo.allowedModules,
            sellerId: select.value
          })
        });
        // O aviso muda conforme o papel porque a CONSEQUÊNCIA muda: tirar o
        // vínculo de um usuário comum o deixa sem ver venda nenhuma em lugar
        // nenhum; tirar o de um administrador só esvazia o Meu Painel dele,
        // porque nos relatórios ele continua irrestrito. Um aviso único
        // mentiria para um dos dois.
        showToast(select.value
          ? 'Vínculo salvo — as vendas desse vendedor passam a ser as deste usuário no Meu Painel.'
          : `Vínculo removido — o Meu Painel deste usuário fica vazio${alvo.role === 'admin' ? '.' : ', e ele deixa de ver vendas nos relatórios.'}`, 'success');
        loadModule('settings');
      } catch (error) {
        showToast(error.message || 'Erro ao salvar o vínculo.', 'error');
        loadModule('settings');
      }
    });
  });

  // DUPLICAR = copiar os ACESSOS, não a pessoa.
  //
  // Montar um usuário novo com os mesmos 14 módulos, o mesmo recorte de telas e
  // as mesmas permissões fiscais de um colega é o caso comum (entrou mais
  // alguém para o mesmo time) e era feito a dedo, item por item, sem nada que
  // dissesse se ficou igual. O que NÃO vem junto é nome, login, senha e o
  // vínculo com vendedor — os quatro campos que dizem quem a pessoa é.
  document.querySelectorAll('.copy-user').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modelo = usuarios.find((entry) => entry.id === btn.dataset.id);
      if (!modelo) return;
      state.settingsDraft = { ...state.settingsDraft, copiarDe: modelo, editUser: null };
      state.activeSub = 'users_register';
      loadModule('settings');
    });
  });

  document.querySelectorAll('.edit-user').forEach((btn) => {
    btn.addEventListener('click', () => {
      const user = usuarios.find((entry) => entry.id === btn.dataset.id);
      if (!user) return;
      state.settingsDraft = { ...state.settingsDraft, editUser: user };
      state.activeSub = 'users_edit';
      loadModule('settings');
    });
  });

  document.querySelectorAll('.delete-user').forEach((btn) => {
    btn.addEventListener('click', async () => {
      // O `disabled` do botão já barra admin excluindo a si mesmo e não-admin
      // excluindo qualquer um, mas um clique programático passaria por cima.
      if (btn.disabled) return;
      const id = btn.dataset.id;
      if (!id) return;
      const linha = btn.closest('tr');
      const username = linha?.querySelector('td')?.textContent || id;
      const confirmado = await confirmModal(`Confirma exclusão do usuário "${username}"?`);
      if (!confirmado) return;
      try {
        await api('/api/users/delete', { method: 'POST', body: JSON.stringify({ id }) });
        showToast('Usuário excluído com sucesso.', 'success');
        loadModule('settings');
      } catch (err) {
        showToast('Erro ao excluir: ' + err.message, 'error');
      }
    });
  });
};
