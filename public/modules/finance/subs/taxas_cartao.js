window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

// TAXAS DE CARTÃO (fase ET, 19/10/2026). As tabelas do simulador da venda no
// cartão: os fatores da loja (cliente paga), as taxas da credenciadora por
// canal, bandeira e parcelas, e os PVs. Mostra o que vale HOJE; gravar acrescenta
// uma vigência de hoje (a venda de ontem continua com o número de ontem). Quem
// grava é o administrador.
window.MavisSubscreenRegistry.finance.taxas_cartao = async function renderTaxasCartao(ctx) {
  const { content, api, showToast, escapeHtml } = ctx;
  let dados;
  const hoje = new Date().toISOString().slice(0, 10);
  const carregar = async () => { dados = await api('/api/finance/cartao'); };
  try {
    await carregar();
  } catch (error) {
    content.innerHTML = `<div class="panel"><p class="muted">${escapeHtml(error.message || 'Erro ao carregar as taxas de cartão.')}</p></div>`;
    return;
  }
  const filtro = { canal: 'maquininha', bandeira: 'MASTERCARD' };
  const MODALIDADES = window.MavisCartaoSimulador.MODALIDADES;
  const CANAIS = window.MavisCartaoSimulador.CANAIS;

  // A linha que vale hoje para cada chave: a de vigência mais recente.
  const vigentes = (linhas, chave) => {
    const porChave = new Map();
    linhas.filter((l) => l.vigencia <= hoje).forEach((l) => {
      const k = chave(l);
      const atual = porChave.get(k);
      if (!atual || l.vigencia > atual.vigencia) porChave.set(k, l);
    });
    return porChave;
  };
  const numeroBr = (v, casas) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const lerNumero = (texto) => Number(String(texto || '').replace(/\./g, '').replace(',', '.'));

  function render() {
    const pode = dados.podeEditar === true;
    const fatores = vigentes(dados.fatores.filter((f) => !f.empresaId), (f) => `${f.canal}|${f.modalidade}|${f.parcelas}`);
    const linhasDeFator = [{ modalidade: 'debito', parcelas: 1, rotulo: 'Débito' },
      ...Array.from({ length: 21 }, (_, i) => ({ modalidade: 'credito', parcelas: i + 1, rotulo: i === 0 ? 'Crédito à vista' : `Crédito ${i + 1}x` }))];
    const taxas = vigentes(dados.taxas.filter((t) => t.canal === filtro.canal && t.bandeira === filtro.bandeira),
      (t) => `${t.modalidade}|${t.parcelas}`);
    const listaDeTaxas = [...taxas.values()].sort((a, b) => Object.keys(MODALIDADES).indexOf(a.modalidade) - Object.keys(MODALIDADES).indexOf(b.modalidade) || a.parcelas - b.parcelas);
    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head"><div><h3>Taxas de Cartão</h3></div></div>

        <section class="cadastro-section">
          <div class="cadastro-section-header"><div><h4>Fatores do simulador (cliente paga)</h4></div></div>
          <div class="cadastro-section-body">
            <div class="table-scroll">
              <table class="table cartao-fatores">
                <thead><tr><th>Opção</th>${CANAIS.map((c) => `<th>${escapeHtml(c.nome)}</th>`).join('')}</tr></thead>
                <tbody>
                  ${linhasDeFator.map((l) => `<tr><td>${l.rotulo}</td>${CANAIS.map((c) => {
                    const f = fatores.get(`${c.id}|${l.modalidade}|${l.parcelas}`);
                    return `<td>${pode
                      ? `<input class="cartao-fator" data-canal="${c.id}" data-modalidade="${l.modalidade}" data-parcelas="${l.parcelas}" value="${f ? numeroBr(f.fator, 5) : ''}" data-original="${f ? numeroBr(f.fator, 5) : ''}" inputmode="decimal" />`
                      : (f ? numeroBr(f.fator, 5) : '-')}</td>`;
                  }).join('')}</tr>`).join('')}
                </tbody>
              </table>
            </div>
            ${pode ? '<div class="finance-actions-row"><button type="button" id="cartaoSalvarFatores">Salvar fatores</button></div>' : ''}
          </div>
        </section>

        <section class="cadastro-section">
          <div class="cadastro-section-header"><div><h4>Taxas da credenciadora</h4></div></div>
          <div class="cadastro-section-body">
            <div class="row">
              <label>Canal<select id="cartaoFiltroCanal">${CANAIS.map((c) => `<option value="${c.id}" ${filtro.canal === c.id ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`).join('')}</select></label>
              <label>Bandeira<select id="cartaoFiltroBandeira">${dados.bandeiras.map((b) => `<option value="${b.chave}" ${filtro.bandeira === b.chave ? 'selected' : ''}>${escapeHtml(b.nome)}</option>`).join('')}</select></label>
            </div>
            <div class="table-scroll">
              <table class="table cartao-taxas">
                <thead><tr><th>Modalidade</th><th>Parcelas</th><th>Taxa (%)</th><th>Recebe em (dias)</th><th>Dias</th><th>Taxa por parcela</th><th>Vigência</th></tr></thead>
                <tbody>
                  ${listaDeTaxas.length ? listaDeTaxas.map((t) => `
                    <tr data-taxa="${escapeHtml(`${t.modalidade}|${t.parcelas}`)}">
                      <td>${escapeHtml(MODALIDADES[t.modalidade] || t.modalidade)}</td>
                      <td>${t.parcelas}x</td>
                      <td>${pode ? `<input class="cartao-taxa" value="${numeroBr(t.taxa * 100, 2)}" data-original="${numeroBr(t.taxa * 100, 2)}" inputmode="decimal" />` : numeroBr(t.taxa * 100, 2)}</td>
                      <td>${pode ? `<input class="cartao-prazo" value="${t.prazoDias === null ? '' : t.prazoDias}" data-original="${t.prazoDias === null ? '' : t.prazoDias}" inputmode="numeric" />` : (t.prazoDias === null ? '-' : t.prazoDias)}</td>
                      <td>${t.prazoDiasUteis ? 'úteis' : 'corridos'}</td>
                      <td>${t.taxaPorParcela ? 'sim' : '-'}</td>
                      <td>${escapeHtml(t.vigencia.split('-').reverse().join('/'))}</td>
                    </tr>`).join('') : '<tr><td colspan="7" class="muted">Nenhuma taxa para este canal e bandeira.</td></tr>'}
                </tbody>
              </table>
            </div>
            ${pode && listaDeTaxas.length ? '<div class="finance-actions-row"><button type="button" id="cartaoSalvarTaxas">Salvar taxas</button></div>' : ''}
          </div>
        </section>

        <section class="cadastro-section">
          <div class="cadastro-section-header"><div><h4>PVs na credenciadora</h4></div></div>
          <div class="cadastro-section-body">
            <div class="table-scroll">
              <table class="table">
                <thead><tr><th>PV</th><th>Nome</th><th>Empresa</th><th>Ativo</th></tr></thead>
                <tbody>
                  ${dados.pvs.map((p) => `
                    <tr>
                      <td>${escapeHtml(p.pv)}</td>
                      <td>${escapeHtml(p.nome)}</td>
                      <td>${pode ? `<select class="cartao-pv-empresa" data-pv="${escapeHtml(p.pv)}"><option value="">Sem empresa</option>${(dados.empresas || []).map((e) => `<option value="${escapeHtml(e.id)}" ${p.empresaId === e.id ? 'selected' : ''}>${escapeHtml(e.name || e.label || e.id)}</option>`).join('')}</select>`
                        : escapeHtml(((dados.empresas || []).find((e) => e.id === p.empresaId) || {}).name || '-')}</td>
                      <td>${pode ? `<input type="checkbox" class="cartao-pv-ativo" data-pv="${escapeHtml(p.pv)}" ${p.ativo ? 'checked' : ''} />` : (p.ativo ? 'sim' : 'não')}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    `;

    document.getElementById('cartaoFiltroCanal')?.addEventListener('change', (e) => { filtro.canal = e.target.value; render(); });
    document.getElementById('cartaoFiltroBandeira')?.addEventListener('change', (e) => { filtro.bandeira = e.target.value; render(); });

    document.getElementById('cartaoSalvarFatores')?.addEventListener('click', async (e) => {
      const mudados = [...content.querySelectorAll('.cartao-fator')].filter((i) => i.value.trim() && i.value.trim() !== i.dataset.original)
        .map((i) => ({ canal: i.dataset.canal, modalidade: i.dataset.modalidade, parcelas: Number(i.dataset.parcelas), fator: lerNumero(i.value) }));
      if (!mudados.length) { showToast('Nenhum fator mudou.', 'info'); return; }
      e.target.disabled = true;
      try {
        dados = { ...dados, ...(await api('/api/finance/cartao/fatores', { method: 'PUT', body: JSON.stringify({ fatores: mudados }) })) };
        showToast(`${mudados.length} fator(es) salvo(s), valendo a partir de hoje.`, 'success');
        render();
      } catch (erro) {
        showToast(erro.message || 'Erro ao salvar os fatores.', 'error');
        e.target.disabled = false;
      }
    });

    document.getElementById('cartaoSalvarTaxas')?.addEventListener('click', async (e) => {
      const mudados = [...content.querySelectorAll('tr[data-taxa]')].filter((tr) => {
        const taxa = tr.querySelector('.cartao-taxa');
        const prazo = tr.querySelector('.cartao-prazo');
        return taxa.value.trim() !== taxa.dataset.original || prazo.value.trim() !== prazo.dataset.original;
      }).map((tr) => {
        const [modalidade, parcelas] = tr.dataset.taxa.split('|');
        const atual = taxas.get(`${modalidade}|${parcelas}`);
        const prazo = tr.querySelector('.cartao-prazo').value.trim();
        return {
          canal: filtro.canal, bandeira: filtro.bandeira, modalidade, parcelas: Number(parcelas),
          taxa: lerNumero(tr.querySelector('.cartao-taxa').value) / 100,
          prazoDias: prazo === '' ? null : Number(prazo),
          prazoDiasUteis: atual ? atual.prazoDiasUteis : true,
          taxaPorParcela: atual ? atual.taxaPorParcela : false
        };
      });
      if (!mudados.length) { showToast('Nenhuma taxa mudou.', 'info'); return; }
      e.target.disabled = true;
      try {
        const cnpj = (listaDeTaxas[0] || {}).credenciadoraCnpj || '';
        dados = { ...dados, ...(await api('/api/finance/cartao/taxas', { method: 'PUT', body: JSON.stringify({ taxas: mudados, credenciadoraCnpj: cnpj }) })) };
        showToast(`${mudados.length} taxa(s) salva(s), valendo a partir de hoje.`, 'success');
        render();
      } catch (erro) {
        showToast(erro.message || 'Erro ao salvar as taxas.', 'error');
        e.target.disabled = false;
      }
    });

    const salvarPv = async (pv) => {
      const empresa = content.querySelector(`.cartao-pv-empresa[data-pv="${CSS.escape(pv)}"]`);
      const ativo = content.querySelector(`.cartao-pv-ativo[data-pv="${CSS.escape(pv)}"]`);
      try {
        dados = { ...dados, ...(await api(`/api/finance/cartao/pvs/${encodeURIComponent(pv)}`, { method: 'PUT', body: JSON.stringify({ empresaId: empresa ? empresa.value : '', ativo: ativo ? ativo.checked : true }) })) };
        showToast('PV salvo.', 'success');
      } catch (erro) {
        showToast(erro.message || 'Erro ao salvar o PV.', 'error');
      }
    };
    content.querySelectorAll('.cartao-pv-empresa, .cartao-pv-ativo').forEach((campo) => {
      campo.addEventListener('change', () => salvarPv(campo.dataset.pv));
    });
  }
  render();
};
