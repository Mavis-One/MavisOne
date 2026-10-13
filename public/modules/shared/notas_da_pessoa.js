// AS NOTAS FISCAIS DE UMA PESSOA, NO CADASTRO DELA (13/10/2026).
//
// Pedido do usuário: no cadastro de pessoas e empresas, uma aba com as NF-e e
// NFC-e emitidas naquele CPF/CNPJ, cada uma com o botão de imprimir.
//
// A lista é a MESMA de NF-e Emitidas (/api/finance/nfe), filtrada pelo
// documento do destinatário: as transmitidas pela Focus, as manuais do
// Financeiro e as importadas do Viper. E a impressão é a MESMA da lista
// (nfePrint, em finance/subs/nfe_emitidas.js): nota que foi à SEFAZ abre a
// DANFE/DANFCe de verdade; importada e manual saem no layout interno, que
// avisa não ser documento fiscal — não há DANFE delas neste sistema.
//
// Nota importada sem CPF/CNPJ do destinatário (veio assim da listagem do
// Viper) não tem como aparecer aqui: o vínculo é o documento.
window.MavisNotasDaPessoa = (function () {
  const POR_VEZ = 250;
  const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const data = (iso) => {
    const s = String(iso || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : '-';
  };

  /** A nota inteira (com itens) para imprimir, conforme a origem. */
  async function notaParaImprimir(nfe, api) {
    if (nfe.origem === 'fiscal') return nfe; // a DANFE vem pronta da rota fiscal
    if (nfe.origem === 'importada') {
      const r = await api(`/api/finance/nfe/importada/${encodeURIComponent(nfe.id)}`);
      return { ...nfe, ...r.nfe, origem: 'importada' };
    }
    const r = await api(`/api/finance/nfe/${encodeURIComponent(nfe.id)}`);
    return { ...nfe, ...r.nfe, origem: 'financeiro' };
  }

  async function mostrar(caixa, documento, { api, escapeHtml, showToast }) {
    if (!documento) {
      caixa.innerHTML = '<p class="muted">Cadastro sem CPF/CNPJ.</p>';
      return;
    }
    caixa.innerHTML = '<p class="muted">Carregando notas…</p>';
    let resposta;
    try {
      resposta = await api(`/api/finance/nfe?documento=${encodeURIComponent(documento)}&limit=${POR_VEZ}&sort=data&dir=desc`);
    } catch (erro) {
      caixa.innerHTML = `<p class="form-error">${escapeHtml(erro.message || 'Não consegui carregar as notas.')}</p>`;
      return;
    }
    const notas = resposta.nfes || [];
    const total = Number(resposta.total || notas.length);
    if (!notas.length) {
      caixa.innerHTML = '<p class="muted">Nenhuma NF-e ou NFC-e emitida neste CPF/CNPJ.</p>';
      return;
    }
    const autorizadas = notas.filter((n) => n.status === 'autorizada');
    caixa.innerHTML = `
      <div class="notas-pessoa-topo">
        <strong>${total.toLocaleString('pt-BR')} ${total === 1 ? 'nota' : 'notas'}</strong>
        <span class="muted">${moeda(autorizadas.reduce((s, n) => s + Number(n.amount || 0), 0))} autorizadas${total > notas.length ? ` · ${notas.length} mais recentes na tela` : ''}</span>
      </div>
      <div class="table-scroll">
        <table class="table notas-pessoa-tabela">
          <thead><tr>
            <th>Tipo</th><th>Número</th><th>Série</th><th>Emissão</th><th>Empresa</th>
            <th class="rel-num">Valor</th><th>Situação</th><th>Chave</th><th></th>
          </tr></thead>
          <tbody>
            ${notas.map((n, i) => `
              <tr>
                <td>${Number(n.modelo) === 65 ? 'NFC-e' : 'NF-e'}</td>
                <td>${escapeHtml(n.number || '-')}</td>
                <td>${escapeHtml(n.series || '-')}</td>
                <td>${data(n.date)}</td>
                <td>${escapeHtml(n.empresa || '-')}</td>
                <td class="rel-num">${moeda(n.amount)}</td>
                <td>${typeof nfeStatusBadge === 'function' ? nfeStatusBadge(n.status) : escapeHtml(n.status || '-')}${n.origem === 'importada' ? ' <span class="finance-badge finance-badge-muted">importada</span>' : ''}</td>
                <td class="notas-pessoa-chave">${n.key ? escapeHtml(n.key) : '<span class="muted">-</span>'}</td>
                <td><button type="button" class="secondary finance-pill-sm" data-nota-imprimir="${i}">Imprimir</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    caixa.querySelectorAll('[data-nota-imprimir]').forEach((botao) => botao.addEventListener('click', async () => {
      const nfe = notas[Number(botao.dataset.notaImprimir)];
      botao.disabled = true;
      try {
        await nfePrint(await notaParaImprimir(nfe, api), 'completo');
      } catch (erro) {
        showToast(erro.message || 'Não consegui imprimir a nota.', 'error');
      } finally {
        botao.disabled = false;
      }
    }));
  }

  return { mostrar, notaParaImprimir };
})();
