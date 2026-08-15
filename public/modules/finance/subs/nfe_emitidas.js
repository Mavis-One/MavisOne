window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

// A lista mostra as duas origens: a nota transmitida à SEFAZ (tabela `nfe`) e
// o registro manual do Financeiro (tabela `nfes`). Por isso o vocabulário
// cobre os estados dos dois — sem rascunho/processando/erro, uma nota que
// falhou na SEFAZ apareceria com o rótulo cru em maiúsculas, ou pior, como
// autorizada (era o que o normalizador do servidor fazia por padrão).
const NFE_STATUS_META = {
  autorizada: { label: 'Autorizada', tone: 'success' },
  cancelada: { label: 'Cancelada', tone: 'muted' },
  denegada: { label: 'Denegada', tone: 'danger' },
  rejeitada: { label: 'Rejeitada', tone: 'danger' },
  erro: { label: 'Erro', tone: 'danger' },
  inutilizada: { label: 'Inutilizada', tone: 'muted' },
  processando: { label: 'Processando', tone: 'warning' },
  rascunho: { label: 'Rascunho', tone: 'muted' },
  pendente: { label: 'Pendente', tone: 'warning' }
};

function nfeStatusBadge(status) {
  const meta = NFE_STATUS_META[status] || { label: status || '-', tone: 'muted' };
  return `<span class="finance-badge finance-badge-${meta.tone}">${meta.label}</span>`;
}

function nfeFormatDocument(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return value || '-';
}

// Aviso obrigatório: nenhum destes layouts é DANFE oficial. A DANFE de verdade
// vem em PDF da Focus NFe (ação "Baixar DANFE"), que exige a API configurada.
const NFE_AVISO_NAO_FISCAL = 'Documento gerado pelo sistema — registro interno, sem valor fiscal (não é uma DANFE oficial).';

const NFE_PRINT_LAYOUTS = {
  // A4 completo: o layout que já existia.
  completo: (nfe, h) => ({
    css: `
      body { font-family: Arial, sans-serif; padding: 24px; color: #10213a; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 13px; }
      .muted { color: #666; }
      .total { text-align: right; font-weight: bold; margin-top: 10px; }
    `,
    body: `
      <h1>NF-e ${h(nfe.number)} / Série ${h(nfe.series)}</h1>
      <p class="muted">${NFE_AVISO_NAO_FISCAL}</p>
      <p><strong>Data de emissão:</strong> ${financeFormatDate(nfe.date)} &nbsp; <strong>Status:</strong> ${h((NFE_STATUS_META[nfe.status] || {}).label || nfe.status)}</p>
      <p><strong>Cliente:</strong> ${h(nfe.customer)} &nbsp; <strong>CPF/CNPJ:</strong> ${h(nfeFormatDocument(nfe.clientDocument))}</p>
      <p><strong>Endereço:</strong> ${h(nfe.clientAddress || '-')}, ${h(nfe.clientCity || '-')} - ${h(nfe.clientState || '-')}</p>
      ${nfe.key ? `<p><strong>Chave:</strong> ${h(nfe.key)}</p>` : ''}
      <table>
        <thead><tr><th>Código</th><th>Descrição</th><th>Qtd.</th><th>Valor unit.</th><th>Total</th></tr></thead>
        <tbody>${(nfe.items || []).map((item) => `
          <tr>
            <td>${h(item.code || '-')}</td><td>${h(item.description || '')}</td>
            <td>${h(String(item.quantity ?? ''))}</td>
            <td>${financeFormatBRL(item.unitPrice)}</td><td>${financeFormatBRL(item.total)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p class="total">Valor total: ${financeFormatBRL(nfe.amount)}</p>
    `
  }),

  // Bobina de 80mm: uma coluna, fonte pequena, sem bordas de tabela.
  simplificado: (nfe, h) => ({
    css: `
      @page { size: 80mm auto; margin: 3mm; }
      body { font-family: 'Courier New', monospace; font-size: 11px; color: #000; width: 74mm; margin: 0; }
      h1 { font-size: 13px; text-align: center; margin: 0 0 2px; }
      .center { text-align: center; }
      .sep { border-top: 1px dashed #000; margin: 6px 0; }
      .linha { display: flex; justify-content: space-between; gap: 6px; }
      .item { margin-bottom: 3px; }
      .total { font-size: 13px; font-weight: bold; }
      .aviso { font-size: 9px; text-align: center; margin-top: 8px; }
    `,
    body: `
      <h1>NF-e ${h(nfe.number)}</h1>
      <div class="center">Série ${h(nfe.series)} — ${financeFormatDate(nfe.date)}</div>
      <div class="sep"></div>
      <div>${h(nfe.customer)}</div>
      <div>${h(nfeFormatDocument(nfe.clientDocument))}</div>
      ${nfe.key ? `<div style="word-break:break-all;font-size:9px;">${h(nfe.key)}</div>` : ''}
      <div class="sep"></div>
      ${(nfe.items || []).map((item) => `
        <div class="item">
          <div>${h(item.description || '')}</div>
          <div class="linha"><span>${h(String(item.quantity ?? ''))} x ${financeFormatBRL(item.unitPrice)}</span><span>${financeFormatBRL(item.total)}</span></div>
        </div>`).join('')}
      <div class="sep"></div>
      <div class="linha total"><span>TOTAL</span><span>${financeFormatBRL(nfe.amount)}</span></div>
      <div class="aviso">${NFE_AVISO_NAO_FISCAL}</div>
    `
  }),

  // Etiqueta de despacho: destinatário em destaque para colar no volume.
  etiqueta: (nfe, h) => ({
    css: `
      @page { size: 100mm 50mm; margin: 3mm; }
      body { font-family: Arial, sans-serif; font-size: 11px; color: #000; margin: 0; }
      .etiqueta { border: 1px solid #000; padding: 6px; height: 44mm; box-sizing: border-box; }
      .topo { display: flex; justify-content: space-between; font-size: 10px; border-bottom: 1px solid #000; padding-bottom: 3px; }
      .dest { font-size: 14px; font-weight: bold; margin: 5px 0 2px; }
      .chave { font-size: 8px; word-break: break-all; margin-top: 4px; }
    `,
    body: `
      <div class="etiqueta">
        <div class="topo"><span>NF-e ${h(nfe.number)} / Série ${h(nfe.series)}</span><span>${financeFormatDate(nfe.date)}</span></div>
        <div class="dest">${h(nfe.customer)}</div>
        <div>${h(nfeFormatDocument(nfe.clientDocument))}</div>
        <div>${h(nfe.clientAddress || '-')}</div>
        <div>${h(nfe.clientCity || '-')} - ${h(nfe.clientState || '-')}</div>
        ${nfe.key ? `<div class="chave">${h(nfe.key)}</div>` : ''}
      </div>
    `
  }),

  // Mesma etiqueta, duas por folha lado a lado (via/contravia).
  etiqueta2: (nfe, h) => {
    const uma = NFE_PRINT_LAYOUTS.etiqueta(nfe, h);
    return {
      css: uma.css.replace('@page { size: 100mm 50mm; margin: 3mm; }', '@page { size: A4 landscape; margin: 5mm; }') +
        '.par { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }',
      body: `<div class="par">${uma.body}${uma.body}</div>`
    };
  }
};

function nfePrint(nfe, layout = 'completo') {
  const build = NFE_PRINT_LAYOUTS[layout] || NFE_PRINT_LAYOUTS.completo;
  const { css, body } = build(nfe, escapeHtml);
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) return;
  win.opener = null;
  win.document.write(`<html><head><title>NF-e ${escapeHtml(nfe.number)}</title><meta charset="utf-8" /><style>${css}</style></head><body>${body}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

window.MavisSubscreenRegistry.finance.nfe_emitidas = async function renderFinanceNfeEmitidas(ctx) {
  const { content, api, showToast, state, loadModule, escapeHtml, confirmModal } = ctx;

  // Esta tela é espelhada: aparece no Financeiro e no Fiscal. A navegação entre
  // ela e "Nova NF-e Avulsa" tem que ficar no módulo por onde a pessoa entrou —
  // 'finance' fixo mandava para o Financeiro quem estava no Fiscal.
  // Só vale para as irmãs: ir para a venda ou para o lançamento continua
  // atravessando de módulo, porque essas telas existem em um lugar só.
  const moduloAtual = () => (state.activeModule === 'fiscal' ? 'fiscal' : 'finance');

  const filters = { search: '', status: '', dateFrom: '', dateTo: '' };
  let page = 1;
  const limit = 15;

  // Seleção guardada por id (não por índice) para sobreviver a refiltragem;
  // `notasDaPagina` guarda os objetos completos, que o painel de ações precisa.
  const selecionadas = new Set();
  let notasDaPagina = [];
  let apiFiscalConfigurada = false;

  // Descobre uma vez se a Focus NFe está configurada — é o que decide se as
  // ações fiscais aparecem habilitadas ou desabilitadas com o motivo.
  try {
    const status = await api('/api/focusnfe/status');
    apiFiscalConfigurada = Boolean(status.configured && status.connected);
  } catch {
    apiFiscalConfigurada = false;
  }

  function buildQuery() {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    return params.toString();
  }

  async function load() {
    let result;
    try {
      result = await api(`/api/finance/nfe?${buildQuery()}`);
    } catch (error) {
      content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar NF-e: ${escapeHtml(error.message || 'erro desconhecido')}</p></div>`;
      return;
    }
    renderView(result);
  }

  function financialSummary(nfe) {
    if (!nfe.financialEntries.length) return '-';
    const paid = nfe.financialEntries.filter((e) => e.status === 'pago' || e.status === 'recebido').length;
    return `${paid}/${nfe.financialEntries.length} parcela${nfe.financialEntries.length === 1 ? '' : 's'} paga${paid === 1 ? '' : 's'}`;
  }

  // Contexto entregue ao painel de ações: seleção atual + os callbacks que cada
  // ação chama. Recalculado a cada render para o painel nunca ver estado velho.
  function actionsContext() {
    const lista = notasDaPagina.filter((nfe) => selecionadas.has(nfe.id));
    return {
      selecionadas: lista,
      nfe: lista.length === 1 ? lista[0] : null,
      apiFiscalConfigurada,
      escapeHtml,
      showToast,
      print: nfePrint,
      cancelar: cancelNfe,
      duplicar: duplicarNfe,
      irParaVenda: irParaVenda,
      baixarArquivo: baixarArquivoFiscal,
      baixarLote: baixarLoteFiscal,
      cartaCorrecao: abrirCartaCorrecao,
      consultarStatus: consultarStatusFiscal,
      statusServico: consultarStatusServico,
      limparSelecao: () => { selecionadas.clear(); load(); }
    };
  }

  // ---------------------------------------------------------------- fiscais
  // Estas ações só chegam aqui para notas de origem 'fiscal' — o painel bloqueia
  // as manuais antes, porque elas não existem na SEFAZ.

  // BUSCA com o token e abre o resultado, em vez de apontar a aba para a rota.
  //
  // A versão anterior fazia window.open direto na URL da API, para preservar o
  // nome do Content-Disposition e não segurar o arquivo na memória. Só que a
  // autenticação deste sistema é por CABEÇALHO (x-auth-token, guardado no
  // sessionStorage) e não por cookie: uma aba nova é navegação limpa, chega ao
  // servidor sem token nenhum e leva 403 "Sem permissão".
  //
  // Medido em 15/08/2026 numa nota AUTORIZADA, com o PDF já guardado no banco:
  // a rota devolvia 13 KB de %PDF-1.3 com o token, e 403 sem ele. Baixar DANFE,
  // Baixar XML, DANFE com UN. TRIB. e DANFE em Lote passavam pela mesma função,
  // então nenhum dos quatro funcionava — e a tela não dizia por quê, porque o
  // erro acontecia na outra aba.
  //
  // O nome do arquivo é reposto pelo atributo `download`, e o objeto é liberado
  // depois; o custo de memória é de um DANFE (dezenas de KB), não de um lote.
  //
  // A ABA É ABERTA ANTES DA BUSCA, e isso não é estilo: é a correção de um
  // segundo bug, encontrado com a primeira já no ar. Abrir a aba DEPOIS do
  // await sai do gesto do usuário, e o Chrome trata como pop-up: a janela
  // aparece e a navegação é barrada. O resultado era uma aba "about:blank"
  // parada — nem PDF, nem erro, nem aviso. Não deu para ver isso no Chrome sem
  // interface, que não liga o bloqueador de pop-up; só apareceu no navegador
  // de verdade. Abrindo aqui, dentro do clique, a janela é nossa e navegar
  // nela depois já não é pop-up nenhum.
  async function baixarArquivoFiscal(nfe, tipo, { paraLeitura = true } = {}) {
    const rotulo = tipo === 'xml' ? 'XML' : 'DANFE';
    // PDF abre para LER — é o que a pessoa quer ao clicar em DANFE. XML não tem
    // o que ver na tela, e o LOTE nunca abre aba: dez notas seriam dez pop-ups.
    const querAba = paraLeitura && tipo !== 'xml';
    const aba = querAba ? window.open('', '_blank') : null;
    // Aba em branco enquanto a busca acontece parece travamento.
    if (aba) aba.document.write(`<title>${rotulo}</title><p style="font:16px system-ui;padding:24px">Abrindo o ${rotulo}…</p>`);
    let url = null;
    try {
      const resposta = await fetch(`/api/fiscal/nfe/${encodeURIComponent(nfe.id)}/${tipo}`, {
        headers: { 'x-auth-token': getSessionToken() || '' }
      });
      if (!resposta.ok) {
        // A rota devolve JSON no erro ("ainda não disponível", "Sem permissão").
        const corpo = await resposta.json().catch(() => ({}));
        // Fecha a aba antes do aviso: deixá-la aberta em branco é justamente o
        // sintoma que mandou o usuário procurar problema onde não estava.
        if (aba) aba.close();
        showToast(corpo.error || `Não foi possível abrir o ${rotulo} (HTTP ${resposta.status}).`, 'error');
        return;
      }
      const blob = await resposta.blob();
      url = URL.createObjectURL(blob);
      const nome = `nfe-${nfe.number || nfe.key || nfe.id}.${tipo === 'xml' ? 'xml' : 'pdf'}`;

      if (aba && !aba.closed) {
        // replace e não href: a aba não guarda o "carregando" no histórico, e
        // o botão Voltar dela não volta para uma página que não existe mais.
        aba.location.replace(url);
      } else {
        // Sem aba (XML, lote, ou pop-up bloqueado de vez): vai para o disco.
        const link = document.createElement('a');
        link.href = url;
        link.download = nome;
        document.body.appendChild(link);
        link.click();
        link.remove();
        if (querAba) showToast(`O ${rotulo} foi baixado — o navegador bloqueou a abertura em nova aba.`, 'success');
      }
    } catch (error) {
      if (aba) aba.close();
      showToast(`Falha ao buscar o ${rotulo}: ${error.message || 'erro desconhecido'}`, 'error');
    } finally {
      // Só depois da aba ler o conteúdo — revogar na hora deixa a aba em branco.
      if (url) setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  function baixarLoteFiscal(notas, tipo) {
    // Um arquivo por nota: a Focus não tem endpoint de lote. Vai espaçado para
    // não disparar N buscas ao mesmo tempo, e sempre para o disco.
    notas.forEach((nfe, i) => setTimeout(() => baixarArquivoFiscal(nfe, tipo, { paraLeitura: false }), i * 400));
    showToast(`Baixando ${notas.length} arquivo(s)…`, 'success');
  }

  async function consultarStatusFiscal(notas) {
    let atualizadas = 0;
    for (const nfe of notas) {
      try {
        // GET da nota reconsulta a SEFAZ e regrava o status — é o que resolve
        // nota parada em "Processando" quando o webhook não chegou.
        const res = await api(`/api/fiscal/nfe/${encodeURIComponent(nfe.id)}`);
        if (res.nfe && res.nfe.status !== nfe.statusFiscal) atualizadas += 1;
      } catch (error) {
        showToast(`NF-e ${nfe.number || nfe.referencia}: ${error.message || 'erro ao consultar'}`, 'error');
      }
    }
    showToast(atualizadas ? `${atualizadas} nota(s) mudaram de status.` : 'Nenhuma mudança de status.', 'success');
    await load();
  }

  async function consultarStatusServico() {
    try {
      const status = await api('/api/focusnfe/status');
      showToast(
        status.connected
          ? `Focus NFe respondendo — ambiente de ${status.ambiente}.${status.travadoEmHomologacao ? ' Notas daqui NÃO têm valor fiscal.' : ''}`
          : `Focus NFe não respondeu: ${status.message || 'sem detalhe'}`,
        status.connected ? 'success' : 'error'
      );
    } catch (error) {
      showToast(error.message || 'Erro ao consultar o serviço.', 'error');
    }
  }

  async function abrirCartaCorrecao(nfe) {
    // A SEFAZ exige de 15 a 1000 caracteres, e a CC-e NÃO pode corrigir valor,
    // data, destinatário nem itens — só dados que não alterem o cálculo do
    // imposto. Dizer isso aqui evita a rejeição depois de digitar tudo.
    const texto = window.prompt(
      'Carta de Correção (15 a 1000 caracteres).\n\n'
      + 'Não serve para corrigir valores, datas, destinatário ou itens — só dados que não mudam o cálculo do imposto.\n\n'
      + 'Descreva a correção:'
    );
    if (texto === null) return;
    const limpo = String(texto).trim();
    if (limpo.length < 15) {
      showToast('A correção precisa ter ao menos 15 caracteres (exigência da SEFAZ).', 'error');
      return;
    }
    try {
      await api(`/api/fiscal/nfe/${encodeURIComponent(nfe.id)}/cce`, {
        method: 'POST',
        body: JSON.stringify({ correcao: limpo })
      });
      showToast('Carta de Correção enviada.', 'success');
      await load();
    } catch (error) {
      showToast(error.message || 'Erro ao enviar a Carta de Correção.', 'error');
    }
  }

  function renderActionsPanel() {
    const painel = document.getElementById('nfeActionsPanel');
    if (painel) window.MavisNfeActions.render(painel, actionsContext());
  }

  async function duplicarNfe(nfe) {
    // `state.financeDuplicateNfe` era gravado aqui e NÃO era lido por tela
    // nenhuma — duplicar só abria um formulário em branco. Agora usa o mesmo
    // canal de pré-preenchimento da emissão (`state.nfeFromOrder`), sem
    // orderId: uma duplicata é uma nota NOVA e avulsa, e herdar o pedido da
    // original faria a cópia não gerar contas a receber.
    let itens = [];
    if (nfe.origem === 'fiscal') {
      try {
        // Os itens da nota fiscal estão no payload que foi para a SEFAZ — é a
        // única cópia fiel do que foi transmitido.
        const res = await api(`/api/fiscal/nfe/${encodeURIComponent(nfe.id)}`);
        itens = ((res.nfe?.payloadEnviado || {}).items || []).map((item) => ({
          code: item.codigo_produto || '',
          description: item.descricao || '',
          quantity: Number(item.quantidade_comercial || 0),
          unitPrice: Number(item.valor_unitario_comercial || 0)
        }));
      } catch (error) {
        showToast('Não foi possível ler os itens da nota original: ' + (error.message || error), 'error');
        return;
      }
    } else {
      itens = (nfe.items || []).map((item) => ({
        code: item.code || '', description: item.description || '',
        quantity: Number(item.quantity || 0), unitPrice: Number(item.unitPrice || 0)
      }));
    }
    state.nfeFromOrder = {
      orderId: '',
      clientSupplierId: nfe.clientSupplierId || '',
      clientName: nfe.customer || '',
      items: itens
    };
    state.activeSub = 'nova_nfe_avulsa';
    // Módulo atual, não 'finance' fixo: esta tela é espelhada no Fiscal, e
    // fixar o destino jogaria para o Financeiro quem entrou pelo Fiscal.
    // Irmã da mesma dupla (Emitidas <-> Nova) fica sempre no módulo de origem.
    loadModule(moduloAtual());
  }

  function irParaVenda(nfe) {
    state.salesOpenRecordId = nfe.orderId;
    state.activeSub = 'sales_records';
    loadModule('sales');
  }

  function renderView(result) {
    const totalPages = Math.max(1, Math.ceil(result.total / limit));
    notasDaPagina = result.nfes || [];
    // Descarta da seleção o que saiu da página atual (filtro/paginação mudou).
    const idsVisiveis = new Set(notasDaPagina.map((n) => n.id));
    [...selecionadas].forEach((id) => { if (!idsVisiveis.has(id)) selecionadas.delete(id); });
    const todasMarcadas = notasDaPagina.length > 0 && notasDaPagina.every((n) => selecionadas.has(n.id));

    content.innerHTML = `
      <div class="cadastro-page-head">
        <div>
          <h3>NF-e Emitidas</h3>
          <p class="muted">${result.total} nota${result.total === 1 ? '' : 's'} encontrada${result.total === 1 ? '' : 's'}</p>
        </div>
        <div class="cadastro-list-actions">
          <button type="button" id="nfeNewBtn">+ Nova NF-e</button>
        </div>
      </div>

      <form id="nfeFilterForm" class="row" style="margin-bottom: 12px;">
        <label class="cadastro-field" style="grid-column: span 2;">
          <span>Busca</span>
          <input name="search" value="${escapeHtml(filters.search)}" placeholder="Número, cliente ou chave" />
        </label>
        <label class="cadastro-field">
          <span>Status</span>
          <select name="status">
            <option value="">Todos</option>
            ${Object.entries(NFE_STATUS_META).map(([value, meta]) => `<option value="${value}" ${filters.status === value ? 'selected' : ''}>${meta.label}</option>`).join('')}
          </select>
        </label>
        <label class="cadastro-field">
          <span>Data inicial</span>
          <input type="date" name="dateFrom" value="${escapeHtml(filters.dateFrom)}" />
        </label>
        <label class="cadastro-field">
          <span>Data final</span>
          <input type="date" name="dateTo" value="${escapeHtml(filters.dateTo)}" />
        </label>
        <div style="align-self: end;"><button type="submit" class="secondary">Filtrar</button></div>
      </form>

      <div id="nfeActionsPanel" class="nfe-actions-panel" hidden></div>

      <div class="panel">
        <div class="table-scroll">
          <table class="table table-actions">
            <thead>
              <tr>
                <th class="nfe-check-col"><input type="checkbox" id="nfeSelectAll" ${todasMarcadas ? 'checked' : ''} title="Selecionar todas desta página" /></th>
                <th>Número</th><th>Série</th><th>Data</th><th>Cliente</th><th>CPF/CNPJ</th><th>Valor</th><th>Status</th><th>Chave</th><th>Lançamento financeiro</th><th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${result.nfes.length ? result.nfes.map((nfe) => `
                <tr class="cadastro-row-clickable finance-entry-row ${selecionadas.has(nfe.id) ? 'is-selected' : ''}" data-id="${escapeHtml(nfe.id)}">
                  <td class="nfe-check-col"><input type="checkbox" data-select="${escapeHtml(nfe.id)}" ${selecionadas.has(nfe.id) ? 'checked' : ''} /></td>
                  <td>${escapeHtml(nfe.number)}</td>
                  <td>${escapeHtml(nfe.series)}</td>
                  <td>${financeFormatDate(nfe.date)}</td>
                  <td>${escapeHtml(nfe.customer)}</td>
                  <td>${nfeFormatDocument(nfe.clientDocument)}</td>
                  <td>${financeFormatBRL(nfe.amount)}</td>
                  <td>${nfeStatusBadge(nfe.status)}</td>
                  <td>${nfe.key ? escapeHtml(nfe.key) : '<span class="muted">-</span>'}</td>
                  <td>${financialSummary(nfe)}</td>
                  <td>${nfe.status === 'autorizada' ? `<button type="button" class="secondary" data-quick-cancel="${nfe.id}">Cancelar</button>` : ''}</td>
                </tr>
              `).join('') : `<tr><td colspan="11" class="muted">Nenhuma NF-e encontrada.</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="finance-pagination">
          <button type="button" class="secondary" id="nfePrevPage" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
          <span class="muted">Página ${page} de ${totalPages}</span>
          <button type="button" class="secondary" id="nfeNextPage" ${page >= totalPages ? 'disabled' : ''}>Próxima</button>
        </div>
      </div>
    `;

    document.getElementById('nfeNewBtn')?.addEventListener('click', () => {
      state.activeSub = 'nova_nfe_avulsa';
      loadModule(moduloAtual());
    });

    document.getElementById('nfeFilterForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      filters.search = formData.get('search') || '';
      filters.status = formData.get('status') || '';
      filters.dateFrom = formData.get('dateFrom') || '';
      filters.dateTo = formData.get('dateTo') || '';
      page = 1;
      load();
    });

    content.querySelectorAll('.finance-entry-row').forEach((row) => {
      row.addEventListener('click', (event) => {
        // Clicar no checkbox seleciona; clicar no resto da linha abre a nota.
        if (event.target.closest('.nfe-check-col')) return;
        openNfeModal(row.dataset.id);
      });
    });

    // Só o painel e as linhas são redesenhados na seleção — não recarrega a
    // lista, senão o clique no checkbox ficaria lento e perderia o scroll.
    function aplicarSelecaoNaTela() {
      content.querySelectorAll('[data-select]').forEach((cb) => {
        cb.checked = selecionadas.has(cb.dataset.select);
        cb.closest('tr')?.classList.toggle('is-selected', cb.checked);
      });
      const todas = notasDaPagina.length > 0 && notasDaPagina.every((n) => selecionadas.has(n.id));
      const selectAll = document.getElementById('nfeSelectAll');
      if (selectAll) {
        selectAll.checked = todas;
        selectAll.indeterminate = !todas && selecionadas.size > 0;
      }
      renderActionsPanel();
    }

    content.querySelectorAll('[data-select]').forEach((cb) => {
      cb.addEventListener('click', (event) => event.stopPropagation());
      cb.addEventListener('change', () => {
        if (cb.checked) selecionadas.add(cb.dataset.select);
        else selecionadas.delete(cb.dataset.select);
        aplicarSelecaoNaTela();
      });
    });

    document.getElementById('nfeSelectAll')?.addEventListener('change', (event) => {
      if (event.target.checked) notasDaPagina.forEach((n) => selecionadas.add(n.id));
      else selecionadas.clear();
      aplicarSelecaoNaTela();
    });

    renderActionsPanel();
    content.querySelectorAll('[data-quick-cancel]').forEach((btn) => {
      btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        await cancelNfe(btn.dataset.quickCancel);
      });
    });

    document.getElementById('nfePrevPage')?.addEventListener('click', () => { if (page > 1) { page -= 1; load(); } });
    document.getElementById('nfeNextPage')?.addEventListener('click', () => {
      if (page < totalPages) { page += 1; load(); }
    });
  }

  async function cancelNfe(id, opcoes = {}) {
    // Cancelar uma nota que está na SEFAZ é um EVENTO fiscal: exige
    // justificativa de 15 caracteres e fica registrado lá para sempre.
    // Cancelar um registro manual é só apagar uma linha do Financeiro. São
    // operações diferentes, em rotas diferentes — descobrir isso pela origem
    // evita mandar uma para a outra.
    const nota = notasDaPagina.find((n) => n.id === id);
    const ehFiscal = nota ? nota.origem === 'fiscal' : false;

    if (!ehFiscal) {
      const confirmed = await confirmModal('Confirma o cancelamento desta NF-e? Parcelas ainda pendentes serão canceladas; parcelas já pagas permanecem no histórico.');
      if (!confirmed) return;
      try {
        await api(`/api/finance/nfe/${id}/cancelar`, { method: 'POST' });
        showToast('NF-e cancelada com sucesso.', 'success');
        closeNfeModal();
        await load();
      } catch (error) {
        showToast(error.message || 'Erro ao cancelar NF-e.', 'error');
      }
      return;
    }

    const aviso = opcoes.extemporaneo
      ? 'CANCELAMENTO EXTEMPORÂNEO — fora do prazo normal (24h em SC).\n\n'
        + 'A SEFAZ pode recusar, e a recusa não é do sistema: depende de autorização específica dela.\n\n'
      : '';
    const justificativa = window.prompt(
      `${aviso}Justificativa do cancelamento (mínimo 15 caracteres, exigência da SEFAZ):`
    );
    if (justificativa === null) return;
    const limpo = String(justificativa).trim();
    if (limpo.length < 15) {
      showToast('A justificativa precisa ter ao menos 15 caracteres.', 'error');
      return;
    }
    try {
      await api(`/api/fiscal/nfe/${encodeURIComponent(id)}/cancelar`, {
        method: 'POST',
        body: JSON.stringify({ justificativa: limpo })
      });
      showToast('NF-e cancelada na SEFAZ.', 'success');
      closeNfeModal();
      await load();
    } catch (error) {
      showToast(error.message || 'Erro ao cancelar NF-e.', 'error');
    }
  }

  function closeNfeModal() {
    document.getElementById('nfeModal')?.remove();
  }

  async function openNfeModal(id) {
    const naLista = notasDaPagina.find((n) => n.id === id);
    let nfe;
    try {
      if (naLista && naLista.origem === 'fiscal') {
        // A nota fiscal vive em outra rota e em outro formato. Os itens estão
        // dentro do payload que foi para a SEFAZ — é a única cópia fiel do que
        // foi transmitido, e é ela que deve ser mostrada, não uma remontagem.
        const res = await api(`/api/fiscal/nfe/${encodeURIComponent(id)}`);
        nfe = fiscalParaModal(res.nfe, naLista);
      } else {
        const res = await api(`/api/finance/nfe/${id}`);
        nfe = res.nfe;
      }
    } catch (error) {
      showToast(error.message || 'Erro ao carregar NF-e.', 'error');
      return;
    }
    renderNfeModal(nfe);
  }

  // Traduz a nota fiscal para o formato que o modal já desenha, lendo os itens
  // do payload enviado à SEFAZ.
  function fiscalParaModal(fiscal, daLista) {
    const payload = (fiscal && fiscal.payloadEnviado) || {};
    return {
      ...daLista,
      ...(fiscal || {}),
      id: daLista.id,
      origem: 'fiscal',
      number: fiscal?.numero || daLista.number || '',
      series: fiscal?.serie || daLista.series || '',
      date: daLista.date,
      status: daLista.status,
      key: fiscal?.chaveAcesso || '',
      amount: Number(fiscal?.valorTotal || daLista.amount || 0),
      // O nome REAL, não o que foi para a SEFAZ: em homologação o enviado é o
      // texto fixo exigido por ela.
      customer: daLista.customer || '',
      clientDocument: daLista.clientDocument || '',
      clientAddress: payload.logradouro_destinatario || '',
      clientCity: payload.municipio_destinatario || '',
      clientState: payload.uf_destinatario || '',
      clientStateRegistration: payload.inscricao_estadual_destinatario || '',
      taxNotes: payload.informacoes_adicionais_contribuinte || '',
      paymentType: 'avista',
      installmentsCount: 1,
      installmentIntervalDays: 30,
      financialEntries: [],
      items: (payload.items || []).map((item) => ({
        code: item.codigo_produto || '',
        description: item.descricao || '',
        quantity: Number(item.quantidade_comercial || 0),
        unitPrice: Number(item.valor_unitario_comercial || 0),
        total: Number(item.valor_bruto || 0)
      }))
    };
  }

  function renderNfeModal(nfe) {
    closeNfeModal();
    const overlay = document.createElement('div');
    overlay.id = 'nfeModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-lg">
        <div class="finance-modal-head">
          <div>
            <h3>NF-e ${escapeHtml(nfe.number)} / Série ${escapeHtml(nfe.series)}</h3>
            <p class="muted">${escapeHtml(nfe.customer)} ${nfeStatusBadge(nfe.status)}</p>
          </div>
          <button type="button" class="icon-button" id="nfeModalClose" title="Fechar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </div>

        <div class="finance-modal-info-grid">
          <div><span class="muted">Data de emissão</span><strong>${financeFormatDate(nfe.date)}</strong></div>
          <div><span class="muted">CPF/CNPJ</span><strong>${nfeFormatDocument(nfe.clientDocument)}</strong></div>
          <div><span class="muted">Endereço</span><strong>${escapeHtml(nfe.clientAddress || '-')}</strong></div>
          <div><span class="muted">Cidade/UF</span><strong>${escapeHtml(nfe.clientCity || '-')} ${nfe.clientState ? '/ ' + escapeHtml(nfe.clientState) : ''}</strong></div>
          <div><span class="muted">Inscrição estadual</span><strong>${escapeHtml(nfe.clientStateRegistration || '-')}</strong></div>
          <div><span class="muted">Chave de acesso</span><strong>${escapeHtml(nfe.key || '-')}</strong></div>
          <div><span class="muted">Valor total</span><strong>${financeFormatBRL(nfe.amount)}</strong></div>
          <div><span class="muted">Forma de pagamento</span><strong>${nfe.paymentType === 'parcelado' ? `Parcelado (${nfe.installmentsCount}x)` : 'À vista'}</strong></div>
        </div>

        <h4>Itens</h4>
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Código</th><th>Descrição</th><th>Qtd.</th><th>Valor unit.</th><th>Total</th></tr></thead>
            <tbody>
              ${nfe.items.map((item) => `<tr><td>${escapeHtml(item.code || '-')}</td><td>${escapeHtml(item.description)}</td><td>${item.quantity}</td><td>${financeFormatBRL(item.unitPrice)}</td><td>${financeFormatBRL(item.total)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${nfe.taxNotes ? `<p class="muted">Observações fiscais: ${escapeHtml(nfe.taxNotes)}</p>` : ''}

        <h4>Lançamentos financeiros vinculados</h4>
        ${nfe.financialEntries.length ? `
          <div class="finance-due-list">
            ${nfe.financialEntries.map((entry) => `
              <div class="finance-due-item finance-clickable-row" data-view-entry="${entry.id}">
                <div>
                  <strong>${escapeHtml(entry.description)}</strong>
                  <div class="muted">Vencimento: ${financeFormatDate(entry.dueDate)}</div>
                </div>
                <div class="finance-due-item-amount">${financeFormatBRL(entry.amount)} ${financeStatusBadge(entry.status)}</div>
              </div>
            `).join('')}
          </div>
        ` : '<p class="muted">Nenhum lançamento vinculado.</p>'}

        <div class="finance-modal-actions">
          <button type="button" class="secondary" id="nfeModalPrint">Imprimir</button>
          ${nfe.status === 'autorizada' ? `<button type="button" class="btn-danger" id="nfeModalCancel">Cancelar NF-e</button>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeNfeModal(); });
    document.getElementById('nfeModalClose')?.addEventListener('click', closeNfeModal);
    document.getElementById('nfeModalPrint')?.addEventListener('click', () => nfePrint(nfe));
    document.getElementById('nfeModalCancel')?.addEventListener('click', () => cancelNfe(nfe.id));

    overlay.querySelectorAll('[data-view-entry]').forEach((row) => {
      row.addEventListener('click', () => {
        closeNfeModal();
        state.financeOpenEntryId = row.dataset.viewEntry;
        state.activeSub = 'lancamentos';
        loadModule('finance');
      });
    });
  }

  await load();
};
