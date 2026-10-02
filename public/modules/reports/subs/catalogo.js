// O CATÁLOGO DE RELATÓRIOS NA TELA.
//
// Cada grupo do menu (Financeiro, Vendas, Estoque...) abre a lista dos seus
// relatórios; escolher um abre a tela dele. A tela é UMA para todos: os
// filtros, as colunas e os totais vêm da definição no servidor
// (lib/relatorios), e a exportação chama o servidor, que refaz permissão e
// filtro — o arquivo nunca é montado com o que estava na tela.
window.MavisRelatoriosCatalogo = (function () {
  const LIMITE_NA_TELA = 2000;

  function formatar(coluna, valor) {
    if (valor === null || valor === undefined || valor === '') return '';
    const n = Number(valor);
    switch (coluna.tipo) {
      case 'moeda': return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      case 'percentual': return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
      case 'inteiro': return Math.round(n).toLocaleString('pt-BR');
      case 'quantidade':
      case 'numero': return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
      case 'data': {
        const s = String(valor).slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : String(valor);
      }
      default: return String(valor);
    }
  }

  const ehNumero = (coluna) => ['moeda', 'percentual', 'inteiro', 'quantidade', 'numero'].includes(coluna.tipo);

  function filtrosDe(state, chave) {
    state.relatoriosFiltros = state.relatoriosFiltros || {};
    state.relatoriosFiltros[chave] = state.relatoriosFiltros[chave] || {};
    return state.relatoriosFiltros[chave];
  }

  function query(filtros) {
    const p = new URLSearchParams();
    Object.entries(filtros || {}).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) p.set(k, v); });
    return p.toString();
  }

  /** O botão de volta para a lista do grupo. */
  function voltar(ctx, grupo) {
    const { escapeHtml } = ctx;
    return `<button type="button" class="secondary rel-voltar" data-rel-voltar>‹ ${escapeHtml(grupo.titulo)}</button>`;
  }

  function ligarVoltar(ctx, grupo) {
    const { content, state, loadModule } = ctx;
    content.querySelectorAll('[data-rel-voltar]').forEach((b) => b.addEventListener('click', () => {
      state.relatorioAberto = state.relatorioAberto || {};
      state.relatorioAberto[grupo.key] = '';
      loadModule('reports');
    }));
  }

  /** As telas que já existiam (Pedidos, Síntese...) ganham a volta no topo. */
  function comVolta(ctx, grupo) {
    const { content } = ctx;
    content.insertAdjacentHTML('afterbegin', `<div class="rel-voltar-linha">${voltar(ctx, grupo)}</div>`);
    ligarVoltar(ctx, grupo);
  }

  function lista(ctx, grupo) {
    const { content, escapeHtml, state, loadModule } = ctx;
    content.innerHTML = `
      <div class="workspace">
        <section class="panel workspace-head"><div><strong>${escapeHtml(grupo.titulo)}</strong></div></section>
        <section class="panel">
          <div class="rel-catalogo-lista">
            ${grupo.relatorios.map((r) => `
              <button type="button" class="rel-catalogo-item" data-rel-abrir="${escapeHtml(r.key)}">
                <span>${escapeHtml(r.titulo)}</span><span aria-hidden="true">›</span>
              </button>`).join('')}
          </div>
        </section>
      </div>`;
    content.querySelectorAll('[data-rel-abrir]').forEach((b) => b.addEventListener('click', () => {
      state.relatorioAberto = state.relatorioAberto || {};
      state.relatorioAberto[grupo.key] = b.dataset.relAbrir;
      loadModule('reports');
    }));
  }

  function barraDeFiltros(ctx, def, filtros, opcoes) {
    const { escapeHtml } = ctx;
    const usa = (f) => (def.filtros || []).includes(f);
    const select = (campo, rotulo, itens, vazio, valorDe = (o) => o.id, nomeDe = (o) => o.name) => `
      <label>${escapeHtml(rotulo)}
        <select data-rel-cat="${campo}">
          <option value="">${escapeHtml(vazio)}</option>
          ${(itens || []).map((o) => `<option value="${escapeHtml(valorDe(o))}" ${String(valorDe(o)) === String(filtros[campo] || '') ? 'selected' : ''}>${escapeHtml(nomeDe(o))}</option>`).join('')}
        </select>
      </label>`;
    const anoAtual = Number(String(filtros.hoje || new Date().toISOString()).slice(0, 4));
    const anos = Array.from({ length: 8 }, (_, i) => anoAtual - 6 + i);
    const campos = [
      usa('periodo') ? `<label>De<input type="date" data-rel-cat="de" value="${escapeHtml(filtros.de || '')}" /></label>
                        <label>Até<input type="date" data-rel-cat="ate" value="${escapeHtml(filtros.ate || '')}" /></label>` : '',
      usa('ano') ? `<label>Ano<select data-rel-cat="ano">${anos.map((a) => `<option value="${a}" ${a === Number(filtros.ano) ? 'selected' : ''}>${a}</option>`).join('')}</select></label>` : '',
      usa('data') ? `<label>Posição em<input type="date" data-rel-cat="data" value="${escapeHtml(filtros.data || '')}" /></label>` : '',
      usa('dias') ? `<label>Dias<input type="number" min="1" max="3650" step="1" data-rel-cat="dias" value="${escapeHtml(String(filtros.dias || ''))}" /></label>` : '',
      usa('deposito') ? select('depositoId', 'Depósito', opcoes.depositos, 'Todos') : '',
      usa('conta') ? select('contaId', 'Conta', opcoes.contas, 'Todas') : '',
      usa('vendedor') && opcoes.podeEscolherVendedor ? select('vendedorId', 'Vendedor', opcoes.vendedores, 'Todos') : '',
      usa('filial') ? select('filial', 'Filial', opcoes.filiais, 'Todas', (o) => o, (o) => o) : '',
      usa('estabelecimento') ? select('estabelecimentoId', 'Estabelecimento', opcoes.estabelecimentos, 'Todos') : '',
      // As escolhas não têm "Todos": o primeiro item já é o padrão do relatório.
      ...(def.escolhas || []).map((e) => `
        <label>${escapeHtml(e.rotulo)}
          <select data-rel-cat="${escapeHtml(e.campo)}">
            ${e.itens.map(([valor, rotulo]) => `<option value="${escapeHtml(valor)}" ${String(valor) === String(filtros[e.campo] || '') ? 'selected' : ''}>${escapeHtml(rotulo)}</option>`).join('')}
          </select>
        </label>`)
    ].join('');
    return `
      <section class="panel rel-filtros">
        ${campos ? `<div class="rel-filtros-grade">${campos}</div>` : ''}
        <div class="rel-filtros-acoes"${campos ? '' : ' style="margin-top:0;padding-top:0;border-top:0;"'}>
          <div>${campos ? '<button type="button" id="relCatAplicar">Aplicar</button>' : ''}
            <button type="button" class="secondary" id="relCatAtualizar">Atualizar</button></div>
          <div>
            <button type="button" class="secondary" id="relCatExportar">Excel (CSV)</button>
            <button type="button" class="secondary" id="relCatImprimir">Imprimir</button>
          </div>
        </div>
      </section>`;
  }

  function tabela(ctx, r) {
    const { escapeHtml } = ctx;
    const colunas = r.colunas || [];
    const temTotal = Object.keys(r.totais || {}).length > 0;
    const cab = colunas.map((c) => `<th${ehNumero(c) ? ' class="rel-num"' : ''}>${escapeHtml(c.rotulo)}</th>`).join('');
    const linhas = (r.linhas || []).map((l) => `<tr>${colunas.map((c) => `<td${ehNumero(c) ? ' class="rel-num"' : ''}>${escapeHtml(formatar(c, l[c.campo]))}</td>`).join('')}</tr>`).join('');
    const rodape = temTotal ? `<tfoot><tr>${colunas.map((c, i) => {
      if (Object.prototype.hasOwnProperty.call(r.totais, c.campo)) return `<td class="rel-num"><strong>${escapeHtml(formatar(c, r.totais[c.campo]))}</strong></td>`;
      return i === 0 ? '<td><strong>Total</strong></td>' : '<td></td>';
    }).join('')}</tr></tfoot>` : '';
    const total = Number(r.totalLinhas || 0);
    return `
      <section class="panel">
        <div class="rel-tabela-topo">
          <h3>${total.toLocaleString('pt-BR')} ${total === 1 ? 'linha' : 'linhas'}</h3>
          ${total > (r.linhas || []).length ? `<span class="muted">${(r.linhas || []).length.toLocaleString('pt-BR')} na tela; o arquivo leva todas</span>` : ''}
        </div>
        <div class="table-scroll">
          <table class="table rel-tabela">
            <thead><tr>${cab}</tr></thead>
            <tbody>${linhas || `<tr><td colspan="${colunas.length || 1}" class="muted">Nenhum registro.</td></tr>`}</tbody>
            ${linhas ? rodape : ''}
          </table>
        </div>
      </section>`;
  }

  async function exportar(ctx, def, filtros) {
    return baixar(ctx, `/api/reports/catalogo/${encodeURIComponent(def.key)}/export?${query(filtros)}`, `${def.key}.csv`);
  }

  /** Baixa o CSV que o servidor montou. O Personalizado usa o mesmo caminho. */
  async function baixar(ctx, endereco, nomePadrao) {
    const { showToast } = ctx;
    let url = null;
    try {
      const resposta = await fetch(endereco, {
        headers: { 'x-auth-token': (typeof getSessionToken === 'function' ? getSessionToken() : '') || '' }
      });
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => ({}));
        showToast(corpo.error || `Não consegui exportar (HTTP ${resposta.status}).`, 'error');
        return;
      }
      const nome = (/filename="([^"]+)"/.exec(resposta.headers.get('Content-Disposition') || '') || [])[1] || nomePadrao;
      url = URL.createObjectURL(await resposta.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = nome;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (erro) {
      showToast(erro.message || 'Não consegui exportar.', 'error');
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  }

  async function relatorio(ctx, grupo, def, opcoes) {
    const { api, content, escapeHtml, state, loadModule } = ctx;
    const filtros = filtrosDe(state, def.key);
    content.innerHTML = `<div class="workspace"><section class="panel workspace-head"><div>${voltar(ctx, grupo)}<strong>${escapeHtml(def.titulo)}</strong></div></section><section class="panel"><p class="muted">Carregando...</p></section></div>`;
    ligarVoltar(ctx, grupo);

    let r;
    try {
      r = await api(`/api/reports/catalogo/${encodeURIComponent(def.key)}?${query(filtros)}`);
    } catch (erro) {
      content.innerHTML = `<div class="workspace"><section class="panel workspace-head"><div>${voltar(ctx, grupo)}<strong>${escapeHtml(def.titulo)}</strong></div></section><section class="panel"><p class="form-error">${escapeHtml(erro.message || 'Não foi possível montar o relatório.')}</p></section></div>`;
      ligarVoltar(ctx, grupo);
      return;
    }
    // O que o servidor aplicou (o período padrão, o ano corrente) volta para
    // os campos: a tela mostra o período que os números de fato cobrem.
    const aplicados = { ...r.filtros };
    Object.entries(filtros).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) aplicados[k] = v; });

    content.innerHTML = `
      <div class="workspace">
        <section class="panel workspace-head"><div>${voltar(ctx, grupo)}<strong>${escapeHtml(def.titulo)}</strong></div></section>
        ${barraDeFiltros(ctx, def, aplicados, opcoes || {})}
        ${tabela(ctx, r)}
      </div>`;
    ligarVoltar(ctx, grupo);

    const ler = () => {
      content.querySelectorAll('[data-rel-cat]').forEach((campo) => { filtros[campo.dataset.relCat] = campo.value; });
    };
    content.querySelector('#relCatAplicar')?.addEventListener('click', () => { ler(); loadModule('reports'); });
    content.querySelector('#relCatAtualizar')?.addEventListener('click', () => loadModule('reports'));
    content.querySelector('#relCatImprimir')?.addEventListener('click', () => window.print());
    content.querySelector('#relCatExportar')?.addEventListener('click', () => { ler(); exportar(ctx, def, filtros); });
  }

  return { lista, relatorio, comVolta, formatar, tabela, baixar, query, LIMITE_NA_TELA };
}());
