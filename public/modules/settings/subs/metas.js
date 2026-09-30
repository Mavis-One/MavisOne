window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.settings = window.MavisSubscreenRegistry.settings || {};

// METAS DE VENDA (fase DC) — o alvo por loja e por vendedor.
//
// FICA EM CONFIGURAÇÕES, e não em Vendas, pela mesma razão de "Contas por
// Estabelecimento" (fase CD): a pergunta é de administração — quem cobra quanto
// de quem —, não de cadastro nem de operação. A rota exige administrador para
// ESCREVER; ler é liberado a quem vê relatórios, porque o vendedor precisa
// saber qual é a meta dele.
//
// A META É MENSAL, E O INÍCIO TEM QUATRO RECORTES. O rateio por dias corridos
// mora em lib/metas.js e está explicado ali; a tela só diz que ele existe,
// porque quem cadastra precisa saber que a meta do dia 25 é a do mês dividida.
window.MavisSubscreenRegistry.settings.metas = async function renderMetas(ctx) {
  const { content, api, showToast, escapeHtml, confirmModal } = ctx;

  const mesAtual = new Date().toISOString().slice(0, 7);
  const estado = { escopo: '', competencia: mesAtual };

  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const mesLegivel = (iso) => {
    const [a, m] = String(iso || '').split('-');
    const nomes = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return m ? `${nomes[Number(m)] || m}/${String(a).slice(2)}` : (iso || '-');
  };

  async function render() {
    let dados;
    try {
      const params = new URLSearchParams();
      if (estado.escopo) params.set('escopo', estado.escopo);
      dados = await api(`/api/metas?${params.toString()}`);
    } catch (erro) {
      content.innerHTML = `<div class="panel"><h3>Metas de Venda</h3><p class="muted">${escapeHtml(erro.message || 'Não foi possível carregar as metas.')}</p></div>`;
      return;
    }

    const metas = dados.metas || [];
    const empresas = dados.empresas || [];
    const vendedores = dados.vendedores || [];
    const podeEditar = Boolean(dados.podeEditar);

    // O NOME vem da lista, não de uma cópia gravada na meta: renomear a loja
    // renomeia a meta dela. Meta de referência que saiu do cadastro mostra o id
    // — feio e honesto, em vez de sumir da lista e parecer que não existe.
    // Filial (fase DD) não tem cadastro: a referência JÁ É o nome, como
    // aparece no fim da categoria do pedido (lib/filial-da-venda.js).
    const filiais = (dados.filiais || []).map((f) => ({ id: f.nome, name: f.nome }));
    const rotuloEscopo = { empresa: 'Loja', vendedor: 'Vendedor', filial: 'Filial' };
    const nomeDe = (meta) => {
      if (meta.escopo === 'filial') return meta.referenciaId;
      const lista = meta.escopo === 'empresa' ? empresas : vendedores;
      const achado = lista.find((x) => x.id === meta.referenciaId);
      return achado ? achado.name : `${meta.referenciaId} (fora do cadastro)`;
    };

    const totalDoMes = (escopo) => metas
      .filter((m) => m.escopo === escopo && m.competencia.slice(0, 7) === estado.competencia)
      .reduce((soma, m) => soma + Number(m.valor || 0), 0);

    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <strong>Metas de Venda</strong>
            <p class="muted">
              O alvo de faturamento de cada <strong>filial</strong> e de cada vendedor, por mês. Aparece como
              barra no cartão Faturamento do Início — quem vê todas as vendas compara com a
              <strong>soma</strong> das metas de filial; quem vê só as próprias compara com a meta dele.
            </p>
          </div>
        </div>
        <!-- A PERGUNTA QUE A TELA PRECISA RESPONDER ANTES DE ALGUÉM CADASTRAR:
             "por que a meta do dia é tão pequena?". Dizer isso aqui evita o
             chamado. -->
        <p class="muted">
          A meta é <strong>mensal</strong>. Nos recortes Diário e Semanal ela é dividida por dias
          corridos do mês (a meta de um dia em setembro é a do mês ÷ 30); no Anual, é a soma dos
          meses cadastrados. Mês sem meta não mostra barra nenhuma — em vez de mostrar 0%.
        </p>
        ${podeEditar ? '' : `
          <p class="entrada-aviso">
            Você pode consultar as metas, e só administrador define ou exclui.
            Meta é instrumento de cobrança: quem muda o próprio alvo não tem alvo.
          </p>`}
      </div>

      ${podeEditar ? `
        <form class="panel" id="metaForm">
          <div class="cadastro-section-header"><h4>Definir meta</h4>
            <p>Salvar de novo o mesmo escopo, referência e mês <strong>atualiza</strong> o valor, não soma outro.</p>
          </div>
          <div class="form-grid">
            <div class="row">
              <!-- "LOJA" SAIU DAQUI (30/09/2026), e era a PRIMEIRA opção.
                   O escopo "empresa" se compara com orders.company_id, que
                   está vazio em 14.864 de 14.864 pedidos — medido, e o mesmo
                   fato que lib/filial-da-venda.js ja registrava. Uma meta de
                   Loja ficava em 0% para sempre, e ainda descartava as metas de
                   filial no "Todas as filiais" do Início.
                   A filial é a divisão que EXISTE nos dados: ela sai do sufixo
                   da categoria do pedido. -->
              <label>A meta é de *
                <select name="escopo" id="metaEscopo" required>
                  <option value="filial">Filial</option>
                  <option value="vendedor">Vendedor</option>
                </select>
              </label>
              <label>Filial / Vendedor *
                <select name="referenciaId" id="metaReferencia" required></select>
              </label>
              <label>Mês *
                <input type="month" name="competencia" value="${escapeHtml(estado.competencia)}" required />
              </label>
              <label>Valor da meta (R$) *
                <input type="number" name="valor" step="0.01" min="0" required placeholder="0,00" />
              </label>
            </div>
          </div>
          <div class="finance-actions-row" style="margin-top:12px;">
            <button type="submit">Salvar meta</button>
          </div>
        </form>
      ` : ''}

      <div class="panel">
        <form id="metaFiltros" class="form-grid">
          <div class="row">
            <label>Mostrar
              <select name="escopo">
                <option value="" ${estado.escopo === '' ? 'selected' : ''}>Tudo</option>
                <!-- "Loja" continua no FILTRO, e saiu so da criacao: sem ele,
                     quem tem meta de Loja cadastrada nao teria como achar e
                     remover a dela. -->
                <option value="empresa" ${estado.escopo === 'empresa' ? 'selected' : ''}>Só lojas (não medem nada)</option>
                <option value="filial" ${estado.escopo === 'filial' ? 'selected' : ''}>Só filiais</option>
                <option value="vendedor" ${estado.escopo === 'vendedor' ? 'selected' : ''}>Só vendedores</option>
              </select>
            </label>
            <label>Somar o mês
              <input type="month" name="competencia" value="${escapeHtml(estado.competencia)}" />
            </label>
          </div>
        </form>
        <div class="finance-stat-cards">
          <article class="kpi-card"><h3>Meta das filiais em ${escapeHtml(mesLegivel(estado.competencia))}</h3>
            <p class="kpi-valor">${brl(totalDoMes('filial'))}</p>
            <p class="muted">É esta que o Início usa em "Todas as filiais".</p></article>
          <article class="kpi-card"><h3>Meta dos vendedores em ${escapeHtml(mesLegivel(estado.competencia))}</h3>
            <p class="kpi-valor">${brl(totalDoMes('vendedor'))}</p></article>
        </div>
        <!-- AS METAS DE LOJA VIRARAM PENDÊNCIA, e não um cartão (30/09/2026).
             Elas tinham um cartão igual aos outros dois, o que sugeria que os
             tres funcionavam do mesmo jeito. Nao funcionam: company_id esta
             vazio em todos os pedidos, então a meta de Loja não tem venda para
             comparar. Zero delas é o estado certo; uma delas é um problema, e é
             assim que aparece agora. -->
        ${totalDoMes('empresa') > 0 || metas.some((m) => m.escopo === 'empresa') ? `
          <p class="sales-totals-alerta">
            Há meta cadastrada no escopo <strong>Loja</strong>, e ela <strong>não mede nada</strong>:
            o campo que ela compara (<code>company_id</code> do pedido) está vazio em
            <strong>todos</strong> os pedidos. Ela ficaria em 0% para sempre.
            Recadastre como <strong>Filial</strong> — que é a divisão que existe nos dados — e remova
            a de Loja na tabela abaixo. O escopo saiu do formulário justamente para não entrar mais.
          </p>` : ''}
        <!-- OS DOIS TOTAIS NÃO SE SOMAM, e a tela diz isso: a meta da filial e a
             do vendedor cobram o mesmo faturamento por caminhos diferentes. Um
             terceiro cartão "total" seria exatamente o número errado. -->
        <p class="muted">
          Os totais <strong>não se somam</strong>: a meta da filial e a do vendedor cobram o mesmo
          faturamento por caminhos diferentes. A meta de filial é a que desenha a
          linha de meta no Fluxo de Vendas do Início, e em "Todas as filiais" ela é a
          <strong>soma</strong> das filiais que têm meta.
        </p>
      </div>

      <div class="panel">
        <div class="table-scroll">
          <table class="table table-actions">
            <thead><tr><th>Mês</th><th>Escopo</th><th>Loja / Vendedor</th><th class="rel-num">Meta</th><th>Definida por</th>${podeEditar ? '<th>Ações</th>' : ''}</tr></thead>
            <tbody>
              ${metas.length ? metas.map((m) => `
                <tr>
                  <td>${escapeHtml(mesLegivel(m.competencia))}</td>
                  <td>${escapeHtml(rotuloEscopo[m.escopo] || m.escopo)}</td>
                  <td>${escapeHtml(nomeDe(m))}</td>
                  <td class="rel-num"><strong>${brl(m.valor)}</strong></td>
                  <td class="muted">${escapeHtml(m.createdByName || '-')}</td>
                  ${podeEditar ? `<td><button type="button" class="secondary" data-excluir="${escapeHtml(m.id)}">Excluir</button></td>` : ''}
                </tr>
              `).join('') : `<tr><td colspan="${podeEditar ? 6 : 5}" class="muted">Nenhuma meta cadastrada. Sem meta, o cartão Faturamento do Início não mostra barra.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // A lista de referências troca junto com o escopo: oferecer vendedor numa
    // meta de loja é oferecer um id que a rota vai aceitar e ninguém vai
    // entender depois.
    const selectRef = document.getElementById('metaReferencia');
    const selectEsc = document.getElementById('metaEscopo');
    function preencherReferencias() {
      if (!selectRef || !selectEsc) return;
      // Sem o ramo de 'empresa': a opcao saiu do seletor, e um ramo para um
      // valor que nao existe mais e' codigo que ninguem exercita.
      const lista = selectEsc.value === 'filial' ? filiais : vendedores;
      selectRef.innerHTML = lista.length
        ? lista.map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join('')
        : '<option value="">Nenhum cadastrado</option>';
    }
    preencherReferencias();
    selectEsc?.addEventListener('change', preencherReferencias);

    document.getElementById('metaFiltros')?.addEventListener('change', (evento) => {
      const form = new FormData(evento.currentTarget);
      estado.escopo = form.get('escopo') || '';
      estado.competencia = form.get('competencia') || mesAtual;
      render();
    });

    document.getElementById('metaForm')?.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const form = new FormData(evento.currentTarget);
      try {
        await api('/api/metas', {
          method: 'POST',
          body: JSON.stringify({
            escopo: form.get('escopo'),
            referenciaId: form.get('referenciaId'),
            competencia: form.get('competencia'),
            valor: Number(form.get('valor') || 0)
          })
        });
        showToast('Meta salva.', 'success');
        render();
      } catch (erro) {
        showToast(erro.message || 'Não consegui salvar a meta.', 'error');
      }
    });

    content.querySelectorAll('[data-excluir]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        const alvo = metas.find((m) => m.id === botao.dataset.excluir);
        const ok = await confirmModal(
          `Excluir a meta de ${alvo ? mesLegivel(alvo.competencia) : 'este mês'}?\n\n`
          + 'O cartão do Início volta a não mostrar barra para o período que dependia dela.'
        );
        if (!ok) return;
        try {
          await api(`/api/metas/${encodeURIComponent(botao.dataset.excluir)}`, { method: 'DELETE' });
          showToast('Meta excluída.', 'success');
          render();
        } catch (erro) {
          showToast(erro.message || 'Não consegui excluir a meta.', 'error');
        }
      });
    });
  }

  await render();
};
