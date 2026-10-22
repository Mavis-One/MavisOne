// OS CAMPOS OBRIGATÓRIOS DO PEDIDO/ORÇAMENTO (13/10/2026).
//
// Pedido do usuário: "coloque empresa, categoria, depósito (mesmo que puxado
// automaticamente), vendedor (mesmo que puxado automaticamente) e pagamentos
// como campo obrigatório". O cliente já era.
//
// FONTE ÚNICA: a tela confere antes de salvar (e diz qual campo falta) e o
// servidor recusa na gravação com a mesma regra — require() deste arquivo. Uma
// regra escrita duas vezes são duas regras.
//
// Pagamento conta quando a linha tem forma escolhida E valor maior que zero.
(function (raiz) {
  const CAMPOS = [
    { campo: 'companyId', rotulo: 'Empresa', mensagem: 'Selecione a empresa.', foco: 'salesCompanyInput' },
    { campo: 'category', rotulo: 'Categoria', mensagem: 'Selecione a categoria.', foco: 'salesCategoryInput' },
    { campo: 'depositId', rotulo: 'Depósito', mensagem: 'Selecione o depósito.', foco: 'salesDepositInput' },
    { campo: 'sellerId', rotulo: 'Vendedor', mensagem: 'Selecione o vendedor.', foco: 'salesSellerInput' }
  ];

  const temPagamento = (pagamentos) => (Array.isArray(pagamentos) ? pagamentos : [])
    .some((linha) => linha && String(linha.methodId || '').trim() && Number(linha.amount || 0) > 0);

  // Quem diz se a categoria exige pagamento (shared/categoria_venda.js).
  const categoriaVenda = typeof module !== 'undefined' && module.exports
    ? require('./categoria_venda')
    : raiz.MavisCategoriaVenda;
  // Na tela, forma_pagamento.js e sales_status.js carregam DEPOIS deste
  // arquivo: por isso são lidos na hora da conferência, não aqui em cima.
  const formaPagamento = () => (typeof module !== 'undefined' && module.exports
    ? require('./forma_pagamento')
    : raiz.MavisFormaPagamento);
  const salesStatus = () => (typeof module !== 'undefined' && module.exports
    ? require('./sales_status')
    : raiz.MavisSalesStatus);

  // NSU/AUTORIZAÇÃO OBRIGATÓRIO NO CARTÃO (14/10/2026, pedido do usuário).
  // Linha de cartão (crédito ou débito, pelo tipo da forma) com valor e sem
  // NSU. Orçamento fica de fora: ainda não houve cobrança, não há NSU.
  // `formas`: o cadastro de formas de pagamento; sem ele, não confere.
  function cartaoSemNsu(r, formas, tipoRegistro) {
    if (!Array.isArray(formas) || !formas.length) return -1;
    const status = salesStatus();
    if (status && status.tipoDoStatus(status.normalizar(r.status, tipoRegistro)) === 'quote') return -1;
    const fp = formaPagamento();
    if (!fp) return -1;
    return (Array.isArray(r.payments) ? r.payments : []).findIndex((linha) => {
      if (!linha || Number(linha.amount || 0) <= 0) return false;
      const forma = formas.find((f) => f && f.id === linha.methodId);
      return Boolean(forma) && fp.ehCartao(forma.type) && !String(linha.cardAuthorization || '').trim();
    });
  }

  // CHASSI OBRIGATÓRIO NO VEÍCULO (16/10/2026, pedido do usuário: "deixe o
  // campo chassi ... de um novo pedido/orçamento como obrigatório"). Veículo é
  // o produto de NCM 8711 (autopropelidos, motos e bicicletas elétricas): peça,
  // acessório e serviço não têm chassi. `ncmDoItem(item)` dá o NCM do produto
  // da linha; sem ele, não confere.
  const ehVeiculo = (ncm) => /^8711/.test(String(ncm || '').replace(/\D/g, ''));
  function itemSemChassi(itens, ncmDoItem) {
    if (typeof ncmDoItem !== 'function') return -1;
    return (Array.isArray(itens) ? itens : [])
      .findIndex((item) => item && ehVeiculo(ncmDoItem(item)) && !String(item.chassi || '').trim());
  }

  // MONTADO OU DESMONTADO NO PRODUTO QUE CONTROLA MONTAGEM (fase ER,
  // 17/10/2026): o item diz de qual saldo sai. `montagemDoItem(item)` diz se o
  // produto da linha controla montagem; sem ele, não confere.
  //
  // NÃO É MAIS OBRIGATÓRIO (fase FA, 22/10/2026, decisão do usuário: religar
  // "sem travar a venda"). Exigido, ele parou as lojas em 19/10. Item sem
  // condição sai do MONTADO (condicaoDoItemDaVenda, em server.js), e a tela já
  // abre a linha nova em Montado. `faltando` não o confere; a função fica para
  // quem quiser saber qual item veio sem.
  const CONDICOES = ['desmontado', 'montado'];
  function itemSemCondicao(itens, montagemDoItem) {
    if (typeof montagemDoItem !== 'function') return -1;
    return (Array.isArray(itens) ? itens : [])
      .findIndex((item) => item && montagemDoItem(item) && !CONDICOES.includes(String(item.condicao || '').trim().toLowerCase()));
  }

  /**
   * O primeiro campo obrigatório que falta, ou null.
   *
   * `categorias`: as categorias de venda cadastradas. Com elas, pedido de
   * categoria que não gera financeiro (transferência entre filiais, remessa)
   * não precisa de pagamento (14/10/2026).
   *
   * `formas` (cadastro de formas de pagamento) e `tipoRegistro` ('order' |
   * 'quote'): com eles, cartão sem NSU/Autorização também falta.
   *
   * `ncmDoItem`: com ele, veículo sem chassi também falta.
   *
   * `montagemDoItem`: com ele, item de produto que controla montagem sem
   * Montado/Desmontado também falta.
   */
  function faltando(registro, { categorias = [], total, formas, tipoRegistro, ncmDoItem, montagemDoItem } = {}) {
    const r = registro || {};
    for (const def of CAMPOS) {
      if (!String(r[def.campo] == null ? '' : r[def.campo]).trim()) return def;
    }
    const semChassi = itemSemChassi(r.items, ncmDoItem);
    if (semChassi >= 0) {
      return {
        campo: 'items',
        rotulo: 'Chassi',
        mensagem: `Informe o chassi de ${String(r.items[semChassi].name || 'veículo').trim()} (item ${semChassi + 1}).`,
        aba: 'dados',
        itemSemChassi: semChassi
      };
    }
    const exige = categoriaVenda && typeof categoriaVenda.exigePagamento === 'function'
      ? categoriaVenda.exigePagamento(r.category, categorias)
      : true;
    // OS PAGAMENTOS FECHAM COM O TOTAL (14/10/2026, pedido do usuário: "vincule
    // os valores de pagamentos com o valor total do pedido"). Só quando quem
    // chama sabe o total — a tela e o servidor calculam o mesmo.
    const somaDosPagamentos = (Array.isArray(r.payments) ? r.payments : [])
      .reduce((soma, linha) => soma + Number((linha && linha.amount) || 0), 0);
    if (exige && temPagamento(r.payments) && Number.isFinite(Number(total)) && total !== undefined && total !== null
      && Math.abs(Math.round(somaDosPagamentos * 100) - Math.round(Number(total) * 100)) >= 1) {
      const reais = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      return {
        campo: 'payments',
        rotulo: 'Pagamentos',
        mensagem: `A soma dos pagamentos (${reais(somaDosPagamentos)}) tem de fechar com o total do pedido (${reais(total)}): diferença de ${reais(Math.abs(somaDosPagamentos - Number(total)))}.`,
        aba: 'pagamentos'
      };
    }
    if (exige && !temPagamento(r.payments)) {
      return {
        campo: 'payments',
        rotulo: 'Pagamentos',
        mensagem: 'Informe ao menos uma forma de pagamento com valor (aba Pagamentos).',
        aba: 'pagamentos'
      };
    }
    const semNsu = cartaoSemNsu(r, formas, tipoRegistro);
    if (semNsu >= 0) {
      return {
        campo: 'payments',
        rotulo: 'NSU / Autorização',
        mensagem: `Informe o NSU / Autorização do pagamento em cartão (aba Pagamentos, linha ${semNsu + 1}).`,
        aba: 'pagamentos',
        linha: semNsu
      };
    }
    return null;
  }

  const api = { CAMPOS, faltando, temPagamento, cartaoSemNsu, ehVeiculo, itemSemChassi, itemSemCondicao };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisVendaObrigatorios = api;
})(typeof window !== 'undefined' ? window : globalThis);
