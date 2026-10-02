window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// ANÁLISE FISCAL (fase DO): o cadastro de produtos contra as tabelas oficiais
// de NCM (Siscomex) e CEST (Convênio ICMS 142/2018). Um alerta por linha, com
// a quantidade; clicar abre os produtos. Sem texto explicativo na tela, a
// pedido do usuário — o título do alerta é a explicação.
(function () {
  const GRAVIDADE = {
    alta: { rotulo: 'alta', tom: 'danger' },
    media: { rotulo: 'média', tom: 'warning' },
    info: { rotulo: 'info', tom: 'info' }
  };
  const LIMITE_NA_TELA = 300;
  let aberto = null;

  const num = (n) => Number(n || 0).toLocaleString('pt-BR');

  async function desenhar(ctx) {
    const { api, content, escapeHtml } = ctx;
    content.innerHTML = '<div class="panel"><h3>Análise Fiscal</h3><p class="muted">Analisando o cadastro...</p></div>';
    let r;
    try {
      r = await api('/api/fiscal/analise-fiscal');
    } catch (e) {
      content.innerHTML = `<div class="panel"><h3>Análise Fiscal</h3><p class="form-error">${escapeHtml(e.message || 'Não foi possível analisar o cadastro.')}</p></div>`;
      return;
    }
    if (r.semTabelas) {
      content.innerHTML = `<div class="panel"><h3>Análise Fiscal</h3>
        <p class="fiscal-aviso-homologacao">As tabelas oficiais de NCM e CEST não foram carregadas (scripts/carregar-tabelas-ncm-cest.js).</p></div>`;
      return;
    }

    const t = r.tabelas || {};
    const linhas = r.alertas.map((a) => {
      const g = GRAVIDADE[a.gravidade] || GRAVIDADE.info;
      const lista = aberto === a.codigo ? `
        <tr><td colspan="3">
          <div class="table-scroll">
            <table class="table">
              <thead><tr><th>Código</th><th>Produto</th><th>NCM</th><th>CEST</th><th></th></tr></thead>
              <tbody>${a.produtos.slice(0, LIMITE_NA_TELA).map((p) => `
                <tr>
                  <td>${escapeHtml(p.sku || '')}</td>
                  <td>${escapeHtml(p.nome || '')}</td>
                  <td>${escapeHtml(p.ncm || '—')}</td>
                  <td>${escapeHtml(p.cest || '—')}</td>
                  <td class="muted">${escapeHtml(p.detalhe || '')}</td>
                </tr>`).join('')}</tbody>
            </table>
          </div>
          ${a.produtos.length > LIMITE_NA_TELA ? `<p class="muted">e mais ${num(a.produtos.length - LIMITE_NA_TELA)}</p>` : ''}
        </td></tr>` : '';
      return `
        <tr data-alerta="${escapeHtml(a.codigo)}" style="cursor: pointer;">
          <td><span class="finance-badge finance-badge-${g.tom}">${g.rotulo}</span></td>
          <td><strong>${escapeHtml(a.titulo)}</strong></td>
          <td class="num">${num(a.quantidade)}</td>
        </tr>${lista}`;
    }).join('');

    content.innerHTML = `
      <div class="panel">
        <h3>Análise Fiscal</h3>
        <div class="cards">
          <div class="card"><h3>Produtos</h3><p>${num(r.analisados)}</p></div>
          <div class="card"><h3>Com alerta</h3><p${r.comAlerta ? ' class="acervo-alerta"' : ''}>${num(r.comAlerta)}</p></div>
          <div class="card"><h3>NCM</h3><p style="font-size: 0.95rem;">${escapeHtml((t.NCM && t.NCM.versao) || '—')}</p></div>
          <div class="card"><h3>CEST</h3><p style="font-size: 0.95rem;">${escapeHtml((t.CEST && t.CEST.versao) || '—')}</p></div>
        </div>
        ${r.alertas.length ? `
          <div class="table-scroll">
            <table class="table">
              <thead><tr><th>Gravidade</th><th>Alerta</th><th class="num">Produtos</th></tr></thead>
              <tbody>${linhas}</tbody>
            </table>
          </div>` : '<p class="sales-totals-nota">Nenhum alerta no cadastro.</p>'}
      </div>`;

    content.querySelectorAll('[data-alerta]').forEach((tr) => tr.addEventListener('click', () => {
      aberto = aberto === tr.dataset.alerta ? null : tr.dataset.alerta;
      desenhar(ctx);
    }));
  }

  window.MavisSubscreenRegistry.fiscal.analise_fiscal = desenhar;
})();
