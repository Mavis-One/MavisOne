window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.settings = window.MavisSubscreenRegistry.settings || {};

const FISCAL_REGIME_OPTIONS = [
  { value: 'SIMPLES_NACIONAL', label: 'Simples Nacional' },
  { value: 'SIMPLES_EXCESSO_SUBLIMITE', label: 'Simples Nacional — excesso de sublimite' },
  { value: 'LUCRO_PRESUMIDO', label: 'Lucro Presumido' },
  { value: 'LUCRO_REAL', label: 'Lucro Real' }
];
const FISCAL_CRT_OPTIONS = [
  { value: '1', label: '1 — Simples Nacional' },
  { value: '2', label: '2 — Simples Nacional (excesso de sublimite)' },
  { value: '3', label: '3 — Regime Normal' },
  { value: '4', label: '4 — MEI' }
];
const FISCAL_ESTAB_TIPO_OPTIONS = [
  { value: 'MATRIZ', label: 'Matriz' },
  { value: 'FILIAL', label: 'Filial' },
  { value: 'DEPOSITO_FECHADO', label: 'Depósito fechado' },
  { value: 'ARMAZEM_GERAL', label: 'Armazém geral' }
];
const FISCAL_TIPO_OPERACAO_OPTIONS = [
  { value: 'VENDA', label: 'Venda' },
  { value: 'TRANSFERENCIA', label: 'Transferência' },
  { value: 'REMESSA', label: 'Remessa' },
  { value: 'RETORNO', label: 'Retorno' },
  { value: 'DEVOLUCAO', label: 'Devolução' },
  { value: 'BONIFICACAO', label: 'Bonificação' },
  { value: 'ENTRADA_IMPORTACAO', label: 'Entrada de importação' }
];

function fiscalDigitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function fiscalFormatCnpj(digits) {
  const clean = fiscalDigitsOnly(digits);
  if (clean.length !== 14) return digits || '';
  return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function fiscalFormatCnpjRaiz(digits) {
  const clean = fiscalDigitsOnly(digits);
  if (clean.length !== 8) return digits || '';
  return clean.replace(/^(\d{2})(\d{3})(\d{3})$/, '$1.$2.$3');
}

window.MavisSubscreenRegistry.settings.fiscal = async function renderSettingsFiscal(ctx) {
  const { content, api, showToast, escapeHtml, confirmModal } = ctx;

  let empresas = [];
  let selectedEmpresaId = null;
  let estabelecimentos = [];
  let empresaForm = null; // null | {} (nova) | objeto empresa (edição)
  let estabForm = null; // null | {} (novo) | objeto estabelecimento (edição)
  let estabStatusById = {};
  // Começa travado: se a resposta do servidor não disser nada, o mais seguro é
  // a tela se comportar como ambiente de teste.
  let travadoEmHomologacao = true;
  let regrasFiscais = [];
  let regraForm = null; // null | {} (nova) | objeto regra (edição)
  let certificados = [];
  let certificadoForm = null; // null | {} (novo)
  // Tabelas oficiais (CFOP, CST, CSOSN, IBS/CBS). São códigos da legislação,
  // iguais para qualquer empresa, e já vinham do banco por /api/fiscal/tabelas
  // — só não chegavam até aqui: o formulário de regra pedia os códigos como
  // texto livre. Digitar "5405" de cabeça funciona; digitar "5450" também
  // funciona, e a nota só é recusada na SEFAZ.
  let tabelas = { disponivel: false };

  async function loadTabelas() {
    try {
      tabelas = await api('/api/fiscal/tabelas');
    } catch (error) {
      // Sem as tabelas a tela continua funcionando com campo de texto, que é o
      // que ela sempre foi. Perder o formulário inteiro por causa da lista de
      // apoio seria trocar uma ajuda por um impedimento.
      tabelas = { disponivel: false };
    }
  }

  async function loadEmpresas() {
    const res = await api('/api/fiscal/empresas');
    empresas = res.empresas || [];
  }

  async function loadEstabelecimentos(empresaId) {
    const res = await api(`/api/fiscal/estabelecimentos?empresaId=${encodeURIComponent(empresaId)}`);
    estabelecimentos = res.estabelecimentos || [];
    travadoEmHomologacao = res.travadoEmHomologacao !== false;
  }

  async function loadRegrasFiscais(empresaId) {
    const res = await api(`/api/fiscal/regras?empresaId=${encodeURIComponent(empresaId)}`);
    regrasFiscais = res.regras || [];
  }

  async function loadCertificados(empresaId) {
    const res = await api(`/api/fiscal/certificados?empresaId=${encodeURIComponent(empresaId)}`);
    certificados = res.certificados || [];
  }

  function certificadoStatusBadge(validoAte) {
    const hoje = new Date().toISOString().slice(0, 10);
    const em30Dias = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (validoAte < hoje) return '<span class="finance-badge finance-badge-danger">Vencido</span>';
    if (validoAte <= em30Dias) return '<span class="finance-badge finance-badge-warning">Vence em breve</span>';
    return '<span class="finance-badge finance-badge-success">Válido</span>';
  }

  function selectedEmpresa() {
    return empresas.find((e) => e.id === selectedEmpresaId) || null;
  }

  function renderEmpresasTable() {
    if (!empresas.length) {
      return '<p class="muted">Nenhuma empresa cadastrada ainda.</p>';
    }
    return `
      <div class="table-scroll">
      <table class="table table-actions">
        <thead><tr><th>Razão social</th><th>CNPJ raiz</th><th>Regime tributário</th><th>CRT</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          ${empresas.map((emp) => `
            <tr data-empresa-id="${emp.id}" class="${emp.id === selectedEmpresaId ? 'active-row' : ''}">
              <td>${escapeHtml(emp.razaoSocial)}</td>
              <td>${escapeHtml(fiscalFormatCnpjRaiz(emp.cnpjRaiz))}</td>
              <td>${escapeHtml((FISCAL_REGIME_OPTIONS.find((o) => o.value === emp.regimeTributario) || {}).label || emp.regimeTributario)}</td>
              <td>${escapeHtml(String(emp.crt))}</td>
              <td>${emp.ativo ? '<span class="finance-badge finance-badge-success">Ativa</span>' : '<span class="finance-badge finance-badge-muted">Inativa</span>'}</td>
              <td>
                <button type="button" class="secondary fiscal-select-empresa" data-id="${emp.id}">Estabelecimentos</button>
                <button class="edit-empresa icon-button edit" data-id="${emp.id}" title="Editar empresa" aria-label="Editar empresa">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                </button>
                <button class="delete-empresa icon-button" data-id="${emp.id}" title="Excluir empresa" aria-label="Excluir empresa">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M10 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>
    `;
  }

  function renderEmpresaForm() {
    if (!empresaForm) return '';
    const isEditing = Boolean(empresaForm.id);
    return `
      <div class="panel">
        <h3>${isEditing ? 'Editar empresa' : 'Nova empresa'}</h3>
        <form id="fiscalEmpresaForm" class="form-grid">
          <div class="row">
            <label>CNPJ raiz (8 dígitos)<input name="cnpjRaiz" required data-campo="cnpj-raiz" value="${escapeHtml(empresaForm.cnpjRaiz || '')}" ${isEditing ? 'disabled' : ''} /></label>
            <label>Razão social<input name="razaoSocial" required value="${escapeHtml(empresaForm.razaoSocial || '')}" /></label>
          </div>
          <div class="row">
            <label>Regime tributário
              <select name="regimeTributario" required>
                ${FISCAL_REGIME_OPTIONS.map((o) => `<option value="${o.value}" ${empresaForm.regimeTributario === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
              </select>
            </label>
            <label>CRT
              <select name="crt" required>
                ${FISCAL_CRT_OPTIONS.map((o) => `<option value="${o.value}" ${String(empresaForm.crt || '') === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="row">
            <label>Alíquota crédito ICMS SN (%)<input name="aliquotaCreditoIcmsSn" type="number" step="0.0001" min="0" value="${empresaForm.aliquotaCreditoIcmsSn ?? ''}" /></label>
            <label>Vigência da alíquota<input name="aliquotaSnVigencia" type="date" value="${empresaForm.aliquotaSnVigencia || ''}" /></label>
          </div>
          <!-- Fase AO. Ficha técnica, garantia e instruções são compromisso
               COMERCIAL de quem assina a nota, e quem assina é este CNPJ. Com
               mais de uma empresa no sistema, um texto único faria a nota de
               uma prometer a garantia da outra — e é o que está impresso no
               DANFE que vale numa discussão com o cliente. -->
          <label>Observação padrão das notas deste CNPJ
            <textarea name="observacaoPadraoNfe" rows="5" maxlength="5000"
              placeholder="Vazio = usa o texto padrão do sistema.">${escapeHtml(empresaForm.observacaoPadraoNfe || '')}</textarea>
          </label>
          <p class="muted">Nasce no campo "Observações adicionais" de toda nota emitida por este CNPJ, e continua editável nota a nota. Vai para o campo livre impresso no DANFE (infCpl) — não altera imposto, CFOP nem base de cálculo. Limite da SEFAZ: 5000 caracteres.</p>

          <div class="checkbox-grid">
            <label><input type="checkbox" name="opcaoTransferenciaTributada" ${empresaForm.opcaoTransferenciaTributada ? 'checked' : ''} /> Opção por transferência tributada (Convênio ICMS 109/2024)</label>
            <label><input type="checkbox" name="eImportadora" ${empresaForm.eImportadora ? 'checked' : ''} /> É importadora</label>
            ${isEditing ? `<label><input type="checkbox" name="ativo" ${empresaForm.ativo ? 'checked' : ''} /> Ativa</label>` : ''}
          </div>
          <div class="row">
            <button type="submit">${isEditing ? 'Salvar alterações' : 'Criar empresa'}</button>
            <button type="button" class="secondary" id="fiscalEmpresaCancel">Cancelar</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderCertificadosSection() {
    const empresa = selectedEmpresa();
    if (!empresa) return '';
    return `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Certificado digital — ${escapeHtml(empresa.razaoSocial)}</h3>
            <p class="muted">Só controla a validade e avisa quando estiver vencendo — o arquivo (.pfx) e a senha ficam só na Focus NFe, nunca aqui.</p>
          </div>
          <div class="cadastro-list-actions">
            <button type="button" id="fiscalNewCertificadoBtn">+ Novo certificado</button>
          </div>
        </div>
        ${certificados.length ? `
          <div class="table-scroll">
          <table class="table table-actions">
            <thead><tr><th>Tipo</th><th>CNPJ titular</th><th>Válido de</th><th>Válido até</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              ${certificados.map((cert) => `
                <tr>
                  <td>${escapeHtml(cert.tipo)}</td>
                  <td>${escapeHtml(fiscalFormatCnpj(cert.titularCnpj))}</td>
                  <td>${escapeHtml(cert.validoDe)}</td>
                  <td>${escapeHtml(cert.validoAte)}</td>
                  <td>${certificadoStatusBadge(cert.validoAte)}</td>
                  <td>
                    <button class="delete-certificado icon-button" data-id="${cert.id}" title="Excluir registro" aria-label="Excluir registro">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M10 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          </div>
        ` : '<p class="muted">Nenhum certificado registrado ainda.</p>'}
      </div>
      ${renderCertificadoForm()}
    `;
  }

  function renderCertificadoForm() {
    if (!certificadoForm) return '';
    return `
      <div class="panel">
        <h3>Novo certificado</h3>
        <form id="fiscalCertificadoForm" class="form-grid">
          <div class="row">
            <label>Tipo
              <select name="tipo">
                <option value="A1">A1</option>
                <option value="A3">A3</option>
              </select>
            </label>
            <label>CNPJ titular<input name="titularCnpj" required data-documento="cnpj" /></label>
          </div>
          <div class="row">
            <label>Válido de<input name="validoDe" type="date" required /></label>
            <label>Válido até<input name="validoAte" type="date" required /></label>
          </div>
          <div class="row">
            <button type="submit">Salvar</button>
            <button type="button" class="secondary" id="fiscalCertificadoCancel">Cancelar</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderEstabelecimentosSection() {
    const empresa = selectedEmpresa();
    if (!empresa) return '';
    return `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Estabelecimentos — ${escapeHtml(empresa.razaoSocial)}</h3>
            <p class="muted">Matriz e filiais desta empresa. Cada uma tem IE, endereço e token da Focus NFe próprios.</p>
            ${travadoEmHomologacao ? '<p class="fiscal-aviso-homologacao"><strong>Ambiente de testes.</strong> Todas as emissões vão para a homologação da Focus NFe e <strong>não têm valor fiscal</strong> — não geram obrigação, não vão para a apuração e não servem para acompanhar mercadoria.</p>' : ''}
          </div>
          <div class="cadastro-list-actions">
            <button type="button" id="fiscalNewEstabBtn">+ Novo estabelecimento</button>
          </div>
        </div>
        ${estabelecimentos.length ? `
          <div class="table-scroll">
          <table class="table table-actions">
            <thead><tr><th>CNPJ</th><th>Tipo</th><th>Razão social</th><th>UF</th><th>Focus NFe</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              ${estabelecimentos.map((estab) => `
                <tr data-estab-id="${estab.id}">
                  <td>${escapeHtml(fiscalFormatCnpj(estab.cnpj))}</td>
                  <td>${escapeHtml((FISCAL_ESTAB_TIPO_OPTIONS.find((o) => o.value === estab.tipo) || {}).label || estab.tipo)}</td>
                  <td>${escapeHtml(estab.razaoSocial)}</td>
                  <td>${escapeHtml(estab.uf)}</td>
                  <td>${estab.focusTokenConfigured
                    ? (travadoEmHomologacao && estab.focusAmbiente === 'producao'
                      ? '<span class="finance-badge finance-badge-danger" title="Marcado como Produção, mas o sistema está travado em homologação: a emissão vai ser recusada.">Produção bloqueada</span>'
                      : `<span class="finance-badge finance-badge-info">${escapeHtml(estab.focusAmbiente === 'producao' ? 'Produção' : 'Homologação')}</span>`)
                    : '<span class="finance-badge finance-badge-muted">Sem token</span>'}</td>
                  <td data-estab-status="${estab.id}">${estabStatusById[estab.id] || ''}</td>
                  <td>
                    <button type="button" class="secondary fiscal-test-estab" data-id="${estab.id}">Testar conexão</button>
                    <button type="button" class="secondary fiscal-registrar-webhook" data-id="${estab.id}">Registrar webhook</button>
                    <button class="edit-estab icon-button edit" data-id="${estab.id}" title="Editar estabelecimento" aria-label="Editar estabelecimento">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                    </button>
                    <button class="delete-estab icon-button" data-id="${estab.id}" title="Excluir estabelecimento" aria-label="Excluir estabelecimento">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M10 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          </div>
        ` : '<p class="muted">Nenhum estabelecimento cadastrado ainda.</p>'}
      </div>
      ${renderEstabForm()}
      ${renderRegrasFiscaisSection()}
    `;
  }

  function renderRegrasFiscaisSection() {
    const empresa = selectedEmpresa();
    if (!empresa) return '';
    return `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Regras fiscais — ${escapeHtml(empresa.razaoSocial)}</h3>
            <p class="muted">Define CFOP e tributação (ICMS/PIS/COFINS) por NCM e tipo de operação. Deixe um campo em branco pra ele valer como "qualquer" — a regra mais específica cadastrada é usada na emissão.</p>
          </div>
          <div class="cadastro-list-actions">
            <button type="button" id="fiscalNewRegraBtn">+ Nova regra</button>
          </div>
        </div>
        ${regrasFiscais.length ? `
          <div class="table-scroll">
          <table class="table table-actions">
            <thead><tr><th>Operação</th><th>NCM</th><th>UF dest.</th><th>CFOP</th><th>CSOSN/CST</th><th>PIS/COFINS</th><th>Prioridade</th><th>Ações</th></tr></thead>
            <tbody>
              ${regrasFiscais.map((regra) => `
                <tr data-regra-id="${regra.id}">
                  <td>${escapeHtml((FISCAL_TIPO_OPERACAO_OPTIONS.find((o) => o.value === regra.tipoOperacao) || {}).label || regra.tipoOperacao)}</td>
                  <td>${escapeHtml(regra.ncm || 'qualquer')}</td>
                  <td>${escapeHtml(regra.ufDestino || 'qualquer')}</td>
                  <td>${escapeHtml(regra.cfop)}</td>
                  <td>${escapeHtml(regra.csosn || regra.cstIcms || '—')}</td>
                  <td>${escapeHtml([regra.cstPis, regra.cstCofins].filter(Boolean).join(' / ') || '—')}</td>
                  <td>${escapeHtml(String(regra.prioridade))}</td>
                  <td>
                    <button class="edit-regra icon-button edit" data-id="${regra.id}" title="Editar regra" aria-label="Editar regra">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                    </button>
                    <button class="delete-regra icon-button" data-id="${regra.id}" title="Excluir regra" aria-label="Excluir regra">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 6h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M10 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          </div>
        ` : '<p class="muted">Nenhuma regra fiscal cadastrada ainda — sem regra, a emissão de NF-e não sabe qual CFOP/tributação usar.</p>'}
      </div>
      ${renderRegraForm()}
    `;
  }

  function renderRegraForm() {
    if (!regraForm) return '';
    const isEditing = Boolean(regraForm.id);
    return `
      <div class="panel">
        <h3>${isEditing ? 'Editar regra fiscal' : 'Nova regra fiscal'}</h3>
        <form id="fiscalRegraForm" class="form-grid">
          <div class="row">
            <label>Tipo de operação
              <select name="tipoOperacao" required>
                ${FISCAL_TIPO_OPERACAO_OPTIONS.map((o) => `<option value="${o.value}" ${regraForm.tipoOperacao === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
              </select>
            </label>
            <label>NCM (vazio = qualquer)<input name="ncm" data-campo="ncm" value="${escapeHtml(regraForm.ncm || '')}" /></label>
            <label>UF destino (vazio = qualquer)<input name="ufDestino" data-campo="uf" value="${escapeHtml(regraForm.ufDestino || '')}" /></label>
          </div>
          <div class="row">
            ${campoDeCodigo({ nome: 'cfop', rotulo: 'CFOP', lista: tabelas.cfop, valor: regraForm.cfop, maxlength: 4, obrigatorio: true, placeholder: 'ex.: 5405' })}
            ${campoDeCodigo({ nome: 'csosn', rotulo: 'CSOSN (Simples Nacional)', lista: tabelas.csosn, valor: regraForm.csosn, maxlength: 3, placeholder: 'ex.: 102' })}
            ${campoDeCodigo({ nome: 'cstIcms', rotulo: 'CST ICMS (Regime Normal)', lista: tabelas.cstIcms, valor: regraForm.cstIcms, maxlength: 2, placeholder: 'ex.: 00' })}
          </div>
          <div class="row">
            <label>Alíquota ICMS (%)<input name="aliquotaIcms" type="number" step="0.01" min="0" value="${regraForm.aliquotaIcms ?? ''}" /></label>
            ${campoDeCodigo({ nome: 'cstPis', rotulo: 'CST PIS', lista: tabelas.cstPisCofins, valor: regraForm.cstPis, maxlength: 2, placeholder: 'ex.: 49' })}
            <label>Alíquota PIS (%)<input name="aliquotaPis" type="number" step="0.0001" min="0" value="${regraForm.aliquotaPis ?? ''}" /></label>
          </div>
          <div class="row">
            ${campoDeCodigo({ nome: 'cstCofins', rotulo: 'CST COFINS', lista: tabelas.cstPisCofins, valor: regraForm.cstCofins, maxlength: 2, placeholder: 'ex.: 49' })}
            <label>Alíquota COFINS (%)<input name="aliquotaCofins" type="number" step="0.0001" min="0" value="${regraForm.aliquotaCofins ?? ''}" /></label>
            <label>Prioridade (desempate)<input name="prioridade" type="number" step="1" value="${regraForm.prioridade ?? 0}" /></label>
          </div>

          <!-- IBS/CBS (LC 214/2025). As colunas existem no regra_fiscal desde a
               fase Z e o mapeador de gravação já as escreve; faltava a tela.
               Enquanto isso, criar uma regra pela tela deixava os campos da
               reforma sempre nulos, e o nfePayloadBuilder só monta o grupo
               quando o CST IBS/CBS está preenchido — ou seja, a reforma estava
               implementada e inalcançável. -->
          <h4>IBS e CBS (reforma tributária)</h4>
          <div class="row">
            ${campoDeCodigo({ nome: 'cstIbsCbs', rotulo: 'CST IBS/CBS', lista: tabelas.cstIbsCbs, valor: regraForm.cstIbsCbs, maxlength: 3, placeholder: 'ex.: 000' })}
            ${campoDeCodigo({ nome: 'classTrib', rotulo: 'Classificação tributária', lista: tabelas.classificacaoTributaria, valor: regraForm.classTrib, maxlength: 6, placeholder: 'ex.: 000001' })}
            <label>Alíquota CBS (%)<input name="aliquotaCbs" type="number" step="0.0001" min="0" value="${regraForm.aliquotaCbs ?? ''}" /></label>
          </div>
          <div class="row">
            <label>Alíquota IBS estadual (%)<input name="aliquotaIbsUf" type="number" step="0.0001" min="0" value="${regraForm.aliquotaIbsUf ?? ''}" /></label>
            <label>Alíquota IBS municipal (%)<input name="aliquotaIbsMun" type="number" step="0.0001" min="0" value="${regraForm.aliquotaIbsMun ?? ''}" /></label>
          </div>
          <div class="row">
            <label>Vigência início<input name="vigenciaInicio" type="date" required value="${regraForm.vigenciaInicio || new Date().toISOString().slice(0, 10)}" /></label>
            <label>Vigência fim (vazio = sem prazo)<input name="vigenciaFim" type="date" value="${regraForm.vigenciaFim || ''}" /></label>
          </div>
          <div class="row">
            <button type="submit">${isEditing ? 'Salvar alterações' : 'Criar regra'}</button>
            <button type="button" class="secondary" id="fiscalRegraCancel">Cancelar</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderEstabForm() {
    if (!estabForm) return '';
    const isEditing = Boolean(estabForm.id);
    const producaoJaSalva = estabForm.focusAmbiente === 'producao';
    // A trava só impede ENTRAR em produção. Se o estabelecimento já está salvo
    // assim, a opção continua habilitada: uma <option> desabilitada e
    // selecionada continua sendo enviada pelo navegador no submit, então
    // "salvar alterações" não corrigia nada e não havia como entender por quê.
    // Rebaixar sozinho para homologação seria pior — é exatamente a troca
    // silenciosa que lib/focusnfe.js recusa fazer, para não mandar token de
    // produção na URL de homologação e culpar a credencial.
    const producaoBloqueada = travadoEmHomologacao && !producaoJaSalva;
    return `
      <div class="panel">
        <h3>${isEditing ? 'Editar estabelecimento' : 'Novo estabelecimento'}</h3>
        <form id="fiscalEstabForm" class="form-grid">
          <div class="row">
            <!-- A máscara é só de tela: o submit grava com fiscalDigitsOnly. -->
            <label>CNPJ<input name="cnpj" required data-documento="cnpj" value="${escapeHtml(estabForm.cnpj || '')}" /></label>
            <label>Ordem<input name="ordem" required maxlength="4" value="${escapeHtml(estabForm.ordem || '0001')}" placeholder="0001 = matriz" /></label>
            <label>Tipo
              <select name="tipo" required>
                ${FISCAL_ESTAB_TIPO_OPTIONS.map((o) => `<option value="${o.value}" ${estabForm.tipo === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="row">
            <label>Razão social<input name="razaoSocial" required value="${escapeHtml(estabForm.razaoSocial || '')}" /></label>
            <label>Nome fantasia<input name="nomeFantasia" value="${escapeHtml(estabForm.nomeFantasia || '')}" /></label>
          </div>
          <div class="row">
            <label>E-mail<input name="email" type="email" value="${escapeHtml(estabForm.email || '')}" /></label>
            <label>Telefone<input name="telefone" data-campo="telefone" value="${escapeHtml(estabForm.telefone || '')}" /></label>
            <label>CNAE principal<input name="cnaePrincipal" required maxlength="7" inputmode="numeric" value="${escapeHtml(estabForm.cnaePrincipal || '')}" /></label>
          </div>
          <div class="row">
            <label>Inscrição estadual<input name="inscricaoEstadual" required value="${escapeHtml(estabForm.inscricaoEstadual || '')}" /></label>
            <label>Inscrição estadual (ST)<input name="inscricaoEstadualSt" value="${escapeHtml(estabForm.inscricaoEstadualSt || '')}" /></label>
            <label>Inscrição municipal<input name="inscricaoMunicipal" value="${escapeHtml(estabForm.inscricaoMunicipal || '')}" /></label>
          </div>
          <div class="row">
            <label>Logradouro<input name="logradouro" required value="${escapeHtml(estabForm.logradouro || '')}" /></label>
            <label>Número<input name="numero" required value="${escapeHtml(estabForm.numero || '')}" /></label>
            <label>Complemento<input name="complemento" value="${escapeHtml(estabForm.complemento || '')}" /></label>
          </div>
          <div class="row">
            <label>Bairro<input name="bairro" required value="${escapeHtml(estabForm.bairro || '')}" /></label>
            <label>Código do município (IBGE)<input name="codigoMunicipio" required maxlength="7" inputmode="numeric" value="${escapeHtml(estabForm.codigoMunicipio || '')}" /></label>
            <label>Município<input name="municipio" required value="${escapeHtml(estabForm.municipio || '')}" /></label>
          </div>
          <div class="row">
            <label>UF<input name="uf" required data-campo="uf" value="${escapeHtml(estabForm.uf || '')}" /></label>
            <label>CEP<input name="cep" required data-campo="cep" value="${escapeHtml(estabForm.cep || '')}" /></label>
          </div>
          <div class="row">
            <label>Token Focus NFe${isEditing ? ' (deixe em branco para manter o atual)' : ''}<input name="focusToken" type="password" autocomplete="new-password" data-lpignore="true" spellcheck="false" placeholder="${estabForm.focusTokenConfigured ? '••••••••' : 'Gerado no painel da Focus NFe'}" />
              <small class="muted">Não aceite sugestão do gerenciador de senhas aqui — cole o token gerado no painel da Focus NFe.</small>
            </label>
            <label>Ambiente Focus
              <select name="focusAmbiente">
                <option value="homologacao" ${!producaoJaSalva ? 'selected' : ''}>Homologação</option>
                <option value="producao" ${producaoJaSalva ? 'selected' : ''} ${producaoBloqueada ? 'disabled' : ''}>Produção${travadoEmHomologacao ? ' — bloqueado pela trava' : ''}</option>
              </select>
              ${travadoEmHomologacao ? (producaoJaSalva
                ? '<small class="fiscal-aviso-homologacao">Este estabelecimento está salvo como Produção, mas o sistema está travado em homologação: <strong>toda emissão por ele vai ser recusada</strong>. Troque para Homologação e use o token de homologação, ou desligue FOCUS_NFE_SOMENTE_HOMOLOGACAO no .env do servidor.</small>'
                : '<small class="muted">O sistema está travado em homologação (FOCUS_NFE_SOMENTE_HOMOLOGACAO no .env). Use o token de homologação da Focus NFe.</small>') : ''}
            </label>
          </div>
          ${isEditing && estabForm.focusTokenConfigured ? `
            <div class="checkbox-grid">
              <label><input type="checkbox" name="removerFocusToken" /> Remover o token salvo — o estabelecimento volta para "Sem token" e para de emitir</label>
            </div>
          ` : ''}
          <div class="checkbox-grid">
            <label><input type="checkbox" name="emiteNfe" ${estabForm.emiteNfe !== false ? 'checked' : ''} /> Emite NF-e</label>
            <label><input type="checkbox" name="emiteNfce" ${estabForm.emiteNfce ? 'checked' : ''} /> Emite NFC-e</label>
            ${isEditing ? `<label><input type="checkbox" name="ativo" ${estabForm.ativo !== false ? 'checked' : ''} /> Ativo</label>` : ''}
          </div>
          <div class="row">
            <button type="submit">${isEditing ? 'Salvar alterações' : 'Criar estabelecimento'}</button>
            <button type="button" class="secondary" id="fiscalEstabCancel">Cancelar</button>
          </div>
        </form>
      </div>
    `;
  }

  // Token padrao do .env (FOCUS_NFE_TOKEN) — a reserva de quando o
  // estabelecimento nao tem token proprio. Este painel morava na tela
  // "Empresa", que deixou de existir: os dados da empresa passaram a ter um
  // lugar so, e este era o unico conteudo dela que valia a pena trazer junto.
  function renderFocusPadraoSection() {
    return `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Integração — Focus NFe</h3>
            <p class="muted">Cada estabelecimento acima tem o seu próprio token. O teste abaixo usa só o token padrão do servidor (FOCUS_NFE_TOKEN no .env), que serve de reserva.</p>
          </div>
          <div class="cadastro-list-actions">
            <button type="button" class="secondary" id="focusNfeRefresh">Testar token padrão</button>
          </div>
        </div>
        <div id="focusNfeStatusBox" class="muted">Verificando conexão...</div>
      </div>
    `;
  }

  async function carregarStatusFocusPadrao() {
    const box = document.getElementById('focusNfeStatusBox');
    if (!box) return;
    box.textContent = 'Verificando conexão...';
    try {
      const status = await api('/api/focusnfe/status');
      const ambienteLabel = status.ambiente === 'producao' ? 'Produção' : 'Homologação';
      if (!status.configured) {
        box.innerHTML = `<span class="finance-badge finance-badge-muted">Não configurado</span> Defina <code>FOCUS_NFE_TOKEN</code> no .env do servidor e reinicie-o.`;
      } else if (status.connected) {
        box.innerHTML = `<span class="finance-badge finance-badge-success">Conectado</span> Ambiente: ${escapeHtml(ambienteLabel)}.`;
      } else {
        box.innerHTML = `<span class="finance-badge finance-badge-danger">Falha na conexão</span> Ambiente: ${escapeHtml(ambienteLabel)}. ${escapeHtml(status.message || '')}`;
      }
    } catch (error) {
      box.textContent = 'Erro ao verificar Focus NFe: ' + (error.message || error);
    }
  }

  // UM CAMPO QUE VIRA LISTA QUANDO EXISTE LISTA.
  //
  // Com o catálogo carregado, vira busca ("5405" ou "venda de mercadoria" acham
  // a mesma linha) e o que é gravado continua sendo só o código — o
  // renderSearchableSelect mantém um <input type="hidden"> com o mesmo `name`,
  // então o FormData do submit não muda em nada.
  //
  // Sem catálogo (migração fiscal pendente), volta a ser o input de texto de
  // antes. Um campo que some porque a tabela de apoio não existe seria pior do
  // que o texto livre que ele veio substituir.
  function campoDeCodigo({ nome, rotulo, lista, valor, placeholder, maxlength, obrigatorio }) {
    const opcoes = (lista || []).map((linha) => ({
      value: String(linha.codigo),
      label: `${linha.codigo} — ${linha.descricao || ''}`.trim().replace(/ —\s*$/, '')
    }));
    if (!opcoes.length) {
      return `<label>${escapeHtml(rotulo)}<input name="${nome}" ${obrigatorio ? 'required' : ''} ${maxlength ? `maxlength="${maxlength}"` : ''} value="${escapeHtml(valor || '')}" placeholder="${escapeHtml(placeholder || '')}" /></label>`;
    }
    return `<label>${escapeHtml(rotulo)}
      ${renderSearchableSelect({
        id: `regra_${nome}`, name: nome, options: opcoes, selectedValue: valor || '',
        placeholder: placeholder || 'Buscar código ou descrição...', required: obrigatorio
      })}
    </label>`;
  }

  // Os mesmos campos de código do formulário, num lugar só: a lista alimenta o
  // render E a religação dos eventos. Ligar quatro e esquecer o quinto deixaria
  // um campo que abre a lista e não grava nada.
  function camposDeCodigoDaRegra() {
    return [
      { nome: 'cfop', lista: tabelas.cfop },
      { nome: 'csosn', lista: tabelas.csosn },
      { nome: 'cstIcms', lista: tabelas.cstIcms },
      { nome: 'cstPis', lista: tabelas.cstPisCofins },
      { nome: 'cstCofins', lista: tabelas.cstPisCofins },
      { nome: 'cstIbsCbs', lista: tabelas.cstIbsCbs },
      { nome: 'classTrib', lista: tabelas.classificacaoTributaria }
    ];
  }

  function ligarCamposDeCodigo() {
    for (const campo of camposDeCodigoDaRegra()) {
      const opcoes = (campo.lista || []).map((linha) => ({
        value: String(linha.codigo),
        label: `${linha.codigo} — ${linha.descricao || ''}`.trim().replace(/ —\s*$/, '')
      }));
      if (opcoes.length) attachSearchableSelect({ id: `regra_${campo.nome}`, options: opcoes });
    }
  }

  function renderAll() {
    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Empresas</h3>
            <p class="muted">Cadastro fiscal completo — usado pra emissão real de NF-e via Focus NFe. Uma linha por raiz de CNPJ.</p>
          </div>
          <div class="cadastro-list-actions">
            <button type="button" id="fiscalNewEmpresaBtn">+ Nova empresa</button>
          </div>
        </div>
        ${renderEmpresasTable()}
      </div>
      ${renderEmpresaForm()}
      ${renderCertificadosSection()}
      ${renderEstabelecimentosSection()}
      ${renderFocusPadraoSection()}
    `;
    attachHandlers();
    document.getElementById('focusNfeRefresh')?.addEventListener('click', carregarStatusFocusPadrao);
    setTimeout(carregarStatusFocusPadrao, 50);
    window.MavisDocumento?.ligarTodos(content);

    // Consulta do CNPJ do estabelecimento. O emitente é o dado que mais custa
    // errar: razão social, endereço e código IBGE saem em TODA nota emitida
    // por ele, e corrigir depois exige cancelar as notas já autorizadas.
    const campoCnpj = content.querySelector('#fiscalEstabForm [name="cnpj"]');
    if (campoCnpj) {
      const form = () => document.getElementById('fiscalEstabForm');
      const preencher = (nome, valor) => {
        const campo = form()?.querySelector(`[name="${nome}"]`);
        if (campo && !String(campo.value || '').trim() && valor) campo.value = valor;
      };
      window.MavisDocumento.ligarConsultaCnpj(campoCnpj, {
        api,
        showToast,
        devePreencherSozinho: () => !String(form()?.querySelector('[name="razaoSocial"]')?.value || '').trim(),
        aoEncontrar: (dados) => {
          preencher('razaoSocial', dados.razaoSocial);
          preencher('nomeFantasia', dados.nomeFantasia);
          preencher('email', dados.email);
          preencher('telefone', dados.telefone);
          preencher('logradouro', dados.logradouro);
          preencher('numero', dados.numero);
          preencher('complemento', dados.complemento);
          preencher('bairro', dados.bairro);
          preencher('municipio', dados.municipio);
          preencher('uf', dados.uf);
          preencher('cep', dados.cep);
          // Só o código IBGE de verdade — o codigo_municipio da BrasilAPI é
          // SIAFI e a SEFAZ rejeitaria a nota inteira.
          preencher('codigoMunicipio', dados.codigoMunicipioIbge);
          // A Receita devolve o CNAE como descrição ("Comércio varejista…"),
          // não como código; o campo aqui espera o código, então não é
          // preenchido — chutar deixaria o cadastro fiscal errado em silêncio.
        }
      });
    }
  }

  function attachHandlers() {
    // Os campos de codigo viram busca so' depois de estarem no DOM. Fica aqui,
    // junto dos outros handlers, porque e' o mesmo momento: tudo o que o
    // renderAll pinta precisa ser religado, e um lugar so' e' o que evita
    // religar quatro e esquecer o quinto.
    ligarCamposDeCodigo();

    document.getElementById('fiscalNewEmpresaBtn')?.addEventListener('click', () => {
      empresaForm = { ativo: true };
      renderAll();
    });
    document.getElementById('fiscalEmpresaCancel')?.addEventListener('click', () => {
      empresaForm = null;
      renderAll();
    });
    document.getElementById('fiscalEmpresaForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      const payload = {
        cnpjRaiz: fiscalDigitsOnly(formData.get('cnpjRaiz')),
        razaoSocial: formData.get('razaoSocial'),
        regimeTributario: formData.get('regimeTributario'),
        crt: Number(formData.get('crt')),
        aliquotaCreditoIcmsSn: formData.get('aliquotaCreditoIcmsSn') ? Number(formData.get('aliquotaCreditoIcmsSn')) : null,
        aliquotaSnVigencia: formData.get('aliquotaSnVigencia') || null,
        opcaoTransferenciaTributada: formData.get('opcaoTransferenciaTributada') === 'on',
        eImportadora: formData.get('eImportadora') === 'on',
        // Vazio e' um valor legitimo aqui: significa "usa o texto padrao do
        // sistema". Por isso vai como string mesmo, sem `|| null` -- quem
        // decide o que fazer com o vazio e' o mapeador do banco, num lugar so'.
        observacaoPadraoNfe: String(formData.get('observacaoPadraoNfe') || '').trim(),
        ativo: formData.get('ativo') === 'on'
      };
      try {
        if (empresaForm.id) {
          await api(`/api/fiscal/empresas/${empresaForm.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          showToast('Empresa atualizada com sucesso.', 'success');
        } else {
          await api('/api/fiscal/empresas', { method: 'POST', body: JSON.stringify(payload) });
          showToast('Empresa criada com sucesso.', 'success');
        }
        empresaForm = null;
        await loadEmpresas();
        renderAll();
      } catch (error) {
        showToast(error.message || 'Erro ao salvar empresa.', 'error');
      }
    });

    document.querySelectorAll('.edit-empresa').forEach((btn) => {
      btn.addEventListener('click', () => {
        const empresa = empresas.find((e) => e.id === btn.dataset.id);
        if (!empresa) return;
        empresaForm = { ...empresa };
        renderAll();
      });
    });

    document.querySelectorAll('.delete-empresa').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const empresa = empresas.find((e) => e.id === btn.dataset.id);
        if (!empresa) return;
        const confirmed = await confirmModal(`Excluir a empresa "${empresa.razaoSocial}"? Só é possível se ela não tiver estabelecimentos cadastrados.`);
        if (!confirmed) return;
        try {
          await api(`/api/fiscal/empresas/${empresa.id}`, { method: 'DELETE' });
          showToast('Empresa excluída.', 'success');
          if (selectedEmpresaId === empresa.id) { selectedEmpresaId = null; estabelecimentos = []; }
          await loadEmpresas();
          renderAll();
        } catch (error) {
          showToast(error.message || 'Erro ao excluir empresa.', 'error');
        }
      });
    });

    document.querySelectorAll('.fiscal-select-empresa').forEach((btn) => {
      btn.addEventListener('click', async () => {
        selectedEmpresaId = btn.dataset.id;
        estabForm = null;
        regraForm = null;
        certificadoForm = null;
        try {
          await Promise.all([loadEstabelecimentos(selectedEmpresaId), loadRegrasFiscais(selectedEmpresaId), loadCertificados(selectedEmpresaId)]);
        } catch (error) {
          showToast(error.message || 'Erro ao carregar estabelecimentos/regras/certificados.', 'error');
        }
        renderAll();
      });
    });

    document.getElementById('fiscalNewCertificadoBtn')?.addEventListener('click', () => {
      certificadoForm = { empresaId: selectedEmpresaId };
      renderAll();
    });
    document.getElementById('fiscalCertificadoCancel')?.addEventListener('click', () => {
      certificadoForm = null;
      renderAll();
    });
    document.getElementById('fiscalCertificadoForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      const payload = {
        empresaId: selectedEmpresaId,
        tipo: formData.get('tipo'),
        titularCnpj: fiscalDigitsOnly(formData.get('titularCnpj')),
        validoDe: formData.get('validoDe'),
        validoAte: formData.get('validoAte')
      };
      try {
        await api('/api/fiscal/certificados', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Certificado registrado com sucesso.', 'success');
        certificadoForm = null;
        await loadCertificados(selectedEmpresaId);
        renderAll();
      } catch (error) {
        showToast(error.message || 'Erro ao registrar certificado.', 'error');
      }
    });
    document.querySelectorAll('.delete-certificado').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const confirmed = await confirmModal('Excluir este registro de certificado?');
        if (!confirmed) return;
        try {
          await api(`/api/fiscal/certificados/${btn.dataset.id}`, { method: 'DELETE' });
          showToast('Registro excluído.', 'success');
          await loadCertificados(selectedEmpresaId);
          renderAll();
        } catch (error) {
          showToast(error.message || 'Erro ao excluir.', 'error');
        }
      });
    });

    document.getElementById('fiscalNewEstabBtn')?.addEventListener('click', () => {
      estabForm = { empresaId: selectedEmpresaId, ordem: '0001', tipo: 'MATRIZ', focusAmbiente: 'homologacao', emiteNfe: true };
      renderAll();
    });
    document.getElementById('fiscalEstabCancel')?.addEventListener('click', () => {
      estabForm = null;
      renderAll();
    });

    // Marcar "remover" desabilita o campo de token, e campo desabilitado não
    // entra no FormData. Assim o servidor nunca recebe os dois pedidos juntos.
    const removerTokenCheck = document.querySelector('#fiscalEstabForm [name="removerFocusToken"]');
    if (removerTokenCheck) {
      const campoToken = document.querySelector('#fiscalEstabForm [name="focusToken"]');
      removerTokenCheck.addEventListener('change', () => {
        if (!campoToken) return;
        campoToken.disabled = removerTokenCheck.checked;
        if (removerTokenCheck.checked) campoToken.value = '';
      });
    }
    document.getElementById('fiscalEstabForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      const payload = {
        empresaId: selectedEmpresaId,
        cnpj: fiscalDigitsOnly(formData.get('cnpj')),
        ordem: formData.get('ordem'),
        tipo: formData.get('tipo'),
        razaoSocial: formData.get('razaoSocial'),
        nomeFantasia: formData.get('nomeFantasia'),
        email: formData.get('email'),
        telefone: formData.get('telefone'),
        cnaePrincipal: fiscalDigitsOnly(formData.get('cnaePrincipal')),
        inscricaoEstadual: formData.get('inscricaoEstadual'),
        inscricaoEstadualSt: formData.get('inscricaoEstadualSt'),
        inscricaoMunicipal: formData.get('inscricaoMunicipal'),
        logradouro: formData.get('logradouro'),
        numero: formData.get('numero'),
        complemento: formData.get('complemento'),
        bairro: formData.get('bairro'),
        codigoMunicipio: fiscalDigitsOnly(formData.get('codigoMunicipio')),
        municipio: formData.get('municipio'),
        uf: String(formData.get('uf') || '').toUpperCase(),
        cep: fiscalDigitsOnly(formData.get('cep')),
        focusToken: formData.get('focusToken') || undefined,
        removerFocusToken: formData.get('removerFocusToken') === 'on',
        focusAmbiente: formData.get('focusAmbiente'),
        emiteNfe: formData.get('emiteNfe') === 'on',
        emiteNfce: formData.get('emiteNfce') === 'on',
        ativo: formData.get('ativo') === 'on'
      };
      // Apagar o token não tem desfazer daqui: ele é gravado cifrado e nunca
      // volta pra tela, então recuperá-lo exige pegar de novo no painel da Focus.
      if (payload.removerFocusToken) {
        const confirmado = await confirmModal(`Remover o token da Focus NFe de "${estabForm.razaoSocial || 'este estabelecimento'}"? Ele para de emitir até que um token novo seja cadastrado, e o token atual não pode ser recuperado por aqui.`);
        if (!confirmado) return;
      }
      try {
        if (estabForm.id) {
          await api(`/api/fiscal/estabelecimentos/${estabForm.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          showToast('Estabelecimento atualizado com sucesso.', 'success');
        } else {
          await api('/api/fiscal/estabelecimentos', { method: 'POST', body: JSON.stringify(payload) });
          showToast('Estabelecimento criado com sucesso.', 'success');
        }
        estabForm = null;
        await loadEstabelecimentos(selectedEmpresaId);
        renderAll();
      } catch (error) {
        showToast(error.message || 'Erro ao salvar estabelecimento.', 'error');
      }
    });

    document.querySelectorAll('.edit-estab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const estab = estabelecimentos.find((e) => e.id === btn.dataset.id);
        if (!estab) return;
        estabForm = { ...estab };
        renderAll();
      });
    });

    document.querySelectorAll('.delete-estab').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const estab = estabelecimentos.find((e) => e.id === btn.dataset.id);
        if (!estab) return;
        const confirmed = await confirmModal(`Excluir o estabelecimento "${estab.razaoSocial}"?`);
        if (!confirmed) return;
        try {
          await api(`/api/fiscal/estabelecimentos/${estab.id}`, { method: 'DELETE' });
          showToast('Estabelecimento excluído.', 'success');
          await loadEstabelecimentos(selectedEmpresaId);
          renderAll();
        } catch (error) {
          showToast(error.message || 'Erro ao excluir estabelecimento.', 'error');
        }
      });
    });

    document.querySelectorAll('.fiscal-test-estab').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const cell = document.querySelector(`[data-estab-status="${btn.dataset.id}"]`);
        if (cell) cell.textContent = 'Testando...';
        try {
          const status = await api(`/api/fiscal/estabelecimentos/${btn.dataset.id}/focus-status`);
          // O motivo fica visível, não escondido num title: um 401 aqui pode ser
          // token expirado, token do outro ambiente ou — o caso que já
          // aconteceu — a senha do login gravada por autofill no lugar do token.
          // "Falhou" sozinho não distingue nenhum deles.
          const label = status.connected
            ? '<span class="finance-badge finance-badge-success">Conectado</span>'
            : `<span class="finance-badge finance-badge-danger">Falhou</span>`
              + (status.message ? `<div class="fiscal-status-motivo">${escapeHtml(status.message)}</div>` : '');
          estabStatusById[btn.dataset.id] = label;
          if (cell) cell.innerHTML = label;
        } catch (error) {
          if (cell) cell.textContent = 'Erro: ' + (error.message || error);
        }
      });
    });

    document.querySelectorAll('.fiscal-registrar-webhook').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const res = await api(`/api/fiscal/estabelecimentos/${btn.dataset.id}/webhook`, { method: 'POST' });
          const info = res.webhook || {};
          // Registrar de novo o mesmo endereço não é erro nem novidade — dizer
          // "registrado com sucesso" faria parecer que algo mudou.
          const removidos = (info.removidos || []).length
            ? ` ${info.removidos.length} endereço(s) antigo(s) removido(s).`
            : '';
          showToast(
            (info.jaRegistrado
              ? 'Este webhook já estava registrado na Focus NFe.'
              : 'Webhook registrado com sucesso na Focus NFe.') + removidos,
            'success'
          );
        } catch (error) {
          showToast(error.message || 'Erro ao registrar webhook.', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });

    document.getElementById('fiscalNewRegraBtn')?.addEventListener('click', () => {
      regraForm = { empresaId: selectedEmpresaId, tipoOperacao: 'VENDA', prioridade: 0, vigenciaInicio: new Date().toISOString().slice(0, 10) };
      renderAll();
    });
    document.getElementById('fiscalRegraCancel')?.addEventListener('click', () => {
      regraForm = null;
      renderAll();
    });
    document.getElementById('fiscalRegraForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      const payload = {
        empresaId: selectedEmpresaId,
        tipoOperacao: formData.get('tipoOperacao'),
        ncm: fiscalDigitsOnly(formData.get('ncm')) || null,
        ufDestino: String(formData.get('ufDestino') || '').toUpperCase() || null,
        cfop: formData.get('cfop'),
        csosn: formData.get('csosn') || null,
        cstIcms: formData.get('cstIcms') || null,
        aliquotaIcms: formData.get('aliquotaIcms') || null,
        cstPis: formData.get('cstPis') || null,
        aliquotaPis: formData.get('aliquotaPis') || null,
        cstCofins: formData.get('cstCofins') || null,
        aliquotaCofins: formData.get('aliquotaCofins') || null,
        cstIbsCbs: formData.get('cstIbsCbs') || null,
        classTrib: formData.get('classTrib') || null,
        // Sem `|| null`: alíquota 0 é valor legítimo (CST 400 isenção, 410
        // imunidade) e viraria "não preenchido". O mapeador do banco usa
        // numeroOuNulo pela mesma razão — os dois lados têm de concordar.
        aliquotaCbs: formData.get('aliquotaCbs') === '' ? null : formData.get('aliquotaCbs'),
        aliquotaIbsUf: formData.get('aliquotaIbsUf') === '' ? null : formData.get('aliquotaIbsUf'),
        aliquotaIbsMun: formData.get('aliquotaIbsMun') === '' ? null : formData.get('aliquotaIbsMun'),
        prioridade: Number(formData.get('prioridade') || 0),
        vigenciaInicio: formData.get('vigenciaInicio'),
        vigenciaFim: formData.get('vigenciaFim') || null
      };
      try {
        if (regraForm.id) {
          await api(`/api/fiscal/regras/${regraForm.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          showToast('Regra fiscal atualizada com sucesso.', 'success');
        } else {
          await api('/api/fiscal/regras', { method: 'POST', body: JSON.stringify(payload) });
          showToast('Regra fiscal criada com sucesso.', 'success');
        }
        regraForm = null;
        await loadRegrasFiscais(selectedEmpresaId);
        renderAll();
      } catch (error) {
        showToast(error.message || 'Erro ao salvar regra fiscal.', 'error');
      }
    });

    document.querySelectorAll('.edit-regra').forEach((btn) => {
      btn.addEventListener('click', () => {
        const regra = regrasFiscais.find((r) => r.id === btn.dataset.id);
        if (!regra) return;
        regraForm = { ...regra };
        renderAll();
      });
    });

    document.querySelectorAll('.delete-regra').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const regra = regrasFiscais.find((r) => r.id === btn.dataset.id);
        if (!regra) return;
        const confirmed = await confirmModal(`Excluir a regra fiscal de "${(FISCAL_TIPO_OPERACAO_OPTIONS.find((o) => o.value === regra.tipoOperacao) || {}).label || regra.tipoOperacao}" (CFOP ${regra.cfop})?`);
        if (!confirmed) return;
        try {
          await api(`/api/fiscal/regras/${regra.id}`, { method: 'DELETE' });
          showToast('Regra fiscal excluída.', 'success');
          await loadRegrasFiscais(selectedEmpresaId);
          renderAll();
        } catch (error) {
          showToast(error.message || 'Erro ao excluir regra fiscal.', 'error');
        }
      });
    });
  }

  try {
    // As tabelas oficiais em paralelo com as empresas: são independentes, e uma
    // depois da outra atrasaria a tela pelo tempo das duas.
    await Promise.all([loadEmpresas(), loadTabelas()]);
  } catch (error) {
    showToast(error.message || 'Erro ao carregar empresas fiscais.', 'error');
  }
  renderAll();
};
