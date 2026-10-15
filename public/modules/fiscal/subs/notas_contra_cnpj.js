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
              <option value="nsu" ${modo === 'nsu' ? 'selected' : ''}>NSU específico</option>
              <option value="chave" ${modo === 'chave' ? 'selected' : ''}>Chave de acesso específica</option>
            </select>
          </label>
          ${modo === 'nsu' ? `<label>NSU<input type="number" id="dfeNsu" min="1" value="${escapeHtml(String(tela.busca.nsu || ''))}" /></label>` : ''}
          ${modo === 'chave' ? `<label>Chave de acesso<input type="text" id="dfeChave" maxlength="44" placeholder="44 dígitos" value="${escapeHtml(tela.busca.chave || '')}" /></label>` : ''}
        </div>
        ${blocoPonteiro()}
        <div class="row">
          <button type="button" id="dfeBuscar" ${tela.ocupado ? 'disabled' : ''}>${tela.ocupado ? 'Consultando a SEFAZ…' : 'Buscar'}</button>
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
    const docs = dados.documentos;
    content.innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <h3>Notas emitidas contra CNPJ</h3>
          <button type="button" id="dfeAbrirBusca">Buscar documentos na SEFAZ</button>
        </div>
        ${avisoDeToken()}
        ${blocoBusca()}
        <div class="table-scroll">
          <table class="table table-actions">
            <thead>
              <tr>
                <th>Empresa</th><th>CNPJ Emissor</th><th>Nome Emissor</th>
                <th>Chave de Acesso</th><th>Data</th><th>Valor</th><th>NSU</th>
                <th>Manifestado</th><th>Tipo Manifestação</th><th>Entrada</th><th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${docs.length ? docs.map((doc) => `
                <tr>
                  <td>${escapeHtml(nomeDaFilial(doc))}</td>
                  <td>${cnpjFormatado(doc.emitenteDocumento)}</td>
                  <td>${escapeHtml(doc.emitenteNome || '-')}</td>
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
              `).join('') : '<tr><td colspan="11" class="muted">Nenhuma nota buscada ainda. Use “Buscar documentos na SEFAZ”.</td></tr>'}
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
          + (r.chavesCompletadas ? ` · ${r.chavesCompletadas} ${r.chavesCompletadas === 1 ? 'entrada importada ganhou a chave' : 'entradas importadas ganharam a chave'}` : '');
        showToast(r.faltaBuscar ? `${resumo}. Ainda há notas a buscar — repita a busca.` : `${resumo}.`, 'success');
      } catch (erro) {
        showToast(erro.message || 'Erro ao consultar a SEFAZ.', 'error');
      } finally {
        tela.ocupado = false;
        await carregar();
      }
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
