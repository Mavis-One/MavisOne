// CONTA BANCÁRIA E CENTRO DE CUSTO OBRIGATÓRIOS NO LANÇAMENTO (23/10/2026).
//
// Pedido do usuário: "deixe os campos de centro de custo, conta bancária e
// banco em lançamentos e títulos financeiros como obrigatórios". O banco é o da
// conta bancária (é dela que o relatório tira a coluna Banco): exigir a conta
// é exigir o banco.
//
// Vale para receita e despesa — no Novo Lançamento e na Edição de Título,
// inclusive o título que um pedido ou uma NF-e gerou, quando alguém o salva.
// A transferência tem as próprias contas (origem e destino) e não tem centro
// de custo. O título que o SISTEMA cria (pedido aprovado, entrada de NF-e) nasce
// sem os dois; quem o abre na Edição de Título completa.
//
// O CENTRO DE CUSTO SÓ NA RAIZ 43.792.899 (23/10/2026, logo depois, pedido do
// usuário: "a obrigatoriedade de centro de custo fique apenas na raiz do CNPJ
// 43.792.899, pois os demais não têm; deixe como opcional"). É o estabelecimento
// do título que decide; sem estabelecimento conhecido, o centro é opcional. A
// conta bancária segue obrigatória em todos.
//
// FONTE ÚNICA, como shared/venda_obrigatorios.js: a tela avisa antes de salvar
// e o servidor recusa com a mesma regra (validarLancamentoFinanceiro).
(function (raiz) {
  const CAMPOS = [
    { campo: 'bankAccountId', rotulo: 'a conta bancária', foco: 'financeBankAccountInput' },
    { campo: 'costCenter', rotulo: 'o centro de custo', foco: 'financeCostCenterInput' }
  ];

  // As raízes de CNPJ (8 dígitos) em que o centro de custo é obrigatório.
  const RAIZES_COM_CENTRO = ['43792899'];
  function exigeCentroDeCusto(cnpjDoEstabelecimento) {
    const raiz = String(cnpjDoEstabelecimento || '').replace(/\D/g, '').slice(0, 8);
    return RAIZES_COM_CENTRO.includes(raiz);
  }

  /**
   * Os campos que faltam ({ campo, rotulo, foco }), ou lista vazia.
   * `cnpjDoEstabelecimento`: o do estabelecimento do título — decide o centro.
   * `centroDisponivel`: false quando NENHUM centro de custo está liberado para
   * esse estabelecimento (24/10/2026, "não estou conseguindo mais faturar"):
   * exigir o que não dá para escolher travava a gravação do título — e, com
   * ela, o faturamento. Sem centro para escolher, ele fica opcional.
   */
  function faltando(lancamento) {
    const l = lancamento || {};
    if (String(l.type || '').toUpperCase() === 'TRANSFERENCIA') return [];
    return CAMPOS
      .filter((c) => c.campo !== 'costCenter' || (exigeCentroDeCusto(l.cnpjDoEstabelecimento) && l.centroDisponivel !== false))
      .filter((c) => !String(l[c.campo] == null ? '' : l[c.campo]).trim());
  }

  /** "Informe a conta bancária e o centro de custo do lançamento." */
  function mensagem(faltam) {
    if (!faltam || !faltam.length) return '';
    return `Informe ${faltam.map((c) => c.rotulo).join(' e ')} do lançamento.`;
  }

  const api = { CAMPOS, RAIZES_COM_CENTRO, exigeCentroDeCusto, faltando, mensagem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisLancamentoObrigatorios = api;
})(typeof window !== 'undefined' ? window : globalThis);
