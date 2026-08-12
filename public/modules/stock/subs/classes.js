window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

/**
 * Catálogo de classes de produto — COR e, no futuro, VOLTAGEM/TAMANHO.
 *
 * DUAS CAMADAS NUMA TELA SÓ
 * -------------------------
 * A classe ("Cor") e seus valores ("Preto", "Branco") são tabelas diferentes,
 * mas ninguém cadastra uma sem a outra: criar "Cor" e ter de navegar para outra
 * tela para dizer quais cores existem seria duas viagens para uma tarefa. Por
 * isso cada classe é um cartão com seus valores dentro.
 *
 * O QUE NÃO ESTÁ AQUI: quais cores CADA PRODUTO tem. Isso é atribuição, fica no
 * cadastro do produto. Este catálogo é global — a cor "Preto" é a mesma para
 * todo mundo, e cadastrá-la uma vez basta.
 *
 * EXCLUIR x DESATIVAR
 * -------------------
 * O servidor recusa excluir o que está em uso (FK), e está certo: movimentos
 * antigos apontam para o valor, e apagá-lo deixaria saldo órfão. A tela oferece
 * desativar como saída — some das listas de escolha, o histórico continua
 * íntegro. Por isso a listagem pede `?todas=1`: sem os inativos, desativar
 * faria a classe sumir da tela sem nenhum caminho de volta.
 */
window.MavisSubscreenRegistry.stock.classes = async function renderStockClasses(ctx) {
  const { content, api, showToast, state, loadModule, confirmModal } = ctx;
  const S = window.MavisStock;

  // De onde o usuário veio. O cadastro de produto manda para cá quando falta
  // uma cor; sem isto ele voltaria para a lista de produtos e teria de
  // reencontrar o que estava editando.
  // Consumido na leitura, como stockEditProductId: se ficasse guardado, entrar
  // nesta tela pelo menu meses depois ainda ofereceria "voltar ao produto".
  const voltarPara = state.stockClassesVoltarPara || null;
  state.stockClassesVoltarPara = null;

  let catalogo = [];

  async function carregar() {
    try {
      const res = await api('/api/stock/classes?todas=1');
      catalogo = res.classes || [];
    } catch (error) {
      showToast(error.message || 'Erro ao carregar as classes.', 'error');
      catalogo = [];
    }
  }

  // ------------------------------------------------------------------ modais

  function fecharModal() {
    document.getElementById('classeModal')?.remove();
    document.removeEventListener('keydown', aoTeclar);
  }

  function aoTeclar(event) {
    if (event.key === 'Escape') fecharModal();
  }

  function abrirModal(titulo, corpoHtml, aoConfirmar) {
    fecharModal();
    const overlay = document.createElement('div');
    overlay.id = 'classeModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>${S.escape(titulo)}</h3>
        <form id="classeModalForm">
          <div class="modal-body form-grid">${corpoHtml}</div>
          <div class="modal-actions">
            <button type="button" class="btn-muted" id="classeModalCancel">Cancelar</button>
            <button type="submit">Salvar</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) fecharModal(); });
    document.getElementById('classeModalCancel')?.addEventListener('click', fecharModal);
    document.addEventListener('keydown', aoTeclar);
    document.querySelector('#classeModalForm input')?.focus();

    document.getElementById('classeModalForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const botao = event.target.querySelector('button[type="submit"]');
      if (botao?.disabled) return;
      if (botao) botao.disabled = true;
      try {
        await aoConfirmar(new FormData(event.target));
        fecharModal();
        await render();
      } catch (error) {
        showToast(error.message || 'Erro ao salvar.', 'error');
        if (botao) botao.disabled = false;
      }
    });
  }

  function modalClasse(classe) {
    abrirModal(classe ? 'Editar classe' : 'Nova classe', `
      <label>Nome<input name="name" required maxlength="60" value="${S.escape(classe?.name || '')}" placeholder="Cor" /></label>
      <label>Descrição <span class="muted">(opcional)</span>
        <input name="description" maxlength="120" value="${S.escape(classe?.description || '')}" placeholder="Aparece no cadastro do produto" />
      </label>
    `, async (formData) => {
      const payload = {
        name: String(formData.get('name') || '').trim(),
        description: String(formData.get('description') || '').trim()
      };
      if (classe) {
        await api(`/api/stock/classes/${encodeURIComponent(classe.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Classe atualizada.', 'success');
      } else {
        await api('/api/stock/classes', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Classe criada.', 'success');
      }
    });
  }

  function modalValor(classe, valor) {
    const temHex = Boolean(valor?.hex);
    abrirModal(valor ? `Editar valor de ${classe.name}` : `Novo valor de ${classe.name}`, `
      <label>Nome<input name="name" required maxlength="60" value="${S.escape(valor?.name || '')}" placeholder="Preto" /></label>
      <label>Código <span class="muted">(opcional)</span>
        <input name="code" maxlength="20" value="${S.escape(valor?.code || '')}" placeholder="PRT" />
      </label>
      <!-- A amostra é opcional de propósito. <input type="color"> nunca vem
           vazio: sem esta marcação todo valor nasceria preto, e um quadrado
           preto ao lado de "Branco" é pior do que quadrado nenhum. -->
      <label class="classe-hex-linha">
        <input type="checkbox" name="temHex" id="classeTemHex" ${temHex ? 'checked' : ''} />
        Mostrar amostra de cor
      </label>
      <label id="classeHexCampo" ${temHex ? '' : 'hidden'}>Amostra
        <input type="color" name="hex" value="${S.escape(valor?.hex || '#000000')}" />
      </label>
    `, async (formData) => {
      const hex = formData.get('temHex') ? String(formData.get('hex') || '') : '';
      const payload = {
        classId: classe.id,
        name: String(formData.get('name') || '').trim(),
        code: String(formData.get('code') || '').trim(),
        // null limpa a amostra; {hex} define. Mandar undefined manteria a
        // antiga, e desmarcar a caixa não teria efeito nenhum.
        metadata: hex ? { hex } : null
      };
      if (valor) {
        await api(`/api/stock/classes/valores/${encodeURIComponent(valor.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Valor atualizado.', 'success');
      } else {
        await api('/api/stock/classes/valores', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Valor criado.', 'success');
      }
    });

    document.getElementById('classeTemHex')?.addEventListener('change', (event) => {
      const campo = document.getElementById('classeHexCampo');
      if (campo) campo.hidden = !event.target.checked;
    });
  }

  // ------------------------------------------------------------------ ações

  // Excluir e desativar são coisas diferentes e a tela não pode confundi-las:
  // excluir some com o cadastro, desativar só tira das listas de escolha. O
  // servidor recusa excluir o que está em uso — a mensagem dele já explica o
  // porquê e sugere desativar, então ela é repassada inteira.
  async function excluir(url, pergunta) {
    const confirmado = await confirmModal(pergunta);
    if (!confirmado) return;
    try {
      await api(url, { method: 'DELETE' });
      showToast('Excluído.', 'success');
      await render();
    } catch (error) {
      showToast(error.message || 'Não foi possível excluir.', 'error');
    }
  }

  async function alternarAtivo(url, ativo, rotulo) {
    try {
      await api(url, { method: 'PUT', body: JSON.stringify({ active: ativo }) });
      showToast(ativo ? `${rotulo} reativado.` : `${rotulo} desativado.`, 'success');
      await render();
    } catch (error) {
      showToast(error.message || 'Erro ao alterar.', 'error');
    }
  }

  // ------------------------------------------------------------------ tela

  function cartaoClasse(classe) {
    const valores = classe.valores || [];
    return `
      <section class="classe-cartao ${classe.active === false ? 'is-inativa' : ''}">
        <header class="classe-cartao-head">
          <div>
            <strong>${S.escape(classe.name)}</strong>
            ${classe.active === false ? S.badge('Inativa', 'muted') : ''}
            ${classe.description ? `<p class="muted">${S.escape(classe.description)}</p>` : ''}
          </div>
          <div class="classe-cartao-acoes">
            <button type="button" class="secondary finance-pill-sm" data-classe-valor-novo="${S.escape(classe.id)}">+ Valor</button>
            <button type="button" class="icon-button edit" data-classe-editar="${S.escape(classe.id)}" title="Editar classe">${S.editIcon}</button>
            <button type="button" class="secondary finance-pill-sm" data-classe-ativo="${S.escape(classe.id)}" data-ativo="${classe.active === false ? '1' : '0'}">
              ${classe.active === false ? 'Reativar' : 'Desativar'}
            </button>
            <button type="button" class="icon-button" data-classe-excluir="${S.escape(classe.id)}" title="Excluir classe">${S.trashIcon}</button>
          </div>
        </header>
        ${valores.length ? `
          <div class="table-scroll">
            <table class="table table-actions">
              <thead><tr><th>Valor</th><th>Código</th><th>Situação</th><th>Ações</th></tr></thead>
              <tbody>
                ${valores.map((valor) => `
                  <tr class="${valor.active === false ? 'is-inativa' : ''}">
                    <td>
                      ${valor.hex ? `<span class="classe-amostra" style="background:${S.escape(valor.hex)}"></span>` : ''}
                      ${S.escape(valor.name)}
                    </td>
                    <td>${S.escape(valor.code || '-')}</td>
                    <td>${valor.active === false ? S.badge('Inativo', 'muted') : S.badge('Ativo', 'success')}</td>
                    <td>
                      <button type="button" class="icon-button edit" data-valor-editar="${S.escape(valor.id)}" data-classe="${S.escape(classe.id)}" title="Editar">${S.editIcon}</button>
                      <button type="button" class="secondary finance-pill-sm" data-valor-ativo="${S.escape(valor.id)}" data-ativo="${valor.active === false ? '1' : '0'}">
                        ${valor.active === false ? 'Reativar' : 'Desativar'}
                      </button>
                      <button type="button" class="icon-button" data-valor-excluir="${S.escape(valor.id)}" title="Excluir">${S.trashIcon}</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<p class="muted">Nenhum valor cadastrado ainda. Sem valores, esta classe não aparece como opção no produto.</p>'}
      </section>
    `;
  }

  async function render() {
    fecharModal();
    await carregar();

    const acoes = `
      ${voltarPara ? '<button type="button" class="secondary" id="classeVoltar">Voltar ao produto</button>' : ''}
      <button type="button" id="classeNova">Nova classe</button>
    `;

    content.innerHTML = `
      <div class="panel">
        ${S.pageHead('Classes de Produto',
          'Cor, voltagem, tamanho. Cada valor passa a ter saldo de estoque próprio — o mesmo produto em preto e em branco são dois saldos.',
          acoes)}
        <p class="muted">
          Aqui se cadastra o catálogo, que vale para todos os produtos.
          <strong>Quais</strong> cores cada produto tem se define no cadastro do produto.
        </p>
      </div>

      ${catalogo.length ? catalogo.map(cartaoClasse).join('') : `
        <div class="panel">
          <p class="muted">Nenhuma classe cadastrada. Comece criando "Cor" e, dentro dela, as cores que você usa.</p>
        </div>
      `}
    `;

    document.getElementById('classeNova')?.addEventListener('click', () => modalClasse(null));

    document.getElementById('classeVoltar')?.addEventListener('click', () => {
      // O produto é recarregado do servidor ao voltar, então as cores criadas
      // aqui já aparecem na lista de atribuição.
      state.stockEditProductId = voltarPara.productId || null;
      state.activeSub = voltarPara.sub || 'products';
      // Sempre 'stock': quando esta tela roda dentro de Cadastros, o proxy de
      // lá traduz o módulo e a sub-tela. Nomear 'cadastros' aqui duplicaria
      // esse mapeamento em dois lugares.
      loadModule('stock');
    });

    content.querySelectorAll('[data-classe-editar]').forEach((btn) => {
      btn.addEventListener('click', () => modalClasse(catalogo.find((c) => c.id === btn.dataset.classeEditar)));
    });

    content.querySelectorAll('[data-classe-valor-novo]').forEach((btn) => {
      btn.addEventListener('click', () => modalValor(catalogo.find((c) => c.id === btn.dataset.classeValorNovo), null));
    });

    content.querySelectorAll('[data-classe-ativo]').forEach((btn) => {
      btn.addEventListener('click', () => alternarAtivo(
        `/api/stock/classes/${encodeURIComponent(btn.dataset.classeAtivo)}`,
        btn.dataset.ativo === '1',
        'Classe'
      ));
    });

    content.querySelectorAll('[data-classe-excluir]').forEach((btn) => {
      const classe = catalogo.find((c) => c.id === btn.dataset.classeExcluir);
      btn.addEventListener('click', () => excluir(
        `/api/stock/classes/${encodeURIComponent(btn.dataset.classeExcluir)}`,
        `Excluir a classe "${classe?.name || ''}"? Se algum produto a usar, a exclusão será recusada — nesse caso, desative.`
      ));
    });

    content.querySelectorAll('[data-valor-editar]').forEach((btn) => {
      const classe = catalogo.find((c) => c.id === btn.dataset.classe);
      const valor = (classe?.valores || []).find((v) => v.id === btn.dataset.valorEditar);
      btn.addEventListener('click', () => modalValor(classe, valor));
    });

    content.querySelectorAll('[data-valor-ativo]').forEach((btn) => {
      btn.addEventListener('click', () => alternarAtivo(
        `/api/stock/classes/valores/${encodeURIComponent(btn.dataset.valorAtivo)}`,
        btn.dataset.ativo === '1',
        'Valor'
      ));
    });

    content.querySelectorAll('[data-valor-excluir]').forEach((btn) => {
      btn.addEventListener('click', () => excluir(
        `/api/stock/classes/valores/${encodeURIComponent(btn.dataset.valorExcluir)}`,
        'Excluir este valor? Se algum produto o usar, a exclusão será recusada — nesse caso, desative.'
      ));
    });
  }

  await render();
};
