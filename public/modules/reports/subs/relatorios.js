window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.reports = window.MavisSubscreenRegistry.reports || {};

// As telas de Relatórios vivem no mesmo arquivo porque compartilham o cabeçalho,
// a barra de filtros e os formatadores — separá-las duplicaria os três.
//
// A ORDEM DA TELA É A ORDEM DAS PERGUNTAS
// ---------------------------------------
// Filtros, indicadores, tabela, gráficos, detalhamento. Não é estética: é a
// sequência em que a pessoa pensa. Primeiro ela recorta o que quer ver; depois
// olha os números grandes para saber se é muito ou pouco; depois procura a
// venda específica; e só então, se a pergunta ainda não foi respondida, olha a
// distribuição. Gráfico antes de tabela obriga a rolar para chegar ao que a
// maioria vem buscar.
//
// NADA AQUI DECIDE QUEM VÊ O QUÊ
// ------------------------------
// A tela desenha o que o servidor mandou. Ela esconde o filtro de vendedor
// quando `escopo.podeEscolherVendedor` é falso, mas isso é CORTESIA, não
// controle: quem forjar a requisição continua recebendo só as próprias vendas,
// porque a decisão é do backend (lib/relatorios-escopo.js). Esconder botão
// nunca foi controle de acesso.

const REL_GRANULARIDADES = [
  { chave: 'day', rotulo: 'Diário' },
  { chave: 'week', rotulo: 'Semanal' },
  { chave: 'month', rotulo: 'Mensal' },
  { chave: 'year', rotulo: 'Anual' }
];

// O tipo do documento. "Pedidos" é o padrão porque relatório de VENDAS trata do
// que foi vendido — orçamento é intenção, e somá-lo ao faturamento infla o
// número que a diretoria olha.
const REL_TIPOS = [
  { chave: 'order', rotulo: 'Pedidos' },
  { chave: 'quote', rotulo: 'Orçamentos' },
  { chave: 'todos', rotulo: 'Pedidos e orçamentos' }
];

function relBRL(valor) {
  if (typeof financeFormatBRL === 'function') return financeFormatBRL(valor);
  return `R$ ${Number(valor || 0).toFixed(2)}`;
}

function relData(iso) {
  const s = String(iso || '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s || '-';
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

function relNum(valor) {
  const x = Number(valor || 0);
  return Number.isInteger(x) ? String(x) : x.toFixed(2).replace('.', ',');
}

// O estado dos filtros vive no `state` do app, e não numa variável do módulo:
// trocar de tela e voltar precisa reencontrar o mesmo recorte, senão a pessoa
// refaz a filtragem a cada ida ao pedido e de volta.
function relFiltros(state) {
  return (state.reportsVendasFiltros = state.reportsVendasFiltros || {
    dataDe: '', dataAte: '', vendedorId: '', clienteId: '', produtoId: '',
    status: '', tipo: 'order', busca: '',
    ordem: 'data', direcao: 'desc', pagina: 1, porPagina: 25,
    visao: 'tabela'
  });
}

function relQueryDeFiltros(filtros) {
  const p = new URLSearchParams();
  Object.entries(filtros).forEach(([chave, valor]) => {
    if (chave === 'visao') return; // só a tela usa
    if (valor !== '' && valor !== null && valor !== undefined) p.set(chave, valor);
  });
  return p.toString();
}

function relCabecalho(ctx, titulo, descricao, comPeriodo) {
  const { escapeHtml, granularidade } = ctx;
  return `
    <section class="panel workspace-head">
      <div>
        <strong>${escapeHtml(titulo)}</strong>
        <p class="muted">${escapeHtml(descricao)}</p>
      </div>
      ${comPeriodo ? `
        <div class="finance-granularity-group" role="tablist">
          ${REL_GRANULARIDADES.map((g) => `<button type="button" class="finance-pill finance-pill-sm ${g.chave === granularidade ? 'active' : ''}" data-rel-granularidade="${g.chave}">${g.rotulo}</button>`).join('')}
        </div>
      ` : ''}
    </section>
  `;
}

function relLigarPeriodo(ctx) {
  const { content, state, loadModule } = ctx;
  content.querySelectorAll('[data-rel-granularidade]').forEach((botao) => {
    botao.addEventListener('click', () => {
      state.reportsGranularidade = botao.dataset.relGranularidade;
      loadModule('reports');
    });
  });
}

function relTabelaVazia(mensagem, colunas = 9) {
  return `<tr><td colspan="${colunas}" class="muted">${mensagem}</td></tr>`;
}

// ===========================================================================
// A BARRA DE FILTROS — o primeiro bloco da tela, e o mais importante.
//
// Fica num painel próprio, com título, porque o briefing pede uma área
// claramente identificada: em tela de relatório, o erro mais caro é olhar um
// número achando que ele é de um período que não é o que está filtrado.
//
// "Aplicar" existe mesmo com os campos gravando ao vivo: mexer em cinco campos
// dispararia cinco consultas, e a pessoa veria a tela piscar a cada tecla.
// ===========================================================================
function relBarraDeFiltros(ctx, rel) {
  const { escapeHtml, state } = ctx;
  const f = relFiltros(state);
  const opcoes = rel.opcoes || {};
  const selects = (lista, valor, vazio) => [`<option value="">${escapeHtml(vazio)}</option>`]
    .concat((lista || []).map((o) => `<option value="${escapeHtml(o.id)}" ${o.id === valor ? 'selected' : ''}>${escapeHtml(o.nome)}</option>`))
    .join('');

  return `
    <section class="panel rel-filtros">
      <div class="rel-filtros-topo">
        <h3>Filtros</h3>
        <!-- Diz de quem são os números que estão na tela. Para o vendedor comum
             é a única indicação de que o relatório é dele — e ela precisa estar
             onde ele já está olhando. -->
        <span class="rel-escopo-selo">${escapeHtml(rel.escopo?.rotulo || '')}</span>
      </div>

      <div class="rel-filtros-grade">
        <label>Período — de
          <input type="date" data-rel-filtro="dataDe" value="${escapeHtml(f.dataDe)}" />
        </label>
        <label>até
          <input type="date" data-rel-filtro="dataAte" value="${escapeHtml(f.dataAte)}" />
        </label>
        ${rel.escopo?.podeEscolherVendedor ? `
          <label>Vendedor
            <select data-rel-filtro="vendedorId">${selects(opcoes.vendedores, f.vendedorId, 'Todos os vendedores')}</select>
          </label>` : ''}
        <label>Cliente
          <select data-rel-filtro="clienteId">${selects(opcoes.clientes, f.clienteId, 'Todos os clientes')}</select>
        </label>
        <label>Produto
          <select data-rel-filtro="produtoId">${selects(opcoes.produtos, f.produtoId, 'Todos os produtos')}</select>
        </label>
        <label>Situação
          <select data-rel-filtro="status">
            <!-- O rótulo diz o que o padrão faz. Um "Todos" que na verdade
                 esconde as canceladas é o tipo de filtro que faz o relatório
                 discordar do sistema sem ninguém entender por quê. -->
            <option value="" ${!f.status ? 'selected' : ''}>Todas, menos canceladas</option>
            <option value="todos" ${f.status === 'todos' ? 'selected' : ''}>Todas, incluindo canceladas</option>
            ${(opcoes.status || []).map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === f.status ? 'selected' : ''}>${escapeHtml(s.nome)}</option>`).join('')}
          </select>
        </label>
        <label>Documento
          <select data-rel-filtro="tipo">
            ${REL_TIPOS.map((t) => `<option value="${t.chave}" ${t.chave === f.tipo ? 'selected' : ''}>${t.rotulo}</option>`).join('')}
          </select>
        </label>
        <label>Pesquisar
          <input type="search" data-rel-filtro="busca" value="${escapeHtml(f.busca)}"
                 placeholder="Pedido, cliente, produto, chassi..." />
        </label>
      </div>

      <div class="rel-filtros-acoes">
        <div>
          <button type="button" id="relAplicar">Aplicar filtros</button>
          <button type="button" class="secondary" id="relLimpar">Limpar</button>
          <button type="button" class="secondary" id="relAtualizar">Atualizar</button>
        </div>
        <div>
          <!-- A exportação NÃO monta arquivo com o que está na tela: ela chama o
               servidor, que refaz a permissão e o filtro. Gerar no navegador
               significaria que os dados já teriam saído do servidor antes de
               alguém checar se podiam sair. -->
          <button type="button" class="secondary" id="relExportar">Excel (CSV)</button>
          <button type="button" class="secondary" id="relImprimir">Imprimir</button>
        </div>
      </div>
    </section>
  `;
}

function relLigarFiltros(ctx) {
  const { content, state, loadModule, showToast } = ctx;
  const f = relFiltros(state);

  content.querySelectorAll('[data-rel-filtro]').forEach((campo) => {
    campo.addEventListener('change', () => {
      f[campo.dataset.relFiltro] = campo.value;
      // Trocar de filtro volta para a primeira página: manter a página 7 num
      // resultado que agora tem 2 páginas mostraria uma tela vazia.
      f.pagina = 1;
    });
  });
  // Enter no campo de busca aplica, que é o que a mão espera.
  content.querySelector('[data-rel-filtro="busca"]')?.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Enter') return;
    evento.preventDefault();
    f.busca = evento.target.value;
    f.pagina = 1;
    loadModule('reports');
  });

  content.querySelector('#relAplicar')?.addEventListener('click', () => loadModule('reports'));
  content.querySelector('#relAtualizar')?.addEventListener('click', () => loadModule('reports'));
  content.querySelector('#relLimpar')?.addEventListener('click', () => {
    state.reportsVendasFiltros = null;
    loadModule('reports');
  });
  content.querySelector('#relImprimir')?.addEventListener('click', () => window.print());

  content.querySelector('#relExportar')?.addEventListener('click', async () => {
    // fetch + blob, e não <a href>: a sessão vive no cabeçalho x-auth-token, e
    // um link comum chegaria ao servidor sem sessão nenhuma.
    let url = null;
    try {
      const resposta = await fetch(`/api/reports/vendas/export?${relQueryDeFiltros(f)}`, {
        headers: { 'x-auth-token': (typeof getSessionToken === 'function' ? getSessionToken() : '') || '' }
      });
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => ({}));
        showToast(corpo.error || `Não consegui exportar (HTTP ${resposta.status}).`, 'error');
        return;
      }
      const blob = await resposta.blob();
      url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `relatorio-de-vendas-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast('Exportação gerada com os mesmos filtros da tela.', 'success');
    } catch (erro) {
      showToast(erro.message || 'Não consegui exportar.', 'error');
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  });
}

// ===========================================================================
// INDICADORES — o segundo bloco. Os quatro números que respondem "como foi?".
// ===========================================================================
function relIndicadores(rel) {
  const i = rel.indicadores || {};
  return `
    <div class="finance-stat-cards">
      ${financeStatCard({ tone: 'green', label: 'Faturamento', value: relBRL(i.faturamento), sub: i.desconto ? `Descontos ${relBRL(i.desconto)}` : '' })}
      ${financeStatCard({ tone: 'blue', label: 'Pedidos', value: String(i.pedidos || 0), sub: `${relNum(i.itens)} itens` })}
      ${financeStatCard({ tone: 'purple', label: 'Clientes', value: String(i.clientes || 0), sub: `${i.produtos || 0} produtos` })}
      ${financeStatCard({ tone: 'teal', label: 'Ticket médio', value: relBRL(i.ticketMedio), sub: 'por pedido' })}
    </div>
  `;
}

// As colunas da tabela e o que cada uma sabe fazer. A ordenação sai daqui, e
// não de uma lista paralela — coluna nova nasce ordenável ou explicitamente não.
const REL_COLUNAS = [
  { chave: 'data', rotulo: 'Data', ordenavel: true },
  { chave: 'pedido', rotulo: 'Pedido', ordenavel: true },
  { chave: 'vendedor', rotulo: 'Vendedor', ordenavel: true },
  { chave: 'cliente', rotulo: 'Cliente', ordenavel: true },
  { chave: 'produto', rotulo: 'Produto', ordenavel: true },
  { chave: 'codigo', rotulo: 'Código', ordenavel: false },
  { chave: 'quantidade', rotulo: 'Qtd.', ordenavel: true, num: true },
  { chave: 'unitario', rotulo: 'Valor unit.', ordenavel: false, num: true },
  { chave: 'desconto', rotulo: 'Desconto', ordenavel: false, num: true },
  { chave: 'valor', rotulo: 'Total', ordenavel: true, num: true },
  { chave: 'status', rotulo: 'Situação', ordenavel: true }
];

function relLinhaDaTabela(linha, escapeHtml) {
  // Pedido, cliente e produto são BOTÕES: clicar abre a tela que já existe no
  // ERP. O relatório não reimplementa nenhuma delas — ele leva até lá.
  return `
    <tr>
      <td>${relData(linha.data)}</td>
      <td><button type="button" class="rel-link" data-rel-pedido="${escapeHtml(linha.pedidoId)}" title="Abrir o pedido">#${escapeHtml(String(linha.pedidoCodigo || '-'))}</button></td>
      <td><button type="button" class="rel-link" data-rel-vendedor="${escapeHtml(linha.vendedorId)}" title="Ver o desempenho deste vendedor">${escapeHtml(linha.vendedorNome)}</button></td>
      <td><button type="button" class="rel-link" data-rel-cliente="${escapeHtml(linha.clienteId)}" data-rel-cliente-nome="${escapeHtml(linha.clienteNome)}" title="Abrir o cadastro do cliente">${escapeHtml(linha.clienteNome)}</button></td>
      <td>
        <button type="button" class="rel-link" data-rel-produto="${escapeHtml(linha.produtoId)}" title="Abrir o cadastro do produto">${escapeHtml(linha.produtoNome)}</button>
        ${linha.cor ? `<span class="sales-item-cor">${escapeHtml(linha.cor)}</span>` : ''}
      </td>
      <td class="muted">${escapeHtml(linha.produtoCodigo || '-')}</td>
      <td class="rel-num">${relNum(linha.quantidade)}</td>
      <td class="rel-num">${relBRL(linha.valorUnitario)}</td>
      <td class="rel-num">${linha.desconto ? relBRL(linha.desconto) : '-'}</td>
      <td class="rel-num"><strong>${relBRL(linha.valorTotal)}</strong></td>
      <td>${relSelo(linha, escapeHtml)}</td>
    </tr>
  `;
}

// O selo usa as classes .finance-badge, que são as do resto do sistema. Uma
// família de selos só para Relatórios faria a mesma situação ("Pedido
// Faturado") ter duas caras conforme a tela onde aparece.
function relSelo(linha, escapeHtml) {
  const tom = linha.cancelada ? 'danger' : (linha.tipo === 'quote' ? 'muted' : 'success');
  return `<span class="finance-badge finance-badge-${tom}">${escapeHtml(linha.statusRotulo)}</span>`;
}

function relTabela(ctx, rel) {
  const { escapeHtml, state } = ctx;
  const f = relFiltros(state);
  const p = rel.paginacao || { pagina: 1, paginas: 1, total: 0 };

  const cabecalho = REL_COLUNAS.map((col) => {
    if (!col.ordenavel) return `<th${col.num ? ' class="rel-num"' : ''}>${col.rotulo}</th>`;
    const ativa = f.ordem === col.chave;
    const seta = ativa ? (f.direcao === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th${col.num ? ' class="rel-num"' : ''}><button type="button" class="sales-ordenar${ativa ? ' is-ativa' : ''}" data-rel-ordem="${col.chave}">${col.rotulo}${seta}</button></th>`;
  }).join('');

  return `
    <section class="panel">
      <div class="rel-tabela-topo">
        <h3>Vendas</h3>
        <span class="muted">${p.total} ${p.total === 1 ? 'linha' : 'linhas'} · uma linha por produto vendido</span>
      </div>
      <div class="table-scroll">
        <table class="table rel-tabela">
          <thead><tr>${cabecalho}</tr></thead>
          <tbody>
            ${(rel.linhas || []).length
              ? rel.linhas.map((linha) => relLinhaDaTabela(linha, escapeHtml)).join('')
              : relTabelaVazia(rel.escopo?.motivo || 'Nenhuma venda no recorte escolhido.', REL_COLUNAS.length)}
          </tbody>
        </table>
      </div>
      ${p.paginas > 1 ? `
        <div class="finance-pagination">
          <button type="button" class="secondary" data-rel-pagina="${p.pagina - 1}" ${p.pagina <= 1 ? 'disabled' : ''}>Anterior</button>
          <span class="muted">Página ${p.pagina} de ${p.paginas}</span>
          <button type="button" class="secondary" data-rel-pagina="${p.pagina + 1}" ${p.pagina >= p.paginas ? 'disabled' : ''}>Próxima</button>
        </div>` : ''}
    </section>
  `;
}

// ===========================================================================
// POR VENDEDOR — o mesmo conjunto, agrupado. Sai dos DADOS: vendedor que
// fechou a primeira venda aparece aqui sem ninguém tocar em código.
// ===========================================================================
function relPorVendedor(ctx, rel) {
  const { escapeHtml } = ctx;
  const grupos = rel.porVendedor || [];
  if (!grupos.length) {
    return `<section class="panel"><p class="muted">${escapeHtml(rel.escopo?.motivo || 'Nenhuma venda no recorte escolhido.')}</p></section>`;
  }
  return grupos.map((grupo) => {
    const i = grupo.indicadores;
    return `
      <section class="panel rel-grupo">
        <details open>
          <summary class="rel-grupo-topo">
            <strong>${escapeHtml(grupo.vendedorNome)}</strong>
            <span class="rel-grupo-resumo">
              <span>${i.pedidos} ${i.pedidos === 1 ? 'pedido' : 'pedidos'}</span>
              <span>${i.clientes} ${i.clientes === 1 ? 'cliente' : 'clientes'}</span>
              <span>Ticket ${relBRL(i.ticketMedio)}</span>
              <strong>${relBRL(i.faturamento)}</strong>
            </span>
          </summary>
          <div class="table-scroll">
            <table class="table rel-tabela">
              <thead><tr>
                <th>Data</th><th>Pedido</th><th>Cliente</th><th>Produto</th>
                <th class="rel-num">Qtd.</th><th class="rel-num">Total</th>
              </tr></thead>
              <tbody>
                ${grupo.linhas.map((linha) => `
                  <tr>
                    <td>${relData(linha.data)}</td>
                    <td><button type="button" class="rel-link" data-rel-pedido="${escapeHtml(linha.pedidoId)}">#${escapeHtml(String(linha.pedidoCodigo || '-'))}</button></td>
                    <td>${escapeHtml(linha.clienteNome)}</td>
                    <td>${escapeHtml(linha.produtoNome)}</td>
                    <td class="rel-num">${relNum(linha.quantidade)}</td>
                    <td class="rel-num"><strong>${relBRL(linha.valorTotal)}</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    `;
  }).join('');
}

// ===========================================================================
// GRÁFICOS E DETALHAMENTOS — o quarto e o quinto blocos, e os últimos por um
// motivo: são os que respondem perguntas que a pessoa ainda não tinha.
// ===========================================================================
function relGraficos(ctx, rel) {
  const { escapeHtml } = ctx;
  const P = window.MavisPainel;
  const barras = (itens, vazio) => P.graficoBarras(itens, escapeHtml, { formato: 'moeda', vazio });
  return `
    <div class="painel-grade">
      <section class="panel finance-panel-stripe-chart">
        <h3>Evolução do faturamento</h3>
        <div class="finance-chart-wrap">
          ${P.graficoLinha(rel.serie || [], escapeHtml, [{ key: 'faturamento', cssClass: 'finance-chart-line-blue' }])}
        </div>
      </section>
      <section class="panel">
        <h3>Faturamento por vendedor</h3>
        ${barras((rel.porVendedor || []).map((g) => ({ label: g.vendedorNome, valor: g.indicadores.faturamento })), 'Sem vendas no recorte.')}
      </section>
      <section class="panel">
        <h3>Produtos mais vendidos</h3>
        ${barras(rel.topProdutos || [], 'Sem produtos no recorte.')}
      </section>
      <section class="panel">
        <h3>Maiores clientes</h3>
        ${barras(rel.topClientes || [], 'Sem clientes no recorte.')}
      </section>
    </div>
  `;
}

// ===========================================================================
// Cliques: cada um leva a uma tela que JÁ EXISTE. O relatório não duplica
// cadastro nenhum — ele é o caminho até eles.
// ===========================================================================
function relLigarCliques(ctx) {
  const { content, state, api, loadModule, renderApp, showToast } = ctx;
  const f = relFiltros(state);

  content.querySelectorAll('[data-rel-ordem]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const coluna = botao.dataset.relOrdem;
      // Clicar na coluna já ativa inverte; em outra, começa decrescente — que é
      // o que se quer ver primeiro em coluna de dinheiro e de data.
      f.direcao = f.ordem === coluna && f.direcao === 'desc' ? 'asc' : 'desc';
      f.ordem = coluna;
      loadModule('reports');
    });
  });

  content.querySelectorAll('[data-rel-pagina]').forEach((botao) => {
    botao.addEventListener('click', () => {
      f.pagina = Number(botao.dataset.relPagina) || 1;
      loadModule('reports');
    });
  });

  content.querySelectorAll('[data-rel-pedido]').forEach((botao) => {
    botao.addEventListener('click', async () => {
      try {
        const resposta = await api(`/api/sales/records/${encodeURIComponent(botao.dataset.relPedido)}`);
        state.salesDraft = state.salesDraft || {};
        state.salesDraft.editRecord = resposta.record;
        state.salesDraft.novoStatus = '';
        state.activeModule = 'sales';
        state.activeSub = 'new_sale';
        renderApp();
        loadModule('sales');
      } catch (erro) {
        // Quem tem Relatórios mas não tem Vendas vê o relatório e não abre o
        // pedido. Dizer isso é melhor do que um clique que não faz nada.
        showToast(erro.message || 'Você não tem acesso à tela de Vendas.', 'warning');
      }
    });
  });

  content.querySelectorAll('[data-rel-cliente]').forEach((botao) => {
    botao.addEventListener('click', () => {
      state.cadastroDraft = state.cadastroDraft || { people: {}, cnpjs: {} };
      state.cadastroDraft.listFilters = {
        ...(state.cadastroDraft.listFilters || {}),
        show: true,
        query: botao.dataset.relClienteNome || ''
      };
      state.activeModule = 'cadastros';
      state.activeSub = 'list';
      renderApp();
      loadModule('cadastros');
    });
  });

  content.querySelectorAll('[data-rel-produto]').forEach((botao) => {
    botao.addEventListener('click', () => {
      if (!botao.dataset.relProduto) return;
      state.stockEditProductId = botao.dataset.relProduto;
      state.activeModule = 'stock';
      state.activeSub = 'products';
      renderApp();
      loadModule('stock');
    });
  });

  content.querySelectorAll('[data-rel-vendedor]').forEach((botao) => {
    botao.addEventListener('click', () => {
      // Detalhar um vendedor é o relatório filtrado por ele — não uma tela
      // nova. Para quem não pode escolher vendedor, o servidor ignora o filtro
      // e devolve as próprias vendas de novo, que é o certo.
      f.vendedorId = botao.dataset.relVendedor || '';
      f.visao = 'vendedor';
      f.pagina = 1;
      loadModule('reports');
    });
  });

  content.querySelectorAll('[data-rel-visao]').forEach((botao) => {
    botao.addEventListener('click', () => {
      f.visao = botao.dataset.relVisao;
      loadModule('reports');
    });
  });
}

// --- Relatório de Vendas ---------------------------------------------------
window.MavisSubscreenRegistry.reports.vendas = async function relVendas(ctx) {
  const { content, escapeHtml, state } = ctx;
  const rel = ctx.relatorioVendas || {};
  const f = relFiltros(state);
  const visao = f.visao === 'vendedor' ? 'vendedor' : 'tabela';

  content.innerHTML = `
    <div class="workspace">
      ${relCabecalho(ctx, 'Relatório de Vendas', 'O que foi vendido, por quem, para quem e por quanto.', false)}
      ${relBarraDeFiltros(ctx, rel)}
      ${rel.escopo?.motivo ? `<p class="entrada-aviso entrada-aviso-bloqueio">${escapeHtml(rel.escopo.motivo)}</p>` : ''}
      ${relIndicadores(rel)}

      <div class="rel-visoes" role="tablist">
        <button type="button" class="finance-pill ${visao === 'tabela' ? 'active' : ''}" data-rel-visao="tabela">Tabela</button>
        <button type="button" class="finance-pill ${visao === 'vendedor' ? 'active' : ''}" data-rel-visao="vendedor">Por vendedor</button>
      </div>

      ${visao === 'tabela' ? relTabela(ctx, rel) : relPorVendedor(ctx, rel)}
      ${relGraficos(ctx, rel)}
    </div>
  `;
  relLigarFiltros(ctx);
  relLigarCliques(ctx);
};

// --- Relatório por Vendedor ------------------------------------------------
// Para quem vê todos, é um ranking. Para o vendedor comum, é o próprio
// desempenho — e não uma lista de um item só, que pareceria um ranking
// quebrado.
window.MavisSubscreenRegistry.reports.vendedores = async function relVendedores(ctx) {
  const { content, escapeHtml, state } = ctx;
  const rel = ctx.relatorioVendas || {};
  const grupos = rel.porVendedor || [];
  const souEuSozinho = !rel.escopo?.podeEscolherVendedor;
  const eu = grupos[0];

  const meuDesempenho = () => {
    if (!eu) {
      return `<section class="panel"><p class="muted">${escapeHtml(rel.escopo?.motivo || 'Você ainda não tem vendas no período escolhido.')}</p></section>`;
    }
    const i = eu.indicadores;
    return `
      <section class="panel">
        <h3>${escapeHtml(eu.vendedorNome)}</h3>
        <p class="muted">Meu desempenho no recorte escolhido.</p>
      </section>
      <div class="finance-stat-cards">
        ${financeStatCard({ tone: 'green', label: 'Faturamento', value: relBRL(i.faturamento) })}
        ${financeStatCard({ tone: 'blue', label: 'Pedidos', value: String(i.pedidos) })}
        ${financeStatCard({ tone: 'purple', label: 'Clientes', value: String(i.clientes) })}
        ${financeStatCard({ tone: 'teal', label: 'Ticket médio', value: relBRL(i.ticketMedio) })}
        ${financeStatCard({ tone: 'blue', label: 'Itens vendidos', value: relNum(i.itens) })}
      </div>
    `;
  };

  const ranking = () => `
    <section class="panel">
      <div class="rel-tabela-topo">
        <h3>Ranking de vendedores</h3>
        <span class="muted">Do maior faturamento para o menor.</span>
      </div>
      <div class="table-scroll">
        <table class="table rel-tabela">
          <thead><tr>
            <th>#</th><th>Vendedor</th><th class="rel-num">Pedidos</th>
            <th class="rel-num">Clientes</th><th class="rel-num">Itens</th>
            <th class="rel-num">Ticket médio</th><th class="rel-num">Faturamento</th>
          </tr></thead>
          <tbody>
            ${grupos.length ? grupos.map((g, pos) => `
              <tr>
                <td class="rel-num">${pos + 1}</td>
                <td><button type="button" class="rel-link" data-rel-vendedor="${escapeHtml(g.vendedorId)}" title="Ver as vendas deste vendedor">${escapeHtml(g.vendedorNome)}</button></td>
                <td class="rel-num">${g.indicadores.pedidos}</td>
                <td class="rel-num">${g.indicadores.clientes}</td>
                <td class="rel-num">${relNum(g.indicadores.itens)}</td>
                <td class="rel-num">${relBRL(g.indicadores.ticketMedio)}</td>
                <td class="rel-num"><strong>${relBRL(g.indicadores.faturamento)}</strong></td>
              </tr>
            `).join('') : relTabelaVazia('Nenhuma venda no recorte escolhido.', 7)}
          </tbody>
        </table>
      </div>
    </section>
  `;

  content.innerHTML = `
    <div class="workspace">
      ${relCabecalho(ctx, souEuSozinho ? 'Meu Desempenho' : 'Relatório por Vendedor',
        souEuSozinho ? 'Seus números de venda no recorte escolhido.' : 'Quanto cada vendedor fechou, do maior para o menor.', false)}
      ${relBarraDeFiltros(ctx, rel)}
      ${souEuSozinho ? meuDesempenho() : ranking()}
      ${souEuSozinho ? '' : `
        <section class="panel">
          <h3>Faturamento por vendedor</h3>
          ${window.MavisPainel.graficoBarras(grupos.map((g) => ({ label: g.vendedorNome, valor: g.indicadores.faturamento })), escapeHtml, { formato: 'moeda', vazio: 'Sem vendas no recorte.' })}
        </section>`}
      ${relPorVendedor(ctx, rel)}
    </div>
  `;
  relLigarFiltros(ctx);
  relLigarCliques(ctx);
};

// --- Relatório Financeiro --------------------------------------------------
window.MavisSubscreenRegistry.reports.financeiro = async function relFinanceiro(ctx) {
  const { content, dados, escapeHtml } = ctx;
  const pagar = dados.financeiro?.contasAPagar || {};
  const receber = dados.financeiro?.contasAReceber || {};
  content.innerHTML = `
    <div class="workspace">
      ${relCabecalho(ctx, 'Relatório Financeiro', 'Receitas, despesas e o que está em aberto.', true)}
      <div class="finance-stat-cards">
        ${financeStatCard({ tone: 'green', label: 'A receber', value: relBRL(receber.total), sub: `Vencidas ${relBRL(receber.vencidas)}` })}
        ${financeStatCard({ tone: 'red', label: 'A pagar', value: relBRL(pagar.total), sub: `Vencidas ${relBRL(pagar.vencidas)}` })}
        ${financeStatCard({ tone: 'blue', label: 'Recebido', value: relBRL(receber.recebidas) })}
        ${financeStatCard({ tone: 'purple', label: 'Pago', value: relBRL(pagar.pagas) })}
      </div>
      <section class="panel finance-panel-stripe-chart">
        <h3>Fluxo no período</h3>
        <div class="finance-chart-legend">
          <span><i class="finance-legend-dot finance-legend-receita"></i> Receitas</span>
          <span><i class="finance-legend-dot finance-legend-despesa"></i> Despesas</span>
          <span><i class="finance-legend-line"></i> Saldo</span>
        </div>
        <div class="finance-chart-wrap">
          ${financeBuildChartSvg(dados.serieFinanceiro || [], escapeHtml)}
        </div>
      </section>
    </div>
  `;
  relLigarPeriodo(ctx);
};

// --- Relatório de Estoque --------------------------------------------------
window.MavisSubscreenRegistry.reports.estoque = async function relEstoque(ctx) {
  const { content, dados, escapeHtml } = ctx;
  const e = dados.estoque || {};
  const maiores = e.maiores || [];
  content.innerHTML = `
    <div class="workspace">
      ${relCabecalho(ctx, 'Relatório de Estoque', 'Quanto dinheiro está parado, e em quê.', false)}
      <div class="finance-stat-cards">
        ${financeStatCard({ tone: 'blue', label: 'Produtos', value: String(e.totalProdutos || 0) })}
        ${financeStatCard({ tone: 'teal', label: 'Valor em estoque', value: relBRL(e.valorTotal) })}
        ${financeStatCard({ tone: 'red', label: 'Sem saldo', value: String(e.semSaldo || 0) })}
      </div>
      <section class="panel">
        <div class="rel-tabela-topo">
          <h3>Maiores valores parados</h3>
          <span class="muted">Custo × quantidade, do maior para o menor.</span>
        </div>
        <div class="table-scroll">
          <table class="table rel-tabela">
            <thead><tr><th>Produto</th><th>SKU</th><th class="rel-num">Qtd.</th><th class="rel-num">Custo</th><th class="rel-num">Valor parado</th></tr></thead>
            <tbody>
              ${maiores.length ? maiores.map((p) => `
                <tr>
                  <td>${escapeHtml(p.name || '')}</td>
                  <td class="muted">${escapeHtml(p.sku || '')}</td>
                  <td class="rel-num">${relNum(p.quantidade)}</td>
                  <td class="rel-num">${relBRL(p.custo)}</td>
                  <td class="rel-num"><strong>${relBRL(p.valor)}</strong></td>
                </tr>
              `).join('') : relTabelaVazia('Nenhum produto com saldo e custo informados.', 5)}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
};
