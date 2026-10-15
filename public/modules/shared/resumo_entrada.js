// O RESUMO DE UMA ENTRADA DE NF-e LANÇADA (15/10/2026).
//
// Pedido do usuário: "um botão após dar entrada nas NF como forma de visualizar
// um resumo do que foi realizado na entrada (itens, valores, depósito,
// confirmação ou cancelamento)". Depois, no mesmo dia: o resumo também em
// Notas de Entrada (Últimas entradas) e abrindo sozinho no fim do lançamento.
// Uma janela só, para as três: Notas contra CNPJ ("Ver entrada"), Notas de
// Entrada ("Resumo") e o fim do lançamento (entrada_nfe.js e a Edição de
// Título, quando a nota gerou contas a pagar).
//
// Tudo vem de GET /api/purchases/entrada-nfe/:id/resumo (resumoDaEntrada no
// servidor), inclusive manifestação e situação na SEFAZ. Valores só para
// administrador: para os outros o servidor os manda vazios, e a janela some
// com as colunas em vez de mostrar R$ 0,00.
(function (raiz) {
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const diaBr = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : '-'; };
  const documentoBr = (v) => {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    return d;
  };
  const SITUACAO_DO_TITULO = { paid: 'Pago', parcial: 'Parcial', cancelado: 'Cancelado' };

  function desenhar(r) {
    const e = r.entrada;
    const valores = r.comValores !== false;
    const hoje = new Date().toISOString().slice(0, 10);
    const situacaoDoTitulo = (t) => SITUACAO_DO_TITULO[t.status] || (t.vencimento < hoje ? 'Vencido' : 'Em aberto');
    const lancadaEm = e.criadoEm ? new Date(e.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    const linha = (rotulo, valor) => `<div class="dfe-resumo-linha"><span class="muted">${rotulo}</span><strong>${valor}</strong></div>`;
    const recebida = r.recebida;
    // No navegador vem do global; no Node (testes), do próprio arquivo.
    const catalogo = (raiz && raiz.MavisManifestacao)
      || (typeof module !== 'undefined' && module.exports ? require('./manifestacao') : null);
    const manifestacao = recebida && recebida.manifestacaoCodigo
      ? `${esc(recebida.manifestacaoCodigo)} - ${esc(catalogo && catalogo.rotulo ? catalogo.rotulo(recebida.manifestacaoCodigo) : '')}`
      : 'Sem manifestação';
    const situacao = !recebida ? '-'
      : (String(recebida.situacao || 'autorizada') === 'cancelada' ? '<span class="finance-negative">Cancelada pelo emitente</span>' : 'Autorizada');
    return `
      <div class="modal modal-lg dfe-resumo" role="dialog" aria-modal="true" aria-labelledby="resumoEntradaTitulo">
        <h3 id="resumoEntradaTitulo">Entrada da NF-e ${esc(e.numero)}/${esc(e.serie)}</h3>
        <div class="dfe-resumo-grade">
          ${linha('Emitente', `${esc(e.emitenteNome)} · ${esc(documentoBr(e.emitenteDocumento))}`)}
          ${linha('Recebida por', `${esc(e.destinatarioNome || '-')} · ${esc(documentoBr(e.destinatarioDocumento))}`)}
          ${linha('Emissão', esc(diaBr(e.dataEmissao)))}
          ${linha('Natureza', esc(e.naturezaOperacao || '-'))}
          ${linha('Manifestação', manifestacao)}
          ${linha('Situação na SEFAZ', situacao)}
          ${linha('Lançada', `${esc(lancadaEm)}${e.criadoPorNome ? ` por ${esc(e.criadoPorNome)}` : ''}`)}
          ${linha('Entrada', e.status === 'REVISAR' ? '<span class="finance-negative">A revisar (item sem produto)</span>' : 'Completa')}
          ${linha('Depósito', r.depositos.length
            ? r.depositos.map((d) => `${esc(d.nome)} (${esc(String(d.quantidade))})`).join(', ')
            : 'Não movimentou estoque')}
          ${linha('Chave', `<span class="dfe-resumo-chave">${esc(e.chave)}</span>`)}
        </div>

        <h4>Itens</h4>
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>#</th><th>Descrição na nota</th><th>Produto no estoque</th><th class="col-valor">Qtd</th>${valores ? '<th class="col-valor">Unitário</th><th class="col-valor">Total</th>' : ''}<th>Estoque</th></tr></thead>
            <tbody>
              ${r.itens.map((i) => `<tr>
                <td>${esc(String(i.numero))}</td>
                <td>${esc(i.descricao)}</td>
                <td>${i.produto ? `${esc(i.produto.nome)}${i.produto.codigo ? ` (${esc(i.produto.codigo)})` : ''}` : '<span class="finance-negative">sem produto</span>'}</td>
                <td class="col-valor">${esc(String(i.quantidade))} ${esc(i.unidade || '')}</td>
                ${valores ? `<td class="col-valor">${moeda(i.valorUnitario)}</td><td class="col-valor">${moeda(i.valorTotal)}</td>` : ''}
                <td>${i.movimentouEstoque ? 'Entrou' : '<span class="muted">Não entrou</span>'}</td>
              </tr>`).join('')}
            </tbody>
            ${valores ? `<tfoot>
              <tr><th colspan="5">Produtos</th><th class="col-valor">${moeda(e.valorProdutos)}</th><th></th></tr>
              <tr><th colspan="5">Total da nota</th><th class="col-valor">${moeda(e.valorTotal)}</th><th></th></tr>
            </tfoot>` : ''}
          </table>
        </div>

        <h4>Contas a pagar</h4>
        ${r.titulos.length ? `
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Código</th><th>Vencimento</th>${valores ? '<th class="col-valor">Valor</th>' : ''}<th>Situação</th></tr></thead>
            <tbody>
              ${r.titulos.map((t) => `<tr>
                <td>${esc(t.codigo || '-')}</td>
                <td>${esc(diaBr(t.vencimento))}</td>
                ${valores ? `<td class="col-valor">${moeda(t.valor)}</td>` : ''}
                <td>${esc(situacaoDoTitulo(t))}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : `<p class="muted">${e.gerouFinanceiro ? 'Nenhuma conta a pagar encontrada.' : 'Sem contas a pagar.'}</p>`}

        <div class="modal-actions">
          <button type="button" class="btn-muted" id="resumoEntradaFechar">Fechar</button>
        </div>
      </div>`;
  }

  /**
   * Abre a janela. `api` e `showToast` são os da tela que chama. Resolve quando
   * a janela fecha (ou na hora, se não deu para abrir).
   */
  async function abrir({ api, showToast, entradaId }) {
    if (!entradaId) return;
    let r;
    try {
      r = await api(`/api/purchases/entrada-nfe/${encodeURIComponent(entradaId)}/resumo`);
    } catch (erro) {
      if (typeof showToast === 'function') showToast(erro.message || 'Não consegui abrir o resumo da entrada.', 'error');
      return;
    }
    document.getElementById('resumoEntradaModal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'resumoEntradaModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = desenhar(r);
    await new Promise((resolve) => {
      const fechar = () => { overlay.remove(); document.removeEventListener('keydown', aoTeclar); resolve(); };
      const aoTeclar = (ev) => { if (ev.key === 'Escape') fechar(); };
      document.addEventListener('keydown', aoTeclar);
      overlay.addEventListener('click', (ev) => { if (ev.target === overlay) fechar(); });
      document.body.appendChild(overlay);
      overlay.querySelector('#resumoEntradaFechar').addEventListener('click', fechar);
      overlay.querySelector('#resumoEntradaFechar').focus();
    });
  }

  const modulo = { abrir, desenhar };
  if (typeof module !== 'undefined' && module.exports) module.exports = modulo;
  if (raiz) raiz.MavisResumoEntrada = modulo;
})(typeof window !== 'undefined' ? window : null);
