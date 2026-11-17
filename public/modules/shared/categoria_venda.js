// O QUE A CATEGORIA DE VENDA FAZ NO SISTEMA (fase EF, 13/10/2026).
//
// Pedido do usuário: a categoria de venda (ex.: "Transferência") diz se ALTERA
// O ESTOQUE, se GERA FINANCEIRO, qual a UTILIDADE dela, e se liga aos outros
// módulos. Decisões dele: as quatro ligações — o pedido (estoque e
// financeiro), os relatórios/painéis/metas (o que conta como venda), o fiscal
// (operação da NF-e) e o financeiro (categoria das contas a receber); e as
// categorias que já existiam começam como Venda, alterando estoque e gerando
// financeiro, como o sistema sempre fez.
//
// A categoria é gravada no pedido pelo NOME, e o nome costuma vir com a filial
// depois da barra ("Venda de Materiais e Serviços / Timbo" — ver
// lib/filial-da-venda.js). Por isso a regra procura primeiro o nome inteiro e
// depois o nome SEM a filial.
//
// Categoria NÃO cadastrada não tem regra: o pedido segue como sempre (status
// decide), e os relatórios seguem pelo texto ("transfer"/"remessa" não é
// venda). Mudar isso faria as transferências antigas virarem venda nos
// painéis da noite para o dia.
//
// Usado no servidor (efeitos do pedido, relatórios) e na tela (cadastro da
// categoria, NF-e a partir do pedido).
(function (raiz) {
  const FINALIDADES = [
    // `estoque`/`financeiro`/`operacao` são só a SUGESTÃO ao escolher a
    // finalidade numa categoria nova; quem salva decide. A operação fiscal só
    // é sugerida onde o nome é o mesmo — em garantia, demonstração e outros
    // quem escolhe é o usuário (questão fiscal: decide o contador).
    { id: 'venda', name: 'Venda', estoque: true, financeiro: true, operacao: 'VENDA' },
    { id: 'transferencia', name: 'Transferência entre filiais', estoque: true, financeiro: false, operacao: 'TRANSFERENCIA' },
    { id: 'remessa', name: 'Remessa', estoque: true, financeiro: false, operacao: 'REMESSA' },
    { id: 'bonificacao', name: 'Bonificação / Brinde', estoque: true, financeiro: false, operacao: 'BONIFICACAO' },
    { id: 'garantia', name: 'Garantia', estoque: true, financeiro: false, operacao: '' },
    { id: 'demonstracao', name: 'Demonstração', estoque: true, financeiro: false, operacao: '' },
    { id: 'devolucao', name: 'Devolução', estoque: true, financeiro: false, operacao: 'DEVOLUCAO' },
    { id: 'outros', name: 'Outros', estoque: true, financeiro: true, operacao: '' }
  ];

  // As operações da NF-e que um pedido pode gerar (lib/operacaoFiscal.js).
  // Entrada de importação e complemento de ICMS não nascem de pedido de venda.
  const OPERACOES = [
    { id: 'VENDA', name: 'Venda' },
    { id: 'TRANSFERENCIA', name: 'Transferência' },
    { id: 'REMESSA', name: 'Remessa' },
    { id: 'RETORNO', name: 'Retorno' },
    { id: 'DEVOLUCAO', name: 'Devolução' },
    { id: 'BONIFICACAO', name: 'Bonificação' },
    // 20/10/2026: a operação nova. A categoria "Garantia" não muda sozinha:
    // quem escolhe a operação de cada categoria é o usuário.
    { id: 'GARANTIA', name: 'Garantia' }
  ];

  const chave = (nome) => String(nome || '').normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

  /** "Venda de Materiais e Serviços / Timbo" -> "Venda de Materiais e Serviços" */
  function semFilial(nome) {
    const texto = String(nome || '');
    const barra = texto.lastIndexOf('/');
    return barra >= 0 ? texto.slice(0, barra).trim() : texto.trim();
  }

  function finalidade(id) {
    return FINALIDADES.find((f) => f.id === id) || null;
  }

  /** A categoria cadastrada de um pedido: nome inteiro, senão sem a filial. */
  function categoriaDoPedido(nome, categorias) {
    const lista = categorias || [];
    const inteiro = chave(nome);
    if (!inteiro) return null;
    return lista.find((c) => chave(c.name) === inteiro)
      || lista.find((c) => chave(c.name) === chave(semFilial(nome)))
      || null;
  }

  /**
   * O que o pedido com esta categoria faz. `cadastrada: false` = sem regra
   * (estoque e financeiro seguem o status; "conta como venda" fica para o
   * texto, ver lib/filial-da-venda.js).
   */
  function regraDaCategoria(nome, categorias) {
    const c = categoriaDoPedido(nome, categorias);
    if (!c) {
      return { cadastrada: false, finalidade: '', alteraEstoque: true, geraFinanceiro: true, operacaoFiscal: '', financialCategoryId: '', contaComoVenda: null };
    }
    const fin = c.finalidade || 'venda';
    return {
      cadastrada: true,
      nome: c.name,
      finalidade: fin,
      alteraEstoque: c.alteraEstoque !== false,
      geraFinanceiro: c.geraFinanceiro !== false,
      operacaoFiscal: c.operacaoFiscal || '',
      financialCategoryId: c.financialCategoryId || '',
      contaComoVenda: fin === 'venda'
    };
  }

  /**
   * O pedido desta categoria precisa de forma de pagamento? (14/10/2026)
   *
   * Pedido do usuário: "transferência entre filiais não gera financeiro, a
   * operação não é obrigatória adicionar forma de pagamento". Cadastrada: vale
   * o "gera financeiro" dela. Não cadastrada: pelo texto, como os relatórios
   * (lib/filial-da-venda.js) — transferência e remessa não exigem.
   */
  function exigePagamento(nome, categorias) {
    const regra = regraDaCategoria(nome, categorias);
    if (regra.cadastrada) return regra.geraFinanceiro;
    const texto = String(nome || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    return !/transfer|remessa/.test(texto);
  }

  /**
   * O FILTRO DE CATEGORIAS DOS RELATÓRIOS (17/11/2026). Pedido do usuário:
   * "preciso que os relatórios tenham filtros de categorias para que eu
   * consiga diferenciar quais categorias eu quero pegar, exemplo: vendas ou
   * transferência entre filiais, garantia e etc".
   *
   * A categoria do filtro é a do pedido SEM a filial ("Venda de Materiais e
   * Serviços / Timbo" e "... / Araquari" são a mesma "Venda de Materiais e
   * Serviços" — a loja já tem o campo Empresa), comparada sem acento e sem
   * caixa. Pedido sem categoria tem a chave SEM_CATEGORIA. O SQL dos
   * relatórios repete a mesma conta (lib/relatorios/comum.js, categoriaSql).
   */
  const SEM_CATEGORIA = 'sem-categoria';
  const SEPARADOR_DO_FILTRO = '|';

  function chaveDoFiltro(nome) {
    return chave(semFilial(nome)) || SEM_CATEGORIA;
  }

  /** "a|b|a" (da tela) -> ['a', 'b']: chaves já normalizadas, sem repetir. */
  function lerFiltro(valor) {
    const lista = Array.isArray(valor) ? valor : String(valor || '').split(SEPARADOR_DO_FILTRO);
    const vistas = new Set();
    for (const item of lista) {
      const k = String(item || '').trim() === SEM_CATEGORIA ? SEM_CATEGORIA : chave(item).slice(0, 120);
      if (k) vistas.add(k);
      if (vistas.size >= 60) break;
    }
    return [...vistas];
  }

  /**
   * As opções do campo: [{ category, total }] (o que os pedidos usam) e as
   * categorias cadastradas -> [{ id: chave, name }]. O nome é a grafia mais
   * usada daquela chave; "Sem categoria" vai por último.
   */
  function opcoesDoFiltro(usadas, cadastradas) {
    const porChave = new Map();
    const somar = (nome, total) => {
      const k = chaveDoFiltro(nome);
      const item = porChave.get(k) || new Map();
      const exibido = k === SEM_CATEGORIA ? 'Sem categoria' : semFilial(nome).replace(/\s+/g, ' ');
      item.set(exibido, (item.get(exibido) || 0) + total);
      porChave.set(k, item);
    };
    for (const u of usadas || []) somar(u.category, Number(u.total) || 1);
    for (const c of cadastradas || []) somar(c.name, 0);
    return [...porChave.entries()]
      .map(([id, grafias]) => ({ id, name: [...grafias.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
      .sort((a, b) => (a.id === SEM_CATEGORIA) - (b.id === SEM_CATEGORIA) || a.name.localeCompare(b.name, 'pt-BR'));
  }

  const api = { FINALIDADES, OPERACOES, finalidade, semFilial, categoriaDoPedido, regraDaCategoria, exigePagamento,
    SEM_CATEGORIA, SEPARADOR_DO_FILTRO, chaveDoFiltro, lerFiltro, opcoesDoFiltro };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisCategoriaVenda = api;
})(typeof window !== 'undefined' ? window : null);
