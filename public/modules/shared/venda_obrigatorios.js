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

  /**
   * O primeiro campo obrigatório que falta, ou null.
   *
   * `categorias`: as categorias de venda cadastradas. Com elas, pedido de
   * categoria que não gera financeiro (transferência entre filiais, remessa)
   * não precisa de pagamento (14/10/2026).
   */
  function faltando(registro, { categorias = [] } = {}) {
    const r = registro || {};
    for (const def of CAMPOS) {
      if (!String(r[def.campo] == null ? '' : r[def.campo]).trim()) return def;
    }
    const exige = categoriaVenda && typeof categoriaVenda.exigePagamento === 'function'
      ? categoriaVenda.exigePagamento(r.category, categorias)
      : true;
    if (exige && !temPagamento(r.payments)) {
      return {
        campo: 'payments',
        rotulo: 'Pagamentos',
        mensagem: 'Informe ao menos uma forma de pagamento com valor (aba Pagamentos).',
        aba: 'pagamentos'
      };
    }
    return null;
  }

  const api = { CAMPOS, faltando, temPagamento };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisVendaObrigatorios = api;
})(typeof window !== 'undefined' ? window : globalThis);
