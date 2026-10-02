// O RELATÓRIO PERSONALIZADO NA TELA (o "Personalizado" do Viper).
//
// Três telas: a lista dos relatórios salvos, o editor (nome, fonte, colunas,
// filtros e ordem) e o relatório rodando. O editor só escolhe NOMES de campo,
// operadores e valores; quem confere e monta a consulta é o servidor
// (lib/relatorios/personalizado.js). A tabela, os totais e o CSV são os do
// catálogo (subs/catalogo.js), para os relatórios se lerem do mesmo jeito.
window.MavisRelatoriosPersonalizados = (function () {
  const TIPO_DO_CAMPO = { data: 'date', texto: 'text' };

  function estado(state) {
    state.relPersonalizado = state.relPersonalizado || { tela: 'lista' };
    return state.relPersonalizado;
  }

  const fonteDe = (dados, chave) => (dados.fontes || []).find((f) => f.key === chave) || null;
  const campoDe = (fonte, nome) => ((fonte && fonte.campos) || []).find((c) => c.campo === nome) || null;
  const dataBr = (iso) => {
    const s = String(iso || '');
    if (!s) return '';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  };

  function cabecalho(ctx, titulo, extra = '') {
    const { escapeHtml } = ctx;
    return `<section class="panel workspace-head"><div>${extra}<strong>${escapeHtml(titulo)}</strong></div></section>`;
  }

  function irPara(ctx, mudanca) {
    Object.assign(estado(ctx.state), mudanca);
    ctx.loadModule('reports');
  }

  // --------------------------------------------------------------------------
  // LISTA
  // --------------------------------------------------------------------------
  function lista(ctx, dados) {
    const { content, escapeHtml, confirmModal, api, showToast } = ctx;
    const relatorios = dados.relatorios || [];
    const podeCriar = (dados.fontes || []).length > 0;
    content.innerHTML = `
      <div class="workspace">
        ${cabecalho(ctx, 'Relatórios Personalizados')}
        <section class="panel">
          ${podeCriar ? '<div class="rel-pers-topo"><button type="button" id="relPersNovo">Novo relatório</button></div>' : ''}
          <div class="table-scroll">
            <table class="table">
              <thead><tr><th>Nome</th><th>Fonte de dados</th><th>Criado por</th><th>Última execução</th><th></th></tr></thead>
              <tbody>
                ${relatorios.length ? relatorios.map((r) => `
                  <tr>
                    <td><button type="button" class="rel-link" data-rel-pers-abrir="${escapeHtml(r.id)}">${escapeHtml(r.nome)}</button></td>
                    <td>${escapeHtml(r.fonteTitulo || r.fonte)}</td>
                    <td>${escapeHtml(r.criadoPorNome || '')}${r.compartilhado ? '' : ' <span class="muted">(só para mim)</span>'}</td>
                    <td>${escapeHtml(dataBr(r.ultimaExecucao))}</td>
                    <td><span class="rel-pers-acoes">
                      <button type="button" class="secondary" data-rel-pers-abrir="${escapeHtml(r.id)}">Abrir</button>
                      ${r.podeEditar ? `<button type="button" class="secondary" data-rel-pers-editar="${escapeHtml(r.id)}">Editar</button>
                      <button type="button" class="secondary" data-rel-pers-excluir="${escapeHtml(r.id)}">Excluir</button>` : ''}
                    </span></td>
                  </tr>`).join('') : '<tr><td colspan="5" class="muted">Nenhum relatório salvo.</td></tr>'}
              </tbody>
            </table>
          </div>
        </section>
      </div>`;
    content.querySelector('#relPersNovo')?.addEventListener('click', () => {
      const fonte = dados.fontes[0];
      irPara(ctx, { tela: 'editor', id: '', rascunho: novoRascunho(fonte) });
    });
    content.querySelectorAll('[data-rel-pers-abrir]').forEach((b) => b.addEventListener('click', () => {
      irPara(ctx, { tela: 'relatorio', id: b.dataset.relPersAbrir, periodo: {} });
    }));
    content.querySelectorAll('[data-rel-pers-editar]').forEach((b) => b.addEventListener('click', () => {
      const r = relatorios.find((x) => x.id === b.dataset.relPersEditar);
      if (!r) return;
      irPara(ctx, { tela: 'editor', id: r.id, rascunho: JSON.parse(JSON.stringify({ nome: r.nome, fonte: r.fonte, colunas: r.colunas, filtros: r.filtros, ordem: r.ordem, compartilhado: r.compartilhado })) });
    }));
    content.querySelectorAll('[data-rel-pers-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const r = relatorios.find((x) => x.id === b.dataset.relPersExcluir);
      if (!r || !(await confirmModal(`Excluir o relatório "${r.nome}"?`))) return;
      try {
        await api(`/api/reports/personalizados/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
        showToast('Relatório excluído.', 'success');
        irPara(ctx, { tela: 'lista' });
      } catch (erro) {
        showToast(erro.message || 'Não foi possível excluir.', 'error');
      }
    }));
  }

  function novoRascunho(fonte) {
    return {
      nome: '',
      fonte: fonte ? fonte.key : '',
      colunas: fonte ? fonte.campos.filter((c) => c.padrao).map((c) => c.campo) : [],
      filtros: [],
      ordem: [],
      compartilhado: true
    };
  }

  // --------------------------------------------------------------------------
  // EDITOR
  // --------------------------------------------------------------------------
  function opcoesDeCampo(ctx, fonte, selecionado, filtro = () => true) {
    const { escapeHtml } = ctx;
    return fonte.campos.filter(filtro).map((c) => `<option value="${escapeHtml(c.campo)}" ${c.campo === selecionado ? 'selected' : ''}>${escapeHtml(c.rotulo)}</option>`).join('');
  }

  function entradaDeValor(ctx, campo, valor, chave) {
    const { escapeHtml } = ctx;
    const tipo = TIPO_DO_CAMPO[campo.tipo] || 'number';
    return `<input type="${tipo}" ${tipo === 'number' ? 'step="any"' : ''} data-rel-pers-valor="${chave}" value="${escapeHtml(valor === undefined || valor === null ? '' : String(valor))}" />`;
  }

  function editor(ctx, dados) {
    const { content, escapeHtml, api, showToast } = ctx;
    const st = estado(ctx.state);
    const r = st.rascunho;
    const fonte = fonteDe(dados, r.fonte) || dados.fontes[0];
    if (!fonte) return irPara(ctx, { tela: 'lista' });
    const operadores = dados.operadores || {};
    const naoEscolhidos = fonte.campos.filter((c) => !r.colunas.includes(c.campo));

    content.innerHTML = `
      <div class="workspace">
        ${cabecalho(ctx, st.id ? 'Editar relatório personalizado' : 'Novo relatório personalizado', '<button type="button" class="secondary rel-voltar" data-rel-pers-voltar>‹ Personalizados</button>')}
        <section class="panel">
          <div class="rel-filtros-grade">
            <label>Nome<input type="text" maxlength="120" id="relPersNome" value="${escapeHtml(r.nome)}" /></label>
            <label>Fonte de dados
              <select id="relPersFonte">${dados.fontes.map((f) => `<option value="${escapeHtml(f.key)}" ${f.key === fonte.key ? 'selected' : ''}>${escapeHtml(f.titulo)}</option>`).join('')}</select>
            </label>
            <label class="rel-pers-check"><input type="checkbox" id="relPersCompartilhado" ${r.compartilhado ? 'checked' : ''} /> Compartilhar com a equipe</label>
          </div>
        </section>

        <section class="panel">
          <h3>Colunas</h3>
          <ol class="rel-pers-colunas">
            ${r.colunas.map((nome, i) => {
              const campo = campoDe(fonte, nome);
              return `<li>
                <span>${escapeHtml(campo ? campo.rotulo : nome)}</span>
                <span class="rel-pers-acoes">
                  <button type="button" class="secondary" data-rel-pers-subir="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
                  <button type="button" class="secondary" data-rel-pers-descer="${i}" ${i === r.colunas.length - 1 ? 'disabled' : ''} aria-label="Descer">↓</button>
                  <button type="button" class="secondary" data-rel-pers-tirar="${i}" aria-label="Remover">✕</button>
                </span>
              </li>`;
            }).join('')}
          </ol>
          ${naoEscolhidos.length ? `
            <div class="rel-pers-adicionar">
              <select id="relPersNovaColuna">${naoEscolhidos.map((c) => `<option value="${escapeHtml(c.campo)}">${escapeHtml(c.rotulo)}</option>`).join('')}</select>
              <button type="button" class="secondary" id="relPersAddColuna">Adicionar coluna</button>
            </div>` : ''}
        </section>

        <section class="panel">
          <h3>Filtros</h3>
          ${r.filtros.map((fl, i) => {
            const campo = campoDe(fonte, fl.campo) || fonte.campos[0];
            const semValor = ['vazio', 'preenchido'].includes(fl.operador);
            return `<div class="rel-pers-linha">
              <select data-rel-pers-filtro-campo="${i}">${opcoesDeCampo(ctx, fonte, campo.campo)}</select>
              <select data-rel-pers-filtro-operador="${i}">${campo.operadores.map((o) => `<option value="${o}" ${o === fl.operador ? 'selected' : ''}>${escapeHtml(operadores[o] || o)}</option>`).join('')}</select>
              ${semValor ? '' : entradaDeValor(ctx, campo, fl.valor, `${i}:valor`)}
              ${fl.operador === 'entre' ? `<span>e</span>${entradaDeValor(ctx, campo, fl.valor2, `${i}:valor2`)}` : ''}
              <button type="button" class="secondary" data-rel-pers-tirar-filtro="${i}" aria-label="Remover filtro">✕</button>
            </div>`;
          }).join('')}
          <button type="button" class="secondary" id="relPersAddFiltro">Adicionar filtro</button>
        </section>

        <section class="panel">
          <h3>Ordem</h3>
          ${r.ordem.map((o, i) => `<div class="rel-pers-linha">
              <select data-rel-pers-ordem-campo="${i}">${opcoesDeCampo(ctx, fonte, o.campo)}</select>
              <select data-rel-pers-ordem-direcao="${i}">
                <option value="asc" ${o.direcao !== 'desc' ? 'selected' : ''}>Crescente</option>
                <option value="desc" ${o.direcao === 'desc' ? 'selected' : ''}>Decrescente</option>
              </select>
              <button type="button" class="secondary" data-rel-pers-tirar-ordem="${i}" aria-label="Remover ordem">✕</button>
            </div>`).join('')}
          <button type="button" class="secondary" id="relPersAddOrdem">Adicionar ordem</button>
        </section>

        <section class="panel">
          <div class="rel-filtros-acoes" style="margin-top:0;padding-top:0;border-top:0;">
            <div><button type="button" id="relPersSalvar">Salvar</button>
              <button type="button" class="secondary" data-rel-pers-voltar>Cancelar</button></div>
          </div>
        </section>
      </div>`;

    const redesenhar = () => editor(ctx, dados);
    content.querySelectorAll('[data-rel-pers-voltar]').forEach((b) => b.addEventListener('click', () => irPara(ctx, { tela: 'lista' })));
    // Texto e marcação mudam o rascunho sem redesenhar: redesenhar tiraria o
    // foco do campo a cada letra digitada.
    content.querySelector('#relPersNome').addEventListener('input', (e) => { r.nome = e.target.value; });
    content.querySelector('#relPersCompartilhado').addEventListener('change', (e) => { r.compartilhado = e.target.checked; });
    content.querySelector('#relPersFonte').addEventListener('change', (e) => {
      // Outra fonte, outros campos: colunas, filtros e ordem da anterior não
      // existem nela.
      const nova = fonteDe(dados, e.target.value);
      Object.assign(r, { ...novoRascunho(nova), nome: r.nome, compartilhado: r.compartilhado });
      redesenhar();
    });
    const mover = (i, delta) => {
      const j = i + delta;
      [r.colunas[i], r.colunas[j]] = [r.colunas[j], r.colunas[i]];
      redesenhar();
    };
    content.querySelectorAll('[data-rel-pers-subir]').forEach((b) => b.addEventListener('click', () => mover(Number(b.dataset.relPersSubir), -1)));
    content.querySelectorAll('[data-rel-pers-descer]').forEach((b) => b.addEventListener('click', () => mover(Number(b.dataset.relPersDescer), 1)));
    content.querySelectorAll('[data-rel-pers-tirar]').forEach((b) => b.addEventListener('click', () => { r.colunas.splice(Number(b.dataset.relPersTirar), 1); redesenhar(); }));
    content.querySelector('#relPersAddColuna')?.addEventListener('click', () => {
      r.colunas.push(content.querySelector('#relPersNovaColuna').value);
      redesenhar();
    });

    content.querySelector('#relPersAddFiltro').addEventListener('click', () => {
      const campo = fonte.campos[0];
      r.filtros.push({ campo: campo.campo, operador: campo.operadores[0], valor: '' });
      redesenhar();
    });
    content.querySelectorAll('[data-rel-pers-filtro-campo]').forEach((s) => s.addEventListener('change', () => {
      const i = Number(s.dataset.relPersFiltroCampo);
      const campo = campoDe(fonte, s.value);
      r.filtros[i] = { campo: campo.campo, operador: campo.operadores[0], valor: '' };
      redesenhar();
    }));
    content.querySelectorAll('[data-rel-pers-filtro-operador]').forEach((s) => s.addEventListener('change', () => {
      r.filtros[Number(s.dataset.relPersFiltroOperador)].operador = s.value;
      redesenhar();
    }));
    content.querySelectorAll('[data-rel-pers-valor]').forEach((input) => input.addEventListener('input', () => {
      const [i, chave] = input.dataset.relPersValor.split(':');
      r.filtros[Number(i)][chave] = input.value;
    }));
    content.querySelectorAll('[data-rel-pers-tirar-filtro]').forEach((b) => b.addEventListener('click', () => { r.filtros.splice(Number(b.dataset.relPersTirarFiltro), 1); redesenhar(); }));

    content.querySelector('#relPersAddOrdem').addEventListener('click', () => {
      r.ordem.push({ campo: r.colunas[0] || fonte.campos[0].campo, direcao: 'asc' });
      redesenhar();
    });
    content.querySelectorAll('[data-rel-pers-ordem-campo]').forEach((s) => s.addEventListener('change', () => { r.ordem[Number(s.dataset.relPersOrdemCampo)].campo = s.value; }));
    content.querySelectorAll('[data-rel-pers-ordem-direcao]').forEach((s) => s.addEventListener('change', () => { r.ordem[Number(s.dataset.relPersOrdemDirecao)].direcao = s.value; }));
    content.querySelectorAll('[data-rel-pers-tirar-ordem]').forEach((b) => b.addEventListener('click', () => { r.ordem.splice(Number(b.dataset.relPersTirarOrdem), 1); redesenhar(); }));

    content.querySelector('#relPersSalvar').addEventListener('click', async (e) => {
      const botao = e.currentTarget;
      botao.disabled = true;
      try {
        const corpo = JSON.stringify({ ...r, fonte: fonte.key });
        const resposta = st.id
          ? await api(`/api/reports/personalizados/${encodeURIComponent(st.id)}`, { method: 'PUT', body: corpo })
          : await api('/api/reports/personalizados', { method: 'POST', body: corpo });
        showToast('Relatório salvo.', 'success');
        irPara(ctx, { tela: 'relatorio', id: resposta.relatorio.id, periodo: {} });
      } catch (erro) {
        botao.disabled = false;
        showToast(erro.message || 'Não foi possível salvar.', 'error');
      }
    });
  }

  // --------------------------------------------------------------------------
  // O RELATÓRIO RODANDO
  // --------------------------------------------------------------------------
  async function relatorio(ctx, dados) {
    const { content, escapeHtml, api } = ctx;
    const st = estado(ctx.state);
    const salvo = (dados.relatorios || []).find((r) => r.id === st.id);
    if (!salvo) return irPara(ctx, { tela: 'lista' });
    const fonte = fonteDe(dados, salvo.fonte);
    const catalogo = window.MavisRelatoriosCatalogo;
    st.periodo = st.periodo || {};
    const voltar = '<button type="button" class="secondary rel-voltar" data-rel-pers-voltar>‹ Personalizados</button>';

    content.innerHTML = `<div class="workspace">${cabecalho(ctx, salvo.nome, voltar)}<section class="panel"><p class="muted">Carregando...</p></section></div>`;
    content.querySelector('[data-rel-pers-voltar]').addEventListener('click', () => irPara(ctx, { tela: 'lista' }));

    let r;
    try {
      r = await api(`/api/reports/personalizados/${encodeURIComponent(salvo.id)}/executar?${catalogo.query(st.periodo)}`);
    } catch (erro) {
      content.innerHTML = `<div class="workspace">${cabecalho(ctx, salvo.nome, voltar)}<section class="panel"><p class="form-error">${escapeHtml(erro.message || 'Não foi possível montar o relatório.')}</p></section></div>`;
      content.querySelector('[data-rel-pers-voltar]').addEventListener('click', () => irPara(ctx, { tela: 'lista' }));
      return;
    }

    const periodo = fonte && fonte.temPeriodo ? `
      <label>De<input type="date" data-rel-pers-periodo="de" value="${escapeHtml(st.periodo.de || '')}" /></label>
      <label>Até<input type="date" data-rel-pers-periodo="ate" value="${escapeHtml(st.periodo.ate || '')}" /></label>` : '';
    content.innerHTML = `
      <div class="workspace">
        ${cabecalho(ctx, salvo.nome, voltar)}
        <section class="panel rel-filtros">
          ${periodo ? `<div class="rel-filtros-grade">${periodo}</div>` : ''}
          <div class="rel-filtros-acoes"${periodo ? '' : ' style="margin-top:0;padding-top:0;border-top:0;"'}>
            <div>${periodo ? '<button type="button" id="relPersAplicar">Aplicar</button>' : ''}
              <button type="button" class="secondary" id="relPersAtualizar">Atualizar</button>
              ${salvo.podeEditar ? '<button type="button" class="secondary" id="relPersEditar">Editar</button>' : ''}</div>
            <div>
              <button type="button" class="secondary" id="relPersExportar">Excel (CSV)</button>
              <button type="button" class="secondary" id="relPersImprimir">Imprimir</button>
            </div>
          </div>
        </section>
        ${r.limitado ? `<section class="panel"><p class="form-error">O resultado passou de ${Number(r.limiteDeLinhas).toLocaleString('pt-BR')} linhas e foi cortado. Use um filtro ou um período menor.</p></section>` : ''}
        ${catalogo.tabela(ctx, r)}
      </div>`;

    const ler = () => content.querySelectorAll('[data-rel-pers-periodo]').forEach((i) => { st.periodo[i.dataset.relPersPeriodo] = i.value; });
    content.querySelector('[data-rel-pers-voltar]').addEventListener('click', () => irPara(ctx, { tela: 'lista' }));
    content.querySelector('#relPersAplicar')?.addEventListener('click', () => { ler(); ctx.loadModule('reports'); });
    content.querySelector('#relPersAtualizar').addEventListener('click', () => ctx.loadModule('reports'));
    content.querySelector('#relPersImprimir').addEventListener('click', () => window.print());
    content.querySelector('#relPersEditar')?.addEventListener('click', () => {
      irPara(ctx, { tela: 'editor', id: salvo.id, rascunho: JSON.parse(JSON.stringify({ nome: salvo.nome, fonte: salvo.fonte, colunas: salvo.colunas, filtros: salvo.filtros, ordem: salvo.ordem, compartilhado: salvo.compartilhado })) });
    });
    content.querySelector('#relPersExportar').addEventListener('click', () => {
      ler();
      catalogo.baixar(ctx, `/api/reports/personalizados/${encodeURIComponent(salvo.id)}/executar/export?${catalogo.query(st.periodo)}`, 'relatorio-personalizado.csv');
    });
  }

  async function desenhar(ctx) {
    const { content, escapeHtml, api } = ctx;
    let dados;
    try {
      dados = await api('/api/reports/personalizados');
    } catch (erro) {
      content.innerHTML = `<div class="panel"><h3>Relatórios Personalizados</h3><p class="muted">${escapeHtml(erro.message || 'Não foi possível carregar.')}</p></div>`;
      return;
    }
    const st = estado(ctx.state);
    if (st.tela === 'editor' && st.rascunho) return editor(ctx, dados);
    if (st.tela === 'relatorio' && st.id) return relatorio(ctx, dados);
    return lista(ctx, dados);
  }

  return { desenhar };
}());
