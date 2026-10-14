// A NOTA DE ENTRADA DIGITADA À MÃO (14/10/2026).
//
// Pedido do usuário: um botão e uma tela dentro de Compras › Notas de Entrada
// para lançar a NF-e sem o XML, a partir da DANFE. A chave de acesso (44
// dígitos, conferida) diz o fornecedor, a série e o número; a pessoa informa a
// data, os itens, frete/despesas/desconto e as parcelas. O servidor lança pelo
// MESMO caminho da nota com XML (lib/entrada-manual.js e
// lancarEntradaConferida em server.js).
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.purchases = window.MavisSubscreenRegistry.purchases || {};

window.MavisSubscreenRegistry.purchases.entrada_nfe_manual = async function renderEntradaNfeManual(ctx) {
  const { content, data, api, showToast, escapeHtml, confirmModal, state, loadModule } = ctx;

  const produtos = data.products || [];
  const produtosPorId = new Map(produtos.map((p) => [p.id, p]));
  const fornecedores = (data.directory || []).map((c) => ({ value: c.id, label: c.name }));
  const depositos = data.deposits || [];
  const opcoesProduto = window.MavisRotuloProduto ? window.MavisRotuloProduto.opcoes(produtos) : produtos.map((p) => ({ value: p.id, label: p.name }));
  const hoje = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

  const nota = {
    chave: '', leitura: null, fornecedorId: '', dataEmissao: hoje, naturezaOperacao: 'Compra para comercialização',
    depositoId: depositos[0] ? depositos[0].id : '',
    itens: [], frete: 0, outrasDespesas: 0, desconto: 0, parcelas: [],
    gerarFinanceiro: true, atualizarCusto: true, lancando: false
  };

  const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const cent = (v) => Math.round(Number(v || 0) * 100) / 100;
  const totalProdutos = () => cent(nota.itens.reduce((s, i) => s + cent(i.quantidade * i.valorUnitario), 0));
  const totalNota = () => cent(totalProdutos() + Number(nota.frete || 0) + Number(nota.outrasDespesas || 0) - Number(nota.desconto || 0));

  function blocoChave() {
    const l = nota.leitura;
    return `
      <div class="row">
        <label style="flex: 2 1 420px;">Chave de acesso (44 dígitos, na DANFE)
          <input id="manualChave" inputmode="numeric" maxlength="54" value="${escapeHtml(nota.chave)}" placeholder="0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000" />
        </label>
        <label>Data de emissão<input type="date" id="manualData" value="${escapeHtml(nota.dataEmissao)}" /></label>
      </div>
      ${l && l.erro ? `<p class="form-error">${escapeHtml(l.erro)}</p>` : ''}
      ${l && !l.erro ? `
        <p class="muted">
          NF-e <strong>${escapeHtml(l.numero)}</strong> · série ${escapeHtml(l.serie)} · CNPJ do emitente ${escapeHtml(l.documentoEmitente)}
          ${l.jaLancada ? ' · <span class="finance-badge finance-badge-danger">esta nota já foi lançada</span>' : ''}
          ${l.fornecedor ? '' : ' · <span class="finance-badge finance-badge-warning">fornecedor não cadastrado</span>'}
        </p>` : ''}
      <div class="row">
        <label>Fornecedor
          ${renderSearchableSelect({ id: 'manualFornecedor', name: 'fornecedorId', options: fornecedores, selectedValue: nota.fornecedorId, placeholder: 'Buscar fornecedor...' })}
        </label>
        <label>Natureza da operação<input id="manualNatureza" value="${escapeHtml(nota.naturezaOperacao)}" /></label>
        <label>Depósito de entrada
          <select id="manualDeposito">
            ${depositos.map((d) => `<option value="${escapeHtml(d.id)}" ${nota.depositoId === d.id ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
          </select>
        </label>
      </div>`;
  }

  function blocoItens() {
    return `
      <h4>Itens</h4>
      <div class="row">
        <label style="flex: 2 1 320px;">Produto
          ${renderSearchableSelect({ id: 'manualProduto', name: 'produtoBusca', options: opcoesProduto, placeholder: 'Buscar por nome ou SKU...' })}
        </label>
        <label>Quantidade<input type="number" id="manualQtd" min="0" step="0.0001" value="1" /></label>
        <label>Valor unitário<input type="number" id="manualValor" min="0" step="0.01" value="0.00" /></label>
        <div style="align-self: end;"><button type="button" class="secondary" id="manualAdicionar">+ Adicionar</button></div>
      </div>
      <div class="table-scroll">
        <table class="table">
          <thead><tr><th>#</th><th>Produto</th><th>Qtd</th><th>Valor unit.</th><th>Total</th><th></th></tr></thead>
          <tbody>
            ${nota.itens.length ? nota.itens.map((item, i) => {
              const p = produtosPorId.get(item.produtoId) || {};
              return `<tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(p.name || item.produtoId)}${p.sku ? ` <span class="muted">(${escapeHtml(p.sku)})</span>` : ''}</td>
                <td><input type="number" min="0" step="0.0001" class="manual-item-qtd" data-index="${i}" value="${item.quantidade}" style="width: 100px;" /></td>
                <td><input type="number" min="0" step="0.01" class="manual-item-valor" data-index="${i}" value="${item.valorUnitario}" style="width: 120px;" /></td>
                <td>${reais(cent(item.quantidade * item.valorUnitario))}</td>
                <td><button type="button" class="secondary" data-remover="${i}">Remover</button></td>
              </tr>`;
            }).join('') : '<tr><td colspan="6" class="muted">Nenhum item.</td></tr>'}
          </tbody>
        </table>
      </div>`;
  }

  function blocoTotais() {
    return `
      <div class="row">
        <label>Frete<input type="number" min="0" step="0.01" id="manualFrete" value="${nota.frete || 0}" /></label>
        <label>Outras despesas<input type="number" min="0" step="0.01" id="manualOutras" value="${nota.outrasDespesas || 0}" /></label>
        <label>Desconto<input type="number" min="0" step="0.01" id="manualDesconto" value="${nota.desconto || 0}" /></label>
      </div>
      <p>Produtos: <strong>${reais(totalProdutos())}</strong> &nbsp;·&nbsp; Total da nota: <strong id="manualTotal">${reais(totalNota())}</strong></p>`;
  }

  function blocoParcelas() {
    const soma = cent(nota.parcelas.reduce((s, p) => s + Number(p.valor || 0), 0));
    const naoFecha = nota.parcelas.length && Math.round(soma * 100) !== Math.round(totalNota() * 100);
    return `
      <h4>Contas a pagar</h4>
      <label class="entrada-opcao"><input type="checkbox" id="manualGerarFinanceiro" ${nota.gerarFinanceiro ? 'checked' : ''} /> <span>Gerar contas a pagar</span></label>
      ${nota.gerarFinanceiro ? `
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor</th><th></th></tr></thead>
            <tbody>
              ${nota.parcelas.length ? nota.parcelas.map((p, i) => `
                <tr>
                  <td>${String(i + 1).padStart(3, '0')}</td>
                  <td><input type="date" class="manual-parcela-venc" data-index="${i}" value="${escapeHtml(p.vencimento)}" /></td>
                  <td><input type="number" min="0" step="0.01" class="manual-parcela-valor" data-index="${i}" value="${p.valor}" style="width: 140px;" /></td>
                  <td><button type="button" class="secondary" data-remover-parcela="${i}">Remover</button></td>
                </tr>`).join('') : `<tr><td colspan="4" class="muted">Sem parcelas: uma só, de ${reais(totalNota())}, vencendo na emissão.</td></tr>`}
            </tbody>
          </table>
        </div>
        ${naoFecha ? `<p class="sales-totals-alerta">As parcelas somam ${reais(soma)} e a nota dá ${reais(totalNota())}: têm de fechar.</p>` : ''}
        <div class="row"><button type="button" class="secondary" id="manualAddParcela">+ Adicionar parcela</button></div>
      ` : ''}
      <label class="entrada-opcao"><input type="checkbox" id="manualAtualizarCusto" ${nota.atualizarCusto ? 'checked' : ''} /> <span>Atualizar o custo dos produtos com o valor da nota</span></label>`;
  }

  function desenhar() {
    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div><h3>Nota de entrada manual</h3></div>
          <div class="cadastro-list-actions"><button type="button" class="secondary" id="manualVoltar">Voltar às Notas de Entrada</button></div>
        </div>
        <form id="manualForm" class="form-grid" autocomplete="off">
          ${blocoChave()}
          ${blocoItens()}
          ${blocoTotais()}
          ${blocoParcelas()}
          <div class="row">
            <button type="submit" ${nota.lancando ? 'disabled' : ''}>${nota.lancando ? 'Lançando…' : 'Lançar entrada'}</button>
          </div>
        </form>
      </div>`;
    ligar();
  }

  // Lê o que está nos campos de cima (sem redesenhar), antes de qualquer redesenho.
  function guardarCampos() {
    const v = (id) => document.getElementById(id);
    if (v('manualData')) nota.dataEmissao = v('manualData').value;
    if (v('manualNatureza')) nota.naturezaOperacao = v('manualNatureza').value;
    if (v('manualDeposito')) nota.depositoId = v('manualDeposito').value;
    if (v('manualFornecedorValue')) nota.fornecedorId = v('manualFornecedorValue').value;
    if (v('manualFrete')) nota.frete = Number(v('manualFrete').value || 0);
    if (v('manualOutras')) nota.outrasDespesas = Number(v('manualOutras').value || 0);
    if (v('manualDesconto')) nota.desconto = Number(v('manualDesconto').value || 0);
  }

  async function lerChave(valor) {
    const digitos = String(valor || '').replace(/\D/g, '');
    nota.chave = valor;
    if (digitos.length !== 44) { nota.leitura = digitos.length ? { erro: `Faltam ${44 - digitos.length} dígitos.` } : null; return; }
    try {
      const r = await api(`/api/purchases/entrada-nfe/manual/chave?chave=${digitos}`);
      nota.leitura = r;
      if (!r.erro && r.fornecedor) nota.fornecedorId = r.fornecedor.id;
    } catch (erro) {
      nota.leitura = { erro: erro.message || 'Não consegui ler a chave.' };
    }
  }

  function ligar() {
    if (typeof attachSearchableSelect === 'function') {
      attachSearchableSelect({ id: 'manualFornecedor', options: fornecedores });
      attachSearchableSelect({ id: 'manualProduto', options: opcoesProduto });
    }
    document.getElementById('manualVoltar')?.addEventListener('click', () => {
      state.activeSub = 'entrada_nfe';
      if (typeof renderApp === 'function') renderApp();
      loadModule('purchases');
    });
    document.getElementById('manualChave')?.addEventListener('change', async (e) => {
      guardarCampos();
      await lerChave(e.target.value);
      desenhar();
    });
    document.getElementById('manualAdicionar')?.addEventListener('click', () => {
      guardarCampos();
      const produtoId = document.getElementById('manualProdutoValue')?.value || '';
      const quantidade = Number(document.getElementById('manualQtd')?.value || 0);
      const valorUnitario = Number(document.getElementById('manualValor')?.value || 0);
      if (!produtoId || !(quantidade > 0)) { showToast('Escolha o produto e uma quantidade maior que zero.', 'warning'); return; }
      nota.itens.push({ produtoId, quantidade, valorUnitario });
      desenhar();
    });
    content.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', () => {
      guardarCampos(); nota.itens.splice(Number(b.dataset.remover), 1); desenhar();
    }));
    content.querySelectorAll('.manual-item-qtd').forEach((c) => c.addEventListener('change', () => {
      guardarCampos(); nota.itens[Number(c.dataset.index)].quantidade = Number(c.value || 0); desenhar();
    }));
    content.querySelectorAll('.manual-item-valor').forEach((c) => c.addEventListener('change', () => {
      guardarCampos(); nota.itens[Number(c.dataset.index)].valorUnitario = Number(c.value || 0); desenhar();
    }));
    ['manualFrete', 'manualOutras', 'manualDesconto'].forEach((id) => document.getElementById(id)?.addEventListener('change', () => { guardarCampos(); desenhar(); }));
    document.getElementById('manualGerarFinanceiro')?.addEventListener('change', (e) => { guardarCampos(); nota.gerarFinanceiro = e.target.checked; desenhar(); });
    document.getElementById('manualAtualizarCusto')?.addEventListener('change', (e) => { nota.atualizarCusto = e.target.checked; });
    document.getElementById('manualAddParcela')?.addEventListener('click', () => {
      guardarCampos();
      const ja = cent(nota.parcelas.reduce((s, p) => s + Number(p.valor || 0), 0));
      nota.parcelas.push({ vencimento: nota.dataEmissao || hoje, valor: Math.max(0, cent(totalNota() - ja)) });
      desenhar();
    });
    content.querySelectorAll('[data-remover-parcela]').forEach((b) => b.addEventListener('click', () => {
      guardarCampos(); nota.parcelas.splice(Number(b.dataset.removerParcela), 1); desenhar();
    }));
    content.querySelectorAll('.manual-parcela-venc').forEach((c) => c.addEventListener('change', () => { nota.parcelas[Number(c.dataset.index)].vencimento = c.value; }));
    content.querySelectorAll('.manual-parcela-valor').forEach((c) => c.addEventListener('change', () => {
      guardarCampos(); nota.parcelas[Number(c.dataset.index)].valor = Number(c.value || 0); desenhar();
    }));

    document.getElementById('manualForm')?.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      if (nota.lancando) return;
      guardarCampos();
      if (!nota.itens.length) { showToast('Inclua ao menos um item.', 'warning'); return; }
      if (!await confirmModal('Lançar esta entrada? Ela dá entrada no estoque e, se marcado, gera as contas a pagar. Nota fiscal não pode ser apagada depois — correção se faz por devolução.')) return;
      nota.lancando = true;
      desenhar();
      try {
        const resposta = await api('/api/purchases/entrada-nfe/manual', {
          method: 'POST',
          body: JSON.stringify({
            chave: nota.chave,
            fornecedorId: nota.fornecedorId,
            dataEmissao: nota.dataEmissao,
            naturezaOperacao: nota.naturezaOperacao,
            depositoId: nota.depositoId,
            itens: nota.itens,
            frete: nota.frete,
            outrasDespesas: nota.outrasDespesas,
            desconto: nota.desconto,
            duplicatas: nota.gerarFinanceiro ? nota.parcelas : [],
            gerarFinanceiro: nota.gerarFinanceiro,
            atualizarCusto: nota.atualizarCusto
          })
        });
        const partes = ['Entrada lançada'];
        if (resposta.estoque?.length) partes.push(`${resposta.estoque.length} ${resposta.estoque.length === 1 ? 'item entrou' : 'itens entraram'} no estoque`);
        if (resposta.financeiro?.length) partes.push(`${resposta.financeiro.length} ${resposta.financeiro.length === 1 ? 'conta a pagar criada' : 'contas a pagar criadas'}`);
        showToast(`${partes.join(' · ')}.`, 'success');
        state.activeSub = 'entrada_nfe';
        if (typeof renderApp === 'function') renderApp();
        loadModule('purchases');
      } catch (erro) {
        nota.lancando = false;
        desenhar();
        showToast(erro.message || 'Não consegui lançar a entrada.', 'error');
      }
    });
  }

  desenhar();
};
