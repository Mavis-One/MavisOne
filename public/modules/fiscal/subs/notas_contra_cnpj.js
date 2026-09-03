// NOTAS EMITIDAS CONTRA O NOSSO CNPJ — Distribuição de DF-e (fase AR).
//
// O que a SEFAZ tem contra os nossos CNPJs, e o que fazemos a respeito.
//
// A TELA ENCADEIA TRÊS PASSOS quando a manifestação é "Confirmação da operação":
// manifestar → lançar a entrada → ligar as duas. São três requisições, e isso é
// deliberado, não preguiça:
//
//   A manifestação acontece na SEFAZ e NÃO SE DESFAZ. Se o lançamento falhar
//   depois dela, o estado "manifestada, ainda não lançada" é real — não é um
//   defeito desta tela. Fingir que os dois são uma operação só exigiria poder
//   desfazer um evento fiscal, e não se pode.
//
//   O lançamento usa a MESMA rota que a tela de Notas de Entrada usa quando uma
//   pessoa lança à mão. Um segundo caminho no servidor seria um segundo lugar
//   para o estoque entrar diferente.
//
// Quando o passo 2 falha, a nota fica na lista marcada como manifestada e sem
// entrada, com o botão de lançar disponível. Nada se perde; só não terminou.
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

window.MavisSubscreenRegistry.fiscal.notas_contra_cnpj = async function renderNotasContraCnpj(ctx) {
  const { content, api, showToast, confirmModal, escapeHtml, state } = ctx;
  const catalogo = window.MavisManifestacao;

  const tela = state.dfe = state.dfe || {
    cnpjFiltro: '', busca: null, manifestando: null, ocupado: false
  };

  let dados = { documentos: [], empresas: [], ponteiros: {}, focusConfigurado: false };

  const dinheiro = (v) => `R$ ${Number(v || 0).toFixed(2)}`;

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
                <option value="${escapeHtml(e.id)}" ${tela.busca.empresaId === e.id ? 'selected' : ''}>
                  ${escapeHtml(e.nome)} — ${cnpjFormatado(e.cnpj)}
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

  function colunaEntrada(doc) {
    if (doc.entradaId) return '<span class="finance-badge finance-badge-success">lançada</span>';
    const evento = catalogo.obter(doc.manifestacaoCodigo);
    if (doc.manifestacaoCodigo && !evento.geraEntrada) return '<span class="muted">não se aplica</span>';
    if (doc.manifestacaoCodigo && evento.geraEntrada) {
      return `<button type="button" class="secondary" data-lancar="${escapeHtml(doc.id)}">Lançar entrada</button>`;
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
        ${dados.focusConfigurado ? '' : `
          <p class="finance-badge finance-badge-warning">
            A Focus NFe não está configurada — a busca na SEFAZ vai recusar até o token do estabelecimento ser cadastrado.
          </p>`}
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
                  <td>${escapeHtml(doc.empresaNome || cnpjFormatado(doc.cnpjDestinatario))}</td>
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
                  <td class="finance-extrato-actions">
                    ${doc.manifestacaoCodigo
                      ? '<span class="muted">-</span>'
                      : `<button type="button" class="secondary" data-manifestar="${escapeHtml(doc.id)}">Manifestar</button>`}
                  </td>
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
      <section class="panel">
        <h4>Manifestar o documento selecionado</h4>
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
        <div class="row">
          <button type="button" id="dfeConfirmarManifestacao" ${tela.ocupado ? 'disabled' : ''}>
            ${tela.ocupado ? 'Enviando à SEFAZ…' : 'Manifestar'}
          </button>
          <button type="button" class="secondary" id="dfeCancelarManifestacao">Cancelar</button>
        </div>
      </section>
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
    const aviso = evento.geraEntrada
      ? `Confirmar a operação diz à SEFAZ que a mercadoria chegou, e o sistema vai lançar a nota como entrada — com estoque e contas a pagar. Manifestação não se desfaz. Continuar?`
      : `Manifestar "${evento.label}"? Isto é um evento fiscal e não se desfaz.`;
    if (!await confirmModal(aviso)) return;

    try {
      tela.ocupado = true;
      desenhar();
      const resposta = await api(`/api/fiscal/dfe/${encodeURIComponent(doc.id)}/manifestar`, {
        method: 'POST',
        body: JSON.stringify({ tipo: tela.manifestando.tipo, justificativa: tela.manifestando.justificativa || '' })
      });
      showToast(`Manifestada como "${evento.label}".`, 'success');
      tela.manifestando = null;

      if (resposta.geraEntrada) {
        if (!resposta.temXml) {
          showToast('A SEFAZ ainda não liberou o XML desta nota. Use “Lançar entrada” quando ele chegar.', 'warning');
        } else {
          await lancarEntrada(doc.id);
        }
      }
    } catch (erro) {
      showToast(erro.message || 'Erro ao manifestar.', 'error');
    } finally {
      tela.ocupado = false;
      await carregar();
    }
  }

  /**
   * Lança a nota como entrada, pela MESMA rota que a tela de Notas de Entrada
   * usa. Não manda `itens`: sem eles, o servidor vincula cada item pela
   * sugestão que ele mesmo calculou (GTIN, código do fornecedor, descrição) —
   * que é exatamente o "reconhecer os itens" pedido. Item que ele não
   * reconhecer fica sem produto e a entrada nasce "a revisar", sem mexer no
   * estoque daquele item. É o comportamento certo: inventar produto a partir de
   * uma nota de terceiro encheria o cadastro de duplicatas.
   */
  async function lancarEntrada(documentoId) {
    try {
      tela.ocupado = true;
      const { xml } = await api(`/api/fiscal/dfe/${encodeURIComponent(documentoId)}/xml`);
      const entrada = await api('/api/purchases/entrada-nfe', {
        method: 'POST',
        body: JSON.stringify({
          xml,
          gerarFinanceiro: true,
          atualizarCusto: true,
          depositoId: tela.depositoId || ''
        })
      });
      await api(`/api/fiscal/dfe/${encodeURIComponent(documentoId)}/entrada`, {
        method: 'POST',
        body: JSON.stringify({ entradaId: entrada.entrada?.id || entrada.id })
      });
      const partes = ['Entrada lançada'];
      if (entrada.estoque?.length) partes.push(`${entrada.estoque.length} ${entrada.estoque.length === 1 ? 'item entrou' : 'itens entraram'} no estoque`);
      if (entrada.financeiro?.length) partes.push(`${entrada.financeiro.length} ${entrada.financeiro.length === 1 ? 'conta a pagar criada' : 'contas a pagar criadas'}`);
      showToast(`${partes.join(' · ')}.`, 'success');
    } catch (erro) {
      // A manifestação já aconteceu e vale. Só o lançamento falhou, e ele se
      // repete pelo botão da lista — por isso o erro diz isso em voz alta.
      showToast(`${erro.message || 'Erro ao lançar a entrada'} — a manifestação valeu; use “Lançar entrada” na lista para tentar de novo.`, 'error');
    } finally {
      tela.ocupado = false;
    }
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
        const resumo = `${r.encontrados} ${r.encontrados === 1 ? 'documento' : 'documentos'} · ${r.novos} ${r.novos === 1 ? 'novo' : 'novos'}`;
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

    document.querySelectorAll('[data-lancar]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        await lancarEntrada(botao.dataset.lancar);
        await carregar();
      });
    });
  }

  await carregar();
};
