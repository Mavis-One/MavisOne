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
  const filters = { bankAccountId: '', importacao: '', status: '', type: '', search: '', dateFrom: '', dateTo: '', amountMin: '', amountMax: '' };
  // OS ARQUIVOS IMPORTADOS (15/10/2026): vêm com cada página do extrato, cada
  // um com quanto sobra a conciliar. Ver importacoesDoExtrato no servidor.
  let importacoes = [];
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

  function nomeDoArquivo(imp) {
    return imp.arquivo || `${imp.origem === 'csv' ? 'CSV' : 'OFX'} sem nome`;
  }

  function dataHora(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function opcoesDeArquivo() {
    return importacoes.map((imp) => `<option value="${escapeHtml(imp.id)}" ${filters.importacao === imp.id ? 'selected' : ''}>${escapeHtml(`${nomeDoArquivo(imp)} · ${imp.bankAccountName || '-'} · ${dataHora(imp.importadoEm)}`)}</option>`).join('');
  }

  // Um arquivo por linha, os com pendência primeiro; com conta no filtro, só
  // os dela.
  function painelDeArquivos() {
    const doFiltro = importacoes
      .filter((imp) => !filters.bankAccountId || imp.bankAccountId === filters.bankAccountId)
      .sort((a, b) => (b.naoConciliado > 0) - (a.naoConciliado > 0));
    if (!doFiltro.length) return '';
    const aberto = state.extratoArquivosAberto !== false;
    return `
      <details class="panel extrato-arquivos" id="extratoArquivos" ${aberto ? 'open' : ''}>
        <summary><strong>Arquivos importados</strong> <span class="muted">(${doFiltro.length})</span></summary>
        <div class="table-scroll">
          <table class="table table-actions">
            <thead><tr>
              <th>Arquivo</th><th>Conta</th><th>Período</th><th>Importado em</th>
              <th class="col-valor">Não conciliadas</th><th class="col-valor">Conciliadas</th><th class="col-valor">Ignoradas</th><th>Ações</th>
            </tr></thead>
            <tbody>
              ${doFiltro.map((imp) => {
                const ativo = filters.importacao === imp.id;
                const limpaveis = imp.naoConciliado + imp.ignorado;
                return `
                  <tr class="${ativo ? 'is-selecionada' : ''}">
                    <td><span class="texto-cortado" title="${escapeHtml(nomeDoArquivo(imp))}">${escapeHtml(nomeDoArquivo(imp))}</span></td>
                    <td>${escapeHtml(imp.bankAccountName || '-')}</td>
                    <td>${escapeHtml(financeFormatDate(imp.de))}${imp.ate && imp.ate !== imp.de ? ` a ${escapeHtml(financeFormatDate(imp.ate))}` : ''}</td>
                    <td>${escapeHtml(dataHora(imp.importadoEm))}</td>
                    <td class="col-valor">${imp.naoConciliado}</td>
                    <td class="col-valor">${imp.conciliado}</td>
                    <td class="col-valor">${imp.ignorado}</td>
                    <td class="finance-extrato-actions">
                      <button type="button" class="secondary" data-arquivo-ver="${escapeHtml(imp.id)}">${ativo ? 'Ver todos' : 'Ver'}</button>
                      <button type="button" class="secondary" data-arquivo-limpar="${escapeHtml(imp.id)}" ${limpaveis ? '' : 'disabled'}>Limpar</button>
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </details>`;
  }

  async function limparArquivo(id) {
    const imp = importacoes.find((item) => item.id === id);
    if (!imp) return;
    const confirmed = await confirmModal(
      `Limpar o arquivo ${nomeDoArquivo(imp)} (${imp.bankAccountName || 'sem conta'})? `
      + `Saem ${imp.naoConciliado} não conciliada(s)`
      + (imp.ignorado ? ` e ${imp.ignorado} ignorada(s)` : '')
      + (imp.conciliado ? `; as ${imp.conciliado} conciliada(s) ficam` : '')
      + '.'
    );
    if (!confirmed) return;
    try {
      const resultado = await api(`/api/finance/bank-transactions/importacoes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      showToast(`${resultado.removidas} movimentação(ões) removida(s) do extrato.`, 'success');
      if (filters.importacao === id && !resultado.mantidas) filters.importacao = '';
      page = 1;
      load();
    } catch (error) {
      showToast(error.message || 'Erro ao limpar o arquivo.', 'error');
    }
  }

  // CONCILIAR AUTOMÁTICO (28/10/2026, pedido do usuário: "a conciliação deve
  // ocorrer com os dados batendo, empresa, fornecedor, valores e datas"). Vale
  // para as não conciliadas do filtro da tela; o servidor só concilia quando
  // tudo bate e o valor é único dos dois lados (lib/conciliacao-automatica.js).
  async function conciliarAutomatico(botao) {
    if (botao.disabled) return;
    const confirmed = await confirmModal('Conciliar automaticamente as movimentações não conciliadas do filtro atual? '
      + 'Só entram as que têm empresa, fornecedor, valor e data batendo com um único título em aberto.');
    if (!confirmed) return;
    botao.disabled = true;
    try {
      const resultado = await api('/api/finance/bank-transactions/conciliar-automatico', {
        method: 'POST',
        body: JSON.stringify({ filtros: filters })
      });
      const ficaram = resultado.analisadas - resultado.conciliadas;
      const principal = (resultado.motivos || [])[0];
      showToast(
        `${resultado.conciliadas} de ${resultado.analisadas} movimentação(ões) conciliada(s) automaticamente.`
        + (ficaram ? ` ${ficaram} ficaram para conciliar à mão${principal ? ` (a maioria: ${principal.motivo})` : ''}.` : ''),
        resultado.conciliadas ? 'success' : 'info'
      );
      load();
    } catch (error) {
      showToast(error.message || 'Erro na conciliação automática.', 'error');
    } finally {
      botao.disabled = false;
    }
  }

  function linhaDaTransacao(tx) {
    const marcada = selecionadas.has(tx.id);
    const sync = tx.source === 'open_finance';
    const conciliadoCom = tx.matchedEntryDescription || 'Ver lançamento';
    // Vários títulos (28/10/2026): "3 títulos", e cada um com o valor no title.
    const varios = Array.isArray(tx.conciliacoes) && tx.conciliacoes.length > 1;
    const tituloDoVinculo = varios
      ? tx.conciliacoes.map((c) => `${c.description || c.entryId}: ${financeFormatBRL(c.valor)}`).join('\n')
      : conciliadoCom;
    const selo = tx.conciliadoAutomaticamente
      ? ' <span class="finance-badge finance-badge-info" title="Conciliada automaticamente: empresa, fornecedor, valor e data batem">Auto</span>'
      : '';
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
        <td>${bankTxStatusBadge(tx.status)}${selo}</td>
        <td>${tx.matchedEntryId ? `<span class="finance-clickable-row texto-cortado is-curto" data-view-entry="${escapeHtml(tx.matchedEntryId)}" title="${escapeHtml(tituloDoVinculo)}">${escapeHtml(conciliadoCom)}</span>` : '<span class="muted">-</span>'}</td>
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
    importacoes = result.importacoes || [];
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
          <button type="button" class="secondary" id="extratoAutoBtn" title="Concilia sozinho o que tem empresa, fornecedor, valor e data batendo, com valor único (um título e uma movimentação com esse valor)">Conciliar automático</button>
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
            <span>Arquivo importado</span>
            <select name="importacao"><option value="">Todos</option>${opcoesDeArquivo()}</select>
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

      ${painelDeArquivos()}

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
    document.getElementById('extratoAutoBtn')?.addEventListener('click', (event) => conciliarAutomatico(event.currentTarget));

    document.getElementById('extratoFilterForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      filters.bankAccountId = formData.get('bankAccountId') || '';
      filters.importacao = formData.get('importacao') || '';
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

    document.getElementById('extratoArquivos')?.addEventListener('toggle', (event) => {
      state.extratoArquivosAberto = event.target.open;
    });
    content.querySelectorAll('[data-arquivo-ver]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.arquivoVer;
        filters.importacao = filters.importacao === id ? '' : id;
        page = 1;
        load();
      });
    });
    content.querySelectorAll('[data-arquivo-limpar]').forEach((btn) => {
      btn.addEventListener('click', () => limparArquivo(btn.dataset.arquivoLimpar));
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
    // O nome do arquivo vai junto (15/10/2026): é por ele que a tela separa e
    // limpa o que cada arquivo trouxe. CSV colado vai sem nome.
    let nomeDoArquivoEscolhido = '';
    const resumo = document.getElementById('extratoImportResumo');
    document.getElementById('extratoImportArquivo')?.addEventListener('change', async (event) => {
      linhasDoOfx = null;
      nomeDoArquivoEscolhido = '';
      resumo.hidden = true;
      const arquivo = event.target.files && event.target.files[0];
      if (!arquivo) return;
      nomeDoArquivoEscolhido = arquivo.name;
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
          ? { bankAccountId: formData.get('bankAccountId'), rows: linhasDoOfx, origem: 'ofx', arquivo: nomeDoArquivoEscolhido }
          : { bankAccountId: formData.get('bankAccountId'), text: formData.get('csvText'), arquivo: nomeDoArquivoEscolhido };
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
          + (result.conciliadasAutomaticamente ? `, ${result.conciliadasAutomaticamente} conciliada(s) automaticamente` : '')
          + (result.skipped ? `, ${result.skipped} linha(s) inválida(s) ignorada(s)` : '')
          + '.',
          result.count === 0 && result.repetidas ? 'info' : 'success'
        );
        closeExtratoModal();
        // A lista abre no arquivo que acabou de entrar.
        if (result.importacaoId) {
          filters.importacao = result.importacaoId;
          page = 1;
        }
        load();
      } catch (error) {
        showToast(error.message || 'Erro ao importar CSV.', 'error');
        submitBtn.disabled = false;
      }
    });
  }

  function cnpjFormatado(doc) {
    const d = String(doc || '');
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    if (d.length === 8) return d.replace(/(\d{2})(\d{3})(\d{3})/, '$1.$2.$3');
    return d;
  }

  async function openConciliarModal(tx) {
    const txId = tx.id;
    // EMPRESA E CONTA (15/10/2026, pedido do usuário: "um filtro para empresa e
    // contas bancárias para conseguir diferir de qual título se trata de qual
    // empresa em qual conta"). O servidor filtra ANTES de escolher as melhores
    // sugestões, e a busca manual vai pela mesma rota, com os mesmos filtros.
    // A rota já sabe o tipo pela movimentação (entrada = receita, saída =
    // despesa) e só oferece título em aberto.
    const filtro = { empresa: '', conta: '' };
    const sugestoes = (busca = '') => {
      const params = new URLSearchParams();
      if (filtro.empresa) params.set('empresa', filtro.empresa);
      if (filtro.conta) params.set('conta', filtro.conta);
      if (busca) params.set('busca', busca);
      const q = params.toString();
      return api(`/api/finance/bank-transactions/${encodeURIComponent(txId)}/matches${q ? `?${q}` : ''}`);
    };
    let primeira;
    try {
      primeira = await sugestoes();
    } catch (error) {
      showToast(error.message || 'Erro ao buscar possíveis correspondências.', 'error');
      return;
    }
    const empresas = primeira.empresas || [];
    const contas = primeira.contas || [];

    // UM ENVIO POR VEZ (fase EI). A rota leva mais de um segundo e nada na
    // tela mostrava isso: o segundo clique em "Conciliar com este" (ou num
    // outro título) gravava uma SEGUNDA baixa para a mesma movimentação. A
    // trava fica no escopo da janela e por isso vale também para os botões
    // desenhados depois (filtro, busca manual). O servidor tem a dele
    // (conciliacoesEmAndamento); esta evita até o pedido.
    let enviando = false;

    // UM PAGAMENTO, VÁRIOS TÍTULOS (28/10/2026, pedido do usuário: "um valor
    // de pagamento através do arquivo OFX pode descontar de vários lançamentos
    // diferentes"). Os marcados em "Juntar" ficam aqui com o valor que a
    // movimentação baixa de cada um, e continuam marcados quando a busca ou o
    // filtro redesenham as listas. O valor começa no esperado no extrato (o
    // líquido, no cartão), até o que falta para fechar a movimentação.
    const centavos = (v) => Math.round(Number(v || 0) * 100);
    const juntos = new Map();
    const vistos = new Map();
    const somaDosJuntos = () => [...juntos.values()].reduce((soma, j) => soma + centavos(j.valor), 0);

    const empresaDoTitulo = (m) => {
      if (!m.empresaNome && !m.empresaCnpj) return '-';
      const cnpj = cnpjFormatado(m.empresaCnpj);
      return m.empresaNome && cnpj ? `${m.empresaNome} · ${cnpj}` : (m.empresaNome || cnpj);
    };
    const itemDoTitulo = (m) => `
      <div class="finance-due-item">
        <div>
          <strong>${escapeHtml(m.description)}</strong> ${matchScoreBadge(m.matchScore)}
          <div class="muted">${escapeHtml(m.clienteFornecedor || '-')} · Vencimento: ${escapeHtml(financeFormatDate(m.dueDate))}</div>
          <div class="muted">Empresa: ${escapeHtml(empresaDoTitulo(m))} · Conta: ${escapeHtml(m.bankAccountName || '-')}</div>
        </div>
        <div class="finance-due-item-amount">
          ${financeFormatBRL(m.remaining)}
          <label class="muted" title="Marque vários para a movimentação baixar todos (um pagamento, vários títulos)"><input type="checkbox" data-juntar="${escapeHtml(m.id)}" ${juntos.has(m.id) ? 'checked' : ''} /> Juntar</label>
          <button type="button" class="secondary" data-match-entry="${escapeHtml(m.id)}" ${enviando ? 'disabled' : ''}>Conciliar com este</button>
        </div>
      </div>`;
    const opcaoDeEmpresa = (op) => {
      if (op.valor === '-') return `Sem empresa (${op.quantidade})`;
      const cnpj = cnpjFormatado(op.cnpj);
      return `${op.rotulo}${cnpj && cnpj !== op.rotulo ? ` · ${cnpj}` : ''} (${op.quantidade})`;
    };
    const opcaoDeConta = (op) => (op.valor === '-' ? `Sem conta (${op.quantidade})` : `${op.rotulo} (${op.quantidade})`);

    closeExtratoModal();
    const overlay = document.createElement('div');
    overlay.id = 'extratoModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-lg">
        <h3>Conciliar movimentação</h3>
        <p class="muted">${escapeHtml(financeFormatDate(tx.date))} · ${tx.type === 'entrada' ? 'Entrada' : 'Saída'} de ${escapeHtml(financeFormatBRL(tx.amount))} · ${escapeHtml(tx.description)}</p>
        <div class="row extrato-conciliar-filtros">
          <label>Empresa
            <select id="extratoConciliarEmpresa">
              <option value="">Todas</option>
              ${empresas.map((op) => `<option value="${escapeHtml(op.valor)}">${escapeHtml(opcaoDeEmpresa(op))}</option>`).join('')}
            </select>
          </label>
          <label>Conta bancária
            <select id="extratoConciliarConta">
              <option value="">Todas</option>
              ${contas.map((op) => `<option value="${escapeHtml(op.valor)}">${escapeHtml(opcaoDeConta(op))}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="panel" id="extratoJuntos" hidden></div>
        <div class="finance-due-list" id="extratoMatchesList"></div>

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

    const botoesDeConciliar = (desligar) => {
      overlay.querySelectorAll('[data-match-entry]').forEach((b) => { b.disabled = desligar; });
      atualizarSomaDosJuntos();
    };

    // A soma e o botão, sem redesenhar o quadro (o campo em edição não perde o foco).
    function atualizarSomaDosJuntos() {
      const alvo = centavos(tx.amount);
      const soma = somaDosJuntos();
      const diferenca = alvo - soma;
      const texto = document.getElementById('extratoJuntosSoma');
      if (texto) {
        texto.className = diferenca ? 'finance-negative' : 'finance-positive';
        texto.textContent = `Soma ${financeFormatBRL(soma / 100)} de ${financeFormatBRL(alvo / 100)}`
          + (diferenca ? ` · ${diferenca > 0 ? 'faltam' : 'sobram'} ${financeFormatBRL(Math.abs(diferenca) / 100)}` : '');
      }
      const botao = document.getElementById('extratoConciliarJuntos');
      if (botao) botao.disabled = enviando || Boolean(diferenca) || !juntos.size;
    }

    function desenharJuntos() {
      const area = document.getElementById('extratoJuntos');
      if (!area) return;
      area.hidden = !juntos.size;
      if (!juntos.size) { area.innerHTML = ''; return; }
      area.innerHTML = `
        <h4>Um pagamento, vários títulos</h4>
        <p class="muted">A movimentação de ${escapeHtml(financeFormatBRL(tx.amount))} baixa os títulos marcados, cada um pelo valor ao lado. A soma tem de ser igual à movimentação.</p>
        ${[...juntos.values()].map(({ m, valor }) => `
          <div class="finance-due-item">
            <div>
              <strong>${escapeHtml(m.description)}</strong>
              <div class="muted">${escapeHtml(m.clienteFornecedor || '-')} · Vencimento: ${escapeHtml(financeFormatDate(m.dueDate))} · Em aberto: ${escapeHtml(financeFormatBRL(m.remaining))}</div>
            </div>
            <div class="finance-due-item-amount">
              <input type="number" min="0.01" step="0.01" data-valor-junto="${escapeHtml(m.id)}" value="${(centavos(valor) / 100).toFixed(2)}" style="width:120px" aria-label="Valor a baixar deste título" />
              <button type="button" class="btn-muted" data-tirar-junto="${escapeHtml(m.id)}">Tirar</button>
            </div>
          </div>`).join('')}
        <div class="modal-actions">
          <span id="extratoJuntosSoma"></span>
          <button type="button" class="btn" id="extratoConciliarJuntos">Conciliar com os ${juntos.size} marcados</button>
        </div>`;
      area.querySelectorAll('[data-valor-junto]').forEach((input) => {
        input.addEventListener('input', () => {
          const junto = juntos.get(input.dataset.valorJunto);
          if (junto) junto.valor = Number(input.value) || 0;
          atualizarSomaDosJuntos();
        });
      });
      area.querySelectorAll('[data-tirar-junto]').forEach((btn) => {
        btn.addEventListener('click', () => marcarJunto(btn.dataset.tirarJunto, false));
      });
      document.getElementById('extratoConciliarJuntos')?.addEventListener('click', doConciliarJuntos);
      atualizarSomaDosJuntos();
    }

    function marcarJunto(id, marcar) {
      if (marcar && !juntos.has(id) && vistos.has(id)) {
        const m = vistos.get(id);
        const falta = centavos(tx.amount) - somaDosJuntos();
        const esperado = centavos(m.esperado !== undefined ? m.esperado : m.remaining);
        juntos.set(id, { m, valor: (falta > 0 ? Math.min(esperado, falta) : esperado) / 100 });
      } else if (!marcar) {
        juntos.delete(id);
      }
      overlay.querySelectorAll(`[data-juntar="${CSS.escape(id)}"]`).forEach((caixa) => { caixa.checked = juntos.has(id); });
      desenharJuntos();
    }

    async function doConciliarJuntos() {
      if (enviando || !juntos.size || somaDosJuntos() !== centavos(tx.amount)) return;
      enviando = true;
      botoesDeConciliar(true);
      try {
        const itens = [...juntos.values()].map(({ m, valor }) => ({ entryId: m.id, valor: centavos(valor) / 100 }));
        await api(`/api/finance/bank-transactions/${txId}/conciliar`, { method: 'POST', body: JSON.stringify({ itens }) });
        showToast(`Movimentação conciliada com ${itens.length} título(s).`, 'success');
        closeExtratoModal();
        load();
      } catch (error) {
        showToast(error.message || 'Erro ao conciliar.', 'error');
        enviando = false;
        botoesDeConciliar(false);
      }
    }

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

    const desenhar = (container, lista, vazio) => {
      if (!container) return;
      lista.forEach((m) => vistos.set(m.id, m));
      container.innerHTML = lista.length ? lista.map(itemDoTitulo).join('') : `<p class="muted">${vazio}</p>`;
      container.querySelectorAll('[data-match-entry]').forEach((btn) => {
        btn.addEventListener('click', () => doConciliar(btn.dataset.matchEntry));
      });
      container.querySelectorAll('[data-juntar]').forEach((caixa) => {
        caixa.addEventListener('change', () => marcarJunto(caixa.dataset.juntar, caixa.checked));
      });
    };
    const desenharSugestoes = (lista) => desenhar(document.getElementById('extratoMatchesList'), lista, 'Nenhuma correspondência automática encontrada.');
    desenharSugestoes(primeira.matches || []);

    // Cada pedido ganha um número; resposta atrasada (troca rápida de filtro)
    // não sobrescreve a mais nova.
    let pedidoDasSugestoes = 0;
    let pedidoDaBusca = 0;
    const termoDaBusca = () => String(document.getElementById('extratoManualSearch')?.value || '').trim();

    async function buscarManual() {
      const term = termoDaBusca();
      const container = document.getElementById('extratoManualResults');
      const este = ++pedidoDaBusca;
      if (!term) {
        if (container) container.innerHTML = '';
        return;
      }
      try {
        const res = await sugestoes(term);
        if (este !== pedidoDaBusca) return;
        desenhar(document.getElementById('extratoManualResults'), res.matches || [], 'Nenhum lançamento pendente encontrado.');
      } catch (error) {
        showToast(error.message || 'Erro ao buscar lançamentos.', 'error');
      }
    }

    async function aplicarFiltro() {
      filtro.empresa = document.getElementById('extratoConciliarEmpresa')?.value || '';
      filtro.conta = document.getElementById('extratoConciliarConta')?.value || '';
      const este = ++pedidoDasSugestoes;
      try {
        const res = await sugestoes();
        if (este !== pedidoDasSugestoes) return;
        desenharSugestoes(res.matches || []);
      } catch (error) {
        showToast(error.message || 'Erro ao buscar possíveis correspondências.', 'error');
      }
      buscarManual();
    }
    document.getElementById('extratoConciliarEmpresa')?.addEventListener('change', aplicarFiltro);
    document.getElementById('extratoConciliarConta')?.addEventListener('change', aplicarFiltro);

    // A BUSCA MANUAL PEDE SÓ O QUE PODE SER CONCILIADO (fase EI): o tipo da
    // movimentação e só os em aberto, 50 por busca. Desde 15/10/2026 pela rota
    // das sugestões, que aplica empresa e conta e lê o texto como a busca de
    // Lançamentos (descrição, cliente/fornecedor, valor "1.234,56", código
    // LF0042, CPF/CNPJ).
    let searchTimeout = null;
    document.getElementById('extratoManualSearch')?.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(buscarManual, 300);
    });
  }

  await load(primeiraPagina);
};
