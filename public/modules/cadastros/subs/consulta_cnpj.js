window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.cadastros = window.MavisSubscreenRegistry.cadastros || {};

// Consulta pública de CNPJ (BrasilAPI, que espelha os dados da Receita/SEFAZ),
// com atalho para abrir o cadastro de pessoa jurídica já preenchido.
window.MavisSubscreenRegistry.cadastros.consulta_cnpj = async function renderConsultaCnpj(ctx) {
  const { content, api, showToast, state, loadModule } = ctx;
  const C = window.MavisCadastros;

  let documentValue = '';
  let result = null;
  let errorMessage = '';
  let loading = false;

  function maskCnpj(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 14);
    return digits
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }

  function infoRow(label, value) {
    return `
      <label class="cadastro-field">
        <span>${C.escape(label)}</span>
        <input value="${C.escape(value || '-')}" readonly />
      </label>
    `;
  }

  function resultPanel() {
    if (!result) return '';
    const endereco = result.endereco || {};
    const contatos = result.contatos || [];
    return `
      <div class="panel cadastros-shell">
        ${C.pageHead('Resultado da consulta', result.razaoSocial || '', `CNPJ ${maskCnpj(result.cnpj)}`)}

        ${C.section('Identificação', `
          <div class="cadastro-grid cadastro-grid-3">
            ${infoRow('Razão social', result.razaoSocial)}
            ${infoRow('Nome fantasia', result.nomeFantasia)}
            ${infoRow('Situação cadastral', result.situacaoCadastral)}
          </div>
          <div class="cadastro-grid cadastro-grid-3">
            ${infoRow('CNAE principal', result.cnaePrincipal)}
            ${infoRow('Data de abertura', C.formatDate(result.dataAbertura))}
          </div>
        `)}

        ${C.section('Endereço', `
          <div class="cadastro-grid cadastro-grid-3">
            ${infoRow('CEP', endereco.cep)}
            ${infoRow('Logradouro', endereco.logradouro)}
            ${infoRow('Número', endereco.numero)}
          </div>
          <div class="cadastro-grid cadastro-grid-3">
            ${infoRow('Complemento', endereco.complemento)}
            ${infoRow('Bairro', endereco.bairro)}
            ${infoRow('Cidade', endereco.cidade)}
          </div>
          <div class="cadastro-grid cadastro-grid-3">
            ${infoRow('UF', endereco.estado)}
          </div>
        `)}

        ${C.section('Contatos', contatos.length
          ? `<div class="cadastro-grid cadastro-grid-3">${contatos.map((contato) => infoRow(contato.type === 'email' ? 'E-mail' : 'Telefone', contato.value)).join('')}</div>`
          : '<p class="muted">Nenhum contato retornado pela consulta.</p>')}

        <div class="cadastro-actions">
          <button type="button" id="cnpjUseBtn">Cadastrar como pessoa jurídica</button>
        </div>
      </div>
    `;
  }

  function render() {
    content.innerHTML = `
      <div class="panel cadastros-shell">
        ${C.pageHead('Consulta CNPJ SEFAZ', 'Busca os dados oficiais do CNPJ e permite abrir o cadastro já preenchido.', 'Consulta')}
        <form id="cnpjConsultaForm" class="cadastro-form">
          ${C.section('CNPJ', `
            <div class="cadastro-grid cadastro-grid-3 cadastro-align-bottom">
              <label class="cadastro-field">
                <span>CNPJ</span>
                <input name="document" id="cnpjInput" value="${C.escape(documentValue)}" inputmode="numeric" maxlength="18" placeholder="00.000.000/0000-00" />
              </label>
              <div class="cadastro-field">
                <span>&nbsp;</span>
                <button type="submit" ${loading ? 'disabled' : ''}>${loading ? 'Consultando...' : 'Consultar'}</button>
              </div>
            </div>
            ${errorMessage ? `<p class="form-error">${C.escape(errorMessage)}</p>` : ''}
          `, 'Informe os 14 dígitos. A validação do dígito verificador é feita antes da consulta.')}
        </form>
      </div>
      ${resultPanel()}
    `;

    const input = document.getElementById('cnpjInput');
    input?.addEventListener('input', (event) => {
      const caret = event.target.value.length;
      documentValue = maskCnpj(event.target.value);
      event.target.value = documentValue;
      if (caret >= documentValue.length) event.target.setSelectionRange(documentValue.length, documentValue.length);
    });

    document.getElementById('cnpjConsultaForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const digits = String(documentValue || '').replace(/\D/g, '');
      if (digits.length !== 14) {
        errorMessage = 'Informe os 14 dígitos do CNPJ.';
        render();
        return;
      }
      loading = true;
      errorMessage = '';
      render();
      try {
        const res = await api(`/api/cnpj/${digits}`);
        result = res.officialData;
        showToast('CNPJ consultado com sucesso.', 'success');
      } catch (error) {
        result = null;
        errorMessage = error.message || 'Erro ao consultar o CNPJ.';
      } finally {
        loading = false;
        render();
      }
    });

    // Leva o resultado para a tela de Pessoas, que já sabe cadastrar PJ.
    document.getElementById('cnpjUseBtn')?.addEventListener('click', () => {
      const endereco = result.endereco || {};
      state.cadastroDraft = state.cadastroDraft || {};
      state.cadastroDraft.people = {
        type: 'pessoa-juridica',
        document: result.cnpj,
        name: result.razaoSocial,
        tradeName: result.nomeFantasia,
        email: (result.contatos || []).find((c) => c.type === 'email')?.value || '',
        phone: (result.contatos || []).find((c) => c.type === 'phone')?.value || '',
        zipCode: endereco.cep || '',
        street: endereco.logradouro || '',
        streetNumber: endereco.numero || '',
        addressComplement: endereco.complemento || '',
        neighborhood: endereco.bairro || '',
        city: endereco.cidade || '',
        state: endereco.estado || '',
        country: 'Brasil',
        status: 'ativo'
      };
      state.activeSub = 'register';
      loadModule('cadastros');
    });
  }

  render();
};
