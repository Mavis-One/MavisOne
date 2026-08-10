// Peças comuns das telas de documento fiscal (eventos, inutilização, logs).
//
// Vive aqui, e não em finance/, porque as telas do Fiscal não podem depender da
// ordem em que o index.html carrega outro módulo: `fiscalFormatCnpjSimples`
// existe hoje dentro de emitir_nfe_focus.js, e usar aquilo daqui amarraria o
// Fiscal a um arquivo do Financeiro continuar carregado antes.
window.MavisFiscalDocs = (function () {
  const TIPOS_EVENTO = {
    CCE: { label: 'Carta de Correção', tom: 'info' },
    CANCELAMENTO: { label: 'Cancelamento', tom: 'danger' },
    INUTILIZACAO: { label: 'Inutilização', tom: 'warning' }
  };

  function soDigitos(valor) {
    return String(valor || '').replace(/\D/g, '');
  }

  function cnpj(valor) {
    const d = soDigitos(valor);
    if (d.length !== 14) return String(valor || '');
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }

  function dataHora(valor) {
    if (!valor) return '-';
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return String(valor);
    return d.toLocaleString('pt-BR');
  }

  // Carrega os estabelecimentos e lembra o escolhido entre as telas do módulo:
  // trocar de Eventos para Logs sem reescolher a empresa é o comportamento
  // esperado por quem está investigando uma nota.
  async function carregarEstabelecimentos(ctx, { somenteEmitentes = false } = {}) {
    const { api, state } = ctx;
    let lista = [];
    let erro = null;
    try {
      const res = await api('/api/fiscal/estabelecimentos');
      lista = (res.estabelecimentos || []).filter((e) => e.ativo && (!somenteEmitentes || e.emiteNfe));
    } catch (e) {
      erro = e.message || 'Não foi possível carregar os estabelecimentos.';
    }
    const lembrado = state.fiscalEstabelecimentoId;
    const escolhido = lista.some((e) => e.id === lembrado) ? lembrado : (lista[0]?.id || '');
    state.fiscalEstabelecimentoId = escolhido;
    return { lista, escolhido, erro };
  }

  // Mesmo desenho de carregarEstabelecimentos, um nível acima: regra fiscal é
  // por EMPRESA (o CNPJ raiz), não por estabelecimento — as filiais de um
  // mesmo grupo compartilham a tributação.
  async function carregarEmpresas(ctx) {
    const { api, state } = ctx;
    let lista = [];
    let erro = null;
    try {
      const res = await api('/api/fiscal/empresas');
      lista = (res.empresas || []).filter((e) => e.ativo);
    } catch (e) {
      erro = e.message || 'Não foi possível carregar as empresas.';
    }
    const lembrada = state.fiscalEmpresaId;
    const escolhida = lista.some((e) => e.id === lembrada) ? lembrada : (lista[0]?.id || '');
    state.fiscalEmpresaId = escolhida;
    return { lista, escolhida, erro };
  }

  function seletorEmpresa(escapeHtml, lista, escolhida, id = 'fiscalEmpresaSelect') {
    if (lista.length <= 1) return '';
    return `
      <label class="fiscal-estab-select">Empresa
        <select id="${id}">
          ${lista.map((e) => `<option value="${escapeHtml(e.id)}" ${e.id === escolhida ? 'selected' : ''}>${escapeHtml(e.razaoSocial)}</option>`).join('')}
        </select>
      </label>`;
  }

  function ligarSeletorEmpresa(ctx, redesenhar, id = 'fiscalEmpresaSelect') {
    const el = ctx.content.querySelector('#' + id);
    if (!el) return;
    el.addEventListener('change', () => {
      ctx.state.fiscalEmpresaId = el.value;
      redesenhar();
    });
  }

  function semEmpresa(escapeHtml, titulo, erro) {
    return `
      <div class="panel">
        <h3>${escapeHtml(titulo)}</h3>
        <p class="muted">${escapeHtml(erro || 'Nenhuma empresa cadastrada.')}</p>
        <p class="muted">Cadastre uma em Configurações → Fiscal → Empresas e estabelecimentos.</p>
      </div>`;
  }

  function seletorEstabelecimento(escapeHtml, lista, escolhido, id = 'fiscalEstabSelect') {
    if (lista.length <= 1) return '';
    return `
      <label class="fiscal-estab-select">Estabelecimento
        <select id="${id}">
          ${lista.map((e) => `<option value="${escapeHtml(e.id)}" ${e.id === escolhido ? 'selected' : ''}>${escapeHtml(e.razaoSocial)} — ${escapeHtml(cnpj(e.cnpj))}</option>`).join('')}
        </select>
      </label>`;
  }

  // Liga o seletor: guarda a escolha e redesenha a tela atual.
  function ligarSeletor(ctx, redesenhar, id = 'fiscalEstabSelect') {
    const el = ctx.content.querySelector('#' + id);
    if (!el) return;
    el.addEventListener('change', () => {
      ctx.state.fiscalEstabelecimentoId = el.value;
      redesenhar();
    });
  }

  function semEstabelecimento(escapeHtml, titulo, erro) {
    return `
      <div class="panel">
        <h3>${escapeHtml(titulo)}</h3>
        <p class="muted">${escapeHtml(erro || 'Nenhum estabelecimento cadastrado.')}</p>
        <p class="muted">Cadastre um em Configurações → Fiscal → Empresas e estabelecimentos.</p>
      </div>`;
  }

  function rotuloTipo(tipo) {
    return TIPOS_EVENTO[tipo] || { label: tipo || '-', tom: 'info' };
  }

  // JSON cru do que foi enviado e do que voltou. É o que resolve uma rejeição
  // da SEFAZ: sem isso, sobra "erro de autorização" e nada mais.
  function blocoJson(escapeHtml, titulo, valor) {
    if (valor === null || valor === undefined) {
      return `<div class="fiscal-json-bloco"><h5>${escapeHtml(titulo)}</h5><p class="muted">Nada registrado.</p></div>`;
    }
    let texto;
    try { texto = JSON.stringify(valor, null, 2); } catch { texto = String(valor); }
    return `
      <div class="fiscal-json-bloco">
        <h5>${escapeHtml(titulo)}</h5>
        <pre class="fiscal-json">${escapeHtml(texto)}</pre>
      </div>`;
  }

  // Alterna o detalhe de uma linha de tabela. Usado por Eventos e por Logs.
  function ligarDetalhes(ctx, seletor = '[data-detalhe]') {
    ctx.content.querySelectorAll(seletor).forEach((botao) => {
      botao.addEventListener('click', () => {
        const alvo = ctx.content.querySelector(`[data-detalhe-de="${botao.dataset.detalhe}"]`);
        if (!alvo) return;
        const abrindo = alvo.hasAttribute('hidden');
        if (abrindo) alvo.removeAttribute('hidden');
        else alvo.setAttribute('hidden', '');
        botao.setAttribute('aria-expanded', String(abrindo));
        botao.textContent = abrindo ? 'Ocultar' : 'Detalhes';
      });
    });
  }

  return {
    TIPOS_EVENTO,
    soDigitos,
    cnpj,
    dataHora,
    carregarEstabelecimentos,
    seletorEstabelecimento,
    ligarSeletor,
    semEstabelecimento,
    carregarEmpresas,
    seletorEmpresa,
    ligarSeletorEmpresa,
    semEmpresa,
    rotuloTipo,
    blocoJson,
    ligarDetalhes
  };
})();
