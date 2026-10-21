window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

const FINANCE_ENTRY_TYPE_OPTIONS = [
  { value: 'receita', label: 'Receita' },
  { value: 'despesa', label: 'Despesa' },
  { value: 'transferencia', label: 'Transferência' }
];

// A SITUAÇÃO DA BUSCA AVANÇADA (fase EI): as de sempre, uma a uma, e as
// junções que as abas usam — o servidor aceita várias separadas por vírgula.
// Ver MavisListaDeLancamentos.ABAS.
const FINANCE_SITUACAO_OPCOES = [
  { value: '', label: 'Todas' },
  { value: 'pendente,vencido,parcial', label: 'Em aberto (a vencer, vencido ou parcial)' },
  { value: 'pendente', label: 'A vencer' },
  { value: 'vencido,parcial-vencido', label: 'Vencido (inclui parcial vencido)' },
  { value: 'parcial', label: 'Parcial' },
  { value: 'pago,recebido', label: 'Pago ou recebido' },
  { value: 'pago', label: 'Pago' },
  { value: 'recebido', label: 'Recebido' },
  { value: 'cancelado', label: 'Cancelado' }
];

// O ATALHO DE VENCIMENTO da barra de busca. Vai para o estado pelo NOME, e
// vira datas só na hora de perguntar ao servidor — "Vence hoje" deixado aberto
// de um dia para o outro mostra o dia de quem olha, como os períodos de Vendas.
const FINANCE_VENCIMENTOS = [
  { chave: '', rotulo: 'Qualquer data' },
  { chave: 'hoje', rotulo: 'Vence hoje' },
  { chave: 'amanha', rotulo: 'Vence amanhã' },
  { chave: '7dias', rotulo: 'Próximos 7 dias' },
  { chave: '30dias', rotulo: 'Próximos 30 dias' },
  { chave: 'mes', rotulo: 'Este mês' },
  { chave: 'proximomes', rotulo: 'Próximo mês' },
  { chave: 'mespassado', rotulo: 'Mês passado' },
  { chave: 'personalizado', rotulo: 'Personalizado…' }
];

const FINANCE_POR_PAGINA = [15, 30, 50, 100];

// Quantos caracteres da descrição a coluna mostra (pedido de 13/10/2026). O
// texto inteiro fica no `title` da célula e no modal do lançamento.
const FINANCE_DESCRICAO_LIMITE = 60;

// A data de hoje no fuso de quem olha. toISOString() é UTC: no Brasil, depois
// das 21h, já devolve o dia seguinte — e a baixa nasceria com a data de amanhã.
function financeHojeLocal(deslocamentoEmDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + deslocamentoEmDias);
  return financeDataIso(d);
}

function financeDataIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function financePeriodoDeVencimento(chave) {
  const hoje = new Date();
  const mes = (deslocamento) => ({
    dueFrom: financeDataIso(new Date(hoje.getFullYear(), hoje.getMonth() + deslocamento, 1)),
    // Dia 0 do mês seguinte = último dia deste: o Date resolve fevereiro sozinho.
    dueTo: financeDataIso(new Date(hoje.getFullYear(), hoje.getMonth() + deslocamento + 1, 0))
  });
  if (chave === 'hoje') return { dueFrom: financeHojeLocal(), dueTo: financeHojeLocal() };
  if (chave === 'amanha') return { dueFrom: financeHojeLocal(1), dueTo: financeHojeLocal(1) };
  // "Próximos 7 dias" conta hoje: hoje + 6.
  if (chave === '7dias') return { dueFrom: financeHojeLocal(), dueTo: financeHojeLocal(6) };
  if (chave === '30dias') return { dueFrom: financeHojeLocal(), dueTo: financeHojeLocal(29) };
  if (chave === 'mes') return mes(0);
  if (chave === 'proximomes') return mes(1);
  if (chave === 'mespassado') return mes(-1);
  return null;
}

// O que ainda falta pagar ou receber. O servidor manda pronto (`emAberto`, a
// regra da rota de baixa: juros, multa e desconto entram); "previsto menos
// realizado" fica só para resposta antiga sem o campo, e erra no cartão
// baixado pelo líquido — a taxa apareceria "em aberto" num título pago.
function financeEmAberto(entry) {
  if (entry.emAberto != null) return Number(entry.emAberto) || 0;
  if (entry.status === 'cancelado' || entry.status === 'pago' || entry.status === 'recebido') return 0;
  return Math.max(0, Number(entry.amountPrevisto || 0) - Number(entry.amountRealizado || 0));
}

// O CATÁLOGO DE COLUNAS (fase EI), no padrão de SALES_COLUNAS: a tabela, o
// seletor de colunas e a preferência salva leem esta lista. `ordem` é a chave
// que o servidor ordena (MavisListaDeLancamentos.ORDENAVEIS); coluna sem ela
// não ganha cabeçalho clicável. `f` traz os formatadores que dependem do ctx.
//
// 16/10/2026, pedido do usuário: "inverta os campos de descrição e empresa ...
// também retire o código e coloque as contas bancárias". A Conta bancária
// ocupa o lugar do Código, Empresa e Descrição trocaram de lugar, e o Código
// deixou de ser fixo: continua no seletor de colunas, no fim, para quem quiser.
const FINANCE_LISTA_COLUNAS = [
  { chave: 'bankAccount', rotulo: 'Conta bancária', ordem: 'bankAccount', valor: (e, f) => f.cortado(e.bankAccountName, 'is-curto') },
  { chave: 'date', rotulo: 'Data', ordem: 'date', valor: (e) => financeFormatDate(e.date) },
  { chave: 'dueDate', rotulo: 'Vencimento', ordem: 'dueDate', valor: (e) => financeFormatDate(e.dueDate) },
  // De qual empresa é o título (15/10/2026): nome e CNPJ (ou a raiz, quando a
  // empresa tem várias filiais e o título não diz qual). Ver
  // empresasDosTitulos no servidor.
  {
    chave: 'empresa',
    rotulo: 'Empresa',
    valor: (e, f) => {
      if (!e.empresaNome && !e.empresaCnpj) return '-';
      const doc = String(e.empresaCnpj || '');
      const cnpj = doc.length === 14
        ? doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
        : (doc.length === 8 ? doc.replace(/(\d{2})(\d{3})(\d{3})/, '$1.$2.$3') : doc);
      return `<span class="fin-empresa">${f.cortado(e.empresaNome || cnpj, 'is-curto', `${e.empresaNome || ''} ${cnpj}`.trim())}${e.empresaNome && cnpj ? `<span class="muted">${f.esc(cnpj)}</span>` : ''}</span>`;
    }
  },
  { chave: 'type', rotulo: 'Tipo', ordem: 'type', valor: (e, f) => FINANCE_TYPE_LABEL[e.type] || f.esc(e.type || '-') },
  { chave: 'category', rotulo: 'Categoria', ordem: 'category', valor: (e, f) => f.cortado(e.categoryName, 'is-curto') },
  { chave: 'clienteFornecedor', rotulo: 'Cliente/Fornecedor', ordem: 'clienteFornecedor', valor: (e, f) => f.cortado(e.clienteFornecedor, 'is-medio') },
  {
    chave: 'description',
    rotulo: 'Descrição',
    ordem: 'description',
    // O RESUMO, E NÃO SÓ O CORTE: 98% das descrições começam com a mesma frase
    // do Viper, e cortar sem resumir deixaria todas as linhas iguais. Ver
    // `resumir` em shared/descricao_lancamento.js.
    valor: (e, f) => {
      const inteira = String(e.description || '').trim();
      if (!inteira) return '-';
      const D = window.MavisDescricaoLancamento;
      const curta = D && D.resumir ? D.cortar(D.resumir(inteira), FINANCE_DESCRICAO_LIMITE) : inteira;
      return `<span class="texto-cortado" title="${f.esc(inteira)}">${f.esc(curta)}</span>`;
    }
  },
  { chave: 'amountPrevisto', rotulo: 'Valor previsto', ordem: 'amount', dinheiro: true, valor: (e) => financeFormatBRL(e.amountPrevisto) },
  { chave: 'amountRealizado', rotulo: 'Valor realizado', dinheiro: true, valor: (e) => financeFormatBRL(e.amountRealizado) },
  { chave: 'emAberto', rotulo: 'Em aberto', dinheiro: true, valor: (e) => financeFormatBRL(financeEmAberto(e)) },
  {
    chave: 'status',
    rotulo: 'Situação',
    ordem: 'status',
    // O parcial cujo vencimento passou aparece na aba Vencidos: o selo diz
    // por quê, em vez de um "Parcial" amarelo no meio dos vermelhos.
    valor: (e) => (e.status === 'parcial' && e.dueDate && e.dueDate < financeHojeLocal()
      ? '<span class="finance-badge finance-badge-danger">Parcial vencido</span>'
      : financeStatusBadge(e.status))
  },
  {
    chave: 'document',
    rotulo: 'Documento',
    ordem: 'document',
    // O Documento nasce com o código na frente ("LF0042 · 000123", fase AY):
    // aqui fica só a referência externa, que é o que distingue uma linha da
    // outra. O inteiro vai no title (e o código tem coluna própria, opcional).
    valor: (e, f) => {
      const C = window.MavisLancamentoCodigo;
      return f.cortado(C ? C.referencia(e.code, e.document) : e.document, 'is-curto', e.document);
    }
  },
  { chave: 'costCenter', rotulo: 'Centro de custo', ordem: 'costCenter', valor: (e, f) => f.cortado(e.costCenterName, 'is-curto') },
  // Fase EN (14/10/2026): a forma de pagamento do título.
  { chave: 'paymentMethod', rotulo: 'Forma de pagamento', valor: (e, f) => f.cortado(e.paymentMethodName, 'is-curto') },
  { chave: 'createdByName', rotulo: 'Lançado por', valor: (e, f) => f.cortado(e.createdByName, 'is-curto') },
  { chave: 'codigo', rotulo: 'Código', ordem: 'codigo', valor: (e, f) => f.esc(e.codigo || '-') }
];

// Para quem nunca escolheu. A ordem na tela é a do catálogo, não a desta lista.
const FINANCE_COLUNAS_PADRAO = ['bankAccount', 'date', 'dueDate', 'empresa', 'type', 'category', 'clienteFornecedor', 'description', 'paymentMethod', 'amountPrevisto', 'amountRealizado', 'status', 'document'];
// A troca de 16/10/2026 vale também para quem já tinha escolhido as colunas:
// UMA VEZ, sai o Código e entra a Conta bancária (preferência sem `layout`, ou
// com um menor que este). Ao mexer no seletor, a preferência passa a ter este
// layout, e daí em diante a escolha é só da pessoa.
const FINANCE_LAYOUT_DAS_COLUNAS = 2;
// Colunas que entraram depois de o seletor existir: aparecem também para quem
// já tinha escolhido as suas, uma vez — se a pessoa tirar, fica tirada
// (`conhecidas` guarda o que ela já viu no seletor).
const FINANCE_COLUNAS_NOVAS = ['empresa'];

const financeFiltrosVazios = () => ({
  search: '', type: '', status: '', periodo: '', clientSupplierId: '', category: '', costCenter: '', bankAccountId: '',
  dateFrom: '', dateTo: '', dueFrom: '', dueTo: '', amountMin: '', amountMax: '',
  // A empresa (raiz do CNPJ) e a filial (CNPJ inteiro) — 19/10/2026.
  empresa: '', filial: ''
});

// TRÊS TELAS, UMA LISTA (14/10/2026). Pedido do usuário: separar em duas
// telas os lançamentos, contas a pagar e contas a receber. "Contas a Pagar" e
// "Contas a Receber" são esta mesma lista com o tipo fixo (despesa / receita),
// cada uma com o seu estado (filtros, página, seleção). "Lançamentos" continua
// como a visão geral — é a única que mostra as transferências entre contas.
const FINANCE_TELAS_DE_LANCAMENTOS = {
  lancamentos: { titulo: 'Lançamentos', tipoFixo: '', novo: 'Novo Lançamento' },
  contas_a_pagar: { titulo: 'Contas a Pagar', tipoFixo: 'despesa', novo: 'Nova Conta a Pagar' },
  contas_a_receber: { titulo: 'Contas a Receber', tipoFixo: 'receita', novo: 'Nova Conta a Receber' }
};

function criarTelaDeLancamentos(telaChave) {
  const tela = FINANCE_TELAS_DE_LANCAMENTOS[telaChave];
  const tipoFixo = tela.tipoFixo;
  return async function renderFinanceLancamentos(ctx) {
  const { content, api, showToast, state, loadModule, escapeHtml, confirmModal } = ctx;
  const Lista = window.MavisListaDeLancamentos;

  let meta = { categories: [], costCenters: [], bankAccounts: [], directory: [] };

  // O ESTADO DA LISTA MORA NO `state` (fase EI). Era local a esta função, e
  // toda volta à tela — abrir um lançamento para editar e voltar, ir ao pedido
  // e voltar — recomeçava na página 1, sem filtro, sem a ordem escolhida.
  // Seleção, filtros, página e ordem agora sobrevivem à navegação da sessão.
  const preferencia = (state.preferences && state.preferences.finance_lancamentos) || {};
  state.financeListas = state.financeListas || {};
  const lista = state.financeListas[telaChave] || (state.financeListas[telaChave] = {
    filtros: financeFiltrosVazios(),
    page: 1,
    limit: FINANCE_POR_PAGINA.includes(preferencia.limit) ? preferencia.limit : 15,
    sort: '',
    dir: 'desc',
    selecao: {},
    showAdvanced: false,
    showColunas: false
  });
  // QUEM CHEGA COM UM FILTRO PRONTO, uma vez: o pedido faturado em várias
  // parcelas manda para cá procurando pelo código dele (app.js). Esse filtro
  // era montado e ignorado — a tela abria a lista inteira.
  if (state.financeFilters) {
    lista.filtros = Object.assign(financeFiltrosVazios(), state.financeFilters);
    lista.page = 1;
    state.financeFilters = null;
  }

  // A LISTA NÃO ESPERA O META (fase DS).
  //
  // A tela pedia /api/finance/meta (2.818 KB: diretório de 6.492 pessoas e
  // 5.560 produtos) e SÓ DEPOIS a lista — 798 + 1.523 ms em fila na medição de
  // base. A primeira pintura não lê nada do meta: categorias, centros, contas e
  // diretório só aparecem na busca avançada, e as contas no modal de baixa.
  //
  // Então o meta sai junto com a lista, e sem o que a tela não lê: nem produtos
  // (só a emissão de NF-e lê), nem diretório (29 KB no lugar de 2.818). O
  // diretório vem quando a busca avançada abre pela primeira vez. Quem precisa
  // do meta espera por `metaPronto` — o modal de baixa e a busca avançada.
  const metaPronto = api('/api/finance/meta?produtos=0&diretorio=0')
    .then((resposta) => { meta = { ...meta, ...resposta, directory: meta.directory }; })
    .catch(() => {
      // segue com metadados vazios: a lista funciona, só os selects ficam sem opções
      showToast('Não foi possível carregar categorias/centros de custo/contas bancárias para os filtros.', 'warning');
    });
  let diretorioPronto = null;
  let opcoesDoDiretorio = [];
  function carregarDiretorio() {
    if (!diretorioPronto) {
      diretorioPronto = api('/api/finance/meta?produtos=0&diretorio=resumido')
        .then((resposta) => {
          meta.directory = resposta.directory || [];
          // Montadas UMA vez: o campo de busca indexa estas opções a cada
          // desenho do painel, e refazer 6.492 rótulos por página virada é o
          // custo que este campo existe para evitar. Mesmo rótulo do <option>
          // que havia aqui: "Nome (código)".
          // O CPF/CNPJ entra para a busca achar por ele (14/10/2026).
          opcoesDoDiretorio = meta.directory.map((item) => ({
            value: item.id,
            label: `${item.name}${item.code ? ` (${item.code})` : ''}`,
            documento: item.document || '',
            buscaExtra: item.tradeName || '',
            detalhe: [item.tradeName, typeof formatarDocumentoParaBusca === 'function' ? formatarDocumentoParaBusca(item.document) : ''].filter(Boolean).join(' · ')
          }));
        })
        .catch(() => {
          diretorioPronto = null;
          showToast('Não foi possível carregar a lista de clientes/fornecedores para o filtro.', 'warning');
        });
    }
    return diretorioPronto;
  }

  function optionList(list, selecionado) {
    return (list || []).map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selecionado ? 'selected' : ''}>${escapeHtml(item.name)}${item.code ? ` (${escapeHtml(item.code)})` : ''}</option>`).join('');
  }

  const brl = (v) => financeFormatBRL(v);
  const numero = (v) => Number(v || 0).toLocaleString('pt-BR');
  const formatadores = {
    esc: escapeHtml,
    // Texto de cadastro (categoria, cliente, documento) cortado na largura da
    // coluna, com o texto inteiro no title. Ver .texto-cortado no app.css.
    cortado: (texto, tamanho, titulo) => {
      const t = String(texto || '').trim();
      if (!t) return '-';
      return `<span class="texto-cortado ${tamanho || ''}" title="${escapeHtml(String(titulo || t))}">${escapeHtml(t)}</span>`;
    }
  };

  function porPagina() {
    return FINANCE_POR_PAGINA.includes(lista.limit) ? lista.limit : 15;
  }

  function colunasVisiveis() {
    const salvas = state.preferences && state.preferences.finance_lancamentos
      ? state.preferences.finance_lancamentos.colunas
      : null;
    let validas = Array.isArray(salvas) ? salvas.filter((c) => FINANCE_LISTA_COLUNAS.some((col) => col.chave === c)) : [];
    const layout = Number((state.preferences && state.preferences.finance_lancamentos && state.preferences.finance_lancamentos.layout) || 1);
    if (validas.length && layout < FINANCE_LAYOUT_DAS_COLUNAS) {
      validas = validas.filter((c) => c !== 'codigo');
      if (!validas.includes('bankAccount')) validas.push('bankAccount');
    }
    const conhecidas = (state.preferences && state.preferences.finance_lancamentos && state.preferences.finance_lancamentos.conhecidas) || [];
    const escolhidas = validas.length
      ? validas.concat(FINANCE_COLUNAS_NOVAS.filter((c) => !conhecidas.includes(c)))
      : FINANCE_COLUNAS_PADRAO;
    // Em Contas a Pagar e a Receber o tipo é um só: a coluna repetiria
    // "Despesa"/"Receita" em todas as linhas (15/10/2026).
    return FINANCE_LISTA_COLUNAS.filter((col) => (col.fixa || escolhidas.includes(col.chave)) && !(tipoFixo && col.chave === 'type'));
  }

  function salvarPreferenciaDaLista(mudanca) {
    const atual = (state.preferences && state.preferences.finance_lancamentos) || {};
    const valor = Object.assign({}, atual, mudanca);
    if (typeof salvarPreferencia === 'function') salvarPreferencia('finance_lancamentos', valor);
    else state.preferences = Object.assign({}, state.preferences || {}, { finance_lancamentos: valor });
  }

  // A EMPRESA DOS TÍTULOS (19/10/2026, pedido do usuário: "escolher a empresa
  // referente que eu quero ver os títulos e não mostrar tudo embaralhado").
  // As empresas vêm do meta (uma por raiz de CNPJ, com as filiais); a regra de
  // qual título é de qual empresa é a da coluna Empresa, no servidor.
  //
  // UM CAMPO SÓ (19/10/2026, pedido do usuário: "está faltando empresas aqui"
  // — as lojas da Plus ficavam num segundo campo, que só aparecia depois de
  // escolher a Plus). Cada empresa e, logo abaixo da que tem várias, as lojas
  // dela. O valor diz qual das duas: a raiz (8 dígitos) é a empresa inteira; o
  // CNPJ (14), a loja.
  function opcoesDeEmpresa() {
    const f = lista.filtros;
    const empresas = meta.empresas || [];
    const marcada = f.filial || f.empresa;
    const opcao = (valor, texto) => `<option value="${escapeHtml(valor)}" ${marcada === valor ? 'selected' : ''}>${texto}</option>`;
    // A escolhida antes de o meta chegar continua escolhida.
    const conhecida = empresas.some((e) => e.raiz === marcada || (e.filiais || []).some((fl) => fl.cnpj === marcada));
    const semNome = marcada && !conhecida ? opcao(marcada, escapeHtml(marcada)) : '';
    return `<option value="">Todas</option>${semNome}${empresas.map((e) => {
      const lojas = e.filiais || [];
      if (lojas.length <= 1) return opcao(e.raiz, escapeHtml(e.nome));
      return opcao(e.raiz, `${escapeHtml(e.nome)} (todas)`)
        + lojas.map((fl) => opcao(fl.cnpj, `\u00a0\u00a0\u00a0\u00a0${escapeHtml(fl.nome)}`)).join('');
    }).join('')}`;
  }
  // O meta chega depois da primeira pintura (fase DS): as empresas entram no
  // campo quando ele chegar, sem redesenhar a lista.
  metaPronto.then(() => {
    const campo = document.getElementById('financeEmpresaRapida');
    if (campo && telaAtiva()) campo.innerHTML = opcoesDeEmpresa();
  });

  // A PERGUNTA AO SERVIDOR. `paginado: false` é a exportação: mesmos filtros
  // e mesma ordem, sem página.
  function consulta({ paginado = true } = {}) {
    const f = lista.filtros;
    const params = new URLSearchParams();
    if (paginado) {
      params.set('page', String(lista.page));
      params.set('limit', String(porPagina()));
    }
    ['search', 'type', 'status', 'clientSupplierId', 'category', 'costCenter', 'bankAccountId', 'dateFrom', 'dateTo', 'amountMin', 'amountMax', 'empresa', 'filial']
      .forEach((campo) => { if (f[campo]) params.set(campo, f[campo]); });
    // Contas a Pagar / a Receber: o tipo vai sempre, e não é um filtro que a
    // pessoa limpa (não entra em `lista.filtros`).
    if (tipoFixo) params.set('type', tipoFixo);
    // Atalho de vencimento vira datas agora; "Personalizado" usa as digitadas.
    const atalho = financePeriodoDeVencimento(f.periodo);
    const dueFrom = atalho ? atalho.dueFrom : f.dueFrom;
    const dueTo = atalho ? atalho.dueTo : f.dueTo;
    if (dueFrom) params.set('dueFrom', dueFrom);
    if (dueTo) params.set('dueTo', dueTo);
    if (lista.sort) {
      params.set('sort', lista.sort);
      params.set('dir', lista.dir === 'asc' ? 'asc' : 'desc');
    }
    return params;
  }

  // A última resposta da lista e a consulta que a produziu: abrir e fechar a
  // busca avançada, marcar uma linha, escolher colunas — tudo isso redesenha
  // com ela, sem ir ao servidor.
  let ultimoResultado = null;
  let ultimaConsulta = '';
  // RESPOSTA VELHA NÃO PINTA POR CIMA DA NOVA. Com a busca enquanto se digita,
  // dois pedidos podem estar no ar ao mesmo tempo, e o primeiro a sair pode
  // chegar por último — a tabela mostraria o resultado de "25" com "2500" na
  // caixa. Cada pedido leva um número; só o mais recente desenha.
  let pedidoAtual = 0;

  // ESTA TELA AINDA É A DA VEZ? A busca espera 450 ms antes de ir ao servidor,
  // e a resposta pode chegar depois de a pessoa ter ido para outra tela — ou
  // saído e voltado, o que cria outra instância desta função. Sem esta
  // conferência, a lista seria desenhada por cima da tela que está aberta.
  const instancia = {};
  state.financeListaInstancia = instancia;
  // Lido e apagado JÁ: se a pessoa sair antes da lista chegar, o id não fica
  // para trás abrindo o modal numa visita futura — nem sobre outra tela.
  const idParaAbrir = state.financeOpenEntryId;
  state.financeOpenEntryId = null;
  const telaAtiva = () => state.financeListaInstancia === instancia
    && state.activeModule === 'finance' && state.activeSub === telaChave;

  async function load() {
    if (!telaAtiva()) return;
    const params = consulta();
    const chave = params.toString();
    const meu = ++pedidoAtual;
    document.getElementById('financeListaPainel')?.classList.add('finance-lista-carregando');
    let result;
    try {
      result = await api(`/api/finance/entries?${chave}`);
    } catch (error) {
      if (meu !== pedidoAtual || !telaAtiva()) return;
      if (ultimoResultado) {
        // Já há uma lista na tela: ela fica, e o erro vai num aviso — trocar a
        // tela inteira por uma mensagem faria perder filtros e seleção de vista.
        document.getElementById('financeListaPainel')?.classList.remove('finance-lista-carregando');
        showToast(`Erro ao carregar lançamentos: ${error.message || 'erro desconhecido'}`, 'error');
        return;
      }
      content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar lançamentos: ${escapeHtml(error.message || 'erro desconhecido')}</p></div>`;
      return;
    }
    if (meu !== pedidoAtual || !telaAtiva()) return;
    // PÁGINA ALÉM DO FIM: baixou ou cancelou o último da última página, ou
    // filtrou estando na página 9. Volta para a última que existe, em vez de
    // mostrar "Página 9 de 2" vazia.
    const ultimaPagina = Math.max(1, Math.ceil((result.total || 0) / porPagina()));
    if (lista.page > ultimaPagina) {
      lista.page = ultimaPagina;
      return load();
    }
    ultimoResultado = result;
    ultimaConsulta = chave;
    // O RETRATO DOS SELECIONADOS QUE VIERAM NESTA RESPOSTA é renovado: baixou
    // um deles pelo modal, e a barra continuaria somando o saldo de antes e
    // oferecendo "Baixar" para um título já pago.
    (result.entries || []).forEach((entry) => { if (estaSelecionado(entry.id)) marcar(entry, true); });
    // O painel aberto precisa das listas dos selects antes de desenhar.
    if (lista.showAdvanced) await Promise.all([metaPronto, carregarDiretorio()]);
    if (meu !== pedidoAtual || !telaAtiva()) return;
    renderView(result);
  }

  // Redesenha com a última resposta — ou vai ao servidor, se a consulta mudou
  // desde ela (a busca digitada e ainda não enviada, por exemplo).
  async function redesenhar() {
    if (!ultimoResultado || consulta().toString() !== ultimaConsulta) return load();
    if (lista.showAdvanced) await Promise.all([metaPronto, carregarDiretorio()]);
    if (!telaAtiva()) return undefined;
    renderView(ultimoResultado);
    return undefined;
  }

  function irParaPagina(n) {
    lista.page = n;
    load();
  }

  function mudarFiltro(mudanca) {
    Object.assign(lista.filtros, mudanca);
    lista.page = 1;
    descartarRascunho = true;
    load();
  }

  // --- Seleção ---------------------------------------------------------------
  //
  // A seleção guarda um RETRATO de cada linha marcada (código, situação,
  // valores), e não só o id: assim ela atravessa páginas — marcar na 1, ir à 2,
  // marcar mais — e a barra continua sabendo somar e dizer quem pode ser
  // baixado. O retrato é renovado a cada resposta que traz a linha (load), e
  // os valores do modal do lote vêm de uma prévia do servidor — o retrato de
  // uma linha de outra página pode estar velho.
  const retrato = (e) => ({
    id: e.id, codigo: e.codigo, rawStatus: e.rawStatus, status: e.status, type: e.type,
    description: e.description, amountPrevisto: e.amountPrevisto, amountRealizado: e.amountRealizado,
    emAberto: e.emAberto
  });
  // UM LOTE POR VEZ. Fechar o modal no meio do envio deixava a barra com
  // "Baixar" ativo e a mesma seleção — e um segundo envio baixava tudo de
  // novo. Enquanto um lote está no ar, a barra trava e o modal não fecha. (O
  // servidor também trava por lançamento: é a garantia de verdade.)
  let loteEmAndamento = false;
  const selecionados = () => Object.values(lista.selecao);
  const estaSelecionado = (id) => Object.prototype.hasOwnProperty.call(lista.selecao, id);
  function marcar(entry, sim) {
    if (sim) lista.selecao[entry.id] = retrato(entry);
    else delete lista.selecao[entry.id];
  }

  function barraDeLote() {
    const itens = selecionados();
    if (!itens.length) return '';
    const somaPor = (tipo) => itens.filter((l) => l.type === tipo && l.status !== 'cancelado')
      .reduce((s, l) => s + Number(l.amountPrevisto || 0), 0);
    const receitas = somaPor('receita');
    const despesas = somaPor('despesa');
    const emAberto = itens.reduce((s, l) => s + financeEmAberto(l), 0);
    const idsDaPagina = new Set(((ultimoResultado && ultimoResultado.entries) || []).map((e) => e.id));
    const foraDaPagina = itens.filter((l) => !idsDaPagina.has(l.id)).length;
    const baixa = Lista.avaliar('baixar', itens);
    const cancela = Lista.avaliar('cancelar', itens);
    // O botão diz para QUANTOS vale. Zero elegíveis = desabilitado com o
    // primeiro motivo, que é o que a pessoa precisa saber.
    const botao = (acao, avaliacao, classe) => {
      const motivo = loteEmAndamento
        ? 'Aguarde: uma ação em lote está sendo gravada.'
        : (avaliacao.elegiveis.length ? '' : ((avaliacao.ignorados[0] && avaliacao.ignorados[0].motivo) || 'Nenhum selecionado pode.'));
      const parcial = avaliacao.elegiveis.length && avaliacao.elegiveis.length < itens.length;
      return `<button type="button" class="${classe}" data-lote="${acao}" ${motivo ? 'disabled' : ''}
        title="${escapeHtml(motivo || `${avaliacao.elegiveis.length} de ${itens.length} selecionado(s)`)}">${Lista.ACOES[acao].rotulo}${parcial ? ` (${avaliacao.elegiveis.length})` : ''}</button>`;
    };
    return `
      <div class="sales-lote-barra">
        <strong>${numero(itens.length)} selecionado${itens.length === 1 ? '' : 's'}</strong>
        <span class="finance-lote-soma">
          ${receitas ? `Receitas ${brl(receitas)} · ` : ''}${despesas ? `Despesas ${brl(despesas)} · ` : ''}Em aberto ${brl(emAberto)}${foraDaPagina ? ` · ${numero(foraDaPagina)} em outras páginas` : ''}
        </span>
        ${botao('baixar', baixa, 'secondary')}
        ${botao('cancelar', cancela, 'btn-danger')}
        ${podeExcluir() ? botao('excluir', Lista.avaliar('excluir', itens), 'btn-danger') : ''}
        <button type="button" class="secondary" data-lote="exportar">Exportar selecionados</button>
        <button type="button" class="secondary" data-lote="limpar">Limpar seleção</button>
      </div>`;
  }

  // Marcar uma linha NÃO redesenha a tabela: só a barra, a cor da linha e a
  // caixa do cabeçalho. Redesenhar tudo jogaria a rolagem para o topo a cada
  // clique numa lista de 100.
  function atualizarSelecao() {
    const barra = document.getElementById('financeLoteBarra');
    if (barra) {
      barra.innerHTML = barraDeLote();
      ligarBarraDeLote();
    }
    const entries = (ultimoResultado && ultimoResultado.entries) || [];
    content.querySelectorAll('.finance-entry-row').forEach((linha) => {
      const sim = estaSelecionado(linha.dataset.id);
      linha.classList.toggle('is-selecionada', sim);
      const caixa = linha.querySelector('.finance-selecionar');
      if (caixa) caixa.checked = sim;
    });
    const todas = document.getElementById('financeSelecionarPagina');
    if (todas) {
      const marcadas = entries.filter((e) => estaSelecionado(e.id)).length;
      todas.checked = entries.length > 0 && marcadas === entries.length;
      todas.indeterminate = marcadas > 0 && marcadas < entries.length;
    }
  }

  // --- Desenho ---------------------------------------------------------------

  // A TELA É REDESENHADA A CADA RESPOSTA, e a busca anda enquanto se digita.
  // Sem guardar e devolver, cada resposta tiraria a pessoa do campo no meio da
  // palavra — ou apagaria o "Valor mínimo" que ela digitava no painel avançado
  // enquanto a busca de cima ainda respondia. Guarda-se o campo com foco (e o
  // cursor) e o RASCUNHO do painel: o que está escrito e ainda não foi aplicado.
  //
  // O rascunho só NÃO volta quando quem pediu o desenho mudou os filtros de
  // propósito (Aplicar, Limpar, uma aba, uma etiqueta): aí o painel tem de
  // mostrar o que passou a valer.
  let descartarRascunho = false;
  function lembrarFoco() {
    const memoria = { foco: null, rascunho: null, textoDaPessoa: null };
    const ativo = document.activeElement;
    if (ativo && content.contains(ativo) && (ativo.id || ativo.name)) {
      memoria.foco = { id: ativo.id || '', name: ativo.name || '', inicio: null, fim: null };
      try { memoria.foco.inicio = ativo.selectionStart; memoria.foco.fim = ativo.selectionEnd; } catch (_) { /* select e date não têm cursor */ }
    }
    const form = document.getElementById('financeFilterForm');
    if (form && !descartarRascunho) {
      memoria.rascunho = [...form.elements].filter((el) => el.name && !el.disabled).map((el) => [el.name, el.value]);
      const pessoa = document.getElementById('financeFilterPartyInput');
      if (pessoa) memoria.textoDaPessoa = pessoa.value;
    }
    descartarRascunho = false;
    return memoria;
  }
  function restaurarFoco(memoria) {
    if (!memoria) return;
    const form = document.getElementById('financeFilterForm');
    if (form && memoria.rascunho) {
      memoria.rascunho.forEach(([name, valor]) => {
        const campo = form.elements.namedItem(name);
        if (campo && !campo.disabled && 'value' in campo) campo.value = valor;
      });
      const pessoa = document.getElementById('financeFilterPartyInput');
      if (pessoa && memoria.textoDaPessoa !== null) pessoa.value = memoria.textoDaPessoa;
    }
    if (!memoria.foco) return;
    const { id, name, inicio, fim } = memoria.foco;
    const campo = (id && document.getElementById(id)) || (name && content.querySelector(`[name="${name.replace(/"/g, '')}"]`));
    if (!campo || campo.disabled) return;
    campo.focus();
    if (inicio !== null && inicio !== undefined) {
      try { campo.setSelectionRange(inicio, fim); } catch (_) { /* campo sem cursor */ }
    }
  }

  function dicaDaBusca() {
    const texto = String(lista.filtros.search || '').trim();
    if (!texto) return '';
    const valor = Lista.valorDaBusca(texto);
    const codigo = Lista.codigoDaBusca(texto);
    if (codigo !== null) return `Procurando o lançamento LF${String(codigo).padStart(4, '0')} e o texto "${escapeHtml(texto)}".`;
    if (valor !== null) return `Procurando também pelo valor ${brl(valor)} (previsto, ou líquido do cartão).`;
    return '';
  }

  function abasDeSituacao(resumo) {
    const situacoes = (resumo && resumo.situacoes) || {};
    const todas = Object.values(situacoes).reduce((s, x) => s + (x.quantidade || 0), 0);
    const atual = Lista.situacoesDoFiltro(lista.filtros.status).slice().sort().join();
    return `
      <div class="finance-abas" role="tablist" aria-label="Situação">
        ${Lista.ABAS.map((aba) => {
          // 'parcial-vencido' não é rótulo (ver ABAS): a contagem dele vem à
          // parte, em `parciaisVencidos`, e `situacoes` segue somando a lista.
          const contar = (x) => (x === 'parcial-vencido'
            ? ((resumo && resumo.parciaisVencidos && resumo.parciaisVencidos.quantidade) || 0)
            : ((situacoes[x] && situacoes[x].quantidade) || 0));
          const quantos = aba.status.length ? aba.status.reduce((s, x) => s + contar(x), 0) : todas;
          const ativa = aba.status.slice().sort().join() === atual;
          const perigo = aba.chave === 'vencido' && quantos > 0 && !ativa;
          return `<button type="button" role="tab" aria-selected="${ativa}" class="finance-aba${ativa ? ' is-ativa' : ''}${perigo ? ' is-perigo' : ''}"
            data-aba="${escapeHtml(aba.status.join(','))}">${escapeHtml(aba.rotulo)}<span class="finance-aba-contagem">${numero(quantos)}</span></button>`;
        }).join('')}
      </div>`;
  }

  function faixaDeTotais(resumo) {
    const t = resumo && resumo.totais;
    if (!t || !t.quantidade) return '';
    const saldo = Number(t.receitas || 0) - Number(t.despesas || 0);
    // Contas a Pagar / a Receber: só os totais do lado da tela — "Receitas
    // previstas R$ 0,00" e um saldo negativo numa tela só de despesas confundem.
    if (tipoFixo === 'despesa') {
      return `
      <div class="finance-totais" aria-label="Totais do filtro, todas as páginas">
        <div><span>Despesas previstas</span><strong class="is-despesa">${brl(t.despesas)}</strong></div>
        <div><span>A pagar em aberto</span><strong>${brl(t.aPagar)}</strong></div>
      </div>`;
    }
    if (tipoFixo === 'receita') {
      return `
      <div class="finance-totais" aria-label="Totais do filtro, todas as páginas">
        <div><span>Receitas previstas</span><strong class="is-receita">${brl(t.receitas)}</strong></div>
        <div><span>A receber em aberto</span><strong>${brl(t.aReceber)}</strong></div>
      </div>`;
    }
    return `
      <div class="finance-totais" aria-label="Totais do filtro, todas as páginas">
        <div><span>Receitas previstas</span><strong class="is-receita">${brl(t.receitas)}</strong></div>
        <div><span>Despesas previstas</span><strong class="is-despesa">${brl(t.despesas)}</strong></div>
        <div><span>Saldo previsto</span><strong class="${saldo < 0 ? 'is-despesa' : 'is-receita'}">${brl(saldo)}</strong></div>
        <div><span>A receber em aberto</span><strong>${brl(t.aReceber)}</strong></div>
        <div><span>A pagar em aberto</span><strong>${brl(t.aPagar)}</strong></div>
      </div>`;
  }

  // Os filtros da busca avançada que estão valendo, como etiquetas — com o
  // painel fechado, era a única forma de saber por que a lista tem 12 linhas.
  function etiquetasDeFiltro() {
    const f = lista.filtros;
    const nome = (listaDeNomes, id) => ((listaDeNomes || []).find((x) => x.id === id) || {}).name || 'selecionado';
    const etiquetas = [];
    if (f.clientSupplierId) {
      const pessoa = opcoesDoDiretorio.find((o) => o.value === f.clientSupplierId);
      etiquetas.push({ campos: 'clientSupplierId', texto: `Cliente/Fornecedor: ${pessoa ? pessoa.label : 'selecionado'}` });
    }
    if (f.category) etiquetas.push({ campos: 'category', texto: `Categoria: ${nome(meta.categories, f.category)}` });
    if (f.costCenter) etiquetas.push({ campos: 'costCenter', texto: `Centro de custo: ${nome(meta.costCenters, f.costCenter)}` });
    if (f.bankAccountId) etiquetas.push({ campos: 'bankAccountId', texto: `Conta: ${nome(meta.bankAccounts, f.bankAccountId)}` });
    if (f.dateFrom || f.dateTo) etiquetas.push({ campos: 'dateFrom,dateTo', texto: `Data: ${f.dateFrom ? financeFormatDate(f.dateFrom) : '…'} a ${f.dateTo ? financeFormatDate(f.dateTo) : '…'}` });
    if (f.periodo === 'personalizado' && (f.dueFrom || f.dueTo)) {
      etiquetas.push({ campos: 'dueFrom,dueTo,periodo', texto: `Vencimento: ${f.dueFrom ? financeFormatDate(f.dueFrom) : '…'} a ${f.dueTo ? financeFormatDate(f.dueTo) : '…'}` });
    }
    if (f.amountMin || f.amountMax) etiquetas.push({ campos: 'amountMin,amountMax', texto: `Valor: ${f.amountMin ? brl(f.amountMin) : '…'} a ${f.amountMax ? brl(f.amountMax) : '…'}` });
    const situacao = FINANCE_SITUACAO_OPCOES.find((o) => o.value && o.value === f.status);
    // Situação que nenhuma aba representa (ex.: só "Parcial") também vira etiqueta.
    if (f.status && !Lista.ABAS.some((a) => a.status.join(',') === f.status)) {
      etiquetas.push({ campos: 'status', texto: `Situação: ${situacao ? situacao.label : f.status}` });
    }
    if (!etiquetas.length || lista.showAdvanced) return '';
    return `
      <div class="finance-abas" aria-label="Filtros ativos">
        ${etiquetas.map((e) => `<button type="button" class="finance-aba" data-limpar="${e.campos}" title="Remover este filtro">${escapeHtml(e.texto)} <span aria-hidden="true">×</span></button>`).join('')}
        <button type="button" class="finance-aba" id="financeLimparEtiquetas">Limpar filtros</button>
      </div>`;
  }

  function painelAvancado() {
    const f = lista.filtros;
    const atalho = financePeriodoDeVencimento(f.periodo);
    // Com um atalho de vencimento valendo, as datas mostram o que ele calcula
    // e ficam travadas — desabilitado não entra no FormData, então aplicar o
    // painel não transforma "Próximos 7 dias" em datas fixas sem querer.
    const vencDe = atalho ? atalho.dueFrom : f.dueFrom;
    const vencAte = atalho ? atalho.dueTo : f.dueTo;
    return `
      <form id="financeFilterForm" class="cadastro-filter-panel">
        <div class="cadastro-filter-grid-5">
          <label class="cadastro-field">
            <span>Situação</span>
            <select name="status">
              ${FINANCE_SITUACAO_OPCOES.map((opt) => `<option value="${opt.value}" ${f.status === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('')}
            </select>
          </label>
          <label class="cadastro-field">
            <span>Cliente / Fornecedor</span>
            ${/* CAMPO DE BUSCA, e não <select> (fase DS): eram 6.493 <option>
                 redesenhados a cada página virada com o painel aberto. O
                 <input type="hidden"> leva o mesmo name="clientSupplierId".
                 Fase EI: abre com o escolhido, em vez de vazio. */''}
            ${renderSearchableSelect({
              id: 'financeFilterParty',
              name: 'clientSupplierId',
              options: opcoesDoDiretorio,
              selectedValue: f.clientSupplierId,
              placeholder: 'Todos — buscar por nome, código ou CPF/CNPJ'
            })}
          </label>
          <label class="cadastro-field">
            <span>Plano de Contas</span>
            <select name="category"><option value="">Todos</option>${optionList(meta.categories, f.category)}</select>
          </label>
          <label class="cadastro-field">
            <span>Centro de custo</span>
            <select name="costCenter"><option value="">Todos</option>${optionList(meta.costCenters, f.costCenter)}</select>
          </label>
          <label class="cadastro-field">
            <span>Conta bancária</span>
            <select name="bankAccountId"><option value="">Todas</option>${optionList(meta.bankAccounts, f.bankAccountId)}</select>
          </label>
          <label class="cadastro-field">
            <span>Data inicial</span>
            <input type="date" name="dateFrom" value="${escapeHtml(f.dateFrom)}" />
          </label>
          <label class="cadastro-field">
            <span>Data final</span>
            <input type="date" name="dateTo" value="${escapeHtml(f.dateTo)}" />
          </label>
          <label class="cadastro-field" ${atalho ? 'title="Definido pelo atalho de vencimento da barra de busca"' : ''}>
            <span>Vencimento de</span>
            <input type="date" name="dueFrom" id="financeVencimentoDe" value="${escapeHtml(vencDe || '')}" ${atalho ? 'disabled' : ''} />
          </label>
          <label class="cadastro-field" ${atalho ? 'title="Definido pelo atalho de vencimento da barra de busca"' : ''}>
            <span>Vencimento até</span>
            <input type="date" name="dueTo" value="${escapeHtml(vencAte || '')}" ${atalho ? 'disabled' : ''} />
          </label>
          <label class="cadastro-field">
            <span>Valor mínimo</span>
            <input type="number" step="0.01" min="0" name="amountMin" value="${escapeHtml(f.amountMin)}" />
          </label>
          <label class="cadastro-field">
            <span>Valor máximo</span>
            <input type="number" step="0.01" min="0" name="amountMax" value="${escapeHtml(f.amountMax)}" />
          </label>
        </div>
        <div class="cadastro-filter-actions">
          <button type="submit">Aplicar filtros</button>
          <button type="button" class="secondary" id="financeFilterClearBtn">Limpar filtros</button>
        </div>
      </form>`;
  }

  function painelDeColunas(colunas) {
    return `
      <div class="panel" id="financeColunasPainel" style="margin-bottom:12px;">
        <p class="muted" style="margin-top:0;">Colunas visíveis</p>
        <div class="cadastro-filter-grid-5">
          ${FINANCE_LISTA_COLUNAS.map((col) => `
            <label class="muted" style="display:flex;align-items:center;gap:6px;">
              <input type="checkbox" data-coluna-visivel="${col.chave}"
                ${colunas.some((c) => c.chave === col.chave) ? 'checked' : ''}
                ${col.fixa ? 'disabled title="Esta coluna não pode ser escondida."' : ''} />
              ${escapeHtml(col.rotulo)}
            </label>`).join('')}
        </div>
      </div>`;
  }

  function cabecalho(col) {
    const classe = col.dinheiro ? ' class="col-valor"' : '';
    if (!col.ordem) return `<th${classe}>${escapeHtml(col.rotulo)}</th>`;
    const ativa = lista.sort === col.ordem;
    // A seta mostra a ordem ATUAL, e não a que o clique vai aplicar.
    const seta = ativa ? (lista.dir === 'asc' ? '▲' : '▼') : '';
    return `<th${classe} aria-sort="${ativa ? (lista.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
      <button type="button" class="lista-ordenar${ativa ? ' is-ativa' : ''}" data-ordenar="${col.ordem}" title="Ordenar por ${escapeHtml(col.rotulo)}">
        ${escapeHtml(col.rotulo)}<span class="lista-ordenar-seta" aria-hidden="true">${seta}</span>
      </button></th>`;
  }

  function renderView(result) {
    const foco = lembrarFoco();
    const f = lista.filtros;
    const limit = porPagina();
    const total = result.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const entries = result.entries || [];
    const colunas = colunasVisiveis();
    const de = total ? (lista.page - 1) * limit + 1 : 0;
    const ate = Math.min(total, lista.page * limit);
    const temFiltro = Object.keys(f).some((k) => f[k]);
    const dica = dicaDaBusca();

    content.innerHTML = `
      <div class="cadastro-page-head">
        <div>
          <h3>${escapeHtml(tela.titulo)}</h3>
          <p class="muted">${numero(total)} lançamento${total === 1 ? '' : 's'} encontrado${total === 1 ? '' : 's'}</p>
        </div>
        <div class="cadastro-list-actions">
          <button type="button" id="financeNewEntryBtn">+ ${escapeHtml(tela.novo)}</button>
          <button type="button" class="secondary" id="financeExportarBtn" title="Baixa uma planilha do Excel pronta para imprimir: todos os lançamentos do filtro, de todas as páginas, com as colunas e a ordem da tela">Exportar Excel</button>
          <button type="button" class="secondary" id="financeColunasBtn" aria-expanded="${Boolean(lista.showColunas)}" title="Escolher colunas visíveis">Colunas</button>
          <button type="button" class="secondary" id="financeFilterToggleBtn" aria-expanded="${Boolean(lista.showAdvanced)}">${lista.showAdvanced ? 'Ocultar filtros' : 'Busca avançada'}</button>
        </div>
      </div>

      ${lista.showColunas ? painelDeColunas(colunas) : ''}

      <form id="financeQuickSearchForm" class="finance-lista-busca" role="search" style="--campos: ${(tipoFixo ? 0 : 1) + 2};">
        <label class="cadastro-field">
          <span>Busca</span>
          <input id="financeQuickSearch" type="search" name="search" value="${escapeHtml(f.search)}" autocomplete="off"
            placeholder="Código, descrição, documento, cliente/fornecedor, CPF/CNPJ ou valor (ex.: 2.500,00)" />
        </label>
        ${tipoFixo ? '' : `<label class="cadastro-field">
          <span>Tipo</span>
          <select id="financeTipoRapido">
            <option value="">Todos</option>
            ${FINANCE_ENTRY_TYPE_OPTIONS.map((opt) => `<option value="${opt.value}" ${f.type === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
          </select>
        </label>`}
        <label class="cadastro-field">
          <span>Vencimento</span>
          <select id="financeVencimentoRapido">
            ${FINANCE_VENCIMENTOS.map((p) => `<option value="${p.chave}" ${(f.periodo || '') === p.chave ? 'selected' : ''}>${escapeHtml(p.rotulo)}</option>`).join('')}
          </select>
        </label>
        <label class="cadastro-field">
          <span>Empresa</span>
          <select id="financeEmpresaRapida">${opcoesDeEmpresa()}</select>
        </label>
        <div style="align-self: end;"><button type="submit" class="secondary">Buscar</button></div>
        ${dica ? `<p class="muted finance-busca-dica">${dica}</p>` : ''}
      </form>

      ${lista.showAdvanced ? painelAvancado() : ''}
      ${etiquetasDeFiltro()}
      ${abasDeSituacao(result.resumo)}
      ${faixaDeTotais(result.resumo)}
      <div id="financeLoteBarra">${barraDeLote()}</div>

      <div class="panel" id="financeListaPainel">
        <div class="table-scroll">
          <table class="table table-actions finance-tabela">
            <thead>
              <tr>
                <th class="sales-col-selecao">
                  <input type="checkbox" id="financeSelecionarPagina" title="Selecionar os desta página" aria-label="Selecionar os desta página"
                    ${entries.length && entries.every((e) => estaSelecionado(e.id)) ? 'checked' : ''} />
                </th>
                ${colunas.map(cabecalho).join('')}
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${entries.length ? entries.map((entry, indice) => `
                <tr class="cadastro-row-clickable finance-entry-row${estaSelecionado(entry.id) ? ' is-selecionada' : ''}" data-id="${escapeHtml(entry.id)}" data-indice="${indice}">
                  <td class="sales-col-selecao">
                    <input type="checkbox" class="finance-selecionar" data-id="${escapeHtml(entry.id)}" aria-label="Selecionar ${escapeHtml(entry.codigo || 'lançamento')}"
                      ${estaSelecionado(entry.id) ? 'checked' : ''} />
                  </td>
                  ${colunas.map((col) => `<td${col.dinheiro ? ' class="col-valor"' : ''}>${col.valor(entry, formatadores)}</td>`).join('')}
                  <td>
                    ${Lista.ACOES.baixar.elegivel(entry) === true ? `<button type="button" class="secondary" data-quick-baixa="${escapeHtml(entry.id)}">Baixar</button>` : ''}
                  </td>
                </tr>
              `).join('') : `
                <tr><td colspan="${colunas.length + 2}" class="muted">
                  ${temFiltro ? 'Nenhum lançamento encontrado com os filtros atuais. <button type="button" class="secondary" id="financeVazioLimpar">Limpar filtros</button>' : 'Nenhum lançamento cadastrado.'}
                </td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="finance-pagination">
          <button type="button" class="secondary" id="financePrimeiraPagina" ${lista.page <= 1 ? 'disabled' : ''} title="Primeira página" aria-label="Primeira página">«</button>
          <button type="button" class="secondary" id="financePrevPage" ${lista.page <= 1 ? 'disabled' : ''}>Anterior</button>
          <span class="muted finance-pagina-info">Página ${numero(lista.page)} de ${numero(totalPages)}${total ? ` · ${numero(de)}–${numero(ate)} de ${numero(total)}` : ''}</span>
          <button type="button" class="secondary" id="financeNextPage" ${lista.page >= totalPages ? 'disabled' : ''}>Próxima</button>
          <button type="button" class="secondary" id="financeUltimaPagina" ${lista.page >= totalPages ? 'disabled' : ''} title="Última página" aria-label="Última página">»</button>
          <label class="muted" style="display:flex;align-items:center;gap:6px;">
            Por página
            <select id="financePorPagina">
              ${FINANCE_POR_PAGINA.map((n) => `<option value="${n}" ${n === limit ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
          </label>
          ${totalPages > 1 ? `
            <form id="financeIrParaPagina" class="muted" style="display:flex;align-items:center;gap:6px;">
              Ir para
              <input type="number" min="1" max="${totalPages}" value="${lista.page}" style="width:80px;" aria-label="Ir para a página" />
              <button type="submit" class="secondary">Ir</button>
            </form>` : ''}
        </div>
      </div>
    `;

    ligarCabecalhoEBusca(result, totalPages);
    ligarTabela(result, totalPages);
    ligarBarraDeLote();
    // indeterminate só existe como propriedade, não como atributo do HTML.
    atualizarSelecao();
    restaurarFoco(foco);
  }

  // --- Eventos ---------------------------------------------------------------

  let esperaDaBusca = null;

  function ligarCabecalhoEBusca() {
    document.getElementById('financeNewEntryBtn')?.addEventListener('click', () => {
      state.financeEditEntryId = null;
      // O novo nasce no tipo da tela e, salvo, volta para ela.
      state.financeNovoTipo = tipoFixo ? tipoFixo.toUpperCase() : null;
      state.financeListaDeOrigem = telaChave;
      state.activeSub = 'novo_lancamento';
      loadModule('finance');
    });
    document.getElementById('financeExportarBtn')?.addEventListener('click', () => {
      baixarPlanilha(`/api/finance/entries/exportar?${paraAPlanilha(consulta({ paginado: false })).toString()}`, `${telaChave.replace(/_/g, '-')}.xlsx`);
    });
    document.getElementById('financeColunasBtn')?.addEventListener('click', () => {
      lista.showColunas = !lista.showColunas;
      redesenhar();
    });
    content.querySelectorAll('[data-coluna-visivel]').forEach((caixa) => {
      caixa.addEventListener('change', () => {
        const escolhidas = [...content.querySelectorAll('[data-coluna-visivel]')]
          .filter((c) => c.checked).map((c) => c.dataset.colunaVisivel);
        if (escolhidas.length === 0) {
          showToast('Deixe ao menos uma coluna.', 'warning');
          caixa.checked = true;
          return;
        }
        // Na ORDEM do catálogo, não na de clique: é ela que desenha a tabela.
        salvarPreferenciaDaLista({
          colunas: FINANCE_LISTA_COLUNAS.map((c) => c.chave).filter((c) => escolhidas.includes(c)),
          conhecidas: FINANCE_LISTA_COLUNAS.map((c) => c.chave),
          layout: FINANCE_LAYOUT_DAS_COLUNAS
        });
        redesenhar();
      });
    });

    // ABRIR E FECHAR A BUSCA AVANÇADA NÃO VAI AO SERVIDOR (fase DS) — a menos
    // que a busca rápida tenha sido digitada e não enviada (ver redesenhar).
    document.getElementById('financeFilterToggleBtn')?.addEventListener('click', () => {
      lista.showAdvanced = !lista.showAdvanced;
      redesenhar();
    });
    if (lista.showAdvanced && typeof attachSearchableSelect === 'function') {
      attachSearchableSelect({ id: 'financeFilterParty', options: opcoesDoDiretorio });
    }

    // A BUSCA ANDA ENQUANTO SE DIGITA (fase EI), com uma pausa de 450 ms: o
    // bastante para não pedir uma lista por letra, pouco para não parecer que
    // a caixa não faz nada. Enter continua buscando na hora.
    const campo = document.getElementById('financeQuickSearch');
    campo?.addEventListener('input', (event) => {
      lista.filtros.search = event.target.value;
      clearTimeout(esperaDaBusca);
      esperaDaBusca = setTimeout(() => { lista.page = 1; load(); }, 450);
    });
    document.getElementById('financeQuickSearchForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      clearTimeout(esperaDaBusca);
      lista.filtros.search = campo ? campo.value : lista.filtros.search;
      lista.page = 1;
      load();
    });
    document.getElementById('financeTipoRapido')?.addEventListener('change', (event) => {
      mudarFiltro({ type: event.target.value });
    });
    // 8 dígitos: a empresa inteira; 14: uma loja dela.
    document.getElementById('financeEmpresaRapida')?.addEventListener('change', (event) => {
      const valor = String(event.target.value || '');
      mudarFiltro(valor.length === 14 ? { empresa: valor.slice(0, 8), filial: valor } : { empresa: valor, filial: '' });
    });
    document.getElementById('financeVencimentoRapido')?.addEventListener('change', async (event) => {
      const chave = event.target.value;
      if (chave === 'personalizado') {
        // As datas são digitadas na busca avançada: abre o painel nelas, já
        // com as do atalho que valia — a lista não pula, e ajustar "Este mês"
        // para "até dia 20" é mudar um campo, não digitar os dois.
        const anterior = financePeriodoDeVencimento(lista.filtros.periodo);
        if (anterior) Object.assign(lista.filtros, anterior);
        lista.filtros.periodo = 'personalizado';
        lista.showAdvanced = true;
        await redesenhar();
        document.getElementById('financeVencimentoDe')?.focus();
        return;
      }
      mudarFiltro({ periodo: chave, dueFrom: '', dueTo: '' });
    });

    document.getElementById('financeFilterForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      const ler = (k) => String(formData.get(k) || '');
      const mudanca = {
        status: ler('status'),
        clientSupplierId: ler('clientSupplierId'),
        category: ler('category'),
        costCenter: ler('costCenter'),
        bankAccountId: ler('bankAccountId'),
        dateFrom: ler('dateFrom'),
        dateTo: ler('dateTo'),
        amountMin: ler('amountMin'),
        amountMax: ler('amountMax')
      };
      // Datas de vencimento só entram quando não há atalho valendo (com
      // atalho, os campos estão desabilitados e não vêm no FormData).
      if (formData.has('dueFrom') || formData.has('dueTo')) {
        mudanca.dueFrom = ler('dueFrom');
        mudanca.dueTo = ler('dueTo');
        mudanca.periodo = (mudanca.dueFrom || mudanca.dueTo) ? 'personalizado' : '';
      }
      mudarFiltro(mudanca);
    });
    const limparTudo = () => {
      lista.filtros = financeFiltrosVazios();
      const busca = document.getElementById('financeQuickSearch');
      if (busca) busca.value = '';
      lista.page = 1;
      descartarRascunho = true;
      load();
    };
    document.getElementById('financeFilterClearBtn')?.addEventListener('click', limparTudo);
    document.getElementById('financeLimparEtiquetas')?.addEventListener('click', limparTudo);
    document.getElementById('financeVazioLimpar')?.addEventListener('click', limparTudo);
    content.querySelectorAll('[data-limpar]').forEach((botao) => {
      botao.addEventListener('click', () => {
        const mudanca = {};
        botao.dataset.limpar.split(',').forEach((campoDoFiltro) => { mudanca[campoDoFiltro] = ''; });
        mudarFiltro(mudanca);
      });
    });

    content.querySelectorAll('[data-aba]').forEach((botao) => {
      botao.addEventListener('click', () => mudarFiltro({ status: botao.dataset.aba }));
    });
  }

  function ligarTabela(result, totalPages) {
    const entries = result.entries || [];

    // Ordenar: clicar na coluna ordenada inverte; numa coluna nova, texto
    // começa de A a Z e data/valor do maior para o menor.
    content.querySelectorAll('[data-ordenar]').forEach((botao) => {
      botao.addEventListener('click', () => {
        const coluna = botao.dataset.ordenar;
        if (lista.sort === coluna) lista.dir = lista.dir === 'asc' ? 'desc' : 'asc';
        else lista.dir = Lista.COMECA_CRESCENTE.includes(coluna) ? 'asc' : 'desc';
        lista.sort = coluna;
        lista.page = 1;
        load();
      });
    });

    // SELEÇÃO. O "todos" marca os DESTA página — marcar o que não se vê e
    // depois agir é como se perde dado sem perceber (mesma regra de Vendas).
    document.getElementById('financeSelecionarPagina')?.addEventListener('change', (event) => {
      entries.forEach((entry) => marcar(entry, event.target.checked));
      atualizarSelecao();
    });
    // Shift+clique marca o intervalo desde a última caixa clicada, como em
    // qualquer lista de e-mail: selecionar 30 parcelas seguidas não pode ser
    // 30 cliques.
    let ultimoIndice = -1;
    content.querySelectorAll('.finance-selecionar').forEach((caixa) => {
      caixa.addEventListener('click', (event) => {
        event.stopPropagation();
        const linha = caixa.closest('tr');
        const indice = Number(linha && linha.dataset.indice);
        const marcarComo = caixa.checked;
        if (event.shiftKey && ultimoIndice >= 0 && ultimoIndice !== indice) {
          const [a, b] = ultimoIndice < indice ? [ultimoIndice, indice] : [indice, ultimoIndice];
          entries.slice(a, b + 1).forEach((entry) => marcar(entry, marcarComo));
        } else {
          const entry = entries[indice];
          if (entry) marcar(entry, marcarComo);
        }
        ultimoIndice = indice;
        atualizarSelecao();
      });
    });
    // A célula da caixa inteira marca: a caixa de 18 px é um alvo pequeno, e
    // errar por 2 px abria o modal do lançamento.
    content.querySelectorAll('.finance-entry-row td.sales-col-selecao').forEach((celula) => {
      celula.addEventListener('click', (event) => {
        if (event.target.closest('input')) return;
        event.stopPropagation();
        // Um clique de verdade, com o Shift de quem clicou: .click() perderia
        // a tecla, e shift+clique na célula não marcaria o intervalo.
        celula.querySelector('input')?.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true, shiftKey: event.shiftKey
        }));
      });
    });

    content.querySelectorAll('.finance-entry-row').forEach((row) => {
      row.addEventListener('click', (event) => {
        if (event.target.closest('button, input, a, .sales-col-selecao')) return;
        openEntryModal(row.dataset.id);
      });
    });
    content.querySelectorAll('[data-quick-baixa]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        openEntryModal(btn.dataset.quickBaixa, { focusPayment: true });
      });
    });

    document.getElementById('financePrimeiraPagina')?.addEventListener('click', () => { if (lista.page > 1) irParaPagina(1); });
    document.getElementById('financePrevPage')?.addEventListener('click', () => { if (lista.page > 1) irParaPagina(lista.page - 1); });
    document.getElementById('financeNextPage')?.addEventListener('click', () => { if (lista.page < totalPages) irParaPagina(lista.page + 1); });
    document.getElementById('financeUltimaPagina')?.addEventListener('click', () => { if (lista.page < totalPages) irParaPagina(totalPages); });
    document.getElementById('financePorPagina')?.addEventListener('change', (event) => {
      lista.limit = Number(event.target.value) || 15;
      salvarPreferenciaDaLista({ limit: lista.limit });
      // Volta para a 1: com 100 por página, a página 7 de antes pode nem existir.
      irParaPagina(1);
    });
    document.getElementById('financeIrParaPagina')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const alvo = Number(event.target.querySelector('input').value);
      if (!Number.isFinite(alvo) || alvo < 1 || alvo > totalPages) {
        showToast(`Informe uma página entre 1 e ${totalPages}.`, 'warning');
        return;
      }
      irParaPagina(Math.floor(alvo));
    });
  }

  function ligarBarraDeLote() {
    document.querySelectorAll('#financeLoteBarra [data-lote]').forEach((botao) => {
      botao.addEventListener('click', () => {
        const acao = botao.dataset.lote;
        if (acao === 'limpar') {
          lista.selecao = {};
          atualizarSelecao();
        } else if (acao === 'exportar') {
          exportarSelecionados();
        } else if (acao === 'baixar') {
          abrirBaixaEmLote();
        } else if (acao === 'cancelar') {
          cancelarEmLote();
        } else if (acao === 'excluir') {
          excluirLancamentos(selecionados().map((l) => l.id));
        }
      });
    });
  }

  // --- Ações em lote ---------------------------------------------------------

  // Baixa o arquivo que o servidor montou, com o token da sessão — um <a href>
  // direto iria sem ele. Mesmo caminho dos relatórios (reports/subs/catalogo.js).
  // A PLANILHA SEGUE A TELA (16/10/2026): o nome da tela vira o título da
  // folha impressa, e as colunas visíveis agora, na ordem do catálogo, são as
  // da planilha — ver lib/planilha-lancamentos.js.
  function paraAPlanilha(params) {
    params.set('tela', telaChave);
    params.set('colunas', colunasVisiveis().map((c) => c.chave).join(','));
    return params;
  }

  async function baixarPlanilha(endereco, nomePadrao) {
    let url = null;
    try {
      const resposta = await fetch(endereco, {
        headers: { 'x-auth-token': (typeof getSessionToken === 'function' ? getSessionToken() : '') || '' }
      });
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => ({}));
        showToast(corpo.error || `Não consegui exportar (HTTP ${resposta.status}).`, 'error');
        return;
      }
      const nome = (/filename="([^"]+)"/.exec(resposta.headers.get('Content-Disposition') || '') || [])[1] || nomePadrao;
      url = URL.createObjectURL(await resposta.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = nome;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (erro) {
      showToast(erro.message || 'Não consegui exportar.', 'error');
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  }

  function exportarSelecionados() {
    const ids = selecionados().map((l) => l.id);
    if (!ids.length) return;
    if (ids.length > Lista.MAXIMO_DO_LOTE) {
      showToast(`Exporte até ${Lista.MAXIMO_DO_LOTE} selecionados por vez — ou use Exportar Excel, que leva o filtro inteiro.`, 'warning');
      return;
    }
    const params = new URLSearchParams({ ids: ids.join(',') });
    if (lista.sort) { params.set('sort', lista.sort); params.set('dir', lista.dir); }
    baixarPlanilha(`/api/finance/entries/exportar?${paraAPlanilha(params).toString()}`, `${telaChave.replace(/_/g, '-')}-selecionados.xlsx`);
  }

  // A resposta do lote vem do SERVIDOR, e não do que a tela previu: entre
  // desenhar e clicar, alguém pode ter baixado um dos selecionados. Os
  // processados saem da seleção; os ignorados ficam marcados, para a pessoa
  // ver quais foram e por quê.
  async function mostrarResultadoDoLote(resposta) {
    const naoFeitos = resposta.ignorados || [];
    (resposta.processados || []).forEach((p) => { delete lista.selecao[p.id]; });
    showToast(resposta.resumo || 'Pronto.', naoFeitos.length ? 'warning' : 'success');
    await load();
    if (naoFeitos.length && telaAtiva()) {
      await confirmModal(`${resposta.resumo}\n\n${naoFeitos.map((i) => `${i.codigo}: ${i.motivo}`).join('\n')}`);
    }
  }

  // A PRÉVIA: o que o servidor faria com cada selecionado, AGORA — saldo,
  // valor da baixa (o líquido, no cartão com taxa) e quem fica de fora. É com
  // ela que o modal e a pergunta do cancelamento contam e somam; o retrato da
  // seleção pode ser de uma página que a pessoa viu há meia hora.
  async function previaDoLote(acao, ids) {
    const resposta = await api('/api/finance/entries/lote', {
      method: 'POST',
      body: JSON.stringify({ acao, ids, previa: true })
    });
    const itens = resposta.itens || [];
    return {
      elegiveis: itens.filter((i) => !i.motivo),
      ignorados: itens.filter((i) => i.motivo)
    };
  }

  function travarLote(sim) {
    loteEmAndamento = sim;
    atualizarSelecao();
  }

  async function abrirBaixaEmLote() {
    if (loteEmAndamento) return;
    const ids = selecionados().filter((l) => Lista.ACOES.baixar.elegivel(l) === true).map((l) => l.id);
    if (!ids.length) return;
    if (ids.length > Lista.MAXIMO_DO_LOTE) {
      showToast(`Baixe até ${Lista.MAXIMO_DO_LOTE} lançamentos por vez.`, 'warning');
      return;
    }
    let previa;
    travarLote(true);
    try {
      [previa] = await Promise.all([previaDoLote('baixar', ids), metaPronto]);
    } catch (erro) {
      showToast(erro.message || 'Não foi possível conferir os lançamentos selecionados.', 'error');
      return;
    } finally {
      travarLote(false);
    }
    const { elegiveis, ignorados } = previa;
    if (!elegiveis.length) {
      showToast(`Nenhum selecionado pode ser baixado agora: ${ignorados[0] ? ignorados[0].motivo : 'sem saldo em aberto'}`, 'warning');
      return;
    }
    const totalDaBaixa = elegiveis.reduce((s, l) => s + Number(l.valor || 0), 0);
    const comTaxa = elegiveis.filter((l) => Number(l.desconto) > 0).length;
    document.getElementById('financeLoteBaixaModal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'financeLoteBaixaModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="financeLoteBaixaTitulo">
        <div class="finance-modal-head">
          <div>
            <h3 id="financeLoteBaixaTitulo">Baixar ${numero(elegiveis.length)} lançamento${elegiveis.length === 1 ? '' : 's'}</h3>
            <p class="muted">Cada um é baixado pelo saldo em aberto, com a data e a conta escolhidas aqui. Uma linha de auditoria por lançamento.</p>
          </div>
          <button type="button" class="icon-button" data-fechar title="Fechar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </div>
        ${ignorados.length ? `<p class="prompt-aviso">${numero(ignorados.length)} selecionado${ignorados.length === 1 ? '' : 's'} fica${ignorados.length === 1 ? '' : 'm'} de fora: ${escapeHtml(ignorados[0].motivo)}${ignorados.length > 1 ? ' (e outros)' : ''}</p>` : ''}
        <div class="table-scroll" style="max-height: 260px; overflow-y: auto;">
          <table class="table">
            <thead><tr><th>Código</th><th>Descrição</th><th class="col-valor">Em aberto</th><th class="col-valor">Será baixado</th></tr></thead>
            <tbody>
              ${elegiveis.map((l) => {
                const D = window.MavisDescricaoLancamento;
                const inteira = String(l.descricao || '');
                const curta = D && D.resumir ? D.cortar(D.resumir(inteira), 48) : inteira;
                return `<tr>
                  <td>${escapeHtml(l.codigo || '-')}</td>
                  <td><span class="texto-cortado is-medio" title="${escapeHtml(inteira)}">${escapeHtml(curta || '-')}</span></td>
                  <td class="col-valor">${brl(l.emAberto)}</td>
                  <td class="col-valor" ${Number(l.desconto) > 0 ? `title="Líquido do cartão: taxa de ${escapeHtml(brl(l.desconto))} como desconto"` : ''}>${brl(l.valor)}</td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot><tr><th colspan="3">Total</th><th class="col-valor">${brl(totalDaBaixa)}</th></tr></tfoot>
          </table>
        </div>
        <form id="financeLoteBaixaForm" class="form-grid">
          <div class="row">
            <label>Data da baixa<input type="date" name="date" required value="${financeHojeLocal()}" /></label>
            <label>Conta bancária
              <select name="bankAccountId">
                <option value="">A conta de cada lançamento</option>
                ${(meta.bankAccounts || []).map((acc) => `<option value="${escapeHtml(acc.id)}">${escapeHtml(acc.name)}</option>`).join('')}
              </select>
            </label>
          </div>
          ${comTaxa ? `<p class="muted" style="margin:0;">${numero(comTaxa)} de cartão com taxa: baixado${comTaxa === 1 ? '' : 's'} pelo líquido, com a taxa como desconto — como na baixa de um só.</p>` : ''}
          <div class="finance-modal-actions">
            <button type="button" class="secondary" data-fechar>Voltar</button>
            <button type="submit">Baixar ${numero(elegiveis.length)}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    // Enquanto o envio está no ar, o modal NÃO fecha: fechado, a barra voltaria
    // a oferecer "Baixar" com a mesma seleção, e o segundo envio repetiria tudo.
    const fechar = () => { if (!loteEmAndamento) overlay.remove(); };
    overlay.addEventListener('click', (event) => { if (event.target === overlay) fechar(); });
    overlay.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', fechar));
    overlay.querySelector('#financeLoteBaixaForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const enviar = event.target.querySelector('button[type="submit"]');
      if (loteEmAndamento) return;
      const formData = new FormData(event.target);
      travarLote(true);
      enviar.disabled = true;
      enviar.textContent = 'Baixando…';
      overlay.querySelectorAll('[data-fechar]').forEach((b) => { b.disabled = true; });
      try {
        const resposta = await api('/api/finance/entries/lote', {
          method: 'POST',
          body: JSON.stringify({
            acao: 'baixar',
            ids: elegiveis.map((l) => l.id),
            date: formData.get('date'),
            bankAccountId: formData.get('bankAccountId') || ''
          })
        });
        travarLote(false);
        overlay.remove();
        await mostrarResultadoDoLote(resposta);
      } catch (erro) {
        travarLote(false);
        showToast(erro.message || 'Não foi possível baixar os lançamentos.', 'error');
        enviar.disabled = false;
        enviar.textContent = `Baixar ${numero(elegiveis.length)}`;
        overlay.querySelectorAll('[data-fechar]').forEach((b) => { b.disabled = false; });
      }
    });
  }

  async function cancelarEmLote() {
    if (loteEmAndamento) return;
    const ids = selecionados().filter((l) => Lista.ACOES.cancelar.elegivel(l) === true).map((l) => l.id);
    if (!ids.length) return;
    if (ids.length > Lista.MAXIMO_DO_LOTE) {
      showToast(`Cancele até ${Lista.MAXIMO_DO_LOTE} lançamentos por vez.`, 'warning');
      return;
    }
    let previa;
    travarLote(true);
    try {
      previa = await previaDoLote('cancelar', ids);
    } catch (erro) {
      showToast(erro.message || 'Não foi possível conferir os lançamentos selecionados.', 'error');
      return;
    } finally {
      travarLote(false);
    }
    const { elegiveis, ignorados } = previa;
    if (!elegiveis.length) {
      showToast(`Nenhum selecionado pode ser cancelado agora: ${ignorados[0] ? ignorados[0].motivo : ''}`, 'warning');
      return;
    }
    const fora = ignorados.length
      ? ` ${ignorados.length} selecionado${ignorados.length === 1 ? '' : 's'} fica${ignorados.length === 1 ? '' : 'm'} de fora: ${ignorados[0].motivo}`
      : '';
    // O MESMO MOTIVO OBRIGATÓRIO de cancelar um só (fase AX), gravado em cada um.
    const motivo = await promptModal({
      titulo: `Cancelar ${elegiveis.length} lançamento${elegiveis.length === 1 ? '' : 's'}`,
      descricao: `Os lançamentos continuam na lista, marcados como cancelados, com este motivo registrado em cada um. O histórico não se perde.${fora}`,
      rotulo: 'Motivo do cancelamento',
      placeholder: 'Ex.: parcelas lançadas em duplicidade na importação',
      minimo: 10,
      maximo: 300,
      confirmar: `Cancelar ${elegiveis.length}`
    });
    if (!motivo || loteEmAndamento) return;
    travarLote(true);
    try {
      const resposta = await api('/api/finance/entries/lote', {
        method: 'POST',
        body: JSON.stringify({ acao: 'cancelar', ids: elegiveis.map((l) => l.id), motivo })
      });
      travarLote(false);
      await mostrarResultadoDoLote(resposta);
    } catch (erro) {
      travarLote(false);
      showToast(erro.message || 'Não foi possível cancelar os lançamentos.', 'error');
    }
  }

  // EXCLUIR (19/10/2026, pedido do usuário): o administrador e quem tem
  // Financeiro › excluir. O servidor confere de novo — o portão cobra a
  // permissão na rota DELETE.
  function podeExcluir() {
    if (typeof usuarioEhAdmin === 'function' && usuarioEhAdmin()) return true;
    return Boolean(state.user && Array.isArray(state.user.permissions) && state.user.permissions.includes('finance.excluir'));
  }

  // Um (da janela do lançamento) ou vários (da seleção), pelo mesmo caminho. A
  // prévia diz o que sai junto — as baixas, a conciliação do extrato — e a que
  // pedido ou nota o título está ligado, ANTES do motivo.
  async function excluirLancamentos(ids, { doModal = false } = {}) {
    if (loteEmAndamento || !ids.length) return;
    if (ids.length > Lista.MAXIMO_DO_LOTE) {
      showToast(`Exclua até ${Lista.MAXIMO_DO_LOTE} lançamentos por vez.`, 'warning');
      return;
    }
    const mensagem = (erro, padrao) => (/finance\.excluir/.test(String(erro && erro.message))
      ? 'Você não tem a permissão Financeiro › excluir.'
      : ((erro && erro.message) || padrao));
    let itens;
    travarLote(true);
    try {
      const resposta = await api('/api/finance/entries', { method: 'DELETE', body: JSON.stringify({ ids, previa: true }) });
      itens = resposta.itens || [];
    } catch (erro) {
      showToast(mensagem(erro, 'Não foi possível conferir os lançamentos.'), 'error');
      return;
    } finally {
      travarLote(false);
    }
    const elegiveis = itens.filter((i) => !i.motivo);
    const ignorados = itens.filter((i) => i.motivo);
    if (!elegiveis.length) {
      showToast(`Nenhum pode ser excluído agora: ${ignorados[0] ? ignorados[0].motivo : ''}`, 'warning');
      return;
    }
    const um = elegiveis.length === 1 ? elegiveis[0] : null;
    const plural = (n, s, p) => (n === 1 ? s : p);
    const comBaixa = elegiveis.filter((i) => i.baixas > 0);
    const conciliadas = elegiveis.reduce((s, i) => s + Number(i.conciliadas || 0), 0);
    const vinculados = elegiveis.filter((i) => i.vinculo);
    const avisos = [];
    if (comBaixa.length) {
      const soma = comBaixa.reduce((s, i) => s + Number(i.valorDasBaixas || 0), 0);
      avisos.push(um
        ? `${um.baixas} ${plural(um.baixas, 'baixa', 'baixas')} de ${brl(soma)} ${plural(um.baixas, 'sai', 'saem')} junto.`
        : `${comBaixa.length} com baixa: as baixas (${brl(soma)}) saem junto.`);
    }
    if (conciliadas) avisos.push(`${conciliadas} ${plural(conciliadas, 'movimentação do extrato volta', 'movimentações do extrato voltam')} a Não conciliado.`);
    if (vinculados.length) {
      avisos.push(um
        ? `Ligado a: ${um.vinculo}. Continua lá, sem este título.`
        : `${vinculados.length} ${plural(vinculados.length, 'ligado', 'ligados')} a pedido ou nota (${vinculados[0].vinculo}${vinculados.length > 1 ? ' e outros' : ''}). Continuam lá, sem o título.`);
      // 21/10/2026: o pedido aprovado (Pré-Faturado) sem nenhum título volta.
      if (vinculados.some((i) => /^Pedido /.test(i.vinculo))) {
        avisos.push('Pedido Pré-Faturado que ficar sem nenhum título volta a "Pedido Não Faturado".');
      }
    }
    if (ignorados.length) avisos.push(`${ignorados.length} de fora: ${ignorados[0].motivo}`);
    const motivo = await promptModal({
      titulo: um ? `Excluir ${um.codigo}` : `Excluir ${elegiveis.length} lançamentos`,
      descricao: [`${um ? 'O lançamento sai' : 'Os lançamentos saem'} da lista; o motivo fica na auditoria.`, ...avisos].join(' '),
      rotulo: 'Motivo da exclusão',
      placeholder: 'Ex.: lançado em duplicidade',
      minimo: 10,
      maximo: 300,
      confirmar: um ? 'Excluir lançamento' : `Excluir ${elegiveis.length}`
    });
    if (!motivo || loteEmAndamento) return;
    travarLote(true);
    try {
      const resposta = await api('/api/finance/entries', {
        method: 'DELETE',
        body: JSON.stringify({ ids: elegiveis.map((i) => i.id), motivo })
      });
      travarLote(false);
      if (doModal) closeEntryModal();
      if (um && (resposta.processados || []).length === 1 && !(resposta.ignorados || []).length) {
        delete lista.selecao[um.id];
        showToast('Lançamento excluído.', 'success');
        // Era o último título de um pedido Pré-Faturado: ele voltou (21/10/2026).
        if ((resposta.pedidosEstornados || []).length) showToast(resposta.resumo, 'info', 8000);
        await load();
      } else {
        await mostrarResultadoDoLote(resposta);
      }
    } catch (erro) {
      travarLote(false);
      showToast(mensagem(erro, 'Não foi possível excluir.'), 'error');
    }
  }

  async function openEntryModal(id, options) {
    let entry;
    try {
      // O modal de baixa lista as contas bancárias do meta: espera por ele,
      // que a esta altura quase sempre já chegou (fase DS).
      const [res] = await Promise.all([api(`/api/finance/entries/${id}`), metaPronto]);
      entry = res.entry;
    } catch (error) {
      if (telaAtiva()) showToast(error.message || 'Erro ao carregar lançamento.', 'error');
      return;
    }
    // A pessoa pode ter ido para outra tela enquanto o lançamento chegava: o
    // modal dele não abre por cima de Vendas (fase EI).
    if (!telaAtiva()) return;
    renderEntryModal(entry, options || {});
  }

  function closeEntryModal() {
    document.getElementById('financeEntryModal')?.remove();
  }

  function renderEntryModal(entry, options) {
    closeEntryModal();

    const isReceita = entry.type === 'receita';
    const canPay = entry.rawStatus === 'pending' || entry.rawStatus === 'parcial';
    const canCancel = entry.rawStatus !== 'paid' && entry.rawStatus !== 'cancelado';
    const canEstorno = entry.payments.length > 0;
    // Parcelar: título em aberto, sem baixa, que não é transferência.
    const podeParcelar = entry.rawStatus === 'pending' && !entry.payments.length && entry.type !== 'transferencia';
    // O saldo da regra da baixa (fase EI): juros, multa e desconto das baixas
    // anteriores entram. Previsto − realizado só para resposta sem o campo.
    const saldoRestante = entry.emAberto != null
      ? Number(entry.emAberto)
      : Math.max(0, entry.amountPrevisto - entry.amountRealizado);
    // A TAXA DA MAQUININHA (fase BX). Só na PRIMEIRA baixa: com uma baixa
    // parcial no meio, o que falta já não é o líquido inteiro, e sugerir que é
    // colocaria um número errado no campo.
    const taxaAAbater = entry.feeAmount != null && entry.netAmount != null && !entry.payments.length
      ? entry.feeAmount
      : 0;
    // O que a credenciadora credita de fato. É este valor que vai aparecer no
    // extrato — baixar pelo bruto deixa o título em "parcial" pela taxa, para
    // sempre.
    const valorSugerido = taxaAAbater > 0 ? entry.netAmount : saldoRestante;

    const overlay = document.createElement('div');
    overlay.id = 'financeEntryModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-lg">
        <div class="finance-modal-head">
          <div>
            <h3>${escapeHtml(entry.description || 'Lançamento')}</h3>
            <p class="muted">${entry.codigo ? `${escapeHtml(entry.codigo)} · ` : ''}${FINANCE_TYPE_LABEL[entry.type] || entry.type} ${financeStatusBadge(entry.status)}</p>
          </div>
          <button type="button" class="icon-button" id="financeModalClose" title="Fechar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </div>

        <div class="finance-modal-info-grid">
          <div><span class="muted">Data</span><strong>${financeFormatDate(entry.date)}</strong></div>
          <div><span class="muted">Vencimento</span><strong>${financeFormatDate(entry.dueDate)}</strong></div>
          <div><span class="muted">${isReceita ? 'Cliente' : 'Fornecedor'}</span><strong>${escapeHtml(entry.clienteFornecedor || '-')}</strong></div>
          <div><span class="muted">Categoria</span><strong>${escapeHtml(entry.categoryName || '-')}</strong></div>
          <div><span class="muted">Centro de custo</span><strong>${escapeHtml(entry.costCenterName || '-')}</strong></div>
          <div><span class="muted">Forma de pagamento</span><strong>${escapeHtml(entry.paymentMethodName || '-')}</strong></div>
          <div><span class="muted">Conta bancária</span><strong>${escapeHtml(entry.bankAccountName || '-')}</strong></div>
          <div><span class="muted">Documento</span><strong>${escapeHtml(entry.document || '-')}</strong></div>
          <div><span class="muted">Valor previsto</span><strong>${financeFormatBRL(entry.amountPrevisto)}</strong></div>
          <div><span class="muted">Valor realizado</span><strong>${financeFormatBRL(entry.amountRealizado)}</strong></div>
          <div><span class="muted">Saldo em aberto</span><strong>${financeFormatBRL(saldoRestante)}</strong></div>
        </div>
        ${entry.cardAcquirerName || entry.feeAmount != null ? `
          <div class="finance-cartao-box">
            <h4>Cartão e taxa</h4>
            <div class="finance-modal-info-grid">
              ${entry.cardAcquirerName ? `<div><span class="muted">Credenciadora</span><strong>${escapeHtml(entry.cardAcquirerName)}</strong></div>` : ''}
              ${entry.cardBrand ? `<div><span class="muted">Bandeira</span><strong>${escapeHtml(entry.cardBrandName || entry.cardBrand)}</strong></div>` : ''}
              ${entry.cardAuthorization ? `<div><span class="muted">NSU / Autorização</span><strong>${escapeHtml(entry.cardAuthorization)}</strong></div>` : ''}
              ${entry.feePercent != null ? `<div><span class="muted">Taxa</span><strong>${Number(entry.feePercent).toFixed(2)}%</strong></div>` : ''}
              ${entry.feeAmount != null ? `<div><span class="muted">Taxa em reais</span><strong>${financeFormatBRL(entry.feeAmount)}</strong></div>` : ''}
              ${entry.netAmount != null ? `<div><span class="muted">Crédito previsto</span><strong>${financeFormatBRL(entry.netAmount)} em ${financeFormatDate(entry.dueDate)}</strong></div>` : ''}
            </div>
          </div>` : ''}
        ${entry.note ? `<p class="muted">Obs: ${escapeHtml(entry.note)}</p>` : ''}

        ${/* Fase AX: por que este lançamento foi cancelado. Fica junto do valor
             porque é a primeira pergunta de quem abre um lançamento cancelado, e
             a resposta vivia só na trilha de auditoria — outra tela, outra busca.

             "Motivo não registrado" para os cancelados antes desta fase: é a
             verdade, e melhor do que uma frase inventada que parece motivo. */''}
        ${entry.rawStatus === 'cancelado' ? `
          <p class="prompt-aviso">
            <strong>Lançamento cancelado${entry.cancelledByName ? ` por ${escapeHtml(entry.cancelledByName)}` : ''}${entry.cancelledAt ? ` em ${financeFormatDate(String(entry.cancelledAt).slice(0, 10))}` : ''}.</strong>
            ${entry.cancelReason
              ? `Motivo: ${escapeHtml(entry.cancelReason)}`
              : 'Motivo não registrado — o cancelamento é anterior à exigência de motivo.'}
          </p>` : ''}

        ${entry.payments.length ? `
          <h4>Histórico de baixas</h4>
          <div class="table-scroll">
            <table class="table">
              <thead><tr><th>Data</th><th>Valor</th><th>Conta</th><th>Juros</th><th>Multa</th><th>Desconto</th><th>Por</th></tr></thead>
              <tbody>
                ${entry.payments.map((p) => `
                  <tr>
                    <td>${financeFormatDate(p.date)}</td>
                    <td>${financeFormatBRL(p.amount)}</td>
                    <td>${escapeHtml(p.bankAccountName || '-')}</td>
                    <td>${financeFormatBRL(p.interest)}</td>
                    <td>${financeFormatBRL(p.fine)}</td>
                    <td>${financeFormatBRL(p.discount)}</td>
                    <td>${escapeHtml(p.createdByName || '-')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : ''}

        ${canPay ? `
          <h4>${isReceita ? 'Recebimento' : 'Pagamento'}</h4>
          <form id="financePaymentForm" class="form-grid">
            <div class="row">
              <label>Valor<input type="number" step="0.01" name="amount" required value="${Number(valorSugerido).toFixed(2)}" /></label>
              <label>Data<input type="date" name="date" required value="${financeHojeLocal()}" /></label>
              <label>Conta bancária<select name="bankAccountId"><option value="">Selecione</option>${optionListInline(entry, 'bankAccounts')}</select></label>
            </div>
            <div class="row">
              <label>Juros<input type="number" step="0.01" name="interest" value="0" /></label>
              <label>Multa<input type="number" step="0.01" name="fine" value="0" /></label>
              <label>Desconto<input type="number" step="0.01" name="discount" value="${Number(taxaAAbater).toFixed(2)}" /></label>
            </div>
            <label>Observação<input name="note" /></label>
            <button type="submit">Registrar ${isReceita ? 'recebimento' : 'pagamento'}</button>
          </form>
        ` : ''}

        ${podeParcelar ? `
          <!-- PARCELAR (17/10/2026, pedido do usuário): a nota sem duplicatas no
               XML vira um título só; aqui ele se divide nas parcelas combinadas. -->
          <div id="financeParcelar" class="finance-parcelar" hidden>
            <h4>Parcelar</h4>
            <div class="row">
              <label>Parcelas<input type="number" min="2" max="120" step="1" id="financeParcelarQtd" value="2" /></label>
              <label>1º vencimento<input type="date" id="financeParcelarPrimeiro" value="${escapeHtml(String(entry.dueDate || '').slice(0, 10))}" /></label>
              <label>Intervalo (dias)<input type="number" min="0" max="365" step="1" id="financeParcelarIntervalo" value="30" /></label>
            </div>
            <div class="table-scroll">
              <table class="table">
                <thead><tr><th>Parcela</th><th>Vencimento</th><th class="col-valor">Valor</th></tr></thead>
                <tbody id="financeParcelarLinhas"></tbody>
                <tfoot><tr><th colspan="2">Soma (título: ${financeFormatBRL(entry.amountPrevisto)})</th><th class="col-valor" id="financeParcelarSoma"></th></tr></tfoot>
              </table>
            </div>
            <button type="button" id="financeParcelarConfirmar">Confirmar parcelamento</button>
          </div>
        ` : ''}

        <div class="finance-modal-actions">
          ${entry.rawStatus === 'pending' ? `<button type="button" class="secondary" id="financeModalEdit">${entry.editable ? 'Editar' : 'Editar vencimento e classificação'}</button>` : ''}
          ${podeParcelar ? '<button type="button" class="secondary" id="financeModalParcelar">Parcelar</button>' : ''}
          ${canEstorno ? `<button type="button" class="secondary" id="financeModalEstorno">Estornar última baixa</button>` : ''}
          ${canCancel ? `<button type="button" class="btn-danger" id="financeModalCancel">Cancelar lançamento</button>` : ''}
          ${podeExcluir() ? '<button type="button" class="btn-danger" id="financeModalExcluir">Excluir lançamento</button>' : ''}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeEntryModal(); });
    document.getElementById('financeModalClose')?.addEventListener('click', closeEntryModal);

    document.getElementById('financePaymentForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = event.target.querySelector('button[type="submit"]');
      if (submitBtn?.disabled) return;
      if (submitBtn) submitBtn.disabled = true;
      const formData = new FormData(event.target);
      try {
        await api(`/api/finance/entries/${entry.id}/payments`, {
          method: 'POST',
          body: JSON.stringify({
            amount: Number(formData.get('amount')),
            date: formData.get('date'),
            bankAccountId: formData.get('bankAccountId'),
            interest: Number(formData.get('interest') || 0),
            fine: Number(formData.get('fine') || 0),
            discount: Number(formData.get('discount') || 0),
            note: formData.get('note')
          })
        });
        showToast(`${isReceita ? 'Recebimento' : 'Pagamento'} registrado com sucesso.`, 'success');
        closeEntryModal();
        await load();
      } catch (error) {
        showToast(error.message || 'Erro ao registrar baixa.', 'error');
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    document.getElementById('financeModalEstorno')?.addEventListener('click', async () => {
      const confirmed = await confirmModal('Confirma o estorno da última baixa deste lançamento?');
      if (!confirmed) return;
      try {
        await api(`/api/finance/entries/${entry.id}/estorno`, { method: 'POST' });
        showToast('Baixa estornada com sucesso.', 'success');
        closeEntryModal();
        await load();
      } catch (error) {
        showToast(error.message || 'Erro ao estornar baixa.', 'error');
      }
    });

    document.getElementById('financeModalExcluir')?.addEventListener('click', () => excluirLancamentos([entry.id], { doModal: true }));

    document.getElementById('financeModalCancel')?.addEventListener('click', async () => {
      // MOTIVO, E NÃO SÓ "CONFIRMA?" (fase AX). O mesmo promptModal do
      // cancelamento de NF-e: conta os caracteres enquanto se escreve e só
      // libera o botão quando o texto serve, em vez de deixar escrever, enviar
      // e receber o erro do servidor de volta.
      const motivo = await promptModal({
        titulo: `Cancelar ${entry.codigo || 'lançamento'}`,
        descricao: 'O lançamento continua na lista, marcado como cancelado, com o motivo registrado. O histórico não se perde.',
        rotulo: 'Motivo do cancelamento',
        placeholder: 'Ex.: pedido devolvido pelo cliente em 03/09',
        minimo: 10,
        maximo: 300,
        confirmar: 'Cancelar lançamento'
      });
      if (!motivo) return;
      try {
        const resposta = await api(`/api/finance/entries/${entry.id}/cancelar`, { method: 'POST', body: JSON.stringify({ motivo }) });
        showToast('Lançamento cancelado.', 'success');
        // Era o último título de um pedido Pré-Faturado: ele voltou (21/10/2026).
        if (resposta && resposta.aviso) showToast(resposta.aviso, 'info', 8000);
        closeEntryModal();
        await load();
      } catch (error) {
        showToast(error.message || 'Erro ao cancelar lançamento.', 'error');
      }
    });

    // PARCELAR: as linhas saem de quantidade, 1º vencimento e intervalo (o
    // centavo que sobra da divisão vai na 1ª); vencimento e valor de cada uma
    // continuam editáveis, e a soma tem de fechar com o título.
    const totalEmCentavos = Math.round(Number(entry.amountPrevisto || 0) * 100);
    const linhasDoParcelamento = () => [...document.querySelectorAll('#financeParcelarLinhas tr')].map((tr) => ({
      dueDate: tr.querySelector('[data-parcela-vencimento]').value,
      amount: Number(tr.querySelector('[data-parcela-valor]').value || 0)
    }));
    const atualizarSoma = () => {
      const soma = linhasDoParcelamento().reduce((s, p) => s + Math.round(p.amount * 100), 0);
      const celula = document.getElementById('financeParcelarSoma');
      if (!celula) return;
      celula.textContent = financeFormatBRL(soma / 100);
      celula.classList.toggle('finance-negative', soma !== totalEmCentavos);
    };
    const montarParcelas = () => {
      const qtd = Math.min(120, Math.max(2, Math.floor(Number(document.getElementById('financeParcelarQtd').value) || 2)));
      const primeiro = document.getElementById('financeParcelarPrimeiro').value || financeHojeLocal();
      const intervalo = Math.max(0, Math.floor(Number(document.getElementById('financeParcelarIntervalo').value) || 0));
      const base = Math.floor(totalEmCentavos / qtd);
      const [ano, mes, dia] = primeiro.split('-').map(Number);
      const corpo = document.getElementById('financeParcelarLinhas');
      corpo.innerHTML = Array.from({ length: qtd }, (_, i) => {
        const data = new Date(Date.UTC(ano, mes - 1, dia + i * intervalo)).toISOString().slice(0, 10);
        const centavos = i === 0 ? totalEmCentavos - base * (qtd - 1) : base;
        return `<tr>
          <td>${i + 1}/${qtd}</td>
          <td><input type="date" data-parcela-vencimento value="${data}" /></td>
          <td class="col-valor"><input type="number" step="0.01" min="0.01" data-parcela-valor value="${(centavos / 100).toFixed(2)}" /></td>
        </tr>`;
      }).join('');
      corpo.querySelectorAll('[data-parcela-valor]').forEach((campo) => campo.addEventListener('input', atualizarSoma));
      atualizarSoma();
    };
    document.getElementById('financeModalParcelar')?.addEventListener('click', () => {
      const quadro = document.getElementById('financeParcelar');
      quadro.hidden = !quadro.hidden;
      if (!quadro.hidden) {
        montarParcelas();
        quadro.scrollIntoView({ block: 'nearest' });
      }
    });
    ['financeParcelarQtd', 'financeParcelarPrimeiro', 'financeParcelarIntervalo'].forEach((idDoCampo) => {
      document.getElementById(idDoCampo)?.addEventListener('change', montarParcelas);
    });
    document.getElementById('financeParcelarConfirmar')?.addEventListener('click', async (evento) => {
      const parcelas = linhasDoParcelamento();
      const soma = parcelas.reduce((s, p) => s + Math.round(p.amount * 100), 0);
      if (soma !== totalEmCentavos) {
        showToast(`A soma das parcelas (${financeFormatBRL(soma / 100)}) tem de fechar com o valor do título (${financeFormatBRL(totalEmCentavos / 100)}).`, 'warning');
        return;
      }
      if (parcelas.some((p) => !p.dueDate || !(p.amount > 0))) {
        showToast('Cada parcela precisa de vencimento e de valor maior que zero.', 'warning');
        return;
      }
      evento.currentTarget.disabled = true;
      try {
        await api(`/api/finance/entries/${encodeURIComponent(entry.id)}/parcelar`, { method: 'POST', body: JSON.stringify({ parcelas }) });
        showToast(`Título parcelado em ${parcelas.length}.`, 'success');
        closeEntryModal();
        await load();
      } catch (error) {
        showToast(error.message || 'Erro ao parcelar o lançamento.', 'error');
        const botao = document.getElementById('financeParcelarConfirmar');
        if (botao) botao.disabled = false;
      }
    });

    document.getElementById('financeModalEdit')?.addEventListener('click', () => {
      closeEntryModal();
      state.financeEditEntryId = entry.id;
      state.financeListaDeOrigem = telaChave;
      // 14/10/2026: abre como "Edição de Título", já com os dados dele.
      state.activeSub = 'edicao_titulo';
      // Redesenha o topo junto: sem isto a página seguia dizendo "Contas a Pagar".
      if (typeof renderApp === 'function') renderApp();
      loadModule('finance');
    });

    if (options.focusPayment) {
      document.getElementById('financePaymentForm')?.querySelector('input[name="amount"]')?.focus();
    }
  }

  function optionListInline(entry, kind) {
    if (kind === 'bankAccounts') {
      return meta.bankAccounts.map((acc) => `<option value="${acc.id}" ${entry.bankAccountId === acc.id ? 'selected' : ''}>${escapeHtml(acc.name)}</option>`).join('');
    }
    return '';
  }

  await load();

  // O lançamento pedido por outra tela (dashboard, extrato, NF-e) — lido e
  // apagado no começo desta função, e aberto só se ela ainda é a da vez.
  if (idParaAbrir && telaAtiva()) openEntryModal(idParaAbrir);
  };
}

Object.keys(FINANCE_TELAS_DE_LANCAMENTOS).forEach((telaChave) => {
  window.MavisSubscreenRegistry.finance[telaChave] = criarTelaDeLancamentos(telaChave);
});
