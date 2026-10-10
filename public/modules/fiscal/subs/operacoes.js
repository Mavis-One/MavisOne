window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// CATÁLOGO DE OPERAÇÕES FISCAIS (lib/operacaoFiscal.js) — consulta e edição.
//
// POR QUE ESTA TELA EXISTE
// ------------------------
// O catálogo decide três coisas que ninguém enxerga na hora de emitir:
//
//   finalidade         -> o finNFe que vai no XML (1 normal, 2 complementar,
//                         3 ajuste, 4 devolução). Errar isso é a SEFAZ recusar,
//                         ou pior: aceitar um documento que diz outra coisa.
//   movimenta estoque  -> uma NF-e Complementar de ICMS não entrega mercadoria.
//                         Tratá-la como venda baixaria produto que não saiu.
//   gera financeiro    -> transferência entre estabelecimentos próprios não é
//                         receita; bonificação sai do estoque e não vira
//                         recebível.
//
// EDITÁVEL DESDE 10/10/2026 (fase DW, pedido do usuário)
// ------------------------------------------------------
// Até aqui era só consulta, porque cada linha é um contrato que a emissão
// OBEDECE (`deveMovimentarEstoque`, `deveGerarFinanceiro`). Agora o lápis de
// cada linha abre o formulário, e o servidor grava a alteração POR CIMA do
// padrão do código (tabela operacao_fiscal_ajuste). O que impede combinação
// sem sentido não é esta tela, é o servidor: operacaoFiscal.validarAjuste
// recusa, por exemplo, devolução sem nota referenciada, ou "exige produto
// escritural" junto de "movimenta estoque".
//
// Só se editam as operações que existem: a chave (VENDA, DEVOLUCAO...) é
// contrato com o pedido, a regra fiscal e a nota. "Restaurar padrão" volta ao
// que está escrito no código.
const FINALIDADES = {
  1: { rotulo: 'Normal', ajuda: 'finNFe 1 — documenta uma operação nova.' },
  2: { rotulo: 'Complementar', ajuda: 'finNFe 2 — acrescenta valor a um documento que já existe.' },
  3: { rotulo: 'Ajuste', ajuda: 'finNFe 3 — NF-e de ajuste.' },
  4: { rotulo: 'Devolução', ajuda: 'finNFe 4 — devolve mercadoria de uma nota anterior.' }
};

// As colunas de bandeira, na ordem em que a pergunta aparece na vida real:
// primeiro o que a operação FAZ no sistema, depois o que ela EXIGE de quem
// emite.
const BANDEIRAS = [
  { chave: 'movimentaEstoque', titulo: 'Move estoque', ajuda: 'Baixa (ou devolve) quantidade no depósito.' },
  { chave: 'geraFinanceiro', titulo: 'Gera financeiro', ajuda: 'Cria conta a receber quando a nota é autorizada.' },
  { chave: 'exigeReferencia', titulo: 'Exige nota referenciada', ajuda: 'Sem a chave da nota original a SEFAZ recusa.' },
  { chave: 'exigeIcms', titulo: 'Exige ICMS', ajuda: 'A nota não faz sentido sem valor de ICMS destacado.' },
  { chave: 'permiteQuantidadeZero', titulo: 'Aceita qtd. zero', ajuda: 'O item pode ir sem quantidade — é o caso do complemento.' },
  { chave: 'permiteValorZero', titulo: 'Aceita valor zero', ajuda: 'O item pode ir sem valor unitário.' },
  { chave: 'exigeProdutoEscritural', titulo: 'Exige produto escritural', ajuda: 'Só aceita produto marcado como escritural no Cadastro.' }
];

window.MavisSubscreenRegistry.fiscal.operacoes = async function renderOperacoesFiscais(ctx) {
  const { api, content, escapeHtml, showToast, confirmModal } = ctx;

  let operacoes = [];
  // Chave da operação aberta no formulário (null = formulário fechado).
  let editando = null;

  async function carregar() {
    const res = await api('/api/fiscal/operacoes');
    operacoes = res.operacoes || [];
  }

  try {
    await carregar();
  } catch (error) {
    content.innerHTML = `<div class="panel"><h3>Operações Fiscais</h3><p class="muted">${escapeHtml(error.message || 'Não foi possível carregar as operações fiscais.')}</p></div>`;
    return;
  }

  // Catálogo vazio não acontece hoje (ele é constante no código), mas uma tela
  // que mostra cabeçalho e nenhuma linha faz a pessoa procurar o erro no lugar
  // errado — no cadastro dela, em vez de no sistema.
  if (!operacoes.length) {
    content.innerHTML = `
      <div class="panel workspace-pendente">
        <h3>Operações Fiscais</h3>
        <p>O servidor não devolveu nenhuma operação. O catálogo vive em
        <code>lib/operacaoFiscal.js</code> — se esta tela está vazia, é ali que falta.</p>
      </div>
    `;
    return;
  }

  const sim = '<span class="op-sim" title="Sim">Sim</span>';
  const nao = '<span class="op-nao" title="Não">—</span>';
  const iconeEditar = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';

  function linha(op) {
    const fin = FINALIDADES[op.finalidade] || { rotulo: `finNFe ${op.finalidade}`, ajuda: '' };
    return `
      <tr>
        <td>
          <button type="button" class="icon-button edit" data-editar-operacao="${escapeHtml(op.chave)}" title="Editar operação" aria-label="Editar operação ${escapeHtml(op.rotulo)}">${iconeEditar}</button>
        </td>
        <td>
          <strong>${escapeHtml(op.rotulo)}</strong>
          ${op.alterada ? '<span class="finance-badge finance-badge-info">alterada</span>' : ''}
          <small class="muted">${escapeHtml(op.chave)}</small>
        </td>
        <td>${escapeHtml(op.natureza || '—')}</td>
        <td title="${escapeHtml(fin.ajuda)}">${escapeHtml(fin.rotulo)}</td>
        ${BANDEIRAS.map((b) => `<td class="op-bandeira">${op[b.chave] ? sim : nao}</td>`).join('')}
      </tr>
    `;
  }

  function formulario() {
    const op = operacoes.find((o) => o.chave === editando);
    if (!op) return '';
    return `
      <div class="panel" id="fiscalOperacaoPainel">
        <div class="cadastro-page-head">
          <div>
            <h3>Editar operação fiscal — ${escapeHtml(op.chave)}</h3>
            ${op.alterada && op.alteradaPor ? `<p class="muted">Alterada por ${escapeHtml(op.alteradaPor)}${op.alteradaEm ? ' em ' + escapeHtml(new Date(op.alteradaEm).toLocaleString('pt-BR')) : ''}</p>` : ''}
          </div>
        </div>
        <form id="fiscalOperacaoForm" class="form-grid">
          <div class="row">
            <label>Nome da operação *
              <input name="rotulo" required maxlength="60" value="${escapeHtml(op.rotulo)}" />
            </label>
            <label>Natureza da operação (natOp)
              <input name="natureza" maxlength="60" value="${escapeHtml(op.natureza || '')}" placeholder="${escapeHtml(op.rotulo.toUpperCase())}" />
            </label>
            <label>Finalidade *
              <select name="finalidade" required>
                ${Object.entries(FINALIDADES).map(([valor, f]) => `<option value="${valor}" ${Number(valor) === Number(op.finalidade) ? 'selected' : ''}>${valor} — ${escapeHtml(f.rotulo)}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="cadastro-check-grid">
            ${BANDEIRAS.map((b) => `
              <label class="cadastro-check" title="${escapeHtml(b.ajuda)}">
                <input type="checkbox" name="${b.chave}" ${op[b.chave] ? 'checked' : ''} />
                <span>${escapeHtml(b.titulo)}</span>
              </label>`).join('')}
          </div>
          <div class="finance-actions-row">
            <button type="submit">Salvar alterações</button>
            ${op.alterada ? '<button type="button" class="secondary" id="fiscalOperacaoRestaurar">Restaurar padrão</button>' : ''}
            <button type="button" class="secondary" id="fiscalOperacaoCancelar">Cancelar</button>
          </div>
          <p class="fiscal-regra-erro" id="fiscalOperacaoErro" hidden></p>
        </form>
      </div>
    `;
  }

  function desenhar() {
    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Operações Fiscais</h3>
          </div>
        </div>
        <div class="table-scroll">
          <table class="table table-actions">
            <thead>
              <tr>
                <th>Editar</th>
                <th>Operação</th>
                <th>Natureza (natOp)</th>
                <th>Finalidade</th>
                ${BANDEIRAS.map((b) => `<th class="op-bandeira" title="${escapeHtml(b.ajuda)}">${escapeHtml(b.titulo)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>${operacoes.map(linha).join('')}</tbody>
          </table>
        </div>
      </div>
      ${formulario()}
    `;
    ligar();
  }

  function mostrarErro(texto) {
    const erro = content.querySelector('#fiscalOperacaoErro');
    if (!erro) return;
    erro.textContent = texto;
    erro.hidden = !texto;
  }

  async function recarregarEDesenhar() {
    await carregar();
    desenhar();
  }

  function ligar() {
    content.querySelectorAll('[data-editar-operacao]').forEach((botao) => {
      botao.addEventListener('click', () => {
        editando = botao.dataset.editarOperacao;
        desenhar();
        content.querySelector('#fiscalOperacaoPainel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    content.querySelector('#fiscalOperacaoCancelar')?.addEventListener('click', () => {
      editando = null;
      desenhar();
    });

    content.querySelector('#fiscalOperacaoRestaurar')?.addEventListener('click', async () => {
      const op = operacoes.find((o) => o.chave === editando);
      if (!op) return;
      const ok = await confirmModal(`Voltar "${op.rotulo}" ao padrão do sistema? As alterações desta operação serão desfeitas.`);
      if (!ok) return;
      try {
        await api(`/api/fiscal/operacoes/${encodeURIComponent(op.chave)}/restaurar`, { method: 'POST' });
        showToast('Operação restaurada ao padrão.', 'success');
        editando = null;
        await recarregarEDesenhar();
      } catch (e) {
        mostrarErro(e.message || 'Não foi possível restaurar a operação.');
      }
    });

    content.querySelector('#fiscalOperacaoForm')?.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const form = evento.target;
      const dados = new FormData(form);
      const corpo = {
        rotulo: dados.get('rotulo'),
        natureza: dados.get('natureza'),
        finalidade: Number(dados.get('finalidade'))
      };
      BANDEIRAS.forEach((b) => { corpo[b.chave] = form.elements[b.chave].checked; });
      const botao = form.querySelector('button[type="submit"]');
      botao.disabled = true;
      mostrarErro('');
      try {
        await api(`/api/fiscal/operacoes/${encodeURIComponent(editando)}`, { method: 'PUT', body: JSON.stringify(corpo) });
        showToast('Operação atualizada.', 'success');
        editando = null;
        await recarregarEDesenhar();
      } catch (e) {
        botao.disabled = false;
        mostrarErro(e.message || 'Não foi possível salvar a operação.');
      }
    });
  }

  desenhar();
};
