window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

const BANK_TX_STATUS_META = {
  nao_conciliado: { label: 'Não conciliado', tone: 'warning' },
  conciliado: { label: 'Conciliado', tone: 'success' },
  ignorado: { label: 'Ignorado', tone: 'muted' }
};

function bankTxStatusBadge(status) {
  const meta = BANK_TX_STATUS_META[status] || { label: status || '-', tone: 'muted' };
  return `<span class="finance-badge finance-badge-${meta.tone}">${meta.label}</span>`;
}

const MATCH_SCORE_META = {
  MATCH_EXACT: { label: 'Correspondência exata', tone: 'success' },
  MATCH_HIGH: { label: 'Correspondência alta', tone: 'success' },
  MATCH_MEDIUM: { label: 'Correspondência média', tone: 'warning' },
  MATCH_LOW: { label: 'Correspondência baixa', tone: 'muted' },
  NO_MATCH: { label: 'Sem correspondência', tone: 'muted' }
};

function matchScoreBadge(score) {
  const meta = MATCH_SCORE_META[score];
  if (!meta) return '';
  return `<span class="finance-badge finance-badge-${meta.tone}">${meta.label}</span>`;
}

window.MavisSubscreenRegistry.finance.extrato_open_finance = async function renderExtratoOpenFinance(ctx) {
  const { content, api, showToast, state, loadModule, escapeHtml, confirmModal } = ctx;

  let meta = { bankAccounts: [] };
  const filters = { bankAccountId: '', status: '', type: '', search: '', dateFrom: '', dateTo: '', amountMin: '', amountMax: '' };
  let page = 1;
  // ITENS POR PÁGINA (fase EI). Eram 15 fixos: conferir o extrato de um mês
  // inteiro era clicar em Próxima dez vezes. O servidor aceita até 100
  // (parsePageParams). Fica no state para sobreviver a sair e voltar à tela.
  const POR_PAGINA = [15, 30, 50, 100];
  let limit = POR_PAGINA.includes(state.extratoPorPagina) ? state.extratoPorPagina : 15;
  // A ORDEM (fase EI). Era sempre data decrescente. Clicar no cabeçalho ordena,
  // clicar de novo inverte. As chaves são as de ORDENS_DO_EXTRATO
  // (lib/extrato-bancario.js): chave que o servidor não conhece cai na data, e
  // por isso só ganha botão a coluna que ele sabe ordenar.
  const COLUNAS_ORDENAVEIS = { data: 'Data', descricao: 'Descrição', valor: 'Valor', tipo: 'Tipo', conta: 'Conta', status: 'Status' };
  // Data e valor começam do maior; texto, de A a Z (mesma regra do servidor).
  const COMECA_DECRESCENTE = ['data', 'valor'];
  const ordem = state.extratoOrdem || { campo: 'data', direcao: 'desc' };
  // A SELEÇÃO (fase EI), por id e só da página à vista: as ações em lote
  // agem sobre o que a pessoa está vendo, nunca sobre linha de outra página
  // que ela marcou e esqueceu.
  const selecionadas = new Set();
  let transacoesDaPagina = [];
  // Cada carga ganha um número; resposta de uma carga antiga (dois cliques
  // rápidos de ordenação) não sobrescreve a mais nova.
  let cargaAtual = 0;

  function bankAccountOptions(selectedId) {
    return meta.bankAccounts.map((acc) => `<option value="${acc.id}" ${selectedId === acc.id ? 'selected' : ''}>${escapeHtml(acc.name)}</option>`).join('');
  }

  function buildQuery() {
    const params = new URLSearchParams({ page: String(page), limit: String(limit), sort: ordem.campo, dir: ordem.direcao });
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    return params.toString();
  }

  // META E PRIMEIRA PÁGINA SAEM JUNTOS, e o meta só com as contas (fase DS).
  //
  // Esta tela lê do meta UMA coisa: as contas bancárias. Recebia 2.818 KB
  // (diretório de pessoas e produtos) e só depois pedia o extrato. Agora pede
  // `produtos=0&diretorio=0` (29 KB) e o extrato ao mesmo tempo; sem conta
  // cadastrada, a resposta do extrato é ignorada e a tela mostra o aviso de
  // sempre.
  const [respostaMeta, primeiraPagina] = await Promise.allSettled([
    api('/api/finance/meta?produtos=0&diretorio=0'),
    api(`/api/finance/bank-transactions?${buildQuery()}`)
  ]);
  if (respostaMeta.status === 'fulfilled') {
    meta = respostaMeta.value;
  } else {
    showToast('Não foi possível carregar as contas bancárias.', 'warning');
  }

  // `preCarregada` é a primeira página, que já veio junto com o meta.
  async function load(preCarregada) {
    if (!meta.bankAccounts.length) {
      renderNoAccounts();
      return;
    }
    const estaCarga = ++cargaAtual;
    let result;
    try {
      if (preCarregada) {
        if (preCarregada.status === 'rejected') throw preCarregada.reason;
        result = preCarregada.value;
      } else {
        result = await api(`/api/finance/bank-transactions?${buildQuery()}`);
      }
    } catch (error) {
      if (estaCarga !== cargaAtual) return;
      content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar extrato: ${escapeHtml(error.message || 'erro desconhecido')}</p></div>`;
      return;
    }
    if (estaCarga !== cargaAtual) return;
    // A PÁGINA QUE DEIXOU DE EXISTIR (fase EI). Com filtro de situação, conciliar
    // ou ignorar a última linha da última página tira essa página do mapa: o
    // servidor devolve lista vazia, e a tela dizia "Nenhuma movimentação
    // encontrada" e "Página 3 de 2", como se o trabalho tivesse acabado, com
    // trinta pendentes nas páginas de trás. Volta para a última que existe.
    // Não entra em laço: com total 0 a última página é a 1.
    const ultimaPagina = Math.max(1, Math.ceil(result.total / limit));
    if (page > ultimaPagina) {
      page = ultimaPagina;
      return load();
    }
    renderView(result);
  }

  function renderNoAccounts() {
    content.innerHTML = `
      <div class="panel finance-coming-soon">
        <div class="finance-coming-soon-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
        </div>
        <h3>Nenhuma conta bancária cadastrada</h3>
        <p class="muted">Cadastre uma conta bancária em "Novo Lançamento" (ícone "+" ao lado do campo Conta bancária) antes de importar ou lançar um extrato.</p>
        <div class="finance-actions-row">
          <button type="button" id="extratoGoToLancamento">Ir para Novo Lançamento</button>
        </div>
      </div>
    `;
    document.getElementById('extratoGoToLancamento')?.addEventListener('click', () => {
      state.activeSub = 'novo_lancamento';
      loadModule('finance');
    });
  }

  // O valor de cada situação embaixo da contagem (fase EI): "12 não
  // conciliadas" não diz se falta conciliar R$ 300 ou R$ 300 mil.
  function valoresDoCartao(v) {
    if (!v || (!v.entrada && !v.saida)) return '';
    return `Entradas ${escapeHtml(financeFormatBRL(v.entrada))} · Saídas ${escapeHtml(financeFormatBRL(v.saida))}`;
  }

  function cabecalhoOrdenavel(campo, classe = '') {
    const ativa = campo === ordem.campo;
    const seta = ativa ? (ordem.direcao === 'asc' ? '▲' : '▼') : '';
    const proxima = ativa
      ? (ordem.direcao === 'asc' ? 'decrescente' : 'crescente')
      : (COMECA_DECRESCENTE.includes(campo) ? 'decrescente' : 'crescente');
    const rotulo = escapeHtml(COLUNAS_ORDENAVEIS[campo]);
    // `th.col-valor` já leva o botão para a direita (app.css), junto dos números.
    return `
      <th${classe ? ` class="${classe}"` : ''} aria-sort="${ativa ? (ordem.direcao === 'asc' ? 'ascending' : 'descending') : 'none'}">
        <button type="button" class="lista-ordenar ${ativa ? 'is-ativa' : ''}" data-ordenar="${campo}"
                title="Ordenar por ${rotulo} em ordem ${proxima}">
          <span>${rotulo}</span>
          <span class="lista-ordenar-seta" aria-hidden="true">${seta}</span>
        </button>
      </th>`;
  }

  function linhaDaTransacao(tx) {
    const marcada = selecionadas.has(tx.id);
    const sync = tx.source === 'open_finance';
    const conciliadoCom = tx.matchedEntryDescription || 'Ver lançamento';
    // DESCRIÇÃO CORTADA, INTEIRA NO TÍTULO (fase EI). `.table td` não quebra
    // linha, e a descrição do OFX vem do MEMO inteiro ("PIX RECEBIDO - NOME -
    // CPF - BANCO AG CC"): a tabela passava da tela e Valor, Status e Ações
    // iam para a rolagem horizontal. O selo Sync fica fora do corte, e por
    // isso, quando ele existe, o texto vira inline-block para ficar ao lado.
    return `
      <tr class="${marcada ? 'is-selecionada' : ''}">
        <td class="sales-col-selecao"><input type="checkbox" data-selecionar="${escapeHtml(tx.id)}" aria-label="Selecionar movimentação" ${marcada ? 'checked' : ''} /></td>
        <td>${escapeHtml(financeFormatDate(tx.date))}</td>
        <td>${sync ? '<span class="finance-badge finance-badge-info" title="Importado via sincronização Open Finance">Sync</span> ' : ''}<span class="texto-cortado"${sync ? ' style="display:inline-block;vertical-align:bottom"' : ''} title="${escapeHtml(tx.description)}">${escapeHtml(tx.description)}</span></td>
        <td class="col-valor ${tx.type === 'entrada' ? 'finance-positive' : 'finance-negative'}">${tx.type === 'entrada' ? '+' : '-'} ${escapeHtml(financeFormatBRL(tx.amount))}</td>
        <td>${tx.type === 'entrada' ? 'Entrada' : 'Saída'}</td>
        <td>${escapeHtml(tx.bankAccountName || '-')}</td>
        <td>${bankTxStatusBadge(tx.status)}</td>
        <td>${tx.matchedEntryId ? `<span class="finance-clickable-row texto-cortado is-curto" data-view-entry="${escapeHtml(tx.matchedEntryId)}" title="${escapeHtml(conciliadoCom)}">${escapeHtml(conciliadoCom)}</span>` : '<span class="muted">-</span>'}</td>
        <td class="finance-extrato-actions">
          ${tx.status === 'nao_conciliado' ? `
            <button type="button" class="secondary" data-conciliar="${escapeHtml(tx.id)}">Conciliar</button>
            <button type="button" class="secondary" data-ignorar="${escapeHtml(tx.id)}">Ignorar</button>
          ` : ''}
          ${tx.status === 'conciliado' ? `<button type="button" class="secondary" data-desconciliar="${escapeHtml(tx.id)}">Desconciliar</button>` : ''}
          ${tx.status === 'ignorado' ? `<button type="button" class="secondary" data-reativar="${escapeHtml(tx.id)}">Reativar</button>` : ''}
        </td>
      </tr>
    `;
  }

  function renderView(result) {
    const totalPages = Math.max(1, Math.ceil(result.total / limit));
    const summary = result.summary || { naoConciliado: 0, conciliado: 0, ignorado: 0 };
    const valores = summary.valores || {};
    transacoesDaPagina = result.transactions || [];
    // O que saiu da página (filtro, ordem, página nova) sai da seleção.
    const idsVisiveis = new Set(transacoesDaPagina.map((tx) => tx.id));
    [...selecionadas].forEach((id) => { if (!idsVisiveis.has(id)) selecionadas.delete(id); });
    const todasMarcadas = transacoesDaPagina.length > 0 && transacoesDaPagina.every((tx) => selecionadas.has(tx.id));

    // O contador do cabeçalho trocava só o sufixo e saía "2 movimentaçãoões"
    // (fase EI): agora a palavra inteira muda conforme o total.
    content.innerHTML = `
      <div class="cadastro-page-head">
        <div>
          <h3>Conciliação Bancária</h3>
          <p class="muted">${escapeHtml(String(result.total))} ${result.total === 1 ? 'movimentação' : 'movimentações'}</p>
        </div>
        <div class="cadastro-list-actions">
          <button type="button" id="extratoNewBtn">+ Nova movimentação</button>
          <button type="button" class="secondary" id="extratoImportBtn">Importar extrato (OFX/CSV)</button>
          <button type="button" class="secondary" id="extratoRefreshBtn">Atualizar</button>
        </div>
      </div>

      <div class="finance-stat-cards">
        ${financeStatCard({ tone: 'red', label: 'Não conciliadas', value: String(summary.naoConciliado), sub: valoresDoCartao(valores.naoConciliado) })}
        ${financeStatCard({ tone: 'green', label: 'Conciliadas', value: String(summary.conciliado), sub: valoresDoCartao(valores.conciliado) })}
        ${financeStatCard({ tone: 'cyan', label: 'Ignoradas', value: String(summary.ignorado), sub: valoresDoCartao(valores.ignorado) })}
      </div>

      <form id="extratoFilterForm" class="cadastro-filter-panel">
        <div class="cadastro-filter-grid-5">
          <label class="cadastro-field">
            <span>Conta bancária</span>
            <select name="bankAccountId"><option value="">Todas</option>${bankAccountOptions(filters.bankAccountId)}</select>
          </label>
          <label class="cadastro-field">
            <span>Status</span>
            <select name="status">
              <option value="">Todos</option>
              ${Object.entries(BANK_TX_STATUS_META).map(([value, m]) => `<option value="${value}" ${filters.status === value ? 'selected' : ''}>${m.label}</option>`).join('')}
            </select>
          </label>
          <label class="cadastro-field">
            <span>Tipo</span>
            <select name="type">
              <option value="">Todos</option>
              <option value="entrada" ${filters.type === 'entrada' ? 'selected' : ''}>Entrada</option>
              <option value="saida" ${filters.type === 'saida' ? 'selected' : ''}>Saída</option>
            </select>
          </label>
          <label class="cadastro-field">
            <span>Busca</span>
            <input name="search" value="${escapeHtml(filters.search)}" placeholder="Descrição ou valor (ex.: 1.250,00)" />
          </label>
          <label class="cadastro-field">
            <span>Data inicial</span>
            <input type="date" name="dateFrom" value="${escapeHtml(filters.dateFrom)}" />
          </label>
          <label class="cadastro-field">
            <span>Data final</span>
            <input type="date" name="dateTo" value="${escapeHtml(filters.dateTo)}" />
          </label>
          <label class="cadastro-field">
            <span>Valor mínimo</span>
            <input type="number" step="0.01" min="0" name="amountMin" value="${escapeHtml(filters.amountMin)}" placeholder="0,00" />
          </label>
          <label class="cadastro-field">
            <span>Valor máximo</span>
            <input type="number" step="0.01" min="0" name="amountMax" value="${escapeHtml(filters.amountMax)}" placeholder="0,00" />
          </label>
        </div>
        <div class="cadastro-filter-actions">
          <button type="submit">Filtrar</button>
          <button type="button" class="secondary" id="extratoFilterClearBtn">Limpar filtros</button>
        </div>
      </form>

      <div class="panel">
        <div id="extratoLote" class="sales-lote-barra hidden" role="region" aria-label="Ações nas movimentações selecionadas"></div>
        <div class="table-scroll">
          <table class="table table-actions">
            <thead><tr>
              <th class="sales-col-selecao"><input type="checkbox" id="extratoSelecionarTodas" aria-label="Selecionar todas as movimentações desta página" ${todasMarcadas ? 'checked' : ''} ${transacoesDaPagina.length ? '' : 'disabled'} /></th>
              ${cabecalhoOrdenavel('data')}
              ${cabecalhoOrdenavel('descricao')}
              ${cabecalhoOrdenavel('valor', 'col-valor')}
              ${cabecalhoOrdenavel('tipo')}
              ${cabecalhoOrdenavel('conta')}
              ${cabecalhoOrdenavel('status')}
              <th>Conciliação</th><th>Ações</th>
            </tr></thead>
            <tbody>
              ${transacoesDaPagina.length
                ? transacoesDaPagina.map(linhaDaTransacao).join('')
                : '<tr><td colspan="9" class="muted">Nenhuma movimentação encontrada com os filtros atuais.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="finance-pagination">
          <button type="button" class="secondary" id="extratoPrevPage" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
          <span class="muted finance-pagina-info">Página ${page} de ${totalPages}</span>
          <button type="button" class="secondary" id="extratoNextPage" ${page >= totalPages ? 'disabled' : ''}>Próxima</button>
          <label class="muted">Por página
            <select id="extratoPorPagina">
              ${POR_PAGINA.map((n) => `<option value="${n}" ${n === limit ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>
    `;

    attachViewHandlers(result);
    aplicarSelecaoNaTela();
  }

  // AÇÕES EM LOTE (fase EI): ignorar 40 tarifas bancárias eram 40 cliques.
  // Cada ação vale só para a situação em que o botão da linha aparece; as
  // rotas conferem de novo, uma a uma.
  const ACOES_EM_LOTE = {
    ignorar: { rotulo: 'Ignorar', situacao: 'nao_conciliado', feito: 'ignorada(s)', dica: 'Ignorar vale só para movimentação não conciliada.' },
    reativar: { rotulo: 'Reativar', situacao: 'ignorado', feito: 'reativada(s)', dica: 'Reativar vale só para movimentação ignorada.' }
  };

  // Marcar não recarrega a lista: só as caixas, o destaque da linha e a barra
  // de lote são redesenhados, senão cada clique perderia a rolagem.
  function aplicarSelecaoNaTela() {
    content.querySelectorAll('[data-selecionar]').forEach((cb) => {
      cb.checked = selecionadas.has(cb.dataset.selecionar);
      cb.closest('tr')?.classList.toggle('is-selecionada', cb.checked);
    });
    const todas = document.getElementById('extratoSelecionarTodas');
    if (todas) {
      const marcadas = transacoesDaPagina.filter((tx) => selecionadas.has(tx.id)).length;
      todas.checked = marcadas > 0 && marcadas === transacoesDaPagina.length;
      todas.indeterminate = marcadas > 0 && marcadas < transacoesDaPagina.length;
    }
    desenharLote();
  }

  function desenharLote() {
    const barra = document.getElementById('extratoLote');
    if (!barra) return;
    const marcadas = transacoesDaPagina.filter((tx) => selecionadas.has(tx.id));
    barra.classList.toggle('hidden', !marcadas.length);
    if (!marcadas.length) {
      barra.innerHTML = '';
      return;
    }
    // A soma das marcadas: conferir um grupo de linhas contra o total que o
    // banco mostra é metade do trabalho de conciliar. Em centavos inteiros.
    const soma = (tipo) => marcadas
      .filter((tx) => tx.type === tipo)
      .reduce((total, tx) => total + Math.round(Number(tx.amount || 0) * 100), 0) / 100;
    barra.innerHTML = `
      <strong>${marcadas.length} selecionada${marcadas.length === 1 ? '' : 's'}</strong>
      <span class="finance-lote-soma">Entradas ${escapeHtml(financeFormatBRL(soma('entrada')))} · Saídas ${escapeHtml(financeFormatBRL(soma('saida')))}</span>
      ${Object.entries(ACOES_EM_LOTE).map(([acao, regra]) => {
        const elegiveis = marcadas.filter((tx) => tx.status === regra.situacao).length;
        return `<button type="button" class="secondary" data-lote="${acao}" ${elegiveis ? '' : 'disabled'} title="${escapeHtml(regra.dica)}">${regra.rotulo} (${elegiveis})</button>`;
      }).join('')}
      <button type="button" class="btn-muted" id="extratoLoteLimpar">Limpar seleção</button>
    `;
    barra.querySelectorAll('[data-lote]').forEach((btn) => {
      btn.addEventListener('click', () => executarLote(btn.dataset.lote));
    });
    document.getElementById('extratoLoteLimpar')?.addEventListener('click', () => {
      selecionadas.clear();
      aplicarSelecaoNaTela();
    });
  }

  async function executarLote(acao) {
    const regra = ACOES_EM_LOTE[acao];
    if (!regra) return;
    const alvos = transacoesDaPagina.filter((tx) => selecionadas.has(tx.id) && tx.status === regra.situacao);
    if (!alvos.length) return;
    const confirmed = await confirmModal(`${regra.rotulo} ${alvos.length} movimentação(ões) selecionada(s)?`);
    if (!confirmed) return;
    document.getElementById('extratoLote')?.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    // Uma por vez, pelas MESMAS rotas do botão da linha: cada uma confere a
    // situação de novo (outra pessoa pode ter conciliado no meio), e o servidor
    // é um processo só — cem pedidos de uma vez atrasariam a tela de todos.
    let feitas = 0;
    const recusadas = [];
    for (const tx of alvos) {
      try {
        await api(`/api/finance/bank-transactions/${encodeURIComponent(tx.id)}/${acao}`, { method: 'POST' });
        feitas += 1;
      } catch (error) {
        recusadas.push(error.message || 'erro desconhecido');
      }
    }
    selecionadas.clear();
    showToast(
      `${feitas} movimentação(ões) ${regra.feito}`
      + (recusadas.length ? `; ${recusadas.length} recusada(s): ${recusadas[0]}` : '')
      + '.',
      recusadas.length ? 'warning' : 'success'
    );
    load();
  }

  function attachViewHandlers(result) {
    const totalPages = Math.max(1, Math.ceil(result.total / limit));

    // Arrow, e não `load` direto: o evento de clique entraria como `preCarregada`.
    document.getElementById('extratoRefreshBtn')?.addEventListener('click', () => load());
    document.getElementById('extratoNewBtn')?.addEventListener('click', openNewTransactionModal);
    document.getElementById('extratoImportBtn')?.addEventListener('click', openImportModal);

    document.getElementById('extratoFilterForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      filters.bankAccountId = formData.get('bankAccountId') || '';
      filters.status = formData.get('status') || '';
      filters.type = formData.get('type') || '';
      filters.search = formData.get('search') || '';
      filters.dateFrom = formData.get('dateFrom') || '';
      filters.dateTo = formData.get('dateTo') || '';
      filters.amountMin = formData.get('amountMin') || '';
      filters.amountMax = formData.get('amountMax') || '';
      page = 1;
      load();
    });
    document.getElementById('extratoFilterClearBtn')?.addEventListener('click', () => {
      Object.keys(filters).forEach((key) => { filters[key] = ''; });
      page = 1;
      load();
    });

    document.getElementById('extratoPrevPage')?.addEventListener('click', () => { if (page > 1) { page -= 1; load(); } });
    document.getElementById('extratoNextPage')?.addEventListener('click', () => { if (page < totalPages) { page += 1; load(); } });

    content.querySelectorAll('[data-ordenar]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const campo = btn.dataset.ordenar;
        if (!COLUNAS_ORDENAVEIS[campo]) return;
        // Mesma coluna inverte; coluna nova começa pela direção natural dela.
        if (campo === ordem.campo) ordem.direcao = ordem.direcao === 'asc' ? 'desc' : 'asc';
        else { ordem.campo = campo; ordem.direcao = COMECA_DECRESCENTE.includes(campo) ? 'desc' : 'asc'; }
        state.extratoOrdem = { ...ordem };
        page = 1;
        load();
      });
    });

    document.getElementById('extratoPorPagina')?.addEventListener('change', (event) => {
      const n = Number(event.target.value);
      if (!POR_PAGINA.includes(n)) return;
      limit = n;
      state.extratoPorPagina = n;
      page = 1;
      load();
    });

    content.querySelectorAll('[data-selecionar]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selecionadas.add(cb.dataset.selecionar);
        else selecionadas.delete(cb.dataset.selecionar);
        aplicarSelecaoNaTela();
      });
    });
    document.getElementById('extratoSelecionarTodas')?.addEventListener('change', (event) => {
      transacoesDaPagina.forEach((tx) => {
        if (event.target.checked) selecionadas.add(tx.id);
        else selecionadas.delete(tx.id);
      });
      aplicarSelecaoNaTela();
    });

    content.querySelectorAll('[data-view-entry]').forEach((el) => {
      el.addEventListener('click', () => {
        state.financeOpenEntryId = el.dataset.viewEntry;
        state.activeSub = 'lancamentos';
        loadModule('finance');
      });
    });

    // A movimentação inteira vai para a janela (fase EI): a busca manual
    // precisa do tipo dela para pedir só receitas (entrada) ou só despesas
    // (saída), e a janela mostra o que está sendo conciliado.
    content.querySelectorAll('[data-conciliar]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tx = (result.transactions || []).find((item) => item.id === btn.dataset.conciliar);
        if (tx) openConciliarModal(tx);
      });
    });
    content.querySelectorAll('[data-ignorar]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/finance/bank-transactions/${btn.dataset.ignorar}/ignorar`, { method: 'POST' });
          showToast('Movimentação ignorada.', 'success');
          load();
        } catch (error) {
          showToast(error.message || 'Erro ao ignorar movimentação.', 'error');
        }
      });
    });
    content.querySelectorAll('[data-desconciliar]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const confirmed = await confirmModal('Confirma desconciliar esta movimentação? A baixa registrada no lançamento vinculado será estornada.');
        if (!confirmed) return;
        try {
          await api(`/api/finance/bank-transactions/${btn.dataset.desconciliar}/desconciliar`, { method: 'POST' });
          showToast('Movimentação desconciliada.', 'success');
          load();
        } catch (error) {
          showToast(error.message || 'Erro ao desconciliar movimentação.', 'error');
        }
      });
    });
    content.querySelectorAll('[data-reativar]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/finance/bank-transactions/${btn.dataset.reativar}/reativar`, { method: 'POST' });
          showToast('Movimentação reativada.', 'success');
          load();
        } catch (error) {
          showToast(error.message || 'Erro ao reativar movimentação.', 'error');
        }
      });
    });
  }

  function closeExtratoModal() {
    document.getElementById('extratoModal')?.remove();
  }

  function openNewTransactionModal() {
    closeExtratoModal();
    const overlay = document.createElement('div');
    overlay.id = 'extratoModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>Nova movimentação</h3>
        <form id="extratoNewForm" class="form-grid">
          <label>Conta bancária<select name="bankAccountId" required><option value="">Selecione</option>${bankAccountOptions('')}</select></label>
          <div class="row">
            <label>Data<input type="date" name="date" required value="${new Date().toISOString().slice(0, 10)}" /></label>
            <label>Valor<input type="number" step="0.01" min="0.01" name="amount" required /></label>
          </div>
          <label>Tipo
            <select name="type"><option value="entrada">Entrada</option><option value="saida">Saída</option></select>
          </label>
          <label>Descrição<input name="description" required /></label>
          <div class="modal-actions">
            <button type="button" class="btn-muted" id="extratoNewCancel">Cancelar</button>
            <button type="submit" class="btn">Registrar</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeExtratoModal(); });
    document.getElementById('extratoNewCancel')?.addEventListener('click', closeExtratoModal);
    document.getElementById('extratoNewForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = event.target.querySelector('button[type="submit"]');
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      const formData = new FormData(event.target);
      try {
        await api('/api/finance/bank-transactions', {
          method: 'POST',
          body: JSON.stringify({
            bankAccountId: formData.get('bankAccountId'),
            date: formData.get('date'),
            amount: Number(formData.get('amount')),
            type: formData.get('type'),
            description: formData.get('description')
          })
        });
        showToast('Movimentação registrada com sucesso.', 'success');
        closeExtratoModal();
        load();
      } catch (error) {
        showToast(error.message || 'Erro ao registrar movimentação.', 'error');
        submitBtn.disabled = false;
      }
    });
  }

  function openImportModal() {
    closeExtratoModal();
    const overlay = document.createElement('div');
    overlay.id = 'extratoModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-lg">
        <h3>Importar extrato</h3>
        <form id="extratoImportForm" class="form-grid">
          <label>Conta bancária de destino<select name="bankAccountId" required><option value="">Selecione</option>${bankAccountOptions('')}</select></label>
          <label>Arquivo do banco (OFX ou CSV)<input type="file" name="arquivo" id="extratoImportArquivo" accept=".ofx,.OFX,.csv,.CSV,.txt" /></label>
          <p class="muted" id="extratoImportResumo" hidden></p>
          <label>Ou cole o CSV<textarea name="csvText" rows="6" placeholder="data,descricao,valor,tipo
2026-08-01,PIX recebido Cliente X,2500,entrada
2026-08-02,Tarifa bancaria,25.50,saida"></textarea></label>
          <div class="modal-actions">
            <button type="button" class="btn-muted" id="extratoImportCancel">Cancelar</button>
            <button type="submit" class="btn">Importar</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeExtratoModal(); });
    document.getElementById('extratoImportCancel')?.addEventListener('click', closeExtratoModal);
    // O ARQUIVO É LIDO AQUI, no navegador (shared/ofx.js): o OFX vira as
    // mesmas linhas que o CSV manda, com o FITID de cada lançamento — é ele que
    // deixa reimportar o arquivo sem duplicar. CSV escolhido como arquivo cai
    // no campo de texto, como se tivesse sido colado.
    let linhasDoOfx = null;
    const resumo = document.getElementById('extratoImportResumo');
    document.getElementById('extratoImportArquivo')?.addEventListener('change', async (event) => {
      linhasDoOfx = null;
      resumo.hidden = true;
      const arquivo = event.target.files && event.target.files[0];
      if (!arquivo) return;
      try {
        const bytes = new Uint8Array(await arquivo.arrayBuffer());
        const texto = window.MavisOfx.decodificar(bytes);
        if (/\.ofx$/i.test(arquivo.name) || /<OFX>/i.test(texto)) {
          const lido = window.MavisOfx.lerOfx(texto);
          linhasDoOfx = lido.transacoes;
          const entradas = lido.transacoes.filter((t) => t.type === 'entrada').length;
          resumo.textContent = `${lido.transacoes.length} lançamento(s) no arquivo (${entradas} entrada(s), ${lido.transacoes.length - entradas} saída(s))`
            + (lido.conta.numero ? ` · conta ${lido.conta.numero}` : '')
            + (lido.ignoradas.length ? ` · ${lido.ignoradas.length} sem data ou valor (fora)` : '');
        } else {
          event.target.form.querySelector('[name="csvText"]').value = texto;
          resumo.textContent = 'CSV carregado no campo abaixo.';
        }
        resumo.hidden = false;
      } catch (erro) {
        showToast(erro.message || 'Não foi possível ler o arquivo.', 'error');
        event.target.value = '';
      }
    });
    document.getElementById('extratoImportForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = event.target.querySelector('button[type="submit"]');
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      const formData = new FormData(event.target);
      try {
        const corpo = linhasDoOfx
          ? { bankAccountId: formData.get('bankAccountId'), rows: linhasDoOfx, origem: 'ofx' }
          : { bankAccountId: formData.get('bankAccountId'), text: formData.get('csvText') };
        const result = await api('/api/finance/bank-transactions/import', {
          method: 'POST',
          body: JSON.stringify(corpo)
        });
        // `repetidas` (fase BR) precisa aparecer: sem ele, reimportar o mesmo
        // arquivo mostraria "0 importadas" e pareceria falha, quando na verdade
        // o extrato ja estava todo la.
        showToast(
          `${result.count} movimentação(ões) importada(s)`
          + (result.repetidas ? `, ${result.repetidas} já existia(m)` : '')
          + (result.skipped ? `, ${result.skipped} linha(s) inválida(s) ignorada(s)` : '')
          + '.',
          result.count === 0 && result.repetidas ? 'info' : 'success'
        );
        closeExtratoModal();
        load();
      } catch (error) {
        showToast(error.message || 'Erro ao importar CSV.', 'error');
        submitBtn.disabled = false;
      }
    });
  }

  async function openConciliarModal(tx) {
    const txId = tx.id;
    let matches = [];
    try {
      const res = await api(`/api/finance/bank-transactions/${txId}/matches`);
      matches = res.matches || [];
    } catch (error) {
      showToast(error.message || 'Erro ao buscar possíveis correspondências.', 'error');
      return;
    }

    closeExtratoModal();
    const overlay = document.createElement('div');
    overlay.id = 'extratoModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-lg">
        <h3>Conciliar movimentação</h3>
        <p class="muted">${escapeHtml(financeFormatDate(tx.date))} · ${tx.type === 'entrada' ? 'Entrada' : 'Saída'} de ${escapeHtml(financeFormatBRL(tx.amount))} · ${escapeHtml(tx.description)}</p>
        <div class="finance-due-list" id="extratoMatchesList">
          ${matches.length ? matches.map((m) => `
            <div class="finance-due-item">
              <div>
                <strong>${escapeHtml(m.description)}</strong> ${matchScoreBadge(m.matchScore)}
                <div class="muted">${escapeHtml(m.clienteFornecedor || '-')} · Vencimento: ${escapeHtml(financeFormatDate(m.dueDate))}</div>
              </div>
              <div class="finance-due-item-amount">
                ${financeFormatBRL(m.remaining)}
                <button type="button" class="secondary" data-match-entry="${escapeHtml(m.id)}">Conciliar com este</button>
              </div>
            </div>
          `).join('') : '<p class="muted">Nenhuma correspondência automática encontrada.</p>'}
        </div>

        <h4 style="margin-top:16px;">Buscar manualmente</h4>
        <div class="row">
          <input type="text" id="extratoManualSearch" placeholder="Buscar lançamento por descrição ou cliente/fornecedor..." />
        </div>
        <div class="finance-due-list" id="extratoManualResults"></div>

        <div class="modal-actions">
          <button type="button" class="btn-muted" id="extratoConciliarCancel">Fechar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeExtratoModal(); });
    document.getElementById('extratoConciliarCancel')?.addEventListener('click', closeExtratoModal);

    // UM ENVIO POR VEZ (fase EI). A rota leva mais de um segundo e nada na
    // tela mostrava isso: o segundo clique em "Conciliar com este" (ou num
    // outro título) gravava uma SEGUNDA baixa para a mesma movimentação. A
    // trava fica no escopo da janela e por isso vale também para os botões da
    // busca manual, desenhados depois. O servidor tem a dele
    // (conciliacoesEmAndamento); esta evita até o pedido.
    let enviando = false;
    const botoesDeConciliar = (desligar) => {
      overlay.querySelectorAll('[data-match-entry]').forEach((b) => { b.disabled = desligar; });
    };

    async function doConciliar(entryId) {
      if (enviando) return;
      enviando = true;
      botoesDeConciliar(true);
      try {
        await api(`/api/finance/bank-transactions/${txId}/conciliar`, { method: 'POST', body: JSON.stringify({ entryId }) });
        showToast('Movimentação conciliada com sucesso.', 'success');
        closeExtratoModal();
        load();
      } catch (error) {
        showToast(error.message || 'Erro ao conciliar.', 'error');
        enviando = false;
        botoesDeConciliar(false);
      }
    }

    overlay.querySelectorAll('[data-match-entry]').forEach((btn) => {
      btn.addEventListener('click', () => doConciliar(btn.dataset.matchEntry));
    });

    // A BUSCA MANUAL PEDE SÓ O QUE PODE SER CONCILIADO (fase EI). Pedia 8
    // lançamentos de qualquer tipo e situação e filtrava os pendentes depois:
    // com os 8 primeiros já pagos, a lista saía vazia e o título em aberto
    // existia; e uma despesa oferecida para uma entrada só dava erro ao
    // clicar. Agora vai o tipo da movimentação (entrada = receita, saída =
    // despesa) e 50 por busca — e só os em aberto, pelo filtro de várias
    // situações da lista de Lançamentos (fase EI): antes, 50 pagos podiam
    // ocupar a resposta inteira e esconder o pendente procurado. O filtro aqui
    // embaixo fica como rede, para resposta de servidor antigo. A busca também
    // acha pelo valor ("1.234,56") e pelo código (LF0042).
    const tipoDoLancamento = tx.type === 'entrada' ? 'receita' : 'despesa';
    let searchTimeout = null;
    document.getElementById('extratoManualSearch')?.addEventListener('input', (event) => {
      clearTimeout(searchTimeout);
      const term = event.target.value.trim();
      searchTimeout = setTimeout(async () => {
        if (!term) {
          document.getElementById('extratoManualResults').innerHTML = '';
          return;
        }
        try {
          const res = await api(`/api/finance/entries?search=${encodeURIComponent(term)}&type=${tipoDoLancamento}&status=pendente,vencido,parcial&limit=50`);
          const container = document.getElementById('extratoManualResults');
          if (!container) return;
          const pendentes = res.entries.filter((e) => e.rawStatus === 'pending' || e.rawStatus === 'parcial');
          container.innerHTML = pendentes.length ? pendentes.map((e) => `
            <div class="finance-due-item">
              <div>
                <strong>${escapeHtml(e.description)}</strong>
                <div class="muted">${escapeHtml(e.clienteFornecedor || '-')} · Vencimento: ${escapeHtml(financeFormatDate(e.dueDate))}</div>
              </div>
              <div class="finance-due-item-amount">
                ${financeFormatBRL(e.emAberto != null ? e.emAberto : e.amountPrevisto - e.amountRealizado)}
                <button type="button" class="secondary" data-match-entry="${escapeHtml(e.id)}" ${enviando ? 'disabled' : ''}>Conciliar com este</button>
              </div>
            </div>
          `).join('') : '<p class="muted">Nenhum lançamento pendente encontrado.</p>';
          container.querySelectorAll('[data-match-entry]').forEach((btn) => {
            btn.addEventListener('click', () => doConciliar(btn.dataset.matchEntry));
          });
        } catch (error) {
          showToast(error.message || 'Erro ao buscar lançamentos.', 'error');
        }
      }, 300);
    });
  }

  await load(primeiraPagina);
};
