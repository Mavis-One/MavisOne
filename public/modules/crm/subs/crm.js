window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.crm = window.MavisSubscreenRegistry.crm || {};

// O CRM é uma PONTE, não um cadastro. Por decisão de projeto ele não guarda
// oportunidade nem conta aqui: quem guarda é o sistema externo. Em troca, este
// módulo depende do outro estar no ar — e é isso que a tela de Conexão existe
// para deixar claro antes de alguém procurar dados que não vão vir.
(function (C) {
  const R = window.MavisSubscreenRegistry.crm;

  R.conexao = async function renderConexao(ctx) {
    const { content, api, showToast, loadModule } = ctx;

    let conexao = { baseUrl: '', temToken: false, active: false, lastOkAt: null, lastError: null };
    try {
      const res = await api('/api/crm/connection');
      conexao = res.connection || conexao;
    } catch (error) {
      showToast(error.message || 'Não foi possível ler a conexão do CRM.', 'error');
    }

    const situacao = conexao.lastError
      ? C.badge('Com erro', 'danger')
      : conexao.lastOkAt
        ? C.badge('Respondeu', 'success')
        : C.badge('Nunca testada', 'muted');

    content.innerHTML = `
      <div class="panel cadastros-shell">
        ${C.pageHead('Conexão com o CRM externo', 'O ERP lê os dados de lá; nada de oportunidade ou conta é gravado aqui.', '', situacao)}

        <form id="crmForm" class="cadastro-form">
          ${C.section('Endereço e credencial', `
            <div class="cadastro-grid cadastro-grid-2">
              <label class="cadastro-field">
                <span>Endereço base (URL) *</span>
                <input name="baseUrl" value="${C.escape(conexao.baseUrl)}" placeholder="https://crm.suaempresa.com/api" required />
                <span class="cadastro-field-hint muted">É onde o teste de conexão bate.</span>
              </label>
              <label class="cadastro-field">
                <span>Token de acesso</span>
                <input name="apiToken" type="password" autocomplete="new-password"
                  placeholder="${conexao.temToken ? 'Token salvo — preencha só para trocar' : 'Cole o token do CRM'}" />
                <span class="cadastro-field-hint muted">${conexao.temToken
                  ? 'Já existe um token guardado. Ele nunca é devolvido para a tela — deixe em branco para mantê-lo.'
                  : 'Enviado no cabeçalho Authorization das consultas.'}</span>
              </label>
            </div>
            <label class="cadastro-check">
              <input type="checkbox" name="active" ${conexao.active ? 'checked' : ''} />
              <span>Conexão ativa</span>
            </label>
          `, 'O token é guardado no servidor e nunca volta para o navegador.')}

          ${conexao.lastError ? `<p class="form-error">Último teste falhou: ${C.escape(conexao.lastError)}</p>` : ''}
          ${conexao.lastOkAt && !conexao.lastError ? `<p class="muted">Última resposta com sucesso em ${C.formatDate(conexao.lastOkAt)}.</p>` : ''}

          <div class="cadastro-actions">
            <button type="button" class="secondary" id="crmTestar">Testar conexão</button>
            <button type="submit">Salvar conexão</button>
          </div>
        </form>
      </div>
    `;

    document.getElementById('crmForm')?.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const dados = new FormData(evento.target);
      try {
        await api('/api/crm/connection', {
          method: 'PUT',
          body: JSON.stringify({
            baseUrl: dados.get('baseUrl') || '',
            apiToken: dados.get('apiToken') || '',
            active: evento.target.querySelector('[name="active"]').checked
          })
        });
        showToast('Conexão salva.', 'success');
        loadModule('crm');
      } catch (error) {
        showToast(error.message || 'Erro ao salvar a conexão.', 'error');
      }
    });

    document.getElementById('crmTestar')?.addEventListener('click', async (evento) => {
      const botao = evento.currentTarget;
      botao.disabled = true;
      botao.textContent = 'Testando…';
      try {
        // Testa o que ESTÁ SALVO, não o que está digitado na tela: assim o
        // resultado corresponde ao que o sistema vai usar de verdade.
        const res = await api('/api/crm/test', { method: 'POST' });
        showToast(res.ok ? 'O CRM respondeu.' : (res.error || 'O CRM não respondeu.'), res.ok ? 'success' : 'error');
        loadModule('crm');
      } catch (error) {
        showToast(error.message || 'Erro ao testar.', 'error');
        botao.disabled = false;
        botao.textContent = 'Testar conexão';
      }
    });
  };

  // As duas telas de leitura só existem depois que a ponte estiver de pé, e o
  // formato do que vem de lá depende de qual CRM é. Em vez de inventar colunas
  // que podem não existir, a tela diz o que falta para ela funcionar.
  function telaDeLeitura(titulo, descricao, oQueFalta) {
    return async function render(ctx) {
      const { content, api, escapeHtml } = ctx;
      let conexao = { baseUrl: '', active: false, lastOkAt: null };
      try {
        conexao = (await api('/api/crm/connection')).connection || conexao;
      } catch (_) { /* segue com a conexão vazia */ }

      const pronta = Boolean(conexao.baseUrl && conexao.active && conexao.lastOkAt);
      content.innerHTML = `
        <div class="panel workspace-pendente">
          <h3>${escapeHtml(titulo)}</h3>
          <p class="muted">${escapeHtml(descricao)}</p>
          ${pronta
            ? `<p>A conexão com <strong>${escapeHtml(conexao.baseUrl)}</strong> está ativa e respondeu.
               Falta só definir de qual caminho do CRM ${escapeHtml(oQueFalta)} vêm e quais campos exibir —
               isso muda conforme o CRM, então precisa da documentação dele.</p>`
            : `<p>Esta tela lê ${escapeHtml(oQueFalta)} do CRM externo, e a ponte ainda não está de pé.
               Configure e teste em <strong>CRM &gt; Conexão</strong>.</p>`}
        </div>
      `;
    };
  }

  R.oportunidades = telaDeLeitura(
    'Oportunidades',
    'Funil de vendas — lido do CRM externo, não gravado aqui.',
    'as oportunidades'
  );
  R.contas = telaDeLeitura(
    'Contas',
    'Clientes e prospects — lidos do CRM externo, não gravados aqui.',
    'as contas'
  );
})(window.MavisCadastros);
