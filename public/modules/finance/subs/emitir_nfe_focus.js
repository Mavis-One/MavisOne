window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

// Formas de pagamento do layout 4.0 da NF-e. Os códigos são os oficiais — o
// mesmo conjunto que lib/nfePayloadBuilder.js aceita; qualquer outro vira '99'
// lá, então oferecer só estes evita a nota sair com "Outros" sem ninguém saber.
const NFE_FORMAS_PAGAMENTO = [
  { value: '01', label: '01 — Dinheiro' },
  { value: '02', label: '02 — Cheque' },
  { value: '03', label: '03 — Cartão de crédito' },
  { value: '04', label: '04 — Cartão de débito' },
  { value: '05', label: '05 — Crédito loja' },
  { value: '15', label: '15 — Boleto bancário' },
  { value: '16', label: '16 — Depósito bancário' },
  { value: '17', label: '17 — PIX' },
  { value: '18', label: '18 — Transferência bancária' },
  { value: '90', label: '90 — Sem pagamento' },
  { value: '99', label: '99 — Outros' }
];

const NFE_FOCUS_TIPO_OPERACAO_OPTIONS = [
  { value: 'VENDA', label: 'Venda' },
  { value: 'TRANSFERENCIA', label: 'Transferência' },
  { value: 'REMESSA', label: 'Remessa' },
  { value: 'RETORNO', label: 'Retorno' },
  { value: 'DEVOLUCAO', label: 'Devolução' },
  { value: 'BONIFICACAO', label: 'Bonificação' },
  // Complemento de ICMS não é venda: não entrega mercadoria, não baixa estoque
  // e não gera recebível. A tela muda de forma ao escolhê-lo.
  { value: 'COMPLEMENTO_ICMS', label: 'Complemento de ICMS' }
];

// Espelho, no navegador, do catálogo de lib/operacaoFiscal.js. Só o que a TELA
// precisa saber para se comportar; quem valida de verdade é o servidor — o
// front some numa aba fechada, o servidor não.
const NFE_FOCUS_COMPLEMENTO = 'COMPLEMENTO_ICMS';

const NFE_FOCUS_STATUS_BADGE = {
  RASCUNHO: 'finance-badge-muted',
  PROCESSANDO: 'finance-badge-info',
  AUTORIZADO: 'finance-badge-success',
  ERRO: 'finance-badge-danger',
  CANCELADO: 'finance-badge-muted',
  DENEGADO: 'finance-badge-danger',
  INUTILIZADO: 'finance-badge-muted'
};

window.MavisSubscreenRegistry.finance.emitir_nfe_focus = async function renderEmitirNfeFocus(ctx) {
  const { content, api, showToast, escapeHtml, state } = ctx;

  let estabelecimentos = [];
  let selectedEstabelecimentoId = '';
  let meta = { directory: [] };
  let selectedClienteId = '';
  let itens = [{ produtoId: '', descricao: '', codigoProduto: '', ncm: '', quantidade: 1, valorUnitario: 0, unidadeComercial: 'UN', origem: 0 }];
  let notasRecentes = [];
  let ultimoResultado = null;

  // Operação escolhida. É ela que decide a FORMA da tela: no complemento de
  // ICMS não há mercadoria a listar nem pagamento a informar — há uma nota
  // original a referenciar e um imposto a destacar.
  let tipoOperacao = 'VENDA';
  const ehComplemento = () => tipoOperacao === NFE_FOCUS_COMPLEMENTO;
  const complemento = { chave: '', numero: '', serie: '', baseIcms: 0, aliquota: 0, valorIcms: 0, informacoes: '' };
  // Editado à mão? Então parar de sobrescrever com o texto sugerido.
  let informacoesEditadas = false;

  const destinatario = { nome: '', documento: '', contribuinte: false, inscricaoEstadual: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '', codigoMunicipio: '' };

  // "Gerar NF-e" a partir de um pedido cai aqui. Antes caía na tela de
  // registro manual, que nunca chegava à SEFAZ — o pedido aparecia faturado e
  // a nota não existia para o fisco.
  //
  // O pedido é consumido (delete) para não reaparecer na próxima abertura da
  // tela: seria a nota errada, com os itens de um pedido antigo.
  const doPedido = state.nfeFromOrder || null;
  if (doPedido) delete state.nfeFromOrder;
  let orderIdOrigem = doPedido ? doPedido.orderId || '' : '';

  try {
    const res = await api('/api/fiscal/estabelecimentos');
    estabelecimentos = (res.estabelecimentos || []).filter((e) => e.ativo && e.emiteNfe);
  } catch (error) {
    showToast('Não foi possível carregar os estabelecimentos: ' + (error.message || error), 'error');
  }

  try {
    meta = await api('/api/finance/meta');
  } catch {
    // segue com diretório vazio — busca de cliente cadastrado fica indisponível
  }

  // Preenche a tela com o pedido. Feito DEPOIS do meta: é dele que sai o
  // endereço do cliente, e sem ele o destinatário sairia só com o nome.
  if (doPedido) {
    selectedClienteId = doPedido.clientSupplierId || '';
    const cliente = meta.directory.find((c) => c.id === selectedClienteId);
    destinatario.nome = cliente?.name || doPedido.clientName || '';
    destinatario.documento = cliente?.document || '';
    destinatario.inscricaoEstadual = cliente?.stateRegistration || '';
    destinatario.uf = cliente?.state || '';
    destinatario.municipio = cliente?.city || '';
    // Contribuinte se tem inscrição estadual: é o que decide indicador_ie e,
    // com ele, se a operação tem DIFAL.
    destinatario.contribuinte = Boolean(cliente?.stateRegistration);
    if (Array.isArray(doPedido.items) && doPedido.items.length) {
      itens = doPedido.items.map((item) => ({
        produtoId: item.produtoId || item.productId || '',
        descricao: item.description || '',
        codigoProduto: item.code || '',
        // NCM e origem vêm do CADASTRO do produto, no servidor. Deixar em
        // branco aqui é intencional: preencher com palpite faria a nota sair
        // com classificação diferente da do produto.
        ncm: '',
        quantidade: Number(item.quantity || 0),
        valorUnitario: Number(item.unitPrice || 0),
        unidadeComercial: item.unit || 'UN',
        origem: 0
      }));
    }
  }

  // Um lugar só para ler o destinatário: a nota comum e a complementar usam os
  // mesmos campos, e duas leituras divergiriam na primeira mudança de rótulo.
  function lerDestinatario(formData) {
    return {
      nome: formData.get('destNome'),
      documento: formData.get('destDocumento'),
      contribuinte: formData.get('destContribuinte') === 'on',
      inscricaoEstadual: formData.get('destIe'),
      cep: (formData.get('destCep') || '').replace(/\D/g, ''),
      logradouro: formData.get('destLogradouro'),
      numero: formData.get('destNumero'),
      complemento: formData.get('destComplemento'),
      bairro: formData.get('destBairro'),
      municipio: formData.get('destMunicipio'),
      uf: formData.get('destUf'),
      codigoMunicipio: formData.get('destCodigoMunicipio')
    };
  }

  function itemTotal(item) {
    return Math.round(Number(item.quantidade || 0) * Number(item.valorUnitario || 0) * 100) / 100;
  }

  function grandTotal() {
    return itens.reduce((sum, item) => sum + itemTotal(item), 0);
  }

  async function loadNotasRecentes() {
    if (!selectedEstabelecimentoId) { notasRecentes = []; return; }
    try {
      const res = await api(`/api/fiscal/nfe?estabelecimentoId=${encodeURIComponent(selectedEstabelecimentoId)}`);
      notasRecentes = (res.records || []).slice(0, 10);
    } catch (error) {
      notasRecentes = [];
    }
  }

  function directoryOptions(filterText) {
    const term = (filterText || '').trim().toLowerCase();
    const list = term
      ? meta.directory.filter((c) => c.name.toLowerCase().includes(term) || String(c.document || '').includes(term))
      : meta.directory;
    return list.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.document ? ` (${escapeHtml(c.document)})` : ''}</option>`).join('');
  }

  // Um produto cadastrado traz a própria classificação fiscal. Escolher pela
  // lista preenche a linha e trava NCM e origem: são atributos da mercadoria,
  // e digitá-los por emissão faria o mesmo produto sair com classificações
  // diferentes em notas diferentes. "Item avulso" continua liberando os campos
  // — serviço e mercadoria sem cadastro ainda precisam ser digitados.
  function opcoesProduto(item) {
    const lista = meta.produtos || [];
    return `<option value="">Item avulso</option>` + lista.map((p) => `
      <option value="${escapeHtml(p.id)}" ${item.produtoId === p.id ? 'selected' : ''}>
        ${escapeHtml(p.name)}${p.sku ? ` (${escapeHtml(p.sku)})` : ''}${p.ncm ? '' : ' — SEM NCM'}
      </option>`).join('');
  }

  function renderItemsRows() {
    return itens.map((item, index) => `
      <tr data-row="${index}">
        <td>
          <select data-field="produtoId" data-index="${index}" style="min-width:170px;">${opcoesProduto(item)}</select>
        </td>
        <td><input data-field="descricao" data-index="${index}" value="${escapeHtml(item.descricao)}" required placeholder="Descrição" style="min-width:160px;" /></td>
        <td><input data-field="codigoProduto" data-index="${index}" value="${escapeHtml(item.codigoProduto)}" placeholder="Código" style="width:90px;" /></td>
        <td><input data-field="ncm" data-index="${index}" value="${escapeHtml(item.ncm)}" required maxlength="8" inputmode="numeric" placeholder="8 dígitos" style="width:90px;" ${item.produtoId ? 'readonly title="Vem do cadastro do produto — altere em Estoque → Produtos."' : ''} /></td>
        <td><input type="number" step="0.01" min="0" data-field="quantidade" data-index="${index}" value="${item.quantidade}" style="width:80px;" /></td>
        <td><input type="number" step="0.01" min="0" data-field="valorUnitario" data-index="${index}" value="${item.valorUnitario}" style="width:100px;" /></td>
        <td><input data-field="unidadeComercial" data-index="${index}" value="${escapeHtml(item.unidadeComercial)}" style="width:70px;" /></td>
        <td class="nfe-item-total" data-row-total="${index}">${financeFormatBRL(itemTotal(item))}</td>
        <td><button type="button" class="icon-button" data-remove-item="${index}" title="Remover item" ${itens.length <= 1 ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6"></path></svg>
        </button></td>
      </tr>
    `).join('');
  }

  function renderResultado() {
    if (!ultimoResultado) return '';
    const badge = NFE_FOCUS_STATUS_BADGE[ultimoResultado.status] || 'finance-badge-muted';
    return `
      <div class="panel">
        <h3>Resultado da última emissão</h3>
        <p><span class="finance-badge ${badge}">${escapeHtml(ultimoResultado.status)}</span> Referência: ${escapeHtml(ultimoResultado.referencia)}</p>
        ${ultimoResultado.chaveAcesso ? `<p>Chave de acesso: <code>${escapeHtml(ultimoResultado.chaveAcesso)}</code></p>` : ''}
        ${ultimoResultado.mensagemSefaz ? `<p class="muted">${escapeHtml(ultimoResultado.mensagemSefaz)}</p>` : ''}
        ${ultimoResultado.urlDanfe ? `<p><a href="${escapeHtml(ultimoResultado.urlDanfe)}" target="_blank" rel="noopener">Ver DANFE</a></p>` : ''}
      </div>
    `;
  }

  function renderNotasRecentes() {
    if (!selectedEstabelecimentoId) return '';
    return `
      <div class="panel">
        <h3>Últimas NF-e deste estabelecimento</h3>
        ${notasRecentes.length ? `
          <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Referência</th><th>Status</th><th>Número</th><th>Valor</th><th>Data</th></tr></thead>
            <tbody>
              ${notasRecentes.map((nfe) => `
                <tr>
                  <td>${escapeHtml(nfe.referencia)}</td>
                  <td><span class="finance-badge ${NFE_FOCUS_STATUS_BADGE[nfe.status] || 'finance-badge-muted'}">${escapeHtml(nfe.status)}</span></td>
                  <td>${escapeHtml(nfe.numero || '—')}</td>
                  <td>${financeFormatBRL(Number(nfe.valorTotal || 0))}</td>
                  <td>${financeFormatDate(String(nfe.dataEmissao || '').slice(0, 10))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          </div>
        ` : '<p class="muted">Nenhuma NF-e emitida ainda por este estabelecimento.</p>'}
      </div>
    `;
  }

  function renderForm() {
    const today = new Date().toISOString().slice(0, 10);
    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Emitir NF-e (Focus NFe)</h3>
            <p class="muted">Transmite de verdade à SEFAZ via Focus NFe — diferente da "Nova NF-e Avulsa", que só registra localmente.</p>
          </div>
        </div>

        ${!estabelecimentos.length ? `
          <p class="form-error">Nenhum estabelecimento habilitado para emitir NF-e. Cadastre um em Configurações → Integrações → Empresas e estabelecimentos.</p>
        ` : `
        <form id="nfeFocusForm" class="form-grid">
          <div class="cadastro-tabs" role="tablist">
            <button type="button" class="cadastro-tab active" data-tab="emitente" role="tab" aria-selected="true"><span>1. Emitente</span></button>
            <button type="button" class="cadastro-tab" data-tab="destinatario" role="tab" aria-selected="false"><span>2. Destinatário</span></button>
            ${ehComplemento()
              ? '<button type="button" class="cadastro-tab" data-tab="complemento" role="tab" aria-selected="false"><span>3. Complemento de ICMS</span></button>'
              : `<button type="button" class="cadastro-tab" data-tab="itens" role="tab" aria-selected="false"><span>3. Itens</span></button>
                 <button type="button" class="cadastro-tab" data-tab="pagamento" role="tab" aria-selected="false"><span>4. Pagamento</span></button>`}
          </div>

          <div class="cadastro-tab-panel" data-tab-panel="emitente">
            <div class="row">
              <label>Estabelecimento emitente
                <select id="nfeFocusEstabSelect" required>
                  <option value="">Selecione</option>
                  ${estabelecimentos.map((e) => `<option value="${e.id}" ${e.id === selectedEstabelecimentoId ? 'selected' : ''}>${escapeHtml(e.razaoSocial)} — ${escapeHtml(fiscalFormatCnpjSimples(e.cnpj))}</option>`).join('')}
                </select>
              </label>
              <label>Tipo de operação (define a tributação)
                <select name="tipoOperacao">
                  ${NFE_FOCUS_TIPO_OPERACAO_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}
                </select>
              </label>
            </div>
            <label>Natureza da operação<input name="naturezaOperacao" required value="Venda de mercadoria" /></label>
            <label>Data de emissão<input type="date" name="dataEmissao" required value="${today}" /></label>
          </div>

          <div class="cadastro-tab-panel" data-tab-panel="destinatario" hidden>
            <label>Buscar cliente cadastrado<input type="text" id="nfeFocusClientSearch" placeholder="Buscar por nome ou documento" autocomplete="off" /></label>
            <select id="nfeFocusClientSelect">
              <option value="">Nenhum (preencher manualmente abaixo)</option>
              ${directoryOptions('')}
            </select>
            <div class="row">
              <label>Nome / Razão social<input name="destNome" required value="${escapeHtml(destinatario.nome)}" /></label>
              <label>CPF/CNPJ<input name="destDocumento" required data-documento value="${escapeHtml(destinatario.documento)}" /></label>
              <label><input type="checkbox" name="destContribuinte" /> Contribuinte de ICMS</label>
            </div>
            <label>Inscrição estadual (se contribuinte)<input name="destIe" value="${escapeHtml(destinatario.inscricaoEstadual)}" /></label>
            <div class="row">
              <label>CEP<input name="destCep" id="nfeFocusCep" maxlength="9" placeholder="00000-000" /></label>
              <div style="align-self:end;"><button type="button" class="secondary" id="nfeFocusBuscarCep">Buscar CEP</button></div>
            </div>
            <div class="row">
              <label>Logradouro<input name="destLogradouro" required /></label>
              <label>Número<input name="destNumero" required /></label>
              <label>Complemento<input name="destComplemento" /></label>
            </div>
            <div class="row">
              <label>Bairro<input name="destBairro" required /></label>
              <label>Município<input name="destMunicipio" required /></label>
              <label>UF<input name="destUf" maxlength="2" required /></label>
            </div>
            <input type="hidden" name="destCodigoMunicipio" />
          </div>

          ${ehComplemento() ? `
          <div class="cadastro-tab-panel" data-tab-panel="complemento" hidden>
            <p class="fiscal-aviso-homologacao">
              <strong>Nota complementar de ICMS.</strong> Não movimenta estoque, não gera
              contas a receber e não acrescenta valor de mercadoria — destaca apenas o imposto
              que faltou na nota original. O item sai como <strong>escritural</strong>
              (código CFOP5.949), com quantidade e valor zerados, conforme orientação da SEF/SC.
            </p>

            <div class="cadastro-section">
              <div class="cadastro-section-header"><h4>NF-e original</h4>
                <p>Obrigatória: a SEFAZ recusa uma complementar que não diga qual documento ela complementa.</p></div>
              <div class="cadastro-section-body">
                <label>Chave de acesso da NF-e original *
                  <input name="complementoChave" required inputmode="numeric" maxlength="44"
                    value="${escapeHtml(complemento.chave)}" placeholder="44 dígitos" />
                </label>
                <div class="row">
                  <label>Número<input name="complementoNumero" value="${escapeHtml(complemento.numero)}" /></label>
                  <label>Série<input name="complementoSerie" value="${escapeHtml(complemento.serie)}" /></label>
                </div>
              </div>
            </div>

            <div class="cadastro-section">
              <div class="cadastro-section-header"><h4>ICMS a complementar</h4>
                <p>A base é o valor que ficou de fora da nota original — não o valor do item, que é zero.</p></div>
              <div class="cadastro-section-body">
                <div class="row">
                  <label>Base de cálculo do ICMS (R$) *
                    <input name="complementoBase" type="number" step="0.01" min="0" required value="${complemento.baseIcms || ''}" />
                  </label>
                  <label>Alíquota (%) *
                    <input name="complementoAliquota" type="number" step="0.0001" min="0" max="100" required value="${complemento.aliquota || ''}" />
                  </label>
                  <label>Valor do ICMS (R$) *
                    <input name="complementoValor" type="number" step="0.01" min="0" required value="${complemento.valorIcms || ''}" />
                    <small class="muted">Calculado ao preencher base e alíquota. Pode ser ajustado para o valor efetivamente apurado.</small>
                  </label>
                </div>
              </div>
            </div>

            <div class="cadastro-section">
              <div class="cadastro-section-header"><h4>Informações complementares</h4>
                <p>Vai no corpo da nota. É o que liga este documento à nota original para quem lê o DANFE.</p></div>
              <div class="cadastro-section-body">
                <label>Texto *
                  <textarea name="complementoInformacoes" rows="3" required>${escapeHtml(complemento.informacoes)}</textarea>
                </label>
              </div>
            </div>
          </div>
          ` : ''}

          ${ehComplemento() ? '' : `
            <div class="table-scroll">
              <table class="table">
                <thead><tr><th>Produto</th><th>Descrição</th><th>Código</th><th>NCM</th><th>Qtd.</th><th>Valor unit.</th><th>Unid.</th><th>Total</th><th></th></tr></thead>
                <tbody id="nfeFocusItemsBody">${renderItemsRows()}</tbody>
              </table>
            </div>
            <div style="margin: 10px 0;"><button type="button" class="secondary" id="nfeFocusAddItemBtn">+ Adicionar item</button></div>
            <p class="finance-negative" style="font-size: 1.1rem;">Valor total: <strong id="nfeFocusGrandTotal">${financeFormatBRL(grandTotal())}</strong></p>
          </div>

          <div class="cadastro-tab-panel" data-tab-panel="pagamento" hidden>
            <p class="muted">
              O grupo de pagamento é <strong>obrigatório no layout 4.0</strong> — nota sem ele é
              rejeitada pela SEFAZ.
            </p>
            ${orderIdOrigem ? `
              <p class="muted">
                Esta nota vem de um pedido, e <strong>o contas a receber já é dele</strong> —
                as parcelas abaixo não serão criadas de novo. A forma de pagamento continua
                valendo: ela vai na nota.
              </p>
            ` : `
              <p class="muted">
                Sem pedido de origem, é daqui que sai o contas a receber: as parcelas são
                criadas em Lançamentos <strong>quando a SEFAZ autorizar</strong> a nota — não na
                hora de enviar, para uma nota rejeitada não deixar recebível para trás.
              </p>
            `}
            <div class="row">
              <label>Forma de pagamento
                <select name="formaPagamento">
                  ${NFE_FORMAS_PAGAMENTO.map((f) => `<option value="${f.value}" ${f.value === '99' ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}
                </select>
              </label>
              <label>Condição
                <select name="paymentType" id="nfeFocusPaymentType">
                  <option value="avista" selected>À vista</option>
                  <option value="parcelado">Parcelado</option>
                </select>
              </label>
            </div>
            <div class="row hidden" id="nfeFocusInstallmentFields">
              <label>Número de parcelas<input type="number" name="installmentsCount" min="2" max="60" step="1" value="2" /></label>
              <label>Intervalo entre parcelas (dias)<input type="number" name="installmentIntervalDays" min="1" value="30" /></label>
            </div>
          </div>
          `}
          <button type="submit" id="nfeFocusSubmitBtn">Emitir NF-e</button>
        </form>
        `}
      </div>

      ${renderResultado()}
      ${renderNotasRecentes()}
    `;

    attachHandlers();
    // Máscara e validação de CPF/CNPJ, iguais às do Cadastro de Pessoas.
    window.MavisDocumento?.ligarTodos(content);

    // Consulta do CNPJ do destinatário na Receita. Aqui ela paga mais do que
    // em qualquer outra tela: endereço errado numa NF-e é rejeição da SEFAZ ou
    // nota autorizada com dado divergente do cadastro nacional.
    const campoDoc = content.querySelector('[name="destDocumento"]');
    if (campoDoc) {
      const form = () => document.getElementById('nfeFocusForm');
      const preencher = (nome, valor) => {
        const campo = form()?.querySelector(`[name="${nome}"]`);
        // Só o que está vazio: quem escolheu um cliente cadastrado já trouxe
        // os dados dele, e a Receita costuma estar mais desatualizada.
        if (campo && !String(campo.value || '').trim() && valor) campo.value = valor;
      };
      window.MavisDocumento.ligarConsultaCnpj(campoDoc, {
        api,
        showToast,
        devePreencherSozinho: () => !String(form()?.querySelector('[name="destNome"]')?.value || '').trim(),
        aoEncontrar: (dados) => {
          preencher('destNome', dados.razaoSocial || dados.nomeFantasia);
          preencher('destCep', dados.cep);
          preencher('destLogradouro', dados.logradouro);
          preencher('destNumero', dados.numero);
          preencher('destComplemento', dados.complemento);
          preencher('destBairro', dados.bairro);
          preencher('destMunicipio', dados.municipio);
          preencher('destUf', dados.uf);
          // O código IBGE do município é campo da nota: preencher errado é
          // rejeição na hora de transmitir. Só entra quando a Receita mandou
          // o código IBGE de verdade — o "Buscar CEP" continua sendo a outra
          // forma de obtê-lo.
          preencher('destCodigoMunicipio', dados.codigoMunicipioIbge);
          // Quem tem CNPJ é presumidamente contribuinte; a inscrição estadual
          // não vem da Receita federal, então o checkbox fica marcado e a IE
          // continua em branco para ser preenchida à mão.
          const contribuinte = form()?.querySelector('[name="destContribuinte"]');
          if (contribuinte && !contribuinte.checked) contribuinte.checked = true;
        }
      });
    }
  }

  function refreshItemsTable() {
    const tbody = document.getElementById('nfeFocusItemsBody');
    if (tbody) tbody.innerHTML = renderItemsRows();
    attachItemsHandlers();
    refreshGrandTotal();
  }

  function refreshGrandTotal() {
    const el = document.getElementById('nfeFocusGrandTotal');
    if (el) el.textContent = financeFormatBRL(grandTotal());
  }

  function attachItemsHandlers() {
    document.querySelectorAll('#nfeFocusItemsBody input').forEach((input) => {
      input.addEventListener('input', () => {
        const index = Number(input.dataset.index);
        const field = input.dataset.field;
        itens[index][field] = field === 'quantidade' || field === 'valorUnitario' ? Number(input.value || 0) : input.value;
        const totalCell = document.querySelector(`[data-row-total="${index}"]`);
        if (totalCell) totalCell.textContent = financeFormatBRL(itemTotal(itens[index]));
        refreshGrandTotal();
      });
    });
    // Escolher o produto preenche a linha a partir do cadastro. Redesenha a
    // tabela porque o NCM passa a ser somente-leitura — e volta a ser editável
    // se a linha virar item avulso.
    document.querySelectorAll('#nfeFocusItemsBody select[data-field="produtoId"]').forEach((select) => {
      select.addEventListener('change', () => {
        const index = Number(select.dataset.index);
        const produto = (meta.produtos || []).find((p) => p.id === select.value);
        if (!produto) {
          itens[index] = { ...itens[index], produtoId: '' };
          refreshItemsTable();
          return;
        }
        itens[index] = {
          ...itens[index],
          produtoId: produto.id,
          descricao: produto.name,
          codigoProduto: produto.sku || '',
          ncm: produto.ncm || '',
          // Preço do cadastro é ponto de partida: desconto e negociação
          // mudam por venda, então o campo continua editável.
          valorUnitario: Number(produto.salePrice || itens[index].valorUnitario || 0),
          unidadeComercial: produto.unidadeComercial || 'UN',
          origem: produto.origem === null || produto.origem === undefined ? 0 : Number(produto.origem)
        };
        if (!produto.ncm) {
          showToast(`"${produto.name}" está sem NCM no cadastro — preencha em Estoque → Produtos, senão a emissão será recusada.`, 'warning', 7000);
        }
        refreshItemsTable();
      });
    });

    document.querySelectorAll('[data-remove-item]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const index = Number(btn.dataset.removeItem);
        if (itens.length <= 1) return;
        itens.splice(index, 1);
        refreshItemsTable();
      });
    });
  }

  function attachHandlers() {
    content.querySelectorAll('.cadastro-tab').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        const target = tabBtn.dataset.tab;
        content.querySelectorAll('.cadastro-tab').forEach((btn) => {
          const isActive = btn === tabBtn;
          btn.classList.toggle('active', isActive);
          btn.setAttribute('aria-selected', String(isActive));
        });
        content.querySelectorAll('.cadastro-tab-panel').forEach((panel) => {
          panel.hidden = panel.dataset.tabPanel !== target;
        });
      });
    });

    document.getElementById('nfeFocusEstabSelect')?.addEventListener('change', async (event) => {
      selectedEstabelecimentoId = event.target.value;
      await loadNotasRecentes();
      renderForm();
    });

    document.getElementById('nfeFocusClientSearch')?.addEventListener('input', (event) => {
      const select = document.getElementById('nfeFocusClientSelect');
      if (select) select.innerHTML = `<option value="">Nenhum (preencher manualmente abaixo)</option>${directoryOptions(event.target.value)}`;
    });

    document.getElementById('nfeFocusClientSelect')?.addEventListener('change', (event) => {
      const id = event.target.value;
      selectedClienteId = id;
      const found = meta.directory.find((c) => c.id === id);
      if (!found) return;
      const form = document.getElementById('nfeFocusForm');
      if (!form) return;
      form.querySelector('[name="destNome"]').value = found.name || '';
      form.querySelector('[name="destDocumento"]').value = found.document || '';
      form.querySelector('[name="destUf"]').value = found.state || '';
      form.querySelector('[name="destMunicipio"]').value = found.city || '';
      form.querySelector('[name="destIe"]').value = found.stateRegistration || '';
    });

    document.getElementById('nfeFocusBuscarCep')?.addEventListener('click', async () => {
      const form = document.getElementById('nfeFocusForm');
      const cepInput = form.querySelector('[name="destCep"]');
      const cepDigits = (cepInput.value || '').replace(/\D/g, '');
      if (cepDigits.length !== 8) {
        showToast('Informe um CEP com 8 dígitos.', 'warning');
        return;
      }
      try {
        const res = await api(`/api/cep/${cepDigits}`);
        const addr = res.address;
        form.querySelector('[name="destLogradouro"]').value = addr.street || '';
        form.querySelector('[name="destBairro"]').value = addr.neighborhood || '';
        form.querySelector('[name="destMunicipio"]').value = addr.city || '';
        form.querySelector('[name="destUf"]').value = addr.state || '';
        form.querySelector('[name="destCodigoMunicipio"]').value = addr.ibgeCityCode || '';
        showToast('Endereço encontrado.', 'success');
      } catch (error) {
        showToast(error.message || 'CEP não encontrado.', 'error');
      }
    });

    attachItemsHandlers();

    document.getElementById('nfeFocusAddItemBtn')?.addEventListener('click', () => {
      itens.push({ produtoId: '', descricao: '', codigoProduto: '', ncm: '', quantidade: 1, valorUnitario: 0, unidadeComercial: 'UN', origem: 0 });
      refreshItemsTable();
    });

    // Os campos de parcela só existem quando "Parcelado" está escolhido —
    // pedir número de parcelas para uma venda à vista é ruído.
    document.getElementById('nfeFocusPaymentType')?.addEventListener('change', (evento) => {
      document.getElementById('nfeFocusInstallmentFields')
        ?.classList.toggle('hidden', evento.target.value !== 'parcelado');
    });

    // Trocar de operação redesenha a tela: no complemento não há aba de itens
    // nem de pagamento, e há uma de nota original. Esconder por CSS deixaria
    // campos `required` invisíveis travando o submit sem dizer onde.
    document.querySelector('[name="tipoOperacao"]')?.addEventListener('change', (evento) => {
      tipoOperacao = evento.target.value;
      renderForm();
    });

    // ICMS = base × alíquota, recalculado a cada digitação — mas o campo do
    // valor continua editável: o complemento pode ser uma diferença apurada,
    // que não sai de uma multiplicação simples.
    const recalcularIcms = () => {
      const form = document.getElementById('nfeFocusForm');
      if (!form) return;
      const base = Number(form.querySelector('[name="complementoBase"]')?.value || 0);
      const aliquota = Number(form.querySelector('[name="complementoAliquota"]')?.value || 0);
      const campoValor = form.querySelector('[name="complementoValor"]');
      if (!campoValor) return;
      complemento.baseIcms = base;
      complemento.aliquota = aliquota;
      const calculado = Math.round(((base * aliquota) / 100 + Number.EPSILON) * 100) / 100;
      complemento.valorIcms = calculado;
      campoValor.value = calculado ? calculado.toFixed(2) : '';
    };
    document.querySelector('[name="complementoBase"]')?.addEventListener('input', recalcularIcms);
    document.querySelector('[name="complementoAliquota"]')?.addEventListener('input', recalcularIcms);
    document.querySelector('[name="complementoValor"]')?.addEventListener('input', (evento) => {
      complemento.valorIcms = Number(evento.target.value || 0);
    });

    // Texto sugerido das informações complementares, montado a partir da nota
    // original. Para de se atualizar assim que o usuário escreve algo — o que
    // ele digitou vale mais do que a sugestão.
    const atualizarTextoComplemento = () => {
      const form = document.getElementById('nfeFocusForm');
      const campo = form?.querySelector('[name="complementoInformacoes"]');
      if (!campo || informacoesEditadas) return;
      const chave = (form.querySelector('[name="complementoChave"]')?.value || '').replace(/\D/g, '');
      const numero = form.querySelector('[name="complementoNumero"]')?.value || '';
      const serie = form.querySelector('[name="complementoSerie"]')?.value || '';
      const partes = [];
      if (numero) partes.push(`Nº ${numero}`);
      if (serie) partes.push(`SÉRIE ${serie}`);
      if (chave) partes.push(`CHAVE DE ACESSO ${chave}`);
      campo.value = `NF-E COMPLEMENTAR DE ICMS REFERENTE À NF-E${partes.length ? ' ' + partes.join(', ') : ''}. `
        + 'COMPLEMENTO DO VALOR DO ICMS NÃO DESTACADO NA NF-E ORIGINAL.';
      complemento.informacoes = campo.value;
    };
    ['complementoChave', 'complementoNumero', 'complementoSerie'].forEach((nome) => {
      document.querySelector(`[name="${nome}"]`)?.addEventListener('input', (evento) => {
        complemento[nome.replace('complemento', '').toLowerCase()] = evento.target.value;
        atualizarTextoComplemento();
      });
    });
    document.querySelector('[name="complementoInformacoes"]')?.addEventListener('input', (evento) => {
      informacoesEditadas = true;
      complemento.informacoes = evento.target.value;
    });
    if (ehComplemento()) atualizarTextoComplemento();

    document.getElementById('nfeFocusForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!selectedEstabelecimentoId) {
        showToast('Selecione o estabelecimento emitente.', 'warning');
        return;
      }
      const submitBtn = document.getElementById('nfeFocusSubmitBtn');
      if (submitBtn?.disabled) return;
      if (submitBtn) submitBtn.disabled = true;

      const formData = new FormData(event.target);

      // A NOTA COMPLEMENTAR TEM OUTRA FORMA.
      //
      // Um único item escritural, quantidade e valor zerados, o ICMS carregado
      // por fora e a chave da original referenciada. Nada de itens da tabela,
      // nada de pagamento: não há mercadoria nem recebível.
      if (ehComplemento()) {
        const chave = String(formData.get('complementoChave') || '').replace(/\D/g, '');
        const valorIcms = Number(formData.get('complementoValor') || 0);
        // Barrado aqui só para poupar a viagem: quem realmente valida é o
        // servidor, que a aba fechada não some.
        if (chave.length !== 44) {
          showToast('Informe a chave de acesso da NF-e original (44 dígitos).', 'error');
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        if (!(valorIcms > 0)) {
          showToast('Informe o valor do ICMS a complementar.', 'error');
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        const corpo = {
          estabelecimentoId: selectedEstabelecimentoId,
          tipoOperacao: NFE_FOCUS_COMPLEMENTO,
          naturezaOperacao: formData.get('naturezaOperacao') || 'Complemento de ICMS',
          dataEmissao: formData.get('dataEmissao') ? new Date(formData.get('dataEmissao')).toISOString() : undefined,
          destinatario: lerDestinatario(formData),
          referencias: [{ chaveAcesso: chave }],
          // O servidor resolve o produto escritural pelo SKU e recusa se ele
          // não for escritural — não dá para mandar uma mercadoria disfarçada.
          itens: [{
            produtoEscritural: 'CFOP5.949',
            quantidade: 0,
            valorUnitario: 0,
            baseIcms: Number(formData.get('complementoBase') || 0),
            aliquotaIcms: Number(formData.get('complementoAliquota') || 0),
            valorIcms
          }],
          informacoesAdicionais: formData.get('complementoInformacoes') || ''
        };
        try {
          const result = await api('/api/fiscal/nfe/emitir', { method: 'POST', body: JSON.stringify(corpo) });
          ultimoResultado = result.nfe;
          showToast(`NF-e complementar ${result.nfe.status === 'AUTORIZADO' ? 'autorizada' : String(result.nfe.status).toLowerCase()}.`,
            result.nfe.status === 'ERRO' ? 'error' : 'success');
        } catch (error) {
          showToast(error.message || 'Erro ao emitir a NF-e complementar.', 'error');
        } finally {
          if (submitBtn) submitBtn.disabled = false;
          await loadNotasRecentes();
          renderForm();
        }
        return;
      }

      const body = {
        estabelecimentoId: selectedEstabelecimentoId,
        tipoOperacao: formData.get('tipoOperacao'),
        naturezaOperacao: formData.get('naturezaOperacao'),
        dataEmissao: formData.get('dataEmissao') ? new Date(formData.get('dataEmissao')).toISOString() : undefined,
        destinatario: {
          nome: formData.get('destNome'),
          documento: formData.get('destDocumento'),
          contribuinte: formData.get('destContribuinte') === 'on',
          inscricaoEstadual: formData.get('destIe'),
          cep: (formData.get('destCep') || '').replace(/\D/g, ''),
          logradouro: formData.get('destLogradouro'),
          numero: formData.get('destNumero'),
          complemento: formData.get('destComplemento'),
          bairro: formData.get('destBairro'),
          municipio: formData.get('destMunicipio'),
          uf: formData.get('destUf'),
          codigoMunicipio: formData.get('destCodigoMunicipio')
        },
        itens: itens.map((item) => ({
          // O servidor relê a classificação fiscal pelo produtoId e ignora o
          // que veio digitado — o que vai aqui é só o ponto de partida da tela.
          produtoId: item.produtoId || '',
          descricao: item.descricao,
          codigoProduto: item.codigoProduto,
          ncm: String(item.ncm || '').replace(/\D/g, ''),
          quantidade: Number(item.quantidade || 0),
          valorUnitario: Number(item.valorUnitario || 0),
          unidadeComercial: item.unidadeComercial || 'UN',
          origem: Number(item.origem || 0)
        })),
        // Grupo obrigatório do layout 4.0 — nota sem ele é rejeitada. Uma
        // parcela única com o total: o parcelamento é condição comercial e
        // vira contas a receber, não N formas de pagamento na nota.
        pagamentos: [{ forma: formData.get('formaPagamento') || '99', valor: grandTotal() }],
        // Com pedido de origem, o servidor NÃO gera contas a receber: quem
        // gerou foi o pedido, e um segundo recebível pelo mesmo valor só
        // apareceria quando a conciliação não fechasse.
        orderId: orderIdOrigem || undefined,
        // Sem pedido de origem, é isto que manda o servidor gerar o contas a
        // receber quando a SEFAZ autorizar.
        paymentType: formData.get('paymentType') || 'avista',
        installmentsCount: Number(formData.get('installmentsCount') || 1),
        installmentIntervalDays: Number(formData.get('installmentIntervalDays') || 30)
      };

      try {
        const result = await api('/api/fiscal/nfe/emitir', { method: 'POST', body: JSON.stringify(body) });
        ultimoResultado = result.nfe;
        showToast(`NF-e ${result.nfe.status === 'AUTORIZADO' ? 'autorizada' : result.nfe.status.toLowerCase()}.`, result.nfe.status === 'ERRO' ? 'error' : 'success');
      } catch (error) {
        showToast(error.message || 'Erro ao emitir NF-e.', 'error');
      } finally {
        await loadNotasRecentes();
        ultimoResultado = notasRecentes[0] || ultimoResultado;
        renderForm();
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  renderForm();
};

// "Nova NF-e Avulsa" É ESTA TELA.
//
// Avulsa quer dizer nota emitida SEM pedido de origem — e é exatamente o que
// esta tela faz: destinatário e itens preenchidos na hora, sem depender de
// venda nenhuma. Existia uma segunda tela com esse nome que gravava um
// registro local e nunca chegava à SEFAZ; quem a usasse acharia que emitiu.
// Duas telas com o mesmo propósito, e a do nome certo era a que não emitia.
//
// Registrada aqui como apelido, e não copiada: uma cópia divergiria na
// primeira correção feita só de um lado.
window.MavisSubscreenRegistry.finance.nova_nfe_avulsa =
  window.MavisSubscreenRegistry.finance.emitir_nfe_focus;

function fiscalFormatCnpjSimples(digits) {
  const clean = String(digits || '').replace(/\D/g, '');
  if (clean.length !== 14) return digits || '';
  return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
