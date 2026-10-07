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
  // A ANÁLISE DESTA VISITA À TELA. Abrir e fechar um alerta só redesenha:
  // antes, cada clique refazia a análise inteira no servidor e baixava de novo
  // os 676 KB. Abrir um alerta mostra a mesma análise que os números da tela já
  // contam, então não é dado mais velho do que o que está à vista. Para ver um
  // cadastro corrigido em outra aba há o botão "Analisar de novo", e entrar na
  // tela (o registro chama desenhar sem `reusar`) também analisa de novo.
  let analise = null;

  const num = (n) => Number(n || 0).toLocaleString('pt-BR');

  async function desenhar(ctx, { reusar = false } = {}) {
    const { api, content, escapeHtml } = ctx;
    let r = reusar ? analise : null;
    if (!r) {
      content.innerHTML = '<div class="panel"><h3>Análise Fiscal</h3><p class="muted">Analisando o cadastro...</p></div>';
      try {
        r = await api('/api/fiscal/analise-fiscal');
      } catch (e) {
        content.innerHTML = `<div class="panel"><h3>Análise Fiscal</h3><p class="form-error">${escapeHtml(e.message || 'Não foi possível analisar o cadastro.')}</p></div>`;
        return;
      }
      analise = r;
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
          ${a.quantidade > LIMITE_NA_TELA ? `<p class="muted">e mais ${num(a.quantidade - LIMITE_NA_TELA)}</p>` : ''}
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
        <div class="cadastro-page-head">
          <div>
            <h3>Análise Fiscal</h3>
          </div>
          <button type="button" class="secondary" id="analiseFiscalDeNovo">Analisar de novo</button>
        </div>
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

    content.querySelector('#analiseFiscalDeNovo')?.addEventListener('click', () => desenhar(ctx));
    content.querySelectorAll('[data-alerta]').forEach((tr) => tr.addEventListener('click', () => {
      aberto = aberto === tr.dataset.alerta ? null : tr.dataset.alerta;
      desenhar(ctx, { reusar: true });
    }));
  }

  window.MavisSubscreenRegistry.fiscal.analise_fiscal = desenhar;
})();
