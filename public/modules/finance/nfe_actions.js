// Painel de ações fiscais da tela de NF-e Emitidas.
//
// Barra que aparece quando o usuário marca uma ou mais notas, no mesmo padrão
// de grade de ícones do ERP de referência: ações de nota única de um lado,
// ações de lote do outro, e o que não se aplica fica visivelmente desabilitado
// em vez de sumir — o usuário vê que a função existe e por que não pode usar
// agora (o `title` do botão explica o motivo).
//
// A maior parte destas ações depende da API fiscal (Focus NFe). Enquanto ela
// não estiver configurada, elas ficam desabilitadas com o motivo. Ligar cada
// uma é só preencher o `run` correspondente — a UI, a seleção e as regras de
// habilitação já estão prontas.
window.MavisNfeActions = (function () {
  const icon = (paths, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</svg>`;

  const ICONS = {
    printer: icon('<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>'),
    download: icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'),
    mail: icon('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>'),
    copy: icon('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    whatsapp: icon('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
    close: icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    file: icon('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v6h6"/>'),
    arrow: icon('<path d="M7 17 17 7"/><path d="M7 7h10v10"/>'),
    check: icon('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
    trash: icon('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>')
  };

  const AGUARDA_API = 'Requer a API fiscal (Focus NFe) configurada em Configurações › Fiscal.';
  // Uma nota lançada à mão no Financeiro não existe na SEFAZ: não tem chave,
  // XML, DANFE nem protocolo para consultar. Dizer isso é melhor do que
  // oferecer o botão e devolver um erro de servidor.
  const SO_FISCAL = 'Esta NF-e é um registro manual do Financeiro — não foi transmitida à SEFAZ, então não tem XML, DANFE nem status a consultar.';
  const AGUARDA_INTEGRACAO = 'Requer integração de envio ainda não configurada.';
  // Distinto de AGUARDA_API de propósito: dizer "configure a API" para quem já
  // configurou manda a pessoa procurar problema onde não tem.
  const NAO_IMPLEMENTADA = 'Ação ainda não implementada — o painel já está pronto para recebê-la.';

  // scope: 'single' só com exatamente 1 nota; 'batch' com 1 ou mais; 'any' sempre.
  // enabled(ctx) devolve true, ou uma string com o motivo do bloqueio.
  const CATALOG = [
    {
      id: 'imprimir', label: 'Imprimir', icon: ICONS.printer, scope: 'single',
      run: (ctx) => ctx.print(ctx.nfe, 'completo')
    },
    {
      // O layout 80mm resume a nota a partir dos itens da LISTA — e a lista de
      // uma nota fiscal não traz itens nem endereço (fiscalNfeParaLista, no
      // server.js). Numa nota da SEFAZ ele sairia sem produto nenhum. Para
      // essas, o documento é a DANFE, que vem em A4 pelo botão Imprimir.
      id: 'imprimir_80mm', label: 'Imprimir NF-e Simplificada (80mm)', icon: ICONS.printer, scope: 'single',
      enabled: (ctx) => (ctx.nfe && ctx.nfe.origem === 'fiscal'
        ? 'Esta nota foi à SEFAZ: o documento dela é a DANFE, em A4 — use "Imprimir". O layout 80mm é do registro manual do Financeiro.'
        : true),
      run: (ctx) => ctx.print(ctx.nfe, 'simplificado')
    },
    {
      id: 'etiqueta', label: 'Imprimir Etiqueta de Despacho', icon: ICONS.printer, scope: 'single',
      run: (ctx) => ctx.print(ctx.nfe, 'etiqueta')
    },
    {
      id: 'etiqueta_2col', label: 'Imprimir Etiqueta de Despacho em Duas Colunas', icon: ICONS.printer, scope: 'single',
      run: (ctx) => ctx.print(ctx.nfe, 'etiqueta2')
    },
    {
      id: 'baixar_xml', label: 'Baixar XML', icon: ICONS.download, scope: 'single',
      needsApi: true, needsAuthorized: true, soFiscal: true,
      run: (ctx) => ctx.baixarArquivo(ctx.nfe, 'xml')
    },
    {
      id: 'baixar_danfe', label: 'Baixar DANFE', icon: ICONS.download, scope: 'single',
      needsApi: true, needsAuthorized: true, soFiscal: true,
      run: (ctx) => ctx.baixarArquivo(ctx.nfe, 'danfe')
    },
    {
      // A DANFE com unidade tributável é a mesma DANFE: a diferença é de
      // layout de impressão, e a Focus só entrega um. Sem endpoint próprio,
      // baixa a mesma e diz isso, em vez de fingir uma segunda versão.
      id: 'baixar_danfe_untrib', label: 'Baixar DANFE com UN. TRIB.', icon: ICONS.download, scope: 'single',
      needsApi: true, needsAuthorized: true, soFiscal: true,
      run: (ctx) => ctx.baixarArquivo(ctx.nfe, 'danfe')
    },
    {
      id: 'enviar_email', label: 'Enviar por E-mail', icon: ICONS.mail, scope: 'single',
      enabled: () => AGUARDA_INTEGRACAO
    },
    {
      id: 'duplicar', label: 'Duplicar NF-e', icon: ICONS.copy, scope: 'single', tone: 'success',
      run: (ctx) => ctx.duplicar(ctx.nfe)
    },
    {
      id: 'xml_whatsapp', label: 'Enviar XML via WhatsApp', icon: ICONS.whatsapp, scope: 'single', tone: 'success',
      enabled: () => AGUARDA_INTEGRACAO
    },
    {
      id: 'danfe_whatsapp', label: 'Enviar DANFE via WhatsApp', icon: ICONS.whatsapp, scope: 'single', tone: 'success',
      enabled: () => AGUARDA_INTEGRACAO
    },
    {
      // Fora do prazo normal (24h em SC), a SEFAZ só aceita o cancelamento com
      // autorização específica. A chamada é a mesma; o que muda é o prazo, e
      // quem decide isso é a SEFAZ, não o sistema. Por isso avisa antes.
      id: 'cancelamento_extemporaneo', label: 'Cancelamento Extemporâneo de NF-e', icon: ICONS.close, scope: 'single',
      needsApi: true, needsAuthorized: true, soFiscal: true,
      run: (ctx) => ctx.cancelar(ctx.nfe.id, { extemporaneo: true })
    },
    {
      id: 'cancelar', label: 'Cancelar NF-e', icon: ICONS.close, scope: 'single',
      enabled: (ctx) => ctx.nfe.status === 'autorizada' ? true : 'Só é possível cancelar uma NF-e autorizada.',
      run: (ctx) => ctx.cancelar(ctx.nfe.id)
    },
    {
      id: 'carta_correcao', label: 'Carta de Correção', icon: ICONS.file, scope: 'single',
      needsApi: true, needsAuthorized: true, soFiscal: true,
      run: (ctx) => ctx.cartaCorrecao(ctx.nfe)
    },
    {
      id: 'ir_para_venda', label: 'Ir Para a Venda', icon: ICONS.arrow, scope: 'single',
      enabled: (ctx) => ctx.nfe.orderId ? true : 'Esta NF-e não tem venda vinculada.',
      run: (ctx) => ctx.irParaVenda(ctx.nfe)
    },
    {
      // Em lote a Focus não tem um endpoint só: são N downloads. Baixar um a
      // um é o que existe — o navegador cuida de cada arquivo.
      id: 'xml_lote', label: 'Baixar XML em Lote', icon: ICONS.download, scope: 'batch',
      needsApi: true, soFiscal: true,
      run: (ctx) => ctx.baixarLote(ctx.selecionadas, 'xml')
    },
    {
      id: 'danfe_lote', label: 'Baixar DANFE em Lote', icon: ICONS.download, scope: 'batch',
      needsApi: true, soFiscal: true,
      run: (ctx) => ctx.baixarLote(ctx.selecionadas, 'danfe')
    },
    {
      // Reconsulta a SEFAZ e atualiza o status gravado. É o que resolve nota
      // parada em PROCESSANDO quando o webhook não chegou.
      id: 'consultar_status', label: 'Consultar Status', icon: ICONS.check, scope: 'batch',
      needsApi: true, soFiscal: true,
      run: (ctx) => ctx.consultarStatus(ctx.selecionadas)
    },
    {
      // Do serviço da SEFAZ, não da nota: por isso não exige seleção.
      id: 'status_servico', label: 'Status Serviço', icon: ICONS.check, scope: 'any',
      needsApi: true,
      run: (ctx) => ctx.statusServico()
    },
    // NÃO existe ação de excluir NF-e, por decisão de projeto. Documento fiscal
    // não se apaga: uma nota autorizada é cancelada (evento registrado na
    // SEFAZ) e permanece no histórico. Apagar o registro local quebraria a
    // trilha de auditoria e a conciliação com o que a SEFAZ tem. Se o ERP de
    // referência oferece "Excluir", não copiar isso é intencional.
    {
      id: 'cancelar_selecao', label: 'Cancelar Seleção', icon: ICONS.close, scope: 'any',
      run: (ctx) => ctx.limparSelecao()
    }
  ];

  // Motivo do bloqueio, ou null se a ação está liberada.
  function motivoBloqueio(action, ctx) {
    const n = ctx.selecionadas.length;
    if (action.scope === 'single' && n !== 1) {
      return n === 0 ? 'Selecione uma NF-e.' : 'Selecione apenas uma NF-e para esta ação.';
    }
    if (action.scope === 'batch' && n === 0) return 'Selecione ao menos uma NF-e.';
    if (action.needsApi && !ctx.apiFiscalConfigurada) return AGUARDA_API;
    // Antes de needsAuthorized: uma nota manual nunca chega a "autorizada" na
    // SEFAZ, e dizer "só para autorizada" mandaria o usuário tentar autorizar
    // um registro que não é uma nota.
    if (action.soFiscal) {
      const naoFiscais = ctx.selecionadas.filter((n) => n.origem !== 'fiscal');
      if (naoFiscais.length) return SO_FISCAL;
    }
    if (action.needsAuthorized && ctx.nfe && ctx.nfe.status !== 'autorizada') {
      return 'Disponível apenas para NF-e autorizada.';
    }
    if (typeof action.enabled === 'function') {
      const resultado = action.enabled(ctx);
      if (resultado !== true) return resultado || 'Indisponível.';
    }
    if (!action.run) return NAO_IMPLEMENTADA;
    return null;
  }

  function render(container, ctx) {
    const n = ctx.selecionadas.length;
    if (n === 0) {
      container.innerHTML = '';
      container.hidden = true;
      return;
    }
    container.hidden = false;

    const botoes = CATALOG.map((action) => {
      const motivo = motivoBloqueio(action, ctx);
      const classes = ['nfe-action', action.tone ? `nfe-action-${action.tone}` : '', motivo ? 'is-disabled' : ''].filter(Boolean).join(' ');
      return `
        <button type="button" class="${classes}" data-action="${action.id}"
                ${motivo ? 'disabled' : ''} title="${ctx.escapeHtml(motivo || action.label)}">
          <span class="nfe-action-icon">${action.icon}</span>
          <span class="nfe-action-label">${ctx.escapeHtml(action.label)}</span>
        </button>`;
    }).join('');

    container.innerHTML = `
      <div class="nfe-actions-head">
        <strong>${n} NF-e selecionada${n === 1 ? '' : 's'}</strong>
        <span class="muted">${n === 1 ? 'Ações de nota única disponíveis' : 'Apenas ações em lote disponíveis'}</span>
      </div>
      <div class="nfe-actions-grid">${botoes}</div>
    `;

    container.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = CATALOG.find((a) => a.id === btn.dataset.action);
        if (!action || motivoBloqueio(action, ctx)) return;
        try {
          await action.run(ctx);
        } catch (error) {
          ctx.showToast(error.message || 'Erro ao executar a ação.', 'error');
        }
      });
    });
  }

  return { CATALOG, render, motivoBloqueio, ICONS };
})();
