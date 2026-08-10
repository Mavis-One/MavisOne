window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// Eventos NF-e e NF-e Inutilizadas.
//
// As duas telas são a MESMA consulta com filtro diferente, então moram no mesmo
// arquivo: separá-las em dois faria a próxima mudança precisar ser feita duas
// vezes, que é como as duas versões começam a divergir.
//
// A inutilização já era gravada há tempo (nfe_eventos, tipo INUTILIZACAO), mas
// não aparecia em lugar nenhum: a única leitura existente filtrava por nfe_id,
// e inutilização tem nfe_id nulo — ela queima uma faixa de números que nunca
// virou nota. Ver getEventosFiscais em lib/db/fiscal.js.
(function (F) {
  const FILTROS = [
    { chave: '', label: 'Todos' },
    { chave: 'CCE', label: 'Cartas de Correção' },
    { chave: 'CANCELAMENTO', label: 'Cancelamentos' },
    { chave: 'INUTILIZACAO', label: 'Inutilizações' }
  ];

  // A faixa e a justificativa da inutilização só existem dentro do payload que
  // foi enviado à Focus — não viraram coluna. Ler dali é o que há.
  function dadosInutilizacao(evento) {
    const p = evento.payloadEnviado || {};
    return {
      serie: p.serie ?? '-',
      inicial: p.numero_inicial ?? p.numeroInicial ?? '-',
      final: p.numero_final ?? p.numeroFinal ?? '-',
      justificativa: p.justificativa || ''
    };
  }

  function faixa(evento) {
    const d = dadosInutilizacao(evento);
    return d.inicial === d.final ? String(d.inicial) : `${d.inicial} a ${d.final}`;
  }

  function notaDoEvento(escapeHtml, evento) {
    if (!evento.nfe) return '<span class="muted">— (faixa sem nota)</span>';
    const numero = evento.nfe.numero ? `nº ${evento.nfe.numero}` : evento.nfe.referencia || '-';
    const serie = evento.nfe.serie ? ` / série ${evento.nfe.serie}` : '';
    return escapeHtml(numero + serie);
  }

  function tomDoStatus(status) {
    const s = String(status || '').toLowerCase();
    if (/autoriz|homolog|sucesso|^ok$/.test(s)) return 'success';
    if (/erro|rejeit|falh|neg/.test(s)) return 'danger';
    return 'info';
  }

  async function desenhar(ctx, { titulo, ajuda, tipoFixo }) {
    const { api, content, escapeHtml, state } = ctx;
    const redesenhar = () => desenhar(ctx, { titulo, ajuda, tipoFixo });

    const { lista, escolhido, erro } = await F.carregarEstabelecimentos(ctx);
    if (!lista.length) { content.innerHTML = F.semEstabelecimento(escapeHtml, titulo, erro); return; }

    // Filtro só existe na tela de Eventos; Inutilizadas já nasce filtrada.
    const filtroAtivo = tipoFixo || state.fiscalEventoTipo || '';
    const tipoConsulta = tipoFixo || filtroAtivo;

    let eventos = [];
    let erroConsulta = null;
    try {
      const params = new URLSearchParams({ estabelecimentoId: escolhido });
      if (tipoConsulta) params.set('tipo', tipoConsulta);
      const res = await api(`/api/fiscal/eventos?${params.toString()}`);
      eventos = res.eventos || [];
    } catch (e) {
      erroConsulta = e.message || 'Não foi possível carregar os eventos.';
    }

    const ehInutilizadas = tipoFixo === 'INUTILIZACAO';

    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>${escapeHtml(titulo)}</h3>
            <p class="muted">${escapeHtml(ajuda)}</p>
          </div>
          ${F.seletorEstabelecimento(escapeHtml, lista, escolhido)}
        </div>

        ${tipoFixo ? '' : `
          <div class="finance-granularity-group" role="tablist">
            ${FILTROS.map((f) => `
              <button type="button" class="finance-pill ${f.chave === filtroAtivo ? 'active' : ''}" data-filtro="${escapeHtml(f.chave)}">${escapeHtml(f.label)}</button>
            `).join('')}
          </div>`}

        ${erroConsulta ? `<p class="form-error">${escapeHtml(erroConsulta)}</p>` : ''}

        ${!eventos.length ? `
          <p class="muted">${escapeHtml(ehInutilizadas
            ? 'Nenhuma faixa de numeração foi inutilizada neste estabelecimento.'
            : 'Nenhum evento registrado para este estabelecimento.')}</p>
        ` : `
        <table class="table">
          <thead>
            <tr>
              <th>Quando</th>
              ${ehInutilizadas ? '<th>Série</th><th>Faixa</th><th>Justificativa</th>' : '<th>Tipo</th><th>NF-e</th>'}
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${eventos.map((ev, i) => {
              const t = F.rotuloTipo(ev.tipo);
              const d = dadosInutilizacao(ev);
              return `
              <tr>
                <td>${escapeHtml(F.dataHora(ev.criadoEm))}</td>
                ${ehInutilizadas ? `
                  <td>${escapeHtml(String(d.serie))}</td>
                  <td>${escapeHtml(faixa(ev))}</td>
                  <td class="fiscal-justificativa" title="${escapeHtml(d.justificativa)}">${escapeHtml(d.justificativa || '-')}</td>
                ` : `
                  <td><span class="finance-badge finance-badge-${t.tom}">${escapeHtml(t.label)}</span></td>
                  <td>${notaDoEvento(escapeHtml, ev)}</td>
                `}
                <td><span class="finance-badge finance-badge-${tomDoStatus(ev.status)}">${escapeHtml(ev.status || '-')}</span></td>
                <td><button type="button" class="secondary" data-detalhe="ev${i}" aria-expanded="false">Detalhes</button></td>
              </tr>
              <tr data-detalhe-de="ev${i}" hidden>
                <td colspan="${ehInutilizadas ? 6 : 5}">
                  <div class="fiscal-detalhe">
                    ${F.blocoJson(escapeHtml, 'Enviado', ev.payloadEnviado)}
                    ${F.blocoJson(escapeHtml, 'Resposta da SEFAZ', ev.respostaFocus)}
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <p class="muted">${eventos.length} evento${eventos.length === 1 ? '' : 's'} — os 200 mais recentes.</p>
        `}
      </div>`;

    F.ligarSeletor(ctx, redesenhar);
    F.ligarDetalhes(ctx);
    content.querySelectorAll('[data-filtro]').forEach((botao) => {
      botao.addEventListener('click', () => {
        state.fiscalEventoTipo = botao.dataset.filtro;
        redesenhar();
      });
    });
  }

  window.MavisSubscreenRegistry.fiscal.eventos = (ctx) => desenhar(ctx, {
    titulo: 'Eventos NF-e',
    ajuda: 'Cartas de correção, cancelamentos e inutilizações, do mais recente para o mais antigo.',
    tipoFixo: null
  });

  window.MavisSubscreenRegistry.fiscal.inutilizadas = (ctx) => desenhar(ctx, {
    titulo: 'NF-e Inutilizadas',
    ajuda: 'Faixas de numeração queimadas na SEFAZ. Nenhuma delas virou nota — é o que justifica o pulo na sequência.',
    tipoFixo: 'INUTILIZACAO'
  });
})(window.MavisFiscalDocs);
