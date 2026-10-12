window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.pcp = window.MavisSubscreenRegistry.pcp || {};

// PROGRAMAÇÃO DO DIA (fase EB, 12/10/2026).
//
// Pedido do usuário: o dia de produção tem uma jornada (ex.: 8 horas) e é
// preenchido MISTURANDO modelos de tempos diferentes — seis de 40 minutos,
// dois de 1h30 — até fechar o dia. Aqui se escolhe o dia e o setor, ajusta a
// jornada daquele dia se precisar (sábado 4h, hora extra 10h), e vai
// encaixando modelos: a tela soma, mostra o que sobra e quantos ainda cabem.
//
// As contas moram em shared/pcp_tempo.js; o tempo de cada modelo, em PCP ›
// Tempos de Produção.
(function (C) {
  const R = window.MavisSubscreenRegistry.pcp;
  const T = window.MavisPcpTempo;
  const hoje = () => new Date().toISOString().slice(0, 10);
  const qtd = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  const CAMPO_PRODUTO = { name: 'productId', label: 'Produto (modelo)', type: 'select', required: true, options: (meta) => meta.products || [] };

  R.programacao = async function renderProgramacao(ctx) {
    const { content, api, showToast, state, loadModule } = ctx;
    state.pcpProgramacao = state.pcpProgramacao || { date: hoje(), sectorId: '' };
    const filtro = state.pcpProgramacao;

    let meta = { products: [], sectors: [], orders: [], tempos: [] };
    let itensTodos = [];
    let jornadas = [];
    try {
      const [m, p, j] = await Promise.all([
        api('/api/pcp/meta'),
        api('/api/pcp/programacao'),
        api('/api/pcp/jornadas')
      ]);
      meta = { ...meta, ...m };
      itensTodos = p.programacao || [];
      jornadas = j.jornadas || [];
    } catch (erro) {
      showToast(erro.message || 'Erro ao carregar a programação.', 'error');
    }

    const recarregar = () => loadModule('pcp');
    // O que foi entregue a um MONTADOR (fase EC) mora em Montadores do Dia,
    // com a jornada dele: contar aqui também somaria as mesmas horas duas vezes.
    const doDia = (lista) => lista.filter((x) => String(x.date || '').slice(0, 10) === filtro.date
      && String(x.sectorId || '') === String(filtro.sectorId || '') && !x.montadorId);
    const setor = (meta.sectors || []).find((s) => s.id === filtro.sectorId) || null;
    const ajuste = doDia(jornadas)[0] || null;
    const jornadaHoras = T.jornadaDoDia({ ajuste, setor });
    const padraoHoras = T.jornadaDoDia({ setor });
    const itens = doDia(itensTodos);
    const resumo = T.resumoDoDia({ itens, tempos: meta.tempos, jornadaHoras });
    const produto = (id) => (meta.products || []).find((p) => p.id === id);
    const rotulo = (id) => {
      const p = produto(id);
      if (!p) return '-';
      return window.MavisRotuloProduto ? window.MavisRotuloProduto.rotulo(p) : p.name;
    };
    const nomeOp = (id) => ((meta.orders || []).find((o) => o.id === id) || {}).name || '';

    const tom = resumo.excedeu ? 'danger' : (resumo.percentual >= 90 ? 'warning' : 'success');
    content.innerHTML = `
      <div class="panel cadastros-shell">
        ${C.pageHead('Programação do Dia', '', '', '')}

        <section class="cadastro-section">
          <div class="cadastro-section-body">
            <div class="form-grid pcp-prog-filtros">
              <label class="cadastro-field"><span>Dia</span>
                <input type="date" id="pcpProgDia" value="${C.escape(filtro.date)}" />
              </label>
              <label class="cadastro-field"><span>Setor</span>
                <select id="pcpProgSetor">
                  <option value="">Geral (sem setor)</option>
                  ${(meta.sectors || []).map((s) => `<option value="${C.escape(s.id)}" ${s.id === filtro.sectorId ? 'selected' : ''}>${C.escape(s.name)}</option>`).join('')}
                </select>
              </label>
              <label class="cadastro-field"><span>Jornada do dia (horas)</span>
                <input type="number" id="pcpProgJornada" min="0" max="24" step="0.25" value="${C.escape(String(jornadaHoras))}" />
              </label>
              <div class="pcp-prog-jornada-acoes">
                <button type="button" class="secondary" id="pcpProgJornadaSalvar">Salvar jornada</button>
                ${ajuste ? `<button type="button" class="secondary" id="pcpProgJornadaPadrao" title="Voltar para ${C.escape(T.formatarMinutos(padraoHoras * 60))}">Usar padrão</button>` : ''}
              </div>
            </div>
          </div>
        </section>

        <div class="finance-stat-cards">
          ${statCard('blue', 'Jornada', T.formatarMinutos(resumo.disponivel) + (ajuste ? ' (ajustada)' : ''))}
          ${statCard('teal', 'Ocupado', T.formatarMinutos(resumo.ocupado) + ` · ${resumo.percentual}%`)}
          ${statCard(resumo.excedeu ? 'red' : 'green', resumo.excedeu ? 'Passou da jornada' : 'Sobra', T.formatarMinutos(Math.abs(resumo.sobra)))}
        </div>
        <div class="pcp-prog-barra pcp-prog-barra-${tom}" role="progressbar" aria-valuenow="${resumo.percentual}" aria-valuemin="0" aria-valuemax="100">
          <span style="width:${Math.min(100, resumo.percentual)}%"></span>
        </div>

        <section class="cadastro-section">
          <div class="cadastro-section-header"><div><h4>Adicionar ao dia</h4></div></div>
          <div class="cadastro-section-body">
            <form id="pcpProgForm" class="form-grid pcp-prog-novo">
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
                <span class="muted">Cabem no dia</span>
                <strong id="pcpProgCabem">-</strong>
              </div>
              <div class="pcp-prog-adicionar"><button type="submit" class="success">+ Adicionar</button></div>
            </form>
          </div>
        </section>

        <section class="cadastro-section">
          <div class="cadastro-section-header">
            <div>
              <h4>Programado para ${C.escape(C.formatDate(filtro.date))}${setor ? ' · ' + C.escape(setor.name) : ''}</h4>
              <p>${itens.length} item(ns)${resumo.semTempo.length ? ` · ${resumo.semTempo.length} sem tempo cadastrado (fora da soma)` : ''}</p>
            </div>
          </div>
          <div class="cadastro-section-body">
            <div class="table-scroll">
              <table class="table table-actions">
                <thead><tr><th>Produto</th><th>Quantidade</th><th>Tempo por unidade</th><th>Tempo total</th><th>OP</th><th>Ações</th></tr></thead>
                <tbody>
                  ${resumo.linhas.length === 0
                    ? '<tr><td colspan="6" class="muted" style="text-align:center; padding:24px;">Nada programado para este dia.</td></tr>'
                    : resumo.linhas.map((l) => `
                      <tr>
                        <td><strong>${C.escape(rotulo(l.productId))}</strong></td>
                        <td><input type="number" class="pcp-prog-qtd" data-item="${C.escape(l.id)}" min="0" step="any" value="${C.escape(String(Number(l.quantidade)))}" /></td>
                        <td>${l.minutosUnidade ? C.escape(T.formatarMinutos(l.minutosUnidade)) : C.badge('sem tempo', 'warning')}</td>
                        <td>${l.minutosTotal !== null ? `<strong>${C.escape(T.formatarMinutos(l.minutosTotal))}</strong>` : '-'}</td>
                        <td>${C.escape(nomeOp(l.orderId) || '-')}</td>
                        <td><button type="button" class="icon-button" data-remover="${C.escape(l.id)}" title="Tirar do dia">${C.trashIcon}</button></td>
                      </tr>
                    `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    `;

    function statCard(cor, rotuloCard, valor) {
      return typeof window.financeStatCard === 'function'
        ? window.financeStatCard({ tone: cor, label: rotuloCard, value: C.escape(valor) })
        : `<div class="finance-stat-card"><span>${C.escape(rotuloCard)}</span><strong>${C.escape(valor)}</strong></div>`;
    }

    // "Cabem no dia" acompanha o produto escolhido: é a pergunta da mesclagem
    // — com o que sobra, quantos deste modelo ainda entram?
    const mostrarCabem = (productId) => {
      const alvo = document.getElementById('pcpProgCabem');
      if (!alvo) return;
      if (!productId) { alvo.textContent = '-'; return; }
      const n = T.cabemNoDia(productId, resumo.sobra, meta.tempos);
      alvo.textContent = n === null ? 'sem tempo cadastrado' : `${qtd(n)} un.`;
    };
    const busca = window.MavisCampoDeBusca;
    if (busca && busca.ehDeBusca(CAMPO_PRODUTO, meta) && typeof window.attachSearchableSelect === 'function') {
      window.attachSearchableSelect({ id: busca.idDoCampo(CAMPO_PRODUTO), options: busca.opcoes(CAMPO_PRODUTO, meta), onSelect: mostrarCabem });
    } else {
      content.querySelector('#pcpProgForm [name="productId"]')?.addEventListener('change', (e) => mostrarCabem(e.target.value));
    }

    document.getElementById('pcpProgDia')?.addEventListener('change', (e) => {
      filtro.date = e.target.value || hoje();
      recarregar();
    });
    document.getElementById('pcpProgSetor')?.addEventListener('change', (e) => {
      filtro.sectorId = e.target.value;
      recarregar();
    });

    document.getElementById('pcpProgJornadaSalvar')?.addEventListener('click', async () => {
      const horas = Number(document.getElementById('pcpProgJornada').value);
      try {
        const corpo = { date: filtro.date, sectorId: filtro.sectorId || '', horas };
        if (ajuste) await api(`/api/pcp/jornadas/${encodeURIComponent(ajuste.id)}`, { method: 'PUT', body: JSON.stringify(corpo) });
        else await api('/api/pcp/jornadas', { method: 'POST', body: JSON.stringify(corpo) });
        showToast('Jornada do dia salva.', 'success');
        recarregar();
      } catch (erro) {
        showToast(erro.message || 'Erro ao salvar a jornada.', 'error');
      }
    });
    document.getElementById('pcpProgJornadaPadrao')?.addEventListener('click', async () => {
      try {
        await api(`/api/pcp/jornadas/${encodeURIComponent(ajuste.id)}`, { method: 'DELETE' });
        recarregar();
      } catch (erro) {
        showToast(erro.message || 'Erro ao voltar ao padrão.', 'error');
      }
    });

    document.getElementById('pcpProgForm')?.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const form = evento.target;
      const productId = form.querySelector('[name="productId"]')?.value || '';
      const quantidade = Number(form.querySelector('[name="quantidade"]').value);
      if (!productId) { showToast('Escolha o produto.', 'warning'); return; }
      const botao = form.querySelector('button[type="submit"]');
      if (botao.disabled) return;
      botao.disabled = true;
      try {
        await api('/api/pcp/programacao', {
          method: 'POST',
          body: JSON.stringify({ date: filtro.date, sectorId: filtro.sectorId || '', productId, quantidade, orderId: form.querySelector('[name="orderId"]').value || '' })
        });
        recarregar();
      } catch (erro) {
        botao.disabled = false;
        showToast(erro.message || 'Erro ao adicionar.', 'error');
      }
    });

    content.querySelectorAll('.pcp-prog-qtd').forEach((campo) => {
      campo.addEventListener('change', async () => {
        try {
          await api(`/api/pcp/programacao/${encodeURIComponent(campo.dataset.item)}`, { method: 'PUT', body: JSON.stringify({ quantidade: Number(campo.value) }) });
          recarregar();
        } catch (erro) {
          showToast(erro.message || 'Erro ao mudar a quantidade.', 'error');
        }
      });
    });
    content.querySelectorAll('[data-remover]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        try {
          await api(`/api/pcp/programacao/${encodeURIComponent(botao.dataset.remover)}`, { method: 'DELETE' });
          recarregar();
        } catch (erro) {
          showToast(erro.message || 'Erro ao tirar do dia.', 'error');
        }
      });
    });
  };
})(window.MavisCadastros);
