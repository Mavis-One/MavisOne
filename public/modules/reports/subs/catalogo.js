// O CATÁLOGO DE RELATÓRIOS NA TELA.
//
// Cada grupo do menu (Financeiro, Vendas, Estoque...) abre a lista dos seus
// relatórios; escolher um abre a tela dele. A tela é UMA para todos: os
// filtros, as colunas e os totais vêm da definição no servidor
// (lib/relatorios), e a exportação chama o servidor, que refaz permissão e
// filtro — o arquivo nunca é montado com o que estava na tela.
window.MavisRelatoriosCatalogo = (function () {
  const LIMITE_NA_TELA = 2000;

  // OS FORMATADORES SÃO CRIADOS UMA VEZ, e não um por célula.
  // `n.toLocaleString('pt-BR', opções)` é, pela especificação (ECMA-402),
  // `new Intl.NumberFormat('pt-BR', opções).format(n)` — e montar o formatador
  // é a parte cara (carregar as regras do idioma). Esta tabela serve os 81
  // relatórios do catálogo e o Personalizado, até 2.000 linhas na tela:
  // medido com o Extrato Bancário de verdade (2.000 linhas x 10 colunas),
  // 300 ms de thread principal só formatando número contra 16 ms com os quatro
  // guardados, e a saída idêntica nas 20.000 células.
  const FORMATO_MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const FORMATO_PERCENTUAL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const FORMATO_INTEIRO = new Intl.NumberFormat('pt-BR');
  const FORMATO_QUANTIDADE = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

  function formatar(coluna, valor) {
    if (valor === null || valor === undefined || valor === '') return '';
    const n = Number(valor);
    switch (coluna.tipo) {
      case 'moeda': return FORMATO_MOEDA.format(n);
      case 'percentual': return `${FORMATO_PERCENTUAL.format(n)}%`;
      case 'inteiro': return FORMATO_INTEIRO.format(Math.round(n));
      case 'quantidade':
      case 'numero': return FORMATO_QUANTIDADE.format(n);
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

  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // A LISTA DO GRUPO (04/11/2026, pedido do usuário: "seus botões fiquem
  // ordenados e mais visíveis"): em ordem alfabética, com um campo que filtra
  // os botões enquanto se digita.
  function lista(ctx, grupo) {
    const { content, escapeHtml, state, loadModule } = ctx;
    const relatorios = grupo.relatorios.slice().sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR', { sensitivity: 'base' }));
    content.innerHTML = `
      <div class="workspace">
        <section class="panel workspace-head rel-lista-topo">
          <div><strong>${escapeHtml(grupo.titulo)}</strong> <span class="muted">· ${relatorios.length} ${relatorios.length === 1 ? 'relatório' : 'relatórios'}</span></div>
          <input type="search" id="relListaProcurar" placeholder="Procurar relatório..." aria-label="Procurar relatório neste grupo" />
        </section>
        <section class="panel">
          <div class="rel-catalogo-lista">
            ${relatorios.map((r) => `
              <button type="button" class="rel-catalogo-item" data-rel-abrir="${escapeHtml(r.key)}" data-rel-nome="${escapeHtml(semAcento(r.titulo))}">
                <span>${escapeHtml(r.titulo)}</span><span aria-hidden="true">›</span>
              </button>`).join('')}
          </div>
          <p class="muted" id="relListaNada" hidden>Nenhum relatório com esse nome neste grupo.</p>
        </section>
      </div>`;
    content.querySelectorAll('[data-rel-abrir]').forEach((b) => b.addEventListener('click', () => {
      state.relatorioAberto = state.relatorioAberto || {};
      state.relatorioAberto[grupo.key] = b.dataset.relAbrir;
      loadModule('reports');
    }));
    content.querySelector('#relListaProcurar')?.addEventListener('input', (evento) => {
      const alvo = semAcento(evento.target.value).trim();
      let visiveis = 0;
      content.querySelectorAll('[data-rel-nome]').forEach((b) => {
        const mostra = !alvo || b.dataset.relNome.includes(alvo);
        b.hidden = !mostra;
        if (mostra) visiveis += 1;
      });
      content.querySelector('#relListaNada').hidden = visiveis > 0;
    });
  }

  /**
   * A BARRA DE AÇÕES DE TODO RELATÓRIO (04/11/2026). Sempre na mesma ordem e no
   * mesmo lugar: à esquerda o que mexe nos filtros, à direita o que baixa —
   * Excel, PDF, CSV e Imprimir, juntos e destacados. As telas ligam os botões
   * por `data-rel-acao` (ver ligarBarra). `filtros: false` tira Aplicar e
   * Limpar (relatório sem filtro); `formatos` escolhe os de baixar.
   */
  function barraDeAcoes(ctx, { filtros = true, formatos = ['xlsx', 'pdf', 'csv'], extraEsquerda = '' } = {}) {
    const ROTULO = {
      xlsx: ['Excel', 'Planilha do Excel formatada, com o subtotal de cada grupo e o total, pronta para imprimir'],
      pdf: ['PDF', 'Salvar em PDF, no mesmo arranjo da tela'],
      csv: ['CSV', 'Arquivo de texto separado por ponto e vírgula, para importar em outro sistema']
    };
    return `
      <div class="rel-barra" role="toolbar" aria-label="Ações do relatório">
        <div class="rel-barra-grupo">
          ${filtros ? '<button type="button" data-rel-acao="aplicar">Aplicar filtros</button>' : ''}
          ${filtros ? '<button type="button" class="secondary" data-rel-acao="limpar" title="Volta todos os filtros, a busca, a ordem e a separação ao padrão">Limpar filtros</button>' : ''}
          <button type="button" class="secondary" data-rel-acao="atualizar" title="Busca de novo no banco, com os mesmos filtros">Atualizar</button>
          ${extraEsquerda}
        </div>
        <div class="rel-barra-grupo rel-baixar" role="group" aria-label="Baixar o relatório">
          <span class="rel-barra-rotulo">Baixar</span>
          ${formatos.map((f) => `<button type="button" class="rel-baixar-botao" data-rel-acao="${f}" title="${ROTULO[f][1]}">${ROTULO[f][0]}</button>`).join('')}
          <button type="button" class="rel-baixar-botao" data-rel-acao="imprimir" title="Imprimir a tela">Imprimir</button>
        </div>
      </div>`;
  }

  /** Liga os botões da barra: `acoes` = { aplicar, limpar, atualizar, xlsx, pdf, csv, imprimir }. */
  function ligarBarra(raiz, acoes) {
    const comPadrao = { imprimir: () => window.print(), ...acoes };
    raiz.querySelectorAll('[data-rel-acao]').forEach((b) => {
      const acao = comPadrao[b.dataset.relAcao];
      if (!acao) { b.hidden = true; return; }
      b.addEventListener('click', async () => {
        if (b.disabled) return;
        b.disabled = true;
        try { await acao(); } finally { b.disabled = false; }
      });
    });
  }

  /**
   * PROCURAR, SEPARAR E A ORDEM (04/11/2026). Tudo vai para o servidor
   * (lib/relatorios/motor.js, aplicarVisao): a busca e a separação valem para
   * TODAS as linhas — inclusive as que passam das 2.000 da tela — e o arquivo
   * baixado sai igual.
   */
  function barraDaVisao(ctx, r) {
    const { escapeHtml } = ctx;
    const v = r.visao || {};
    const colunas = r.colunas || [];
    const col = colunas.find((c) => c.campo === v.ordenarPor);
    const como = !col ? '' : (ehNumero(col) ? (v.sentido === 'desc' ? 'maior primeiro' : 'menor primeiro')
      : col.tipo === 'data' ? (v.sentido === 'desc' ? 'mais recente primeiro' : 'mais antiga primeiro') : (v.sentido === 'desc' ? 'Z a A' : 'A a Z'));
    return `
      <div class="rel-visao">
        <label class="rel-visao-procurar">Procurar nas linhas
          <input type="search" data-rel-visao="procurar" value="${escapeHtml(v.procurar || '')}" placeholder="nome, número, valor ou data... (Enter)" />
        </label>
        <label>Separar por
          <select data-rel-visao="separarPor">
            <option value="">Sem separação</option>
            ${(r.separacoes || []).map((s) => `<option value="${escapeHtml(s.valor)}" ${s.valor === v.separarPor ? 'selected' : ''}>${escapeHtml(s.rotulo)}</option>`).join('')}
          </select>
        </label>
        <div class="rel-visao-ordem">
          ${col
            ? `Ordenado por <strong>${escapeHtml(col.rotulo)}</strong> (${como}) <button type="button" class="secondary rel-visao-tirar" data-rel-visao-tirar-ordem title="Voltar à ordem do relatório">Tirar ordem</button>`
            : '<span class="muted">Clique no título de uma coluna para ordenar.</span>'}
        </div>
      </div>`;
  }

  /**
   * Liga a busca, a separação e os títulos que ordenam. `aplicar(mudanca)`
   * recebe o que mudou ({ procurar }, { separarPor }, { ordenarPor, sentido })
   * e recarrega.
   */
  function ligarVisao(raiz, r, aplicar) {
    const v = r.visao || {};
    const procurar = raiz.querySelector('[data-rel-visao="procurar"]');
    if (procurar) {
      const enviar = () => { if (procurar.value.trim() !== (v.procurar || '')) aplicar({ procurar: procurar.value.trim() }); };
      procurar.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); enviar(); } });
      // O "x" do campo de busca limpa e dispara `search`.
      procurar.addEventListener('search', enviar);
    }
    raiz.querySelector('[data-rel-visao="separarPor"]')?.addEventListener('change', (e) => aplicar({ separarPor: e.target.value }));
    raiz.querySelector('[data-rel-visao-tirar-ordem]')?.addEventListener('click', () => aplicar({ ordenarPor: '', sentido: '' }));
    raiz.querySelectorAll('[data-rel-ordenar]').forEach((b) => b.addEventListener('click', () => {
      const campo = b.dataset.relOrdenar;
      // Coluna nova começa de A a Z (ou do menor); a mesma inverte; a terceira vez tira.
      if (v.ordenarPor !== campo) return aplicar({ ordenarPor: campo, sentido: 'asc' });
      if (v.sentido !== 'desc') return aplicar({ ordenarPor: campo, sentido: 'desc' });
      return aplicar({ ordenarPor: '', sentido: '' });
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
      usa('banco') ? select('banco', 'Banco', opcoes.bancos, 'Todos', (o) => o, (o) => o) : '',
      usa('vendedor') && opcoes.podeEscolherVendedor ? select('vendedorId', 'Vendedor', opcoes.vendedores, 'Todos') : '',
      // A empresa onde o pedido foi faturado (05/11/2026): o CNPJ no valor.
      usa('filial') ? select('filial', 'Empresa (faturamento)', opcoes.empresasDeFaturamento, 'Todas', (o) => o.id, (o) => o.name) : '',
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
          ${barraDeAcoes(ctx, { filtros: Boolean(campos) })}
        </div>
      </section>`;
  }

  /**
   * A tabela do relatório. Com `ordenavel`, o título de cada coluna é um botão
   * que ordena (ver ligarVisao). Com `r.grupos` (a separação), cada grupo abre
   * com o nome e a quantidade e fecha com o subtotal; o grupo que passa das
   * 2.000 linhas da tela diz que continua no arquivo.
   */
  function tabela(ctx, r, { ordenavel = false } = {}) {
    const { escapeHtml } = ctx;
    const colunas = r.colunas || [];
    const v = r.visao || {};
    const temTotal = Object.keys(r.totais || {}).length > 0;
    const cab = colunas.map((c) => {
      const classe = ehNumero(c) ? ' class="rel-num"' : '';
      if (!ordenavel) return `<th${classe}>${escapeHtml(c.rotulo)}</th>`;
      const ativa = v.ordenarPor === c.campo;
      const seta = ativa ? (v.sentido === 'desc' ? ' ▼' : ' ▲') : '';
      return `<th${classe}><button type="button" class="sales-ordenar${ativa ? ' is-ativa' : ''}" data-rel-ordenar="${escapeHtml(c.campo)}" title="Ordenar por ${escapeHtml(c.rotulo)}">${escapeHtml(c.rotulo)}${seta}</button></th>`;
    }).join('');
    const celulas = (l) => colunas.map((c) => `<td${ehNumero(c) ? ' class="rel-num"' : ''}>${escapeHtml(formatar(c, l[c.campo]))}</td>`).join('');
    const somaDe = (totais, rotulo) => colunas.map((c, i) => {
      if (Object.prototype.hasOwnProperty.call(totais || {}, c.campo)) return `<td class="rel-num"><strong>${escapeHtml(formatar(c, totais[c.campo]))}</strong></td>`;
      return i === 0 ? `<td><strong>${escapeHtml(rotulo)}</strong></td>` : '<td></td>';
    }).join('');
    const dados = r.linhas || [];
    let linhas = '';
    if (Array.isArray(r.grupos) && r.grupos.length) {
      let i = 0;
      for (const g of r.grupos) {
        if (i >= dados.length) break;
        const fim = i + g.quantidade;
        linhas += `<tr class="rel-tabela-grupo"><td colspan="${colunas.length}"><strong>${escapeHtml(g.rotulo)}</strong> <span class="muted">· ${g.quantidade.toLocaleString('pt-BR')} ${g.quantidade === 1 ? 'linha' : 'linhas'}</span></td></tr>`;
        linhas += dados.slice(i, fim).map((l) => `<tr>${celulas(l)}</tr>`).join('');
        linhas += fim <= dados.length
          ? `<tr class="rel-tabela-subtotal">${somaDe(g.totais, 'Subtotal')}</tr>`
          : `<tr class="rel-tabela-subtotal"><td colspan="${colunas.length}" class="muted">O grupo continua no arquivo (a tela mostra as primeiras ${dados.length.toLocaleString('pt-BR')} linhas).</td></tr>`;
        i = fim;
      }
    } else {
      linhas = dados.map((l) => `<tr>${celulas(l)}</tr>`).join('');
    }
    const rodape = temTotal ? `<tfoot><tr>${somaDe(r.totais, 'Total')}</tr></tfoot>` : '';
    const total = Number(r.totalLinhas || 0);
    return `
      <div class="rel-tabela-topo">
        <h3>${total.toLocaleString('pt-BR')} ${total === 1 ? 'linha' : 'linhas'}${Array.isArray(r.grupos) && r.grupos.length ? ` <span class="muted">em ${r.grupos.length} ${r.grupos.length === 1 ? 'grupo' : 'grupos'}</span>` : ''}</h3>
        ${total > dados.length ? `<span class="muted">${dados.length.toLocaleString('pt-BR')} na tela; o arquivo leva todas</span>` : ''}
      </div>
      <div class="table-scroll">
        <table class="table rel-tabela">
          <thead><tr>${cab}</tr></thead>
          <tbody>${linhas || `<tr><td colspan="${colunas.length || 1}" class="muted">${v.procurar ? `Nenhuma linha com "${escapeHtml(v.procurar)}".` : 'Nenhum registro.'}</td></tr>`}</tbody>
          ${linhas ? rodape : ''}
        </table>
      </div>`;
  }

  /** O arquivo do relatório: xlsx (padrão), pdf ou csv — com os filtros e a visão da tela. */
  async function exportar(ctx, def, filtros, formato = 'xlsx') {
    const extra = formato === 'xlsx' ? '' : `&formato=${formato}`;
    return baixar(ctx, `/api/reports/catalogo/${encodeURIComponent(def.key)}/export?${query(filtros)}${extra}`, `${def.key}.${formato}`);
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
        <section class="panel">
          ${barraDaVisao(ctx, r)}
          ${tabela(ctx, r, { ordenavel: true })}
        </section>
      </div>`;
    ligarVoltar(ctx, grupo);

    const ler = () => {
      content.querySelectorAll('[data-rel-cat]').forEach((campo) => { filtros[campo.dataset.relCat] = campo.value; });
    };
    // A visão (procurar, separar, ordem) mora nos mesmos filtros: o arquivo a
    // leva, e ela fica ao sair e voltar para o relatório.
    ligarVisao(content, r, (mudanca) => { ler(); Object.assign(filtros, mudanca); loadModule('reports'); });
    ligarBarra(content, {
      aplicar: () => { ler(); loadModule('reports'); },
      limpar: () => { Object.keys(filtros).forEach((k) => { delete filtros[k]; }); loadModule('reports'); },
      atualizar: () => loadModule('reports'),
      xlsx: () => { ler(); return exportar(ctx, def, filtros, 'xlsx'); },
      // O PDF (17/10/2026): o mesmo relatório, com todas as linhas, como a planilha.
      pdf: () => { ler(); return exportar(ctx, def, filtros, 'pdf'); },
      csv: () => { ler(); return exportar(ctx, def, filtros, 'csv'); }
    });
  }

  return { lista, relatorio, comVolta, formatar, tabela, baixar, query, barraDeAcoes, ligarBarra, barraDaVisao, ligarVisao, LIMITE_NA_TELA };
}());
