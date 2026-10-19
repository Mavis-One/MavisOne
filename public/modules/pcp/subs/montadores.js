window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.pcp = window.MavisSubscreenRegistry.pcp || {};

// MONTADORES DO DIA (fase EC, 12/10/2026).
//
// Pedido do usuário: "uma tela para PCP, para colocar ordens para montadores
// separados". Cada montador (pessoa do Cadastros com o papel "Montador") tem o
// seu dia: jornada (8h, ajustável no dia), o que já está com ele e quanto
// sobra. Aqui se distribuem modelos e OPs entre eles, e se imprime a folha de
// cada um para entregar na bancada.
//
// Mesmos dados da Programação do Dia (pcp_programacao), com o montador
// preenchido; as contas são as de shared/pcp_tempo.js.
(function (C) {
  const R = window.MavisSubscreenRegistry.pcp;
  const T = window.MavisPcpTempo;
  const hoje = () => new Date().toISOString().slice(0, 10);
  const qtd = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  const CAMPO_PRODUTO = { name: 'productId', label: 'Produto (modelo)', type: 'select', required: true, options: (meta) => meta.products || [] };

  R.montadores = async function renderMontadores(ctx) {
    const { content, api, showToast, state, loadModule, renderApp } = ctx;
    state.pcpMontadores = state.pcpMontadores || { date: hoje(), montadorId: '' };
    const filtro = state.pcpMontadores;

    let meta = { products: [], orders: [], tempos: [], montadores: [], deposits: [] };
    let itensTodos = [];
    let jornadas = [];
    // Fase ED: os depósitos da baixa e as baixas do dia (para "desfazer").
    let config = { depositoMontagemId: '', depositoMontagemNome: '' };
    let baixas = [];
    try {
      const [m, p, j, c, b] = await Promise.all([
        api('/api/pcp/meta?montadores=1'), api('/api/pcp/programacao'), api('/api/pcp/jornadas'),
        api('/api/pcp/config'), api(`/api/pcp/baixas?date=${encodeURIComponent(filtro.date)}`)
      ]);
      meta = { ...meta, ...m };
      itensTodos = p.programacao || [];
      jornadas = j.jornadas || [];
      config = c.config || config;
      baixas = (b.baixas || []).filter((x) => !x.estornada);
    } catch (erro) {
      showToast(erro.message || 'Erro ao carregar os montadores.', 'error');
    }
    const recarregar = () => loadModule('pcp');
    const doDia = (x) => String(x.date || '').slice(0, 10) === filtro.date;
    const montadores = meta.montadores || [];
    const podeCadastrar = typeof window.hasModuleAccess !== 'function' || window.hasModuleAccess('cadastros');
    if (!montadores.some((m) => m.id === filtro.montadorId)) filtro.montadorId = (montadores[0] || {}).id || '';

    const produto = (id) => (meta.products || []).find((p) => p.id === id);
    const rotulo = (id) => {
      const p = produto(id);
      if (!p) return '-';
      return window.MavisRotuloProduto ? window.MavisRotuloProduto.rotulo(p) : p.name;
    };
    const nomeOp = (id) => ((meta.orders || []).find((o) => o.id === id) || {}).name || '';
    // Fase ER: um depósito só, o de montagem — a baixa troca desmontado por
    // montado dentro dele.
    const depositosProntos = Boolean(config.depositoMontagemId);
    // A última baixa ATIVA de cada linha — é a que o "Desfazer" estorna.
    const ultimaBaixa = (itemId) => baixas.filter((x) => x.programacaoId === itemId).slice(-1)[0] || null;
    const celulaBaixa = (l) => {
      const montada = Number(l.quantidadeMontada || 0);
      const falta = Math.max(0, Number(l.quantidade || 0) - montada);
      const ultima = ultimaBaixa(l.id);
      const desfazer = ultima ? `<button type="button" class="link-button" data-desfazer="${C.escape(ultima.id)}" title="Desfazer a baixa de ${C.escape(qtd(ultima.quantidade))}">Desfazer</button>` : '';
      if (falta <= 0) return `${C.badge('Montado', 'success')} ${desfazer}`;
      return `<div class="pcp-baixa">
          <input type="number" class="pcp-baixa-qtd" data-baixa-qtd="${C.escape(l.id)}" min="0" max="${falta}" step="any" value="${falta}" />
          <button type="button" class="success" data-baixa="${C.escape(l.id)}">Dar baixa</button>
          ${desfazer}
        </div>`;
    };

    // O dia de cada montador: os itens dele, a jornada (ajuste do dia ou 8h) e o resumo.
    const quadros = montadores.map((m) => {
      const ajuste = jornadas.find((j) => doDia(j) && j.montadorId === m.id) || null;
      const jornadaHoras = T.jornadaDoDia({ ajuste });
      const itens = itensTodos.filter((x) => doDia(x) && x.montadorId === m.id);
      return { montador: m, ajuste, jornadaHoras, resumo: T.resumoDoDia({ itens, tempos: meta.tempos, jornadaHoras }) };
    });
    const quadroDo = (id) => quadros.find((q) => q.montador.id === id) || null;

    const htmlQuadro = ({ montador, ajuste, jornadaHoras, resumo }) => {
      const tom = resumo.excedeu ? 'danger' : (resumo.percentual >= 90 ? 'warning' : 'success');
      return `
        <section class="cadastro-section pcp-montador" data-montador="${C.escape(montador.id)}">
          <div class="cadastro-section-header pcp-montador-topo">
            <div>
              <h4>${C.escape(montador.name)}</h4>
              <p>${resumo.excedeu
                ? `<strong class="pcp-montador-passou">Passou ${C.escape(T.formatarMinutos(-resumo.sobra))}</strong>`
                : `Sobra ${C.escape(T.formatarMinutos(resumo.sobra))}`} · ocupado ${C.escape(T.formatarMinutos(resumo.ocupado))} de ${C.escape(T.formatarMinutos(resumo.disponivel))}${ajuste ? ' (ajustada)' : ''}</p>
            </div>
            <div class="pcp-montador-acoes">
              <label class="pcp-montador-jornada" title="Jornada deste montador neste dia, em horas">
                <span>Jornada (h)</span>
                <input type="number" min="0" max="24" step="0.25" value="${C.escape(String(jornadaHoras))}" data-jornada="${C.escape(montador.id)}" />
              </label>
              ${ajuste ? `<button type="button" class="secondary" data-jornada-padrao="${C.escape(ajuste.id)}" title="Voltar para 8h">8h</button>` : ''}
              <button type="button" class="secondary" data-imprimir="${C.escape(montador.id)}">Imprimir</button>
            </div>
          </div>
          <div class="pcp-prog-barra pcp-prog-barra-${tom}"><span style="width:${Math.min(100, resumo.percentual)}%"></span></div>
          <div class="cadastro-section-body">
            <div class="table-scroll">
              <table class="table table-actions">
                <thead><tr><th>Produto</th><th>Qtd.</th><th>Montadas</th><th>Tempo</th><th>Baixa</th><th></th></tr></thead>
                <tbody>
                  ${resumo.linhas.length === 0
                    ? '<tr><td colspan="6" class="muted" style="text-align:center; padding:16px;">Nada para este dia.</td></tr>'
                    : resumo.linhas.map((l) => `
                      <tr>
                        <td><strong>${C.escape(rotulo(l.productId))}</strong>${l.orderId ? `<br /><span class="muted">${C.escape(nomeOp(l.orderId))}</span>` : ''}</td>
                        <td><input type="number" class="pcp-prog-qtd" data-item="${C.escape(l.id)}" min="${Number(l.quantidadeMontada || 0)}" step="any" value="${C.escape(String(Number(l.quantidade)))}" /></td>
                        <td><strong>${C.escape(qtd(l.quantidadeMontada || 0))}</strong>/${C.escape(qtd(l.quantidade))}</td>
                        <td>${l.minutosTotal !== null ? C.escape(T.formatarMinutos(l.minutosTotal)) : C.badge('sem tempo', 'warning')}</td>
                        <td>${celulaBaixa(l)}</td>
                        <td>${Number(l.quantidadeMontada || 0) > 0 ? '' : `<button type="button" class="icon-button" data-remover="${C.escape(l.id)}" title="Tirar do montador">${C.trashIcon}</button>`}</td>
                      </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </section>`;
    };

    content.innerHTML = `
      <div class="panel cadastros-shell">
        ${C.pageHead('Montadores do Dia', '', '', `
          ${podeCadastrar ? '<button type="button" class="success" id="pcpMontNovo">+ Novo montador</button>' : ''}
          ${montadores.length ? '<button type="button" class="secondary" id="pcpMontImprimirTodos">Imprimir todos</button>' : ''}`)}
        ${montadores.length === 0 ? `
          <section class="cadastro-section"><div class="cadastro-section-body">
            <p class="muted">Nenhuma pessoa com o papel Montador no Cadastros.</p>
          </div></section>` : `
        <section class="cadastro-section">
          <div class="cadastro-section-body">
            <div class="pcp-mont-depositos" id="pcpMontDepositos">
              ${depositosProntos
                ? `<span class="muted">Baixa em</span> <strong>${C.escape(config.depositoMontagemNome)}</strong>: <span class="badge warning">desmontado</span> <span class="muted">→</span> <span class="badge success">montado</span>`
                : `<span class="pcp-montador-passou">O depósito de montagem da matriz não está classificado.</span> <button type="button" class="secondary" id="pcpMontIrDepositos">Classificar em Cadastros › Depósitos</button>`}
            </div>
            <form id="pcpMontForm" class="form-grid pcp-mont-novo">
              <label class="cadastro-field"><span>Dia</span>
                <input type="date" id="pcpMontDia" value="${C.escape(filtro.date)}" />
              </label>
              <label class="cadastro-field"><span>Montador *</span>
                <select name="montadorId" id="pcpMontMontador">
                  ${montadores.map((m) => `<option value="${C.escape(m.id)}" ${m.id === filtro.montadorId ? 'selected' : ''}>${C.escape(m.name)}</option>`).join('')}
                </select>
              </label>
              <div class="pcp-prog-produto">${C.field(CAMPO_PRODUTO, '', meta)}</div>
              <label class="cadastro-field"><span>Quantidade *</span>
                <input type="number" name="quantidade" min="0" step="any" value="1" required />
              </label>
              <label class="cadastro-field"><span>Ordem de produção</span>
                <select name="orderId">
                  <option value="">Sem OP</option>
                  ${(meta.orders || []).map((o) => `<option value="${C.escape(o.id)}">${C.escape(o.name)}</option>`).join('')}
                </select>
              </label>
              <div class="pcp-prog-cabem">
                <span class="muted">Cabem para ele</span>
                <strong id="pcpMontCabem">-</strong>
              </div>
              <div class="pcp-prog-adicionar"><button type="submit" class="success">+ Entregar</button></div>
            </form>
          </div>
        </section>
        <div class="pcp-montadores-grade">${quadros.map(htmlQuadro).join('')}</div>`}
      </div>
    `;
    // "+ Novo montador": o formulário de Pessoas do Cadastros, com o papel
    // Montador já marcado. Mesma escolha da tela Representantes (fase DZ): o
    // cadastro exige documento e endereço, e uma segunda cópia dele divergiria.
    document.getElementById('pcpMontNovo')?.addEventListener('click', () => {
      state.activeModule = 'cadastros';
      state.selectedModule = null;
      state.cadastroDraft = { ...(state.cadastroDraft || {}), activeType: 'people', people: { roles: ['Montador'], status: 'ativo' } };
      state.activeSub = 'register';
      renderApp();
      loadModule('cadastros');
    });
    if (!montadores.length) return;

    // "Cabem para ele": a sobra do montador escolhido no dia, dividida pelo
    // tempo do modelo escolhido.
    let produtoEscolhido = '';
    const mostrarCabem = () => {
      const alvo = document.getElementById('pcpMontCabem');
      const quadro = quadroDo(filtro.montadorId);
      if (!alvo) return;
      if (!produtoEscolhido || !quadro) { alvo.textContent = '-'; return; }
      const n = T.cabemNoDia(produtoEscolhido, quadro.resumo.sobra, meta.tempos);
      alvo.textContent = n === null ? 'sem tempo cadastrado' : `${qtd(n)} un.`;
    };
    const busca = window.MavisCampoDeBusca;
    if (busca && busca.ehDeBusca(CAMPO_PRODUTO, meta) && typeof window.attachSearchableSelect === 'function') {
      window.attachSearchableSelect({ id: busca.idDoCampo(CAMPO_PRODUTO), options: busca.opcoes(CAMPO_PRODUTO, meta), onSelect: (v) => { produtoEscolhido = v; mostrarCabem(); } });
    } else {
      content.querySelector('#pcpMontForm [name="productId"]')?.addEventListener('change', (e) => { produtoEscolhido = e.target.value; mostrarCabem(); });
    }

    document.getElementById('pcpMontDia')?.addEventListener('change', (e) => { filtro.date = e.target.value || hoje(); recarregar(); });
    document.getElementById('pcpMontMontador')?.addEventListener('change', (e) => { filtro.montadorId = e.target.value; mostrarCabem(); });

    document.getElementById('pcpMontForm')?.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const form = evento.target;
      const productId = form.querySelector('[name="productId"]')?.value || '';
      if (!productId) { showToast('Escolha o produto.', 'warning'); return; }
      const botao = form.querySelector('button[type="submit"]');
      if (botao.disabled) return;
      botao.disabled = true;
      try {
        await api('/api/pcp/programacao', {
          method: 'POST',
          body: JSON.stringify({
            date: filtro.date,
            montadorId: form.querySelector('[name="montadorId"]').value,
            productId,
            quantidade: Number(form.querySelector('[name="quantidade"]').value),
            orderId: form.querySelector('[name="orderId"]').value || ''
          })
        });
        recarregar();
      } catch (erro) {
        botao.disabled = false;
        showToast(erro.message || 'Erro ao entregar ao montador.', 'error');
      }
    });

    content.querySelectorAll('[data-jornada]').forEach((campo) => {
      campo.addEventListener('change', async () => {
        const quadro = quadroDo(campo.dataset.jornada);
        const corpo = { date: filtro.date, montadorId: campo.dataset.jornada, horas: Number(campo.value) };
        try {
          if (quadro && quadro.ajuste) await api(`/api/pcp/jornadas/${encodeURIComponent(quadro.ajuste.id)}`, { method: 'PUT', body: JSON.stringify(corpo) });
          else await api('/api/pcp/jornadas', { method: 'POST', body: JSON.stringify(corpo) });
          recarregar();
        } catch (erro) {
          showToast(erro.message || 'Erro ao salvar a jornada.', 'error');
        }
      });
    });
    content.querySelectorAll('[data-jornada-padrao]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        try { await api(`/api/pcp/jornadas/${encodeURIComponent(botao.dataset.jornadaPadrao)}`, { method: 'DELETE' }); recarregar(); }
        catch (erro) { showToast(erro.message || 'Erro ao voltar ao padrão.', 'error'); }
      });
    });
    content.querySelectorAll('.pcp-prog-qtd').forEach((campo) => {
      campo.addEventListener('change', async () => {
        try { await api(`/api/pcp/programacao/${encodeURIComponent(campo.dataset.item)}`, { method: 'PUT', body: JSON.stringify({ quantidade: Number(campo.value) }) }); recarregar(); }
        catch (erro) { showToast(erro.message || 'Erro ao mudar a quantidade.', 'error'); }
      });
    });
    // Fase EE: os depósitos da baixa são os da matriz classificados como
    // desmontados e montados (Cadastros › Depósitos); aqui só se mostram.
    document.getElementById('pcpMontIrDepositos')?.addEventListener('click', () => {
      state.activeModule = 'cadastros';
      state.activeSub = 'deposits';
      state.selectedModule = null;
      renderApp();
      loadModule('cadastros');
    });

    // DAR BAIXA: transfere do depósito de desmontadas para o de montadas
    // (fase ED). A quantidade sugerida é o que falta; dá para baixar menos.
    content.querySelectorAll('[data-baixa]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        const itemId = botao.dataset.baixa;
        const quantidade = Number(content.querySelector(`[data-baixa-qtd="${itemId}"]`)?.value || 0);
        if (botao.disabled) return;
        // Sem os dois depósitos o botão NÃO fica desligado (13/10/2026): desligado,
        // o clique não fazia nada e o motivo só aparecia passando o mouse — no
        // celular, nem isso. Agora diz o que falta e leva até o campo.
        if (!depositosProntos) {
          showToast('Antes de dar baixa, classifique o depósito de montagem da matriz em Cadastros › Depósitos.', 'warning');
          document.getElementById('pcpMontDepositos')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        if (!(quantidade > 0)) {
          showToast('Informe quantas foram montadas.', 'warning');
          return;
        }
        botao.disabled = true;
        try {
          await api('/api/pcp/baixas', { method: 'POST', body: JSON.stringify({ programacaoId: itemId, quantidade }) });
          showToast(`Baixa de ${qtd(quantidade)} feita: saiu do desmontado e entrou no montado.`, 'success');
          recarregar();
        } catch (erro) {
          botao.disabled = false;
          showToast(erro.message || 'Erro ao dar baixa.', 'error');
        }
      });
    });
    content.querySelectorAll('[data-desfazer]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        try {
          await api(`/api/pcp/baixas/${encodeURIComponent(botao.dataset.desfazer)}`, { method: 'DELETE' });
          showToast('Baixa desfeita: voltou para o desmontado.', 'success');
          recarregar();
        } catch (erro) {
          showToast(erro.message || 'Erro ao desfazer a baixa.', 'error');
        }
      });
    });

    content.querySelectorAll('[data-remover]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        try { await api(`/api/pcp/programacao/${encodeURIComponent(botao.dataset.remover)}`, { method: 'DELETE' }); recarregar(); }
        catch (erro) { showToast(erro.message || 'Erro ao tirar do montador.', 'error'); }
      });
    });

    // A FOLHA DO MONTADOR. Uma página por montador, para entregar na bancada:
    // o que montar, quanto, de qual OP, o tempo, e uma coluna para marcar feito.
    const imprimir = (lista) => {
      const paginas = lista.filter((q) => q.resumo.linhas.length).map((q) => `
        <section class="folha">
          <header>
            <div><h1>${C.escape(q.montador.name)}</h1><p>Montagem do dia ${C.escape(C.formatDate(filtro.date))}</p></div>
            <div class="direita"><p>Jornada: <strong>${C.escape(T.formatarMinutos(q.resumo.disponivel))}</strong></p><p>Programado: <strong>${C.escape(T.formatarMinutos(q.resumo.ocupado))}</strong></p></div>
          </header>
          <table>
            <thead><tr><th>Produto</th><th class="n">Qtd.</th><th class="n">Tempo un.</th><th class="n">Tempo total</th><th>OP</th><th class="feito">Feito</th></tr></thead>
            <tbody>
              ${q.resumo.linhas.map((l) => `<tr>
                <td>${C.escape(rotulo(l.productId))}</td>
                <td class="n">${C.escape(qtd(l.quantidade))}</td>
                <td class="n">${l.minutosUnidade ? C.escape(T.formatarMinutos(l.minutosUnidade)) : '-'}</td>
                <td class="n">${l.minutosTotal !== null ? C.escape(T.formatarMinutos(l.minutosTotal)) : '-'}</td>
                <td>${C.escape(nomeOp(l.orderId) || '-')}</td>
                <td class="feito">&#9744;</td>
              </tr>`).join('')}
            </tbody>
          </table>
          <footer>Assinatura: ______________________________________</footer>
        </section>`).join('');
      if (!paginas) { showToast('Nada programado para imprimir neste dia.', 'warning'); return; }
      // SEM 'noopener': com ele window.open devolve null (ver a impressão do
      // pedido em app.js). A isolação vem do opener = null logo abaixo.
      const win = window.open('', '_blank');
      if (!win) { showToast('O navegador bloqueou a janela de impressão.', 'error'); return; }
      win.opener = null;
      win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Montadores ${C.escape(C.formatDate(filtro.date))}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111; margin: 0; }
          .folha { padding: 18mm 14mm; page-break-after: always; }
          .folha:last-child { page-break-after: auto; }
          header { display: flex; justify-content: space-between; border-bottom: 2px solid #111; margin-bottom: 12px; }
          h1 { font-size: 20px; margin: 0 0 4px; } p { margin: 0 0 6px; font-size: 13px; } .direita { text-align: right; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          th, td { border: 1px solid #999; padding: 7px 8px; text-align: left; } th { background: #eee; }
          .n { text-align: right; white-space: nowrap; } .feito { text-align: center; width: 48px; font-size: 18px; }
          footer { margin-top: 28px; font-size: 13px; }
        </style></head><body>${paginas}</body></html>`);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 300);
    };
    content.querySelectorAll('[data-imprimir]').forEach((botao) => {
      botao.addEventListener('click', () => imprimir(quadros.filter((q) => q.montador.id === botao.dataset.imprimir)));
    });
    document.getElementById('pcpMontImprimirTodos')?.addEventListener('click', () => imprimir(quadros));
  };
})(window.MavisCadastros);
