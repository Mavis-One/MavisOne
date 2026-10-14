window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

const FINANCE_TYPE_TOGGLE = [
  { value: 'RECEITA', label: 'Receita' },
  { value: 'DESPESA', label: 'Despesa' },
  { value: 'TRANSFERENCIA', label: 'Transferência' }
];

window.MavisSubscreenRegistry.finance.novo_lancamento = async function renderFinanceNovoLancamento(ctx) {
  const { content, api, showToast, state, loadModule, escapeHtml } = ctx;

  let meta = { categories: [], costCenters: [], bankAccounts: [], directory: [], estabelecimentos: [], contasPorEstabelecimento: [] };
  // AS DUAS CARGAS SAEM JUNTAS, e o meta só com o que esta tela lê (fase DS).
  //
  // Eram em fila: o meta inteiro (2.818 KB) e só depois o lançamento em edição.
  // Uma não depende da outra. E do meta esta tela não lê produtos (só a
  // emissão de NF-e lê), e do diretório lê id, nome e código — o recorte
  // `resumido`, 548 KB no lugar de 2.818 (169 KB no fio, contra 569).
  const idEmEdicao = state.financeEditEntryId;
  state.financeEditEntryId = null;
  // EDIÇÃO DE TÍTULO (14/10/2026) é esta mesma tela com outro nome. Sem título
  // escolhido (F5, "Novo Lançamento" de dentro dela) ela volta a ser a de novo.
  if (state.activeSub === 'edicao_titulo' && !idEmEdicao) {
    state.activeSub = 'novo_lancamento';
    if (typeof renderApp === 'function') renderApp();
  }
  // Vindo de Contas a Pagar / a Receber, o novo nasce no tipo da tela.
  const tipoSugerido = state.financeNovoTipo;
  state.financeNovoTipo = null;
  const [respostaMeta, respostaEdicao] = await Promise.allSettled([
    api('/api/finance/meta?produtos=0&diretorio=resumido'),
    idEmEdicao ? api(`/api/finance/entries/${idEmEdicao}`) : Promise.resolve(null)
  ]);
  if (respostaMeta.status === 'fulfilled') {
    meta = respostaMeta.value;
  } else {
    // segue com metadados vazios
    showToast('Não foi possível carregar categorias/centros de custo/contas bancárias. Os campos correspondentes ficarão vazios.', 'warning');
  }

  let editEntry = null;
  if (idEmEdicao) {
    if (respostaEdicao.status === 'fulfilled') {
      editEntry = respostaEdicao.value.entry;
    } else {
      showToast('Não foi possível carregar o lançamento para edição.', 'error');
    }
  }

  // Fase EI: "Voltar ao pedido" só para lançamento DAQUELE pedido.
  //
  // state.financeReturnTo nasce ao faturar (app.js, mudarStatus) e só era
  // zerado no clique do próprio botão: "Ver Lançamento" ou sair da tela o
  // deixavam ali, e uma despesa de luz cadastrada horas depois oferecia voltar
  // ao pedido antigo, abrindo-o em edição. Conferir o pedido do lançamento
  // serve aos dois fluxos do faturamento: uma parcela só, ou várias editadas
  // uma a uma a partir da lista filtrada pelo pedido.
  const voltaAoPedido = state.financeReturnTo && editEntry && editEntry.referenceId
    && editEntry.referenceId === state.financeReturnTo.recordId
    ? state.financeReturnTo
    : null;

  // Fase EI: a data de HOJE no relógio de quem usa, e não em UTC. O
  // `toISOString()` dá a data de Greenwich: em SC (UTC-3), das 21h à meia-noite
  // isso já é amanhã, e a despesa lançada às 22h caía no dia (ou no mês)
  // seguinte no fluxo de caixa. Mesmo cálculo do hoje() de fiscal/subs/arquivos.js.
  function hojeLocal() {
    const agora = new Date();
    return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
  }

  // FASE CD — POR QUAL ESTABELECIMENTO ESTE LANCAMENTO E'.
  //
  // Entra preenchido com o da pessoa, que e' o caso comum e nao pede clique
  // nenhum. Editando um lancamento antigo, vale o que ele ja tem — inclusive
  // vazio, que e' como nasceram todos os anteriores a esta fase.
  const REGRA = window.MavisContasPorEstabelecimento;
  const podeTrocarEstab = meta.podeTrocarEstabelecimento === true;
  let estabelecimentoAtual = editEntry
    ? (editEntry.estabelecimentoId || '')
    : (meta.estabelecimentoDoUsuario || '');
  // O campo so' aparece quando ha' o que dizer: sem estabelecimento cadastrado,
  // ou com a pessoa presa ao seu e sem vinculo nenhum, ele seria um select com
  // uma opcao so' — ruido no formulario mais usado do Financeiro.
  const mostrarEstab = Boolean(REGRA)
    && (meta.estabelecimentos || []).length > 0
    && (podeTrocarEstab || estabelecimentoAtual);

  let formType = editEntry ? String(editEntry.type).toUpperCase() : (tipoSugerido || 'DESPESA');
  // Vinculado a pedido/NF-e: dá para editar, mas só o que a origem não possui.
  // Travar na tela é o que evita o beco sem saída — antes o formulário aceitava
  // tudo e o servidor recusava depois de preenchido.
  const vinculado = Boolean(editEntry && editEntry.vinculo);
  const travado = (campo) => (vinculado && (editEntry.camposTravados || []).includes(campo)
    ? 'readonly tabindex="-1" title="Vem do pedido/NF-e de origem e não pode ser alterado aqui."'
    : '');

  // O cliente/fornecedor do lançamento: UM campo de busca, não um par
  // "digite aqui / escolha ali".
  //
  // Medido no navegador com os dados reais, antes: <select name="clientSupplierId">
  // com 6.493 <option> e 6.546 nós no DOM numa tela de 13 campos. E o par era
  // pior do que o número sugere — o texto digitado reconstruía os 6.493
  // <option> A CADA TECLA, e escolher ainda exigia um segundo gesto no campo
  // de baixo, que não dizia estar ligado ao de cima.
  //
  // O código entra no rótulo porque é como o cadastro é chamado no dia a dia
  // ("o 6443"), e porque há nomes repetidos entre as 6.492 pessoas — mesmo
  // motivo do SKU no rótulo do produto (ver shared/rotulo_produto.js).
  function opcoesDoDiretorio() {
    // O CPF/CNPJ entra para a busca achar por ele (14/10/2026) e aparece ao
    // lado do nome, como na Nova Venda.
    return (meta.directory || []).map((c) => ({
      value: c.id,
      label: c.code ? `${c.name} (${c.code})` : c.name,
      documento: c.document || '',
      // Nome fantasia: acha pelo nome da loja, e aparece ao lado para dizer
      // por que a opção veio.
      buscaExtra: c.tradeName || '',
      detalhe: [c.tradeName, typeof formatarDocumentoParaBusca === 'function' ? formatarDocumentoParaBusca(c.document) : ''].filter(Boolean).join(' · ')
    }));
  }

  function opcoesDePlano() {
    return meta.categories.map((c) => ({ value: c.id, label: c.name }));
  }
  // FASE EK (14/10/2026): o centro de custo vale para as empresas que o
  // usuário vinculou a ele (vazio = todas). O campo mostra os da empresa do
  // lançamento; o já gravado continua aparecendo, mesmo de outra empresa.
  function centroValeAqui(c) {
    const ids = Array.isArray(c.estabelecimentoIds) ? c.estabelecimentoIds : [];
    return !ids.length || !estabelecimentoAtual || ids.includes(estabelecimentoAtual);
  }
  function opcoesDeCentro(selecionado) {
    return meta.costCenters
      .filter((c) => centroValeAqui(c) || c.id === selecionado)
      .map((c) => ({ value: c.id, label: c.name }));
  }
  /**
   * As contas que ESTE estabelecimento pode usar (fase CD).
   *
   * Filtra pela MESMA funcao que o servidor usa para recusar a gravacao — o
   * arquivo compartilhado e' um so'. Sem isso, a lista ofereceria uma conta que
   * o servidor recusa, e a pessoa aprenderia a desconfiar da tela.
   *
   * Sem a regra carregada, mostra tudo: e' o comportamento anterior a esta
   * fase, e esconder contas por causa de um <script> que nao carregou seria
   * pior do que mostrar demais — o servidor continua recusando o que nao vale.
   */
  function contasDisponiveis() {
    if (!REGRA || !estabelecimentoAtual) return meta.bankAccounts;
    return REGRA.contasDoEstabelecimento({
      contas: meta.bankAccounts,
      estabelecimentoId: estabelecimentoAtual,
      estabelecimentos: meta.estabelecimentos || [],
      vinculos: meta.contasPorEstabelecimento || []
    });
  }

  function opcoesDeConta(selectedId) {
    const lista = contasDisponiveis();
    // A conta JA GRAVADA num lancamento antigo continua na lista mesmo que
    // hoje nao seja permitida. Tira-la faria o campo abrir em branco ao editar
    // e o primeiro salvamento apagaria a conta do lancamento sem ninguem pedir.
    const gravada = selectedId && !lista.some((c) => c.id === selectedId)
      ? meta.bankAccounts.find((c) => c.id === selectedId)
      : null;
    const paraMostrar = gravada ? [gravada, ...lista] : lista;
    return paraMostrar.map((c) => ({
      value: c.id,
      label: `${c.name}${gravada && c.id === gravada.id ? ' (não liberada para este estabelecimento)' : ''}`
    }));
  }

  // CONTA, PLANO DE CONTAS E CENTRO DE CUSTO SE DIGITAM (14/10/2026, pedido do
  // usuário): o mesmo campo de busca do cliente/fornecedor, em vez de <select>.
  // `kind` é o cadastro que o "+" ao lado cria; `opcoes` monta a lista na hora,
  // porque conta e centro mudam com o estabelecimento.
  const CAMPOS_DE_BUSCA = {
    financeSourceAccount: { name: 'sourceBankAccountId', kind: 'bankAccount', opcoes: opcoesDeConta, rotulo: 'Conta de origem' },
    financeTargetAccount: { name: 'targetBankAccountId', kind: 'bankAccount', opcoes: opcoesDeConta, rotulo: 'Conta de destino' },
    financeBankAccount: { name: 'bankAccountId', kind: 'bankAccount', opcoes: opcoesDeConta, rotulo: 'Conta bancária' },
    financeCategory: { name: 'category', kind: 'category', opcoes: opcoesDePlano, rotulo: 'Plano de Contas' },
    financeCostCenter: { name: 'costCenter', kind: 'costCenter', opcoes: opcoesDeCentro, rotulo: 'Centro de custo' }
  };
  const VALOR_GRAVADO = {
    financeSourceAccount: () => (editEntry ? editEntry.bankAccountId : ''),
    financeTargetAccount: () => (editEntry ? editEntry.targetBankAccountId : ''),
    financeBankAccount: () => (editEntry ? editEntry.bankAccountId : ''),
    financeCategory: () => (editEntry ? editEntry.category : ''),
    financeCostCenter: () => (editEntry ? editEntry.costCenter : '')
  };

  function campoDeBusca(id, valor = VALOR_GRAVADO[id]() || '') {
    const campo = CAMPOS_DE_BUSCA[id];
    return renderSearchableSelect({
      id,
      name: campo.name,
      options: campo.opcoes(valor),
      selectedValue: valor,
      placeholder: 'Digite para buscar...'
    });
  }

  /** Redesenha UM campo de busca (lista nova) e o religa, sem tocar no resto do formulário. */
  function refazerCampoDeBusca(id, valor) {
    const wrapper = document.getElementById(`${id}Wrapper`);
    if (!wrapper) return;
    wrapper.outerHTML = campoDeBusca(id, valor);
    ligarCampoDeBusca(id, valor);
  }

  function ligarCampoDeBusca(id, valor) {
    if (typeof attachSearchableSelect !== 'function') return;
    const valorAtual = valor !== undefined ? valor : (document.getElementById(`${id}Value`)?.value || '');
    attachSearchableSelect({ id, options: CAMPOS_DE_BUSCA[id].opcoes(valorAtual) });
  }

  function nomeDoEstab(e) {
    const nome = e.nomeFantasia || e.razaoSocial || 'Sem nome';
    return String(e.tipo || '').toUpperCase() === 'MATRIZ' ? `${nome} (matriz)` : nome;
  }

  // Fase DR: so' os estabelecimentos liberados para esta pessoa (null = todos),
  // mais o que o lancamento ja' tem -- sem ele, editar um lancamento de outra
  // filial abriria o select em outro valor e o salvamento trocaria a filial.
  const liberados = Array.isArray(meta.estabelecimentosLiberados) ? meta.estabelecimentosLiberados : null;
  function estabelecimentoOptions() {
    return (meta.estabelecimentos || [])
      .filter((e) => !liberados || liberados.includes(e.id) || e.id === estabelecimentoAtual)
      .map((e) => `<option value="${e.id}" ${estabelecimentoAtual === e.id ? 'selected' : ''}>${escapeHtml(nomeDoEstab(e))}</option>`)
      .join('');
  }

  function renderForm() {
    const isReceita = formType === 'RECEITA';
    const isTransfer = formType === 'TRANSFERENCIA';
    const today = hojeLocal();

    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            ${/* Fase AT. O título dizia só "Editar Lançamento", e o subtítulo
                 mostrava os oito últimos caracteres do id interno ("41196-9q1")
                 — um pedaço de identificador que ninguém dita ao telefone, não
                 ordena e não se procura. Agora é o número do próprio lançamento.

                 `rotulo` devolve só "Editar Lançamento" quando o lançamento não
                 tem número (registro anterior à migração): melhor do que
                 "Editar Lançamento (sem número)", que faz procurar defeito onde
                 só há registro antigo. Ver shared/lancamento_codigo.js. */''}
            <h3>${editEntry
              ? escapeHtml(window.MavisLancamentoCodigo.rotulo(editEntry.code, 'Edição de Título'))
              : 'Novo Lançamento'}</h3>
          </div>
        </div>
        ${vinculado ? `
          <p class="prompt-aviso">
            <strong>Lançamento gerado ${editEntry.vinculo === 'nfe' ? 'por uma NF-e' : 'por um pedido'}.</strong>
            Valor, data, descrição e cliente vêm de lá e aparecem travados aqui —
            ${editEntry.vinculo === 'nfe'
              ? 'corrigi-los exige cancelar a nota e emitir outra.'
              : 'para mudá-los, corrija o pedido de origem e o financeiro acompanha.'}
            Vencimento, conta bancária, plano de contas, centro de custo, documento e
            observação você ajusta normalmente por aqui.
          </p>` : ''}

        <div class="finance-period-group" role="tablist" style="margin-bottom: 18px;">
          ${FINANCE_TYPE_TOGGLE.map((opt) => `<button type="button" class="finance-pill ${formType === opt.value ? 'active' : ''}" data-type="${opt.value}" ${editEntry ? 'disabled' : ''}>${opt.label}</button>`).join('')}
        </div>

        <form id="financeEntryForm" class="form-grid">
          ${mostrarEstab ? `
          <div class="row">
            <label>Estabelecimento
              <select name="estabelecimentoId" id="financeEstabSelect" ${podeTrocarEstab ? '' : 'disabled title="Você lança pelo seu próprio estabelecimento. Quem administra o sistema libera a troca em Configurações › Usuários."'}>
                ${podeTrocarEstab && !liberados ? '<option value="">Nenhum</option>' : ''}
                ${estabelecimentoOptions()}
              </select>
            </label>
          </div>` : ''}

          <div class="row">
            <label>Data<input type="date" name="date" required value="${editEntry ? editEntry.date : today}" ${travado('date')} /></label>
            <label>Vencimento<input type="date" name="dueDate" required value="${editEntry ? editEntry.dueDate : today}" /></label>
            <label>Valor<input type="number" step="0.01" min="0.01" name="amount" required value="${editEntry ? editEntry.amountPrevisto : ''}" ${travado('amount')} /></label>
          </div>

          ${isTransfer ? `
            <div class="row">
              <label>Conta de origem
                <div class="finance-inline-select">
                  ${campoDeBusca('financeSourceAccount')}
                  <button type="button" class="icon-button edit" data-inline-add="bankAccount" data-inline-alvo="financeSourceAccount" title="Nova conta bancária">+</button>
                </div>
              </label>
              <label>Conta de destino
                <div class="finance-inline-select">
                  ${campoDeBusca('financeTargetAccount')}
                  <button type="button" class="icon-button edit" data-inline-add="bankAccount" data-inline-alvo="financeTargetAccount" title="Nova conta bancária">+</button>
                </div>
              </label>
            </div>
          ` : `
            <div class="row">
              <label>${isReceita ? 'Cliente' : 'Fornecedor'}
                ${renderSearchableSelect({
      id: 'financeParty',
      name: 'clientSupplierId',
      options: opcoesDoDiretorio(),
      selectedValue: (editEntry && editEntry.clientSupplierId) || '',
      placeholder: 'Buscar por nome, código ou CPF/CNPJ...',
      // Vinculado a pedido/NF-e: mostra de quem é, não deixa trocar. A
      // travação vem no HTML, não depois — ver renderSearchableSelect.
      readonly: vinculado
    })}
              </label>
              <label>Nome livre (se não cadastrado)<input name="clientSupplierName" value="${editEntry && !editEntry.clientSupplierId ? escapeHtml(editEntry.clienteFornecedor || '') : ''}" ${travado('clientSupplierName')} /></label>
            </div>
            <div class="row">
              <label>Conta bancária
                <div class="finance-inline-select">
                  ${campoDeBusca('financeBankAccount')}
                  <button type="button" class="icon-button edit" data-inline-add="bankAccount" data-inline-alvo="financeBankAccount" title="Nova conta bancária">+</button>
                </div>
              </label>
              <label>Plano de Contas
                <div class="finance-inline-select">
                  ${campoDeBusca('financeCategory')}
                  <button type="button" class="icon-button edit" data-inline-add="category" data-inline-alvo="financeCategory" title="Nova categoria">+</button>
                </div>
              </label>
              <label>Centro de custo
                <div class="finance-inline-select">
                  ${campoDeBusca('financeCostCenter')}
                  <button type="button" class="icon-button edit" data-inline-add="costCenter" data-inline-alvo="financeCostCenter" title="Novo centro de custo">+</button>
                </div>
              </label>
            </div>
          `}

          <div class="row">
            ${/* Fase AY: o campo Documento comeca com o numero do lancamento. O
                 prefixo aparece AO LADO do campo, fixo, e nao dentro dele: e' do
                 sistema, nao do usuario. Sem isto o campo abriria com
                 "LF0042 · 123" e a primeira correcao seria alguem apagando o
                 prefixo a mao — que o servidor recolocaria, num vai e volta que
                 so confunde. Ver shared/lancamento_codigo.js. */''}
            <label>Documento
              <div class="finance-documento-campo">
                ${editEntry && editEntry.codigo ? `<span class="finance-documento-prefixo" title="Numero do lancamento">${escapeHtml(editEntry.codigo)} &middot;</span>` : ''}
                <input name="document" placeholder="NF-e, chave de acesso, pedido..." value="${editEntry ? escapeHtml(window.MavisLancamentoCodigo.referencia(editEntry.code, editEntry.document)) : ''}" />
              </div>
            </label>
            <label>Descrição<input name="description" required value="${editEntry ? escapeHtml(editEntry.description || '') : ''}" ${travado('description')} /></label>
          </div>
          <label>Observação<textarea name="note" rows="3">${editEntry ? escapeHtml(editEntry.note || '') : ''}</textarea></label>

          <button type="submit">${editEntry ? 'Salvar alterações' : 'Salvar lançamento'}</button>
        </form>
      </div>
    `;

    attachFormHandlers();
  }

  function renderSuccess(entry) {
    content.innerHTML = `
      <div class="panel finance-coming-soon">
        <div class="finance-coming-soon-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
        </div>
        <h3>Lançamento salvo com sucesso</h3>
        <p class="muted">${escapeHtml(entry.description || '')} — ${financeFormatBRL(entry.amountPrevisto)}</p>
        ${acoesDeSaida()}
      </div>
    `;
    ligarAcoesDeSaida(entry);
  }

  // Fase EI: LANÇAMENTO JÁ BAIXADO OU CANCELADO NÃO ABRE O FORMULÁRIO.
  //
  // Faturar uma venda à vista gera a parcela já paga, e o app traz a pessoa
  // direto para cá (app.js, mudarStatus). O formulário abria editável, com o
  // aviso "você ajusta normalmente por aqui", e o servidor recusava ao salvar:
  // ele só edita lançamento pendente. Dizer antes, e mostrar a saída, é o que
  // tira o beco. A baixa se estorna em Lançamentos e, sem baixa, ele volta a
  // ser editável; cancelado não volta (cancelar é definitivo, com motivo).
  const SITUACAO_BAIXADA = { pago: 'pago', recebido: 'recebido', parcial: 'com baixa parcial' };
  function renderSomenteLeitura(entry) {
    const cancelado = entry.rawStatus === 'cancelado';
    const situacao = SITUACAO_BAIXADA[entry.status] || 'com baixa registrada';
    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>${escapeHtml(window.MavisLancamentoCodigo.rotulo(entry.code, 'Lançamento'))}</h3>
          </div>
        </div>
        <p class="prompt-aviso">
          ${cancelado
            ? `<strong>Este lançamento foi cancelado e não pode mais ser editado.</strong>
              ${entry.cancelReason ? `Motivo: ${escapeHtml(entry.cancelReason)}` : ''}`
            : `<strong>Este lançamento já está ${escapeHtml(situacao)}.</strong>
              Só lançamento pendente, sem baixa, pode ser editado. Para mudar algo,
              abra-o em Ver Lançamento e estorne as baixas; sem baixa, ele volta a
              ser editável por aqui.`}
        </p>
        <p class="muted">${escapeHtml(entry.description || '')} — ${financeFormatBRL(entry.amountPrevisto)}</p>
        ${acoesDeSaida()}
      </div>
    `;
    ligarAcoesDeSaida(entry);
  }

  // Os botões de saída, iguais no "salvo com sucesso" e no aviso de lançamento
  // já baixado (fase EI): os dois terminam no mesmo ponto do fluxo.
  function acoesDeSaida() {
    return `
        <div class="finance-actions-row">
          ${voltaAoPedido ? '<button type="button" id="financeSuccessBack">Voltar ao pedido</button>' : ''}
          <button type="button" ${voltaAoPedido ? 'class="secondary"' : ''} id="financeSuccessView">Ver Lançamento</button>
          <button type="button" class="secondary" id="financeSuccessNew">Novo Lançamento</button>
        </div>`;
  }

  function ligarAcoesDeSaida(entry) {
    // Fecha o ciclo do fluxo: quem veio de "Aprovar Pedido" volta para o pedido,
    // que é onde está a próxima etapa (Gerar NF-e). Sem isto o usuário teria que
    // navegar de volta na mão, e é aí que se perde o fio.
    document.getElementById('financeSuccessBack')?.addEventListener('click', async () => {
      const volta = voltaAoPedido;
      state.financeReturnTo = null;
      try {
        const res = await api(`/api/sales/records/${volta.recordId}`);
        if (res.record) state.salesDraft = { ...state.salesDraft, editRecord: res.record };
      } catch (error) {
        showToast('Não foi possível reabrir o pedido — abra pela lista de Pedidos e Orçamentos.', 'warning');
      }
      state.activeModule = volta.module;
      state.activeSub = volta.sub;
      loadModule(volta.module);
    });

    document.getElementById('financeSuccessView')?.addEventListener('click', () => {
      state.financeOpenEntryId = entry.id;
      // Volta para a lista de onde veio (Contas a Pagar, a Receber ou Lançamentos).
      state.activeSub = state.financeListaDeOrigem || 'lancamentos';
      loadModule('finance');
    });
    document.getElementById('financeSuccessNew')?.addEventListener('click', (evento) => {
      // Fase EI: a tela nasce de novo, em vez de redesenhar o formulário com o
      // estado da edição anterior. `vinculado`, `estabelecimentoAtual`,
      // `mostrarEstab` e `voltaAoPedido` foram calculados para o lançamento
      // editado: zerar só `editEntry` deixava `vinculado` verdadeiro, o
      // formulário lia `editEntry.vinculo` de um nulo e o clique não fazia nada
      // (TypeError no console). Custa recarregar o meta, o mesmo de abrir a
      // tela pelo menu. O pedido de origem fica para trás junto.
      evento.currentTarget.disabled = true;
      state.financeReturnTo = null;
      renderFinanceNovoLancamento(ctx);
    });
  }

  // ONDE CADA "+" CADASTRA: módulo, tela, e o que a tela recebe para já abrir
  // o formulário de novo preenchido com o que se sabe aqui.
  const TELA_DE_CADASTRO = {
    bankAccount: { modulo: 'cadastros', tela: 'nova_conta_bancaria', nome: 'conta bancária' },
    category: { modulo: 'finance', tela: 'plano_de_contas', nome: 'plano de contas' },
    costCenter: { modulo: 'finance', tela: 'centros_de_custo', nome: 'centro de custo' }
  };

  function irParaCadastro(kind, alvo) {
    const destino = TELA_DE_CADASTRO[kind];
    if (!destino) return;
    if (!(state.user?.allowedModules || []).includes(destino.modulo)) {
      showToast(`Cadastrar ${destino.nome} é do módulo ${destino.modulo === 'cadastros' ? 'Cadastros' : 'Financeiro'}, que não está liberado para você.`, 'warning');
      return;
    }
    const form = document.getElementById('financeEntryForm');
    const campos = {};
    [...(form ? form.elements : [])].forEach((el) => {
      if (el.name && !['submit', 'button'].includes(el.type)) campos[el.name] = el.value;
    });
    const rotulos = {};
    ['financeParty', ...Object.keys(CAMPOS_DE_BUSCA)].forEach((id) => {
      const busca = document.getElementById(`${id}Input`);
      if (busca) rotulos[id] = busca.value;
    });
    state.financeRascunhoLancamento = {
      editId: editEntry ? editEntry.id : null, formType, estabelecimentoAtual, campos, rotulos, kind, alvo
    };
    if (kind === 'category') state.planoDeContasNovo = { type: formType === 'RECEITA' ? 'receita' : 'despesa' };
    if (kind === 'costCenter') state.centroDeCustoNovo = { estabelecimentoIds: estabelecimentoAtual ? [estabelecimentoAtual] : [] };
    if (kind === 'bankAccount') state.cadastroEditBankAccountId = null;
    state.activeModule = destino.modulo;
    state.activeSub = destino.tela;
    if (typeof renderApp === 'function') renderApp();
    loadModule(destino.modulo);
  }

  /** Volta o que estava digitado antes do "+", com o cadastro novo escolhido. */
  function restaurarRascunho() {
    const r = state.financeRascunhoLancamento;
    if (!r || (r.editId || null) !== (editEntry ? editEntry.id : null)) return;
    state.financeRascunhoLancamento = null;
    const form = document.getElementById('financeEntryForm');
    if (!form) return;
    Object.entries(r.campos || {}).forEach(([nome, valor]) => {
      const campo = form.elements.namedItem(nome);
      if (campo && campo.type !== 'hidden' && !campo.readOnly && !campo.disabled) campo.value = valor;
    });
    Object.keys(CAMPOS_DE_BUSCA).forEach((id) => {
      if (!document.getElementById(`${id}Wrapper`)) return;
      const valor = id === r.alvo && r.criadoId ? r.criadoId : (r.campos || {})[CAMPOS_DE_BUSCA[id].name] || '';
      refazerCampoDeBusca(id, valor);
    });
    const parte = document.getElementById('financePartyValue');
    const parteBusca = document.getElementById('financePartyInput');
    if (parte && parteBusca && !vinculado) {
      parte.value = (r.campos || {}).clientSupplierId || '';
      parteBusca.value = (r.rotulos || {}).financeParty || '';
    }
    if (r.criadoId) showToast('Cadastrado e já escolhido no lançamento.', 'success');
  }

  // Fase EI: trocar Receita/Despesa/Transferência leva junto o que já foi
  // digitado. O formulário é redesenhado (conta e cliente mudam de forma entre
  // os três), e redesenhar a partir de editEntry, nulo num lançamento novo,
  // devolvia valor, descrição e observação em branco. Conta, plano de contas e
  // cliente/fornecedor ficam de fora de propósito: mudam de sentido de um tipo
  // para o outro (a conta de origem da transferência não é a conta da despesa).
  // O estabelecimento não precisa: o redesenho já parte de estabelecimentoAtual.
  const CAMPOS_DO_RASCUNHO = ['date', 'dueDate', 'amount', 'description', 'document', 'note'];

  function attachFormHandlers() {
    content.querySelectorAll('[data-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (editEntry) return;
        const formAntes = document.getElementById('financeEntryForm');
        const rascunho = {};
        CAMPOS_DO_RASCUNHO.forEach((nome) => {
          const campo = formAntes && formAntes.elements.namedItem(nome);
          if (campo) rascunho[nome] = campo.value;
        });
        formType = btn.dataset.type;
        renderForm();
        const formDepois = document.getElementById('financeEntryForm');
        Object.entries(rascunho).forEach(([nome, valor]) => {
          const campo = formDepois && formDepois.elements.namedItem(nome);
          if (campo) campo.value = valor;
        });
      });
    });

    // Vinculado a pedido/NF-e: o campo já sai `readonly` do HTML (ver a
    // chamada de renderSearchableSelect acima) e não recebe ouvinte nenhum. O
    // valor continua indo no envio pelo <input type="hidden">, que é o que a
    // origem gravou — travar o campo não pode apagar o dado.
    if (vinculado) {
      const buscaDaParte = document.getElementById('financePartyInput');
      if (buscaDaParte) buscaDaParte.title = 'Vem do pedido/NF-e de origem.';
    } else if (typeof attachSearchableSelect === 'function') {
      attachSearchableSelect({ id: 'financeParty', options: opcoesDoDiretorio() });
    }
    Object.keys(CAMPOS_DE_BUSCA).forEach((id) => {
      if (document.getElementById(`${id}Wrapper`)) ligarCampoDeBusca(id);
    });

    // O "+" LEVA À TELA DE CADASTRO DE VERDADE (14/10/2026, pedido do usuário).
    // O lançamento em digitação fica guardado (irParaCadastro) e volta
    // preenchido, com o cadastro novo já escolhido, quando a outra tela salva.
    content.querySelectorAll('[data-inline-add]').forEach((btn) => {
      btn.addEventListener('click', () => irParaCadastro(btn.dataset.inlineAdd, btn.dataset.inlineAlvo || ''));
    });

    // FASE CD — trocar o estabelecimento refaz SO' as listas de conta.
    //
    // Nao chama renderForm(): o formulario inteiro seria redesenhado e tudo o
    // que a pessoa ja' digitou iria junto. Trocar o estabelecimento no meio do
    // preenchimento e' justamente quando isso doeria mais.
    document.getElementById('financeEstabSelect')?.addEventListener('change', (evento) => {
      estabelecimentoAtual = evento.target.value || '';
      const permitidas = contasDisponiveis();
      let perdeuAlguma = null;
      ['financeSourceAccount', 'financeTargetAccount', 'financeBankAccount'].forEach((id) => {
        if (!document.getElementById(`${id}Wrapper`)) return;
        const escolhida = document.getElementById(`${id}Value`)?.value || '';
        const aindaVale = !escolhida || permitidas.some((c) => c.id === escolhida);
        if (!aindaVale) {
          perdeuAlguma = (meta.bankAccounts.find((c) => c.id === escolhida) || {}).name || 'A conta escolhida';
        }
        refazerCampoDeBusca(id, aindaVale ? escolhida : '');
      });
      // Avisa em vez de limpar em silencio: um campo que se esvazia sozinho
      // parece defeito, e a pessoa salvaria sem a conta sem perceber.
      if (perdeuAlguma) {
        showToast(`${perdeuAlguma} não está liberada para este estabelecimento. Escolha outra conta.`, 'warning');
      }
      // E os centros de custo da empresa nova (fase EK).
      if (document.getElementById('financeCostCenterWrapper')) {
        const escolhido = document.getElementById('financeCostCenterValue')?.value || '';
        const aindaVale = !escolhido || meta.costCenters.some((c) => c.id === escolhido && centroValeAqui(c));
        refazerCampoDeBusca('financeCostCenter', aindaVale ? escolhido : '');
        if (!aindaVale) showToast('O centro de custo escolhido não é desta empresa. Escolha outro.', 'warning');
      }
    });

    document.getElementById('financeEntryForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = event.target.querySelector('button[type="submit"]');
      if (submitBtn?.disabled) return;
      // Fase EI: nome digitado na busca e não escolhido na lista. O campo de
      // busca zera o valor escolhido a cada tecla (attachSearchableSelect), e o
      // texto que fica à vista não vai no envio: o lançamento era gravado sem
      // cliente/fornecedor com o nome ainda na tela e, na edição, uma letra
      // apagada sem querer tirava o que já estava gravado. Recusar aqui é algo
      // que a pessoa consegue corrigir; adivinhar quem ela quis, não.
      if (!vinculado && formType !== 'TRANSFERENCIA') {
        const buscaDaParte = document.getElementById('financePartyInput');
        const parteEscolhida = document.getElementById('financePartyValue');
        if (buscaDaParte && parteEscolhida && buscaDaParte.value.trim() && !parteEscolhida.value) {
          const quem = formType === 'RECEITA' ? 'cliente' : 'fornecedor';
          showToast(`O ${quem} digitado não foi escolhido na lista. Clique numa das opções, ou apague o texto e use o campo "Nome livre (se não cadastrado)".`, 'warning');
          buscaDaParte.focus();
          return;
        }
      }
      // O mesmo para conta, plano de contas e centro de custo, que também se
      // digitam: texto à vista sem item escolhido não vai no envio.
      for (const id of Object.keys(CAMPOS_DE_BUSCA)) {
        const busca = document.getElementById(`${id}Input`);
        const escolhido = document.getElementById(`${id}Value`);
        if (!busca || !escolhido || escolhido.value) continue;
        const obrigatorio = id === 'financeSourceAccount' || id === 'financeTargetAccount';
        if (busca.value.trim() || obrigatorio) {
          showToast(busca.value.trim()
            ? `${CAMPOS_DE_BUSCA[id].rotulo}: o texto digitado não foi escolhido na lista. Clique numa das opções.`
            : `Escolha a ${CAMPOS_DE_BUSCA[id].rotulo.toLowerCase()}.`, 'warning');
          busca.focus();
          return;
        }
      }
      if (submitBtn) submitBtn.disabled = true;
      const formData = new FormData(event.target);
      const payload = vinculado
        ? {
          // Só o que o pedido/NF-e não possui. Reenviar valor e data iguais
          // seria pedir para divergir por formato de data ou arredondamento.
          dueDate: formData.get('dueDate'),
          document: formData.get('document'),
          note: formData.get('note')
        }
        : {
          type: formType,
          date: formData.get('date'),
          dueDate: formData.get('dueDate'),
          amount: Number(formData.get('amount')),
          description: formData.get('description'),
          document: formData.get('document'),
          note: formData.get('note')
        };
      // Fase CD: so' vai quando o campo existe na tela. Mandar '' de um
      // formulario que nem perguntou desvincularia o lancamento do
      // estabelecimento dele — a mesma distincao ausente/vazio que o servidor
      // faz para o vendedor e para as telas bloqueadas.
      //
      // Fase EI: e só quando a pessoa pode mexer nele. Desabilitado, o FormData
      // o deixa de fora e ia '', que o servidor lê como "o estabelecimento de
      // quem salva" (estabelecimentoDaOperacao), trocando o do lançamento sem
      // ninguém pedir. Fora do corpo, o PUT mantém o que o lançamento já tem e
      // o POST usa o da pessoa: é exatamente o que o campo travado mostrava.
      const campoEstab = mostrarEstab ? document.getElementById('financeEstabSelect') : null;
      if (campoEstab && !campoEstab.disabled) {
        payload.estabelecimentoId = formData.get('estabelecimentoId') || '';
      }
      if (formType === 'TRANSFERENCIA') {
        payload.bankAccountId = formData.get('sourceBankAccountId') || '';
        payload.targetBankAccountId = formData.get('targetBankAccountId') || '';
      } else {
        payload.bankAccountId = formData.get('bankAccountId') || '';
        payload.category = formData.get('category') || '';
        payload.costCenter = formData.get('costCenter') || '';
        if (!vinculado) {
          payload.clientSupplierId = formData.get('clientSupplierId') || '';
          payload.clientSupplierName = formData.get('clientSupplierName') || '';
        }
      }

      try {
        let result;
        if (editEntry) {
          result = await api(`/api/finance/entries/${editEntry.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
          result = await api('/api/finance/entries', { method: 'POST', body: JSON.stringify(payload) });
        }
        showToast(editEntry ? 'Lançamento atualizado com sucesso.' : 'Lançamento criado com sucesso.', 'success');
        renderSuccess(result.entry);
      } catch (error) {
        showToast(error.message || 'Erro ao salvar lançamento.', 'error');
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Fase EI: pendente abre o formulário; baixado ou cancelado, o aviso só de
  // leitura (ver renderSomenteLeitura). `rawStatus` ausente conta como
  // pendente, que é o que a tela sempre presumiu.
  if (editEntry && String(editEntry.rawStatus || 'pending') !== 'pending') {
    renderSomenteLeitura(editEntry);
  } else {
    const rascunho = state.financeRascunhoLancamento;
    if (rascunho && (rascunho.editId || null) === (editEntry ? editEntry.id : null)) {
      if (!editEntry && rascunho.formType) formType = rascunho.formType;
      if (rascunho.estabelecimentoAtual !== undefined) estabelecimentoAtual = rascunho.estabelecimentoAtual;
    }
    renderForm();
    restaurarRascunho();
  }
};

// A Edição de Título é este mesmo renderizador (ver o começo da função).
window.MavisSubscreenRegistry.finance.edicao_titulo = window.MavisSubscreenRegistry.finance.novo_lancamento;

// A VOLTA DO "+" (14/10/2026). As telas de cadastro (Nova Conta Bancária, Plano
// de Contas, Centros de Custo) perguntam se há um lançamento esperando um
// cadastro do tipo delas e, ao salvar ou cancelar, devolvem a pessoa a ele.
window.MavisRascunhoLancamento = {
  espera(state, kind) {
    const r = state && state.financeRascunhoLancamento;
    return Boolean(r && r.kind === kind);
  },
  voltar(ctx, criadoId) {
    const { state, loadModule } = ctx;
    const r = state.financeRascunhoLancamento;
    if (!r) return false;
    r.criadoId = criadoId || '';
    state.activeModule = 'finance';
    state.activeSub = r.editId ? 'edicao_titulo' : 'novo_lancamento';
    state.financeEditEntryId = r.editId || null;
    if (typeof renderApp === 'function') renderApp();
    loadModule('finance');
    return true;
  }
};
