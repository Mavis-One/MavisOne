window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// Logs NF-e: o que foi transmitido e o que a SEFAZ respondeu, nota por nota.
//
// Diferente de "NF-e Emitidas", que mostra o documento. Aqui mostra a
// CONVERSA: payload enviado, resposta crua, mensagem e protocolo. É o que
// resolve uma rejeição — sem isso sobra "erro de autorização" e mais nada, e a
// pessoa fica reemitindo às cegas.
//
// Por isso o padrão da lista é mostrar primeiro o que deu errado: numa tela de
// log, o que interessa é a exceção, não o fluxo normal.
(function (F) {
  const STATUS_PROBLEMA = ['ERRO', 'DENEGADO'];

  const FILTROS = [
    { chave: 'problemas', label: 'Com problema' },
    { chave: 'todos', label: 'Todos' },
    { chave: 'AUTORIZADO', label: 'Autorizados' },
    { chave: 'PROCESSANDO', label: 'Processando' },
    { chave: 'CANCELADO', label: 'Cancelados' }
  ];

  function tomDoStatus(status) {
    if (status === 'AUTORIZADO') return 'success';
    if (STATUS_PROBLEMA.includes(status)) return 'danger';
    if (status === 'CANCELADO' || status === 'INUTILIZADO') return 'warning';
    return 'info';
  }

  function aplicarFiltro(registros, filtro) {
    if (filtro === 'todos') return registros;
    if (filtro === 'problemas') return registros.filter((r) => STATUS_PROBLEMA.includes(r.status));
    return registros.filter((r) => r.status === filtro);
  }

  // AS NOTAS DESTA VISITA À TELA, por estabelecimento. Trocar o filtro só
  // redesenha: o filtro é aplicado aqui (aplicarFiltro), e a lista que a rota
  // devolve é sempre a mesma — antes, cada clique baixava de novo TODAS as
  // notas do estabelecimento, com o JSON enviado e o recebido de cada uma.
  // Entrar na tela, ou trocar o estabelecimento, carrega de novo.
  let carregado = null;

  async function desenhar(ctx, { reusar = false } = {}) {
    const { api, content, escapeHtml, state } = ctx;
    const redesenhar = () => desenhar(ctx);

    if (!reusar || !carregado) {
      const { lista, escolhido, erro } = await F.carregarEstabelecimentos(ctx);
      let registros = [];
      let erroConsulta = null;
      if (lista.length) {
        try {
          const res = await api(`/api/fiscal/nfe?estabelecimentoId=${encodeURIComponent(escolhido)}`);
          registros = res.records || [];
        } catch (e) {
          erroConsulta = e.message || 'Não foi possível carregar os logs.';
        }
      }
      carregado = { lista, escolhido, erro, registros, erroConsulta };
    }
    const { lista, escolhido, erro, registros, erroConsulta } = carregado;
    if (!lista.length) { content.innerHTML = F.semEstabelecimento(escapeHtml, 'Logs NF-e', erro); return; }

    const filtro = state.fiscalLogFiltro || 'problemas';
    const visiveis = aplicarFiltro(registros, filtro);
    const comProblema = registros.filter((r) => STATUS_PROBLEMA.includes(r.status)).length;

    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Logs NF-e</h3>
          </div>
          <button type="button" class="secondary" id="fiscalLogAtualizar">Atualizar</button>
          ${F.seletorEstabelecimento(escapeHtml, lista, escolhido)}
        </div>

        <div class="finance-granularity-group" role="tablist">
          ${FILTROS.map((f) => `
            <button type="button" class="finance-pill ${f.chave === filtro ? 'active' : ''}" data-log-filtro="${escapeHtml(f.chave)}">
              ${escapeHtml(f.label)}${f.chave === 'problemas' && comProblema ? ` (${comProblema})` : ''}
            </button>
          `).join('')}
        </div>

        ${erroConsulta ? `<p class="form-error">${escapeHtml(erroConsulta)}</p>` : ''}

        ${!visiveis.length ? `
          <p class="muted">${escapeHtml(filtro === 'problemas' && registros.length
            ? 'Nenhuma nota com erro ou denegação neste estabelecimento — as ' + registros.length + ' transmitidas passaram.'
            : 'Nenhuma transmissão registrada para este estabelecimento.')}</p>
        ` : `
        <table class="table">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Referência</th>
              <th>Número</th>
              <th>Status</th>
              <th>Mensagem da SEFAZ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${visiveis.map((r, i) => `
              <tr>
                <td>${escapeHtml(F.dataHora(r.criadoEm))}</td>
                <td><code>${escapeHtml(r.referencia || '-')}</code></td>
                <td>${escapeHtml(r.numero ? `${r.numero}${r.serie ? ' / ' + r.serie : ''}` : '-')}</td>
                <td><span class="finance-badge finance-badge-${tomDoStatus(r.status)}">${escapeHtml(r.status || '-')}</span></td>
                <td class="fiscal-justificativa" title="${escapeHtml(r.mensagemSefaz || '')}">${escapeHtml(r.mensagemSefaz || '-')}</td>
                <td><button type="button" class="secondary" data-detalhe="log${i}" aria-expanded="false">Detalhes</button></td>
              </tr>
              <tr data-detalhe-de="log${i}" hidden>
                <td colspan="6">
                  <div class="fiscal-detalhe">
                    <p class="muted">
                      Chave: <code>${escapeHtml(r.chaveAcesso || '—')}</code> ·
                      Protocolo: <code>${escapeHtml(r.protocolo || '—')}</code>
                    </p>
                    <div data-json-de="${i}"></div>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <p class="muted">${visiveis.length} de ${registros.length} transmissão${registros.length === 1 ? '' : 'ões'}.</p>
        `}
      </div>`;

    F.ligarSeletor(ctx, redesenhar);
    // O filtro não recarrega mais (era a única forma de "atualizar" a lista):
    // recarregar virou este botão, explícito.
    content.querySelector('#fiscalLogAtualizar')?.addEventListener('click', redesenhar);
    // Antes de ligarDetalhes: o JSON entra no primeiro clique, e o toggle
    // (registrado depois) o mostra.
    content.querySelectorAll('[data-detalhe^="log"]').forEach((botao) => {
      botao.addEventListener('click', () => {
        const i = Number(botao.dataset.detalhe.slice(3));
        const alvo = content.querySelector(`[data-json-de="${i}"]`);
        if (!alvo || alvo.dataset.montado) return;
        alvo.innerHTML = F.blocoJson(escapeHtml, 'Enviado à SEFAZ', visiveis[i].payloadEnviado)
          + F.blocoJson(escapeHtml, 'Resposta recebida', visiveis[i].respostaFocus);
        alvo.dataset.montado = '1';
      });
    });
    F.ligarDetalhes(ctx);
    content.querySelectorAll('[data-log-filtro]').forEach((botao) => {
      botao.addEventListener('click', () => {
        state.fiscalLogFiltro = botao.dataset.logFiltro;
        desenhar(ctx, { reusar: true });
      });
    });
  }

  window.MavisSubscreenRegistry.fiscal.logs = desenhar;
})(window.MavisFiscalDocs);
