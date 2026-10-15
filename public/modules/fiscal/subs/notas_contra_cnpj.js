// NOTAS EMITIDAS CONTRA O NOSSO CNPJ — Distribuição de DF-e (fase AR).
//
// O que a SEFAZ tem contra os nossos CNPJs, e o que fazemos a respeito.
//
// MANIFESTAR E DAR ENTRADA SÃO DOIS PASSOS, E DOIS BOTÕES (14/10/2026). Pedido
// do usuário: o "Manifestar" abre uma janela por cima da lista (antes o
// formulário nascia no fim da página, abaixo de dezenas de notas, e o clique
// parecia não fazer nada); e, manifestada a Ciência ou a Confirmação, aparece
// "Dar entrada", que abre Compras › Entrada de NF-e com o XML desta nota para
// conferir itens, depósito e contas a pagar antes de lançar. Antes, a
// Confirmação lançava a entrada sozinha, sem conferência.
//
// A manifestação acontece na SEFAZ e NÃO SE DESFAZ; o lançamento usa a MESMA
// rota da tela de Notas de Entrada, e ao lançar a nota fica ligada à entrada
// (/api/fiscal/dfe/:id/entrada), que é o que muda a coluna para "lançada".
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

window.MavisSubscreenRegistry.fiscal.notas_contra_cnpj = async function renderNotasContraCnpj(ctx) {
  const { content, api, showToast, confirmModal, escapeHtml, state } = ctx;
  const catalogo = window.MavisManifestacao;

  const tela = state.dfe = state.dfe || {
    cnpjFiltro: '', busca: null, manifestando: null, ocupado: false
  };
  // PESQUISA E FILTROS DA LISTA (15/10/2026, pedido do usuário: "um campo de
  // pesquisa e botão de filtros aqui também: data, nome, empresa"). A lista
  // inteira já está na tela (/api/fiscal/dfe), então filtrar é na hora.
  tela.pesquisa = tela.pesquisa || '';
  // + manifestação e situação (15/10/2026, pedido do usuário: "botão de
  // ordenação e filtro para organizar").
  const FILTROS_VAZIOS = { de: '', ate: '', nome: '', empresa: '', manifestacao: '', situacao: '' };
  tela.filtros = { ...FILTROS_VAZIOS, ...(tela.filtros || {}) };
  tela.filtrosAbertos = Boolean(tela.filtrosAbertos);
  // A ORDEM DA LISTA: pelo seletor "Ordenar" ou clicando no título da coluna
  // (o mesmo clique da lista de produtos). Começa pelas mais recentes.
  tela.ordem = tela.ordem || { campo: 'data', direcao: 'desc' };

  let dados = { documentos: [], empresas: [], ponteiros: {}, focusConfigurado: false };

  const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  // Data e hora no formato do print, sem depender de fuso: o que vem do banco
  // já é o instante certo, e passá-lo por toLocaleString num navegador em outro
  // fuso mostraria a nota num dia que não é o da emissão.
  function dataHora(iso) {
    if (!iso) return '-';
    const texto = String(iso);
    const [d, h] = texto.split('T');
    if (!d) return '-';
    const [a, m, dia] = d.split('-');
    return `${dia}/${m}/${a}${h ? ' - ' + h.slice(0, 5) : ''}`;
  }

  const cnpjFormatado = (v) => {
    const s = String(v || '').replace(/\D/g, '');
    if (s.length !== 14) return s || '-';
    return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
  };

  // A filial da nota pelo CNPJ destinatário (15/10/2026): o nome ATUAL do
  // estabelecimento, que diz qual filial é. As notas gravadas antes guardaram a
  // razão social, igual em todas as filiais da Plus.
  const nomeDaFilial = (doc) => {
    const cnpj = String(doc.cnpjDestinatario || '').replace(/\D/g, '');
    const daLista = (dados.empresas || []).find((e) => String(e.cnpj || '').replace(/\D/g, '') === cnpj);
    return (daLista && daLista.nome) || doc.empresaNome || cnpjFormatado(doc.cnpjDestinatario);
  };

  const soDigitos = (v) => String(v || '').replace(/\D/g, '');
  const semAcento = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  // O número da nota está na chave: posições 26 a 34 (nNF).
  const numeroDaNota = (chave) => {
    const c = soDigitos(chave);
    return c.length === 44 ? String(Number(c.slice(25, 34))) : '';
  };

  function docsFiltrados() {
    const f = tela.filtros;
    const texto = String(tela.pesquisa || '').trim();
    const q = semAcento(texto);
    // CNPJ, chave e número com ou sem pontuação.
    const qDigitos = /^[\d.\-/\s]+$/.test(texto) ? soDigitos(texto) : '';
    return (dados.documentos || []).filter((doc) => {
      const dia = String(doc.dataEmissao || '').slice(0, 10);
      if (f.de && dia && dia < f.de) return false;
      if (f.ate && dia && dia > f.ate) return false;
      if (f.empresa && soDigitos(doc.cnpjDestinatario) !== f.empresa) return false;
      if (f.nome && !semAcento(doc.emitenteNome).includes(semAcento(f.nome))) return false;
      if (f.manifestacao === 'nao' && doc.manifestacaoCodigo) return false;
      if (f.manifestacao && f.manifestacao !== 'nao' && doc.manifestacaoCodigo !== f.manifestacao) return false;
      if (f.situacao && String(doc.situacao || 'autorizada') !== f.situacao) return false;
      if (!q) return true;
      if ([doc.emitenteNome, nomeDaFilial(doc)].some((t) => semAcento(t).includes(q))) return true;
      if (!qDigitos) return false;
      if (numeroDaNota(doc.chave) === String(Number(qDigitos))) return true;
      return qDigitos.length >= 3 && [doc.emitenteDocumento, doc.chave, doc.cnpjDestinatario].some((v) => soDigitos(v).includes(qDigitos));
    });
  }

  // AS ORDENS: o rótulo da coluna e o valor que se compara. Empate sai pela
  // data, das mais recentes para as antigas.
  const MANIFESTACAO_PESO = { '': 0, 210210: 1, 210200: 2, 210240: 3, 210220: 4 };
  const ORDENAVEIS = {
    emitente: { rotulo: 'De (emitente)', valor: (d) => semAcento(d.emitenteNome) },
    destinatario: { rotulo: 'Para (destinatário)', valor: (d) => semAcento(nomeDaFilial(d)) },
    numero: { rotulo: 'Nº', valor: (d) => Number(numeroDaNota(d.chave) || 0) },
    data: { rotulo: 'Data', valor: (d) => String(d.dataEmissao || '') },
    valor: { rotulo: 'Valor', valor: (d) => Number(d.valorTotal || 0) },
    nsu: { rotulo: 'NSU', valor: (d) => Number(d.nsu || 0) },
    manifestacao: { rotulo: 'Manifestado', valor: (d) => MANIFESTACAO_PESO[d.manifestacaoCodigo || ''] ?? 9 }
  };
  // O seletor "Ordenar" (as combinações de uso diário, num clique).
  const ORDENS_DO_SELETOR = [
    { valor: 'data:desc', rotulo: 'Mais recentes' },
    { valor: 'data:asc', rotulo: 'Mais antigas' },
    { valor: 'valor:desc', rotulo: 'Maior valor' },
    { valor: 'valor:asc', rotulo: 'Menor valor' },
    { valor: 'emitente:asc', rotulo: 'Emitente (A–Z)' },
    { valor: 'destinatario:asc', rotulo: 'Empresa (A–Z)' },
    { valor: 'numero:desc', rotulo: 'Número da nota' },
    { valor: 'manifestacao:asc', rotulo: 'Não manifestadas primeiro' }
  ];
  function docsOrdenados(docs) {
    const def = ORDENAVEIS[tela.ordem.campo] || ORDENAVEIS.data;
    const sinal = tela.ordem.direcao === 'asc' ? 1 : -1;
    return docs.slice().sort((a, b) => {
      const va = def.valor(a);
      const vb = def.valor(b);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR');
      if (cmp) return cmp * sinal;
      return String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || ''));
    });
  }
  function tituloOrdenavel(campo) {
    const def = ORDENAVEIS[campo];
    const ativa = tela.ordem.campo === campo;
    const seta = ativa ? (tela.ordem.direcao === 'asc' ? '▲' : '▼') : '';
    const proxima = ativa && tela.ordem.direcao === 'asc' ? 'decrescente' : 'crescente';
    return `<th aria-sort="${ativa ? (tela.ordem.direcao === 'asc' ? 'ascending' : 'descending') : 'none'}">
      <button type="button" class="lista-ordenar ${ativa ? 'is-ativa' : ''}" data-dfe-ordenar="${campo}" title="Ordenar por ${escapeHtml(def.rotulo)} em ordem ${proxima}">
        <span>${escapeHtml(def.rotulo)}</span><span class="lista-ordenar-seta" aria-hidden="true">${seta}</span>
      </button></th>`;
  }

  function blocoPesquisa(total, achadas) {
    const f = tela.filtros;
    const filtrando = Boolean(String(tela.pesquisa || '').trim() || f.de || f.ate || f.nome || f.empresa || f.manifestacao || f.situacao);
    const ordemAtual = `${tela.ordem.campo}:${tela.ordem.direcao}`;
    return `
      <form id="dfePesquisa" class="cadastro-busca-rapida dfe-pesquisa" role="search">
        <input id="dfePesquisaTexto" value="${escapeHtml(tela.pesquisa)}" placeholder="Emitente, CNPJ, número ou chave" aria-label="Pesquisar notas por emitente, CNPJ, número ou chave" autocomplete="off" />
        <button type="submit">Buscar</button>
        <button type="button" class="secondary" id="dfeFiltrosBtn" aria-expanded="${tela.filtrosAbertos}">Filtros</button>
        <label class="dfe-ordem">Ordenar
          <select id="dfeOrdem">
            ${ORDENS_DO_SELETOR.some((o) => o.valor === ordemAtual) ? '' : `<option value="${escapeHtml(ordemAtual)}" selected>${escapeHtml((ORDENAVEIS[tela.ordem.campo] || {}).rotulo || '')} ${tela.ordem.direcao === 'asc' ? '▲' : '▼'}</option>`}
            ${ORDENS_DO_SELETOR.map((o) => `<option value="${o.valor}" ${o.valor === ordemAtual ? 'selected' : ''}>${escapeHtml(o.rotulo)}</option>`).join('')}
          </select>
        </label>
      </form>
      ${tela.filtrosAbertos ? `
        <form id="dfeFiltros" class="dfe-filtros">
          <label>Data inicial<input type="date" name="de" value="${escapeHtml(f.de)}" /></label>
          <label>Data final<input type="date" name="ate" value="${escapeHtml(f.ate)}" /></label>
          <label>Nome do emitente<input name="nome" value="${escapeHtml(f.nome)}" autocomplete="off" /></label>
          <label>Empresa (destinatária)
            <select name="empresa">
              <option value="">Todas</option>
              ${(dados.empresas || []).map((e) => `<option value="${escapeHtml(soDigitos(e.cnpj))}" ${f.empresa === soDigitos(e.cnpj) ? 'selected' : ''}>${escapeHtml(e.nome)} — ${cnpjFormatado(e.cnpj)}</option>`).join('')}
            </select>
          </label>
          <label>Manifestação
            <select name="manifestacao">
              <option value="">Todas</option>
              <option value="nao" ${f.manifestacao === 'nao' ? 'selected' : ''}>Não manifestadas</option>
              ${catalogo.CATALOGO.map((m) => `<option value="${m.codigo}" ${f.manifestacao === m.codigo ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
            </select>
          </label>
          <label>Situação
            <select name="situacao">
              <option value="">Todas</option>
              <option value="autorizada" ${f.situacao === 'autorizada' ? 'selected' : ''}>Autorizada</option>
              <option value="cancelada" ${f.situacao === 'cancelada' ? 'selected' : ''}>Cancelada</option>
            </select>
          </label>
          <div class="dfe-filtros-acoes">
            <button type="submit">Filtrar</button>
            <button type="button" class="secondary" id="dfeLimparFiltros">Limpar</button>
          </div>
        </form>` : ''}
      ${filtrando ? `<p class="muted dfe-contagem">${achadas.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} notas</p>` : ''}`;
  }

  async function carregar() {
    try {
      const query = tela.cnpjFiltro ? `?cnpj=${encodeURIComponent(tela.cnpjFiltro)}` : '';
      dados = await api(`/api/fiscal/dfe${query}`);
    } catch (erro) {
      content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar: ${escapeHtml(erro.message || 'erro desconhecido')}</p></div>`;
      return;
    }
    desenhar();
  }

  // ---------------------------------------------------------------- a busca
  // A busca usa o token DE CADA ESTABELECIMENTO (focusNfe.forEstabelecimento).
  // O aviso diz quais estão sem — antes dizia "Focus não configurada" olhando
  // só o .env, com a Focus funcionando em produção (12/10/2026).
  function avisoDeToken() {
    const semToken = (dados.empresas || []).filter((e) => !e.temToken);
    if (!dados.focusConfigurado) {
      return '<p class="finance-badge finance-badge-warning">Nenhum estabelecimento tem token da Focus NFe — a busca na SEFAZ vai recusar até o token ser cadastrado.</p>';
    }
    if (!semToken.length) return '';
    return `<p class="finance-badge finance-badge-warning">Sem token da Focus NFe: ${semToken.map((e) => escapeHtml(e.nome)).join(', ')}.</p>`;
  }

  function blocoBusca() {
    if (!tela.busca) return '';
    const modo = tela.busca.modo;
    return `
      <section class="panel">
        <h4>Buscar notas na SEFAZ</h4>
        <div class="row">
          <label>Empresa
            <select id="dfeEmpresa">
              <option value="">— escolha —</option>
              ${dados.empresas.map((e) => `
                <option value="${escapeHtml(e.id)}" ${tela.busca.empresaId === e.id ? 'selected' : ''} ${e.temToken === false ? 'disabled' : ''}>
                  ${escapeHtml(e.nome)} — ${cnpjFormatado(e.cnpj)}${e.temToken === false ? ' (sem token da Focus)' : ''}
                </option>
              `).join('')}
            </select>
          </label>
          <label>Tipo de busca na SEFAZ
            <select id="dfeModo">
              <option value="ultimo-nsu" ${modo === 'ultimo-nsu' ? 'selected' : ''}>A partir do último NSU sincronizado</option>
              <option value="tres-meses" ${modo === 'tres-meses' ? 'selected' : ''}>NSUs dos últimos 3 meses</option>
              <option value="tudo" ${modo === 'tudo' ? 'selected' : ''}>Todas as notas (desde o início)</option>
              <option value="nsu" ${modo === 'nsu' ? 'selected' : ''}>NSU específico</option>
              <option value="chave" ${modo === 'chave' ? 'selected' : ''}>Chave de acesso específica</option>
            </select>
          </label>
          ${modo === 'nsu' ? `<label>NSU<input type="number" id="dfeNsu" min="1" value="${escapeHtml(String(tela.busca.nsu || ''))}" /></label>` : ''}
          ${modo === 'chave' ? `<label>Chave de acesso<input type="text" id="dfeChave" maxlength="44" placeholder="44 dígitos" value="${escapeHtml(tela.busca.chave || '')}" /></label>` : ''}
        </div>
        ${blocoPonteiro()}
        <div class="row">
          <button type="button" id="dfeBuscar" ${tela.ocupado ? 'disabled' : ''}>${tela.ocupado && !tela.todas ? 'Consultando a SEFAZ…' : 'Buscar'}</button>
          <button type="button" class="secondary" id="dfeFecharBusca">Fechar</button>
        </div>
      </section>
    `;
  }

  // O ponteiro dito em voz alta: "a partir do último NSU" sem dizer qual é o
  // último é um botão que não conta de onde parte.
  function blocoPonteiro() {
    const empresa = dados.empresas.find((e) => e.id === tela.busca.empresaId);
    if (!empresa) return '';
    const p = dados.ponteiros[String(empresa.cnpj || '').replace(/\D/g, '')];
    if (!p) return '';
    const falta = p.maxNsu > p.ultimoNsu;
    return `
      <p class="muted">
        Sincronizado até o NSU <strong>${p.ultimoNsu}</strong>${p.maxNsu ? ` de <strong>${p.maxNsu}</strong>` : ''}.
        ${p.sincronizadoEm ? `Última busca em ${dataHora(p.sincronizadoEm)}.` : 'Nunca sincronizado.'}
        ${falta ? '<span class="finance-badge finance-badge-warning">ainda há notas a buscar</span>' : ''}
      </p>
    `;
  }

  // -------------------------------------------------------------- a listagem
  function badgeManifestado(doc) {
    if (!doc.manifestacaoCodigo) return '<span class="finance-badge finance-badge-danger">Não</span>';
    const evento = catalogo.obter(doc.manifestacaoCodigo);
    return `<span class="finance-badge finance-badge-${evento.tom}">Sim</span>`;
  }

  // Ciência e Confirmação liberam o XML: dá para dar entrada. As outras duas
  // dizem que a nota não é nossa ou não aconteceu — não se lança.
  const podeDarEntrada = (doc) => Boolean(doc.manifestacaoCodigo) && catalogo.liberaXml(doc.manifestacaoCodigo) && !doc.entradaId;

  function colunaEntrada(doc) {
    if (doc.entradaId) return '<span class="finance-badge finance-badge-success">lançada</span>';
    if (podeDarEntrada(doc)) return '<span class="finance-badge finance-badge-warning">pendente</span>';
    if (doc.manifestacaoCodigo) return '<span class="muted">não se aplica</span>';
    return '<span class="muted">-</span>';
  }

  function acoesDaNota(doc) {
    if (!doc.manifestacaoCodigo) {
      return `<button type="button" class="secondary" data-manifestar="${escapeHtml(doc.id)}">Manifestar</button>`;
    }
    if (podeDarEntrada(doc)) {
      return `<button type="button" data-dar-entrada="${escapeHtml(doc.id)}">Dar entrada</button>`;
    }
    return '<span class="muted">-</span>';
  }

  function desenhar() {
    const docs = docsOrdenados(docsFiltrados());
    const total = (dados.documentos || []).length;
    content.innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <h3>Notas emitidas contra CNPJ</h3>
          <div class="dfe-acoes-topo">
            <button type="button" class="secondary" id="dfeAtualizarTodas" ${tela.ocupado ? 'disabled' : ''}>${tela.todas ? `Atualizando ${tela.todas.feitas + 1} de ${tela.todas.total}…` : 'Atualizar todas as empresas'}</button>
            <button type="button" id="dfeAbrirBusca">Buscar documentos na SEFAZ</button>
          </div>
        </div>
        ${avisoDeToken()}
        ${blocoBusca()}
        ${blocoPesquisa(total, docs.length)}
        <div class="table-scroll">
          <table class="table table-actions">
            <thead>
              <tr>
                <!-- De quem é a nota e para quem vai (15/10/2026, pedido do usuário). -->
                ${tituloOrdenavel('emitente')}${tituloOrdenavel('destinatario')}${tituloOrdenavel('numero')}
                <th>Chave de Acesso</th>${tituloOrdenavel('data')}${tituloOrdenavel('valor')}${tituloOrdenavel('nsu')}
                ${tituloOrdenavel('manifestacao')}<th>Tipo Manifestação</th><th>Entrada</th><th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${docs.length ? docs.map((doc) => `
                <tr>
                  <td class="dfe-parte"><strong>${escapeHtml(doc.emitenteNome || '-')}</strong><span class="muted">${cnpjFormatado(doc.emitenteDocumento)}</span></td>
                  <td class="dfe-parte"><strong>${escapeHtml(nomeDaFilial(doc))}</strong><span class="muted">${cnpjFormatado(doc.cnpjDestinatario)}</span></td>
                  <td>${escapeHtml(numeroDaNota(doc.chave) || '-')}</td>
                  <td><code>${escapeHtml(doc.chave)}</code></td>
                  <td>${dataHora(doc.dataEmissao)}</td>
                  <td>${dinheiro(doc.valorTotal)}</td>
                  <td>${doc.nsu == null ? '-' : doc.nsu}</td>
                  <td>${badgeManifestado(doc)}</td>
                  <td>${doc.manifestacaoCodigo
                      ? `${escapeHtml(doc.manifestacaoCodigo)} - ${escapeHtml(catalogo.rotulo(doc.manifestacaoCodigo))}`
                      : '<span class="muted">-</span>'}</td>
                  <td>${colunaEntrada(doc)}</td>
                  <td class="finance-extrato-actions">${acoesDaNota(doc)}</td>
                </tr>
              `).join('') : (total
                ? '<tr><td colspan="12" class="muted">Nenhuma nota com essa pesquisa ou filtros.</td></tr>'
                : '<tr><td colspan="12" class="muted">Nenhuma nota buscada ainda. Use “Buscar documentos na SEFAZ”.</td></tr>')}
            </tbody>
          </table>
        </div>
      </div>
      ${blocoManifestacao()}
    `;
    ligarEventos();
  }

  // --------------------------------------------------------- a manifestação
  function blocoManifestacao() {
    if (!tela.manifestando) return '';
    const doc = dados.documentos.find((d) => d.id === tela.manifestando.id);
    if (!doc) return '';
    const escolhido = catalogo.obter(tela.manifestando.tipo);
    const exigeJustificativa = escolhido.value === 'desconhecimento' || escolhido.value === 'nao-realizada';
    return `
      <div class="modal-overlay" id="dfeManifestacaoModal">
      <section class="modal modal-lg">
        <h3>Manifestar o documento selecionado</h3>
        <p class="muted">
          ${escapeHtml(doc.emitenteNome || '')} · ${dinheiro(doc.valorTotal)}<br />
          <code>${escapeHtml(doc.chave)}</code>
        </p>
        <div class="row">
          <label>Tipo de manifestação
            <select id="dfeTipoManifestacao">
              <option value="">— escolha —</option>
              ${catalogo.CATALOGO.map((m) => `
                <option value="${m.value}" ${tela.manifestando.tipo === m.value ? 'selected' : ''}>${escapeHtml(m.label)}</option>
              `).join('')}
            </select>
          </label>
        </div>
        ${tela.manifestando.tipo ? `<p class="muted">${escapeHtml(escolhido.descricao)}</p>` : ''}
        ${exigeJustificativa ? `
          <label>Justificativa (a SEFAZ exige, mínimo 15 caracteres)
            <textarea id="dfeJustificativa" rows="2">${escapeHtml(tela.manifestando.justificativa || '')}</textarea>
          </label>` : ''}
        <div class="modal-actions">
          <button type="button" class="secondary" id="dfeCancelarManifestacao">Cancelar</button>
          <button type="button" id="dfeConfirmarManifestacao" ${tela.ocupado ? 'disabled' : ''}>
            ${tela.ocupado ? 'Enviando à SEFAZ…' : 'Manifestar'}
          </button>
        </div>
      </section>
      </div>
    `;
  }

  /**
   * Manifesta e, quando o evento é Confirmação, encadeia o lançamento.
   *
   * A ORDEM IMPORTA e é irreversível no primeiro passo — ver o cabeçalho do
   * arquivo. Por isso a confirmação avisa o que vai acontecer ANTES: depois de
   * a SEFAZ aceitar, não há como voltar atrás por aqui.
   */
  async function manifestar() {
    const doc = dados.documentos.find((d) => d.id === tela.manifestando.id);
    const evento = catalogo.obter(tela.manifestando.tipo);
    if (!tela.manifestando.tipo) {
      showToast('Escolha o tipo de manifestação.', 'warning');
      return;
    }
    const aviso = `Manifestar "${evento.label}"? Isto é um evento fiscal e não se desfaz.`;
    if (!await confirmModal(aviso)) return;

    try {
      tela.ocupado = true;
      desenhar();
      const resposta = await api(`/api/fiscal/dfe/${encodeURIComponent(doc.id)}/manifestar`, {
        method: 'POST',
        body: JSON.stringify({ tipo: tela.manifestando.tipo, justificativa: tela.manifestando.justificativa || '' })
      });
      tela.manifestando = null;
      // A entrada agora é um botão na lista ("Dar entrada"), com conferência.
      showToast(catalogo.liberaXml(evento.value)
        ? `Manifestada como "${evento.label}". Use “Dar entrada” na lista para lançar a nota.`
        : `Manifestada como "${evento.label}".`, 'success');
      if (catalogo.liberaXml(evento.value) && !resposta.temXml) {
        showToast('A SEFAZ ainda não liberou o XML completo desta nota; o “Dar entrada” funciona quando ele chegar.', 'warning');
      }
    } catch (erro) {
      showToast(erro.message || 'Erro ao manifestar.', 'error');
    } finally {
      tela.ocupado = false;
      await carregar();
    }
  }

  /**
   * "Dar entrada": abre Compras › Entrada de NF-e com o XML desta nota, para
   * conferir itens, depósito e contas a pagar antes de lançar. Ao lançar, a
   * tela de entrada liga a entrada a este documento (ver entrada_nfe.js).
   */
  function darEntrada(documentoId) {
    if (!(state.user?.allowedModules || []).includes('purchases')) {
      showToast('Dar entrada é do módulo Compras, que não está liberado para você.', 'warning');
      return;
    }
    const doc = dados.documentos.find((d) => d.id === documentoId);
    state.entradaNfeDoDfe = { dfeId: documentoId, chave: doc ? doc.chave : '' };
    state.activeModule = 'purchases';
    state.activeSub = 'entrada_nfe';
    if (typeof renderApp === 'function') renderApp();
    ctx.loadModule('purchases');
  }

  // ----------------------------------------------------------------- eventos
  function ligarEventos() {
    document.getElementById('dfePesquisa')?.addEventListener('submit', (e) => {
      e.preventDefault();
      tela.pesquisa = String(document.getElementById('dfePesquisaTexto')?.value || '').trim();
      desenhar();
    });
    document.getElementById('dfeFiltrosBtn')?.addEventListener('click', () => {
      tela.pesquisa = String(document.getElementById('dfePesquisaTexto')?.value || '').trim();
      tela.filtrosAbertos = !tela.filtrosAbertos;
      desenhar();
    });
    document.getElementById('dfeFiltros')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      tela.filtros = {
        de: String(fd.get('de') || ''), ate: String(fd.get('ate') || ''),
        nome: String(fd.get('nome') || '').trim(), empresa: String(fd.get('empresa') || ''),
        manifestacao: String(fd.get('manifestacao') || ''), situacao: String(fd.get('situacao') || '')
      };
      tela.pesquisa = String(document.getElementById('dfePesquisaTexto')?.value || '').trim();
      desenhar();
    });
    document.getElementById('dfeLimparFiltros')?.addEventListener('click', () => {
      tela.filtros = { ...FILTROS_VAZIOS };
      tela.pesquisa = '';
      desenhar();
    });
    // ORDENAR: o seletor e o clique no título (mesma coluna inverte; outra
    // começa crescente, como na lista de produtos).
    document.getElementById('dfeOrdem')?.addEventListener('change', (e) => {
      const [campo, direcao] = String(e.target.value || 'data:desc').split(':');
      tela.ordem = { campo, direcao };
      tela.pesquisa = String(document.getElementById('dfePesquisaTexto')?.value || '').trim();
      desenhar();
    });
    content.querySelectorAll('[data-dfe-ordenar]').forEach((botao) => {
      botao.addEventListener('click', () => {
        const campo = botao.dataset.dfeOrdenar;
        tela.ordem = tela.ordem.campo === campo
          ? { campo, direcao: tela.ordem.direcao === 'asc' ? 'desc' : 'asc' }
          : { campo, direcao: 'asc' };
        desenhar();
      });
    });
    document.getElementById('dfeAbrirBusca')?.addEventListener('click', () => {
      tela.busca = tela.busca || { modo: 'ultimo-nsu', empresaId: dados.empresas[0]?.id || '' };
      desenhar();
    });
    document.getElementById('dfeFecharBusca')?.addEventListener('click', () => { tela.busca = null; desenhar(); });
    document.getElementById('dfeEmpresa')?.addEventListener('change', (e) => { tela.busca.empresaId = e.target.value; desenhar(); });
    document.getElementById('dfeModo')?.addEventListener('change', (e) => { tela.busca.modo = e.target.value; desenhar(); });
    document.getElementById('dfeNsu')?.addEventListener('input', (e) => { tela.busca.nsu = e.target.value; });
    document.getElementById('dfeChave')?.addEventListener('input', (e) => { tela.busca.chave = e.target.value; });

    document.getElementById('dfeBuscar')?.addEventListener('click', async () => {
      if (!tela.busca.empresaId) {
        showToast('Escolha a empresa cujo CNPJ será consultado.', 'warning');
        return;
      }
      try {
        tela.ocupado = true;
        desenhar();
        const r = await api('/api/fiscal/dfe/buscar', {
          method: 'POST',
          body: JSON.stringify({
            empresaId: tela.busca.empresaId, modo: tela.busca.modo,
            nsu: tela.busca.nsu, chave: tela.busca.chave
          })
        });
        const resumo = `${r.encontrados} ${r.encontrados === 1 ? 'documento' : 'documentos'} · ${r.novos} ${r.novos === 1 ? 'novo' : 'novos'}`
          + (r.manifestacoesAtualizadas ? ` · ${r.manifestacoesAtualizadas} ${r.manifestacoesAtualizadas === 1 ? 'manifestação atualizada' : 'manifestações atualizadas'} pela SEFAZ` : '')
          + (r.chavesCompletadas ? ` · ${r.chavesCompletadas} ${r.chavesCompletadas === 1 ? 'entrada importada ganhou a chave' : 'entradas importadas ganharam a chave'}` : '');
        showToast(r.faltaBuscar ? `${resumo}. Ainda há notas a buscar — repita a busca.` : `${resumo}.`, 'success');
      } catch (erro) {
        showToast(erro.message || 'Erro ao consultar a SEFAZ.', 'error');
      } finally {
        tela.ocupado = false;
        await carregar();
      }
    });

    // TODAS AS EMPRESAS DE UMA VEZ (15/10/2026, pedido do usuário: "verifique
    // pela SEFAZ todas as notas antigas que já foram manifestadas e atualize
    // elas no MavisONE"). Uma busca "desde o início" por empresa, uma depois da
    // outra (cada uma pagina até 5.000 versões; o que passar disso continua
    // do ponteiro). A manifestação que a SEFAZ já tem entra na nota (ver
    // registrarManifestacaoDaSefaz). Empresa que falhar não para as outras.
    document.getElementById('dfeAtualizarTodas')?.addEventListener('click', async () => {
      const empresas = dados.empresas.filter((e) => e.temToken !== false);
      if (!empresas.length) return;
      const soma = { encontrados: 0, novos: 0, manifestacoes: 0 };
      const falhas = [];
      tela.ocupado = true;
      tela.todas = { feitas: 0, total: empresas.length };
      desenhar();
      for (const empresa of empresas) {
        try {
          let modo = 'tudo';
          for (let volta = 0; volta < 20; volta += 1) {
            const r = await api('/api/fiscal/dfe/buscar', { method: 'POST', body: JSON.stringify({ empresaId: empresa.id, modo }) });
            soma.encontrados += r.encontrados || 0;
            soma.novos += r.novos || 0;
            soma.manifestacoes += r.manifestacoesAtualizadas || 0;
            if (!r.faltaBuscar) break;
            modo = 'ultimo-nsu';
          }
        } catch (erro) {
          falhas.push(`${empresa.nome}: ${erro.message || erro}`);
        }
        tela.todas.feitas += 1;
        desenhar();
      }
      tela.ocupado = false;
      tela.todas = null;
      showToast(`${empresas.length - falhas.length} de ${empresas.length} empresas · ${soma.encontrados} notas · ${soma.novos} novas · ${soma.manifestacoes} ${soma.manifestacoes === 1 ? 'manifestação atualizada' : 'manifestações atualizadas'}`
        + (falhas.length ? `. Sem resposta: ${falhas.join(' | ')}` : '.'), falhas.length ? 'warning' : 'success', falhas.length ? 15000 : undefined);
      await carregar();
    });

    document.querySelectorAll('[data-manifestar]').forEach((botao) => {
      botao.addEventListener('click', () => {
        tela.manifestando = { id: botao.dataset.manifestar, tipo: '', justificativa: '' };
        desenhar();
      });
    });
    document.getElementById('dfeTipoManifestacao')?.addEventListener('change', (e) => {
      tela.manifestando.tipo = e.target.value;
      desenhar();
    });
    document.getElementById('dfeJustificativa')?.addEventListener('input', (e) => {
      tela.manifestando.justificativa = e.target.value;
    });
    document.getElementById('dfeConfirmarManifestacao')?.addEventListener('click', manifestar);
    document.getElementById('dfeCancelarManifestacao')?.addEventListener('click', () => {
      tela.manifestando = null;
      desenhar();
    });

    document.querySelectorAll('[data-dar-entrada]').forEach((botao) => {
      botao.addEventListener('click', () => darEntrada(botao.dataset.darEntrada));
    });
    // Fora da janela fecha (Cancelar também).
    document.getElementById('dfeManifestacaoModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'dfeManifestacaoModal' && !tela.ocupado) { tela.manifestando = null; desenhar(); }
    });
  }

  await carregar();
};
