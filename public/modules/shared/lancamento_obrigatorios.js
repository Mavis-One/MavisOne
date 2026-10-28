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

  const raizDoCnpj = (cnpj) => String(cnpj || '').replace(/\D/g, '').slice(0, 8);
  const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

  // As raízes de CNPJ (8 dígitos) em que o centro de custo é obrigatório.
  const RAIZES_COM_CENTRO = ['43792899'];
  function exigeCentroDeCusto(cnpjDoEstabelecimento) {
    return RAIZES_COM_CENTRO.includes(raizDoCnpj(cnpjDoEstabelecimento));
  }

  // AS EMPRESAS SEM CENTRO DE CUSTO (28/10/2026, pedido do usuário: "quando
  // houver um lançamento da Kaccau, By Blumenau e Electric, não pode ter centro
  // de custos"). O lançamento é delas pelo estabelecimento OU pela conta
  // bancária: Kaccau e By Blumenau nem sempre são estabelecimento aqui, e as
  // contas delas levam o nome da empresa ("SICOOB KACCAU", "ITAU BY BLUMENAU").
  // `cnpjDaConta` é a empresa da conta pela regra da coluna Empresa
  // (resolvedorDeEmpresas, no servidor); o nome é a segunda tentativa.
  const EMPRESAS_SEM_CENTRO = [
    { nome: 'ELECTRIC', raiz: '46877837', naConta: /\bELECTRICS?\b/ },
    { nome: 'KACCAU', raiz: '51638084', naConta: /\bKACCAU\b/ },
    { nome: 'BY BLUMENAU', raiz: '53812831', naConta: /\bBY BLUMENAU\b/ }
  ];
  /** A empresa ({ nome, raiz }) cujo lançamento não leva centro de custo, ou null. */
  function empresaSemCentro({ cnpjDoEstabelecimento, cnpjDaConta, nomeDaConta } = {}) {
    const raizes = [raizDoCnpj(cnpjDoEstabelecimento), raizDoCnpj(cnpjDaConta)];
    const nome = semAcento(nomeDaConta);
    return EMPRESAS_SEM_CENTRO.find((e) => raizes.includes(e.raiz) || (nome && e.naConta.test(nome))) || null;
  }

  // TRANSFERÊNCIA ENTRE PORTADORES (28/10/2026, pedido do usuário: "crédito
  // puxe receita e débito puxe despesa"). Os relatórios separam pelo TIPO do
  // lançamento, e a tela deixa escolher qualquer plano de contas em qualquer
  // tipo: uma despesa com o plano "...CREDITO" caía em Contas a Pagar. Nesses
  // planos o tipo segue o plano — CREDITO é receita, DEBITO é despesa e, sem
  // uma das duas palavras, vale o tipo cadastrado no plano.
  const PLANO_QUE_DECIDE_O_TIPO = /TRANSFERENCIA ENTRE PORTADORES/;
  function tipoPeloPlano(plano, tipo) {
    const atual = String(tipo || '').toUpperCase();
    const nome = semAcento(plano && plano.name);
    if (atual === 'TRANSFERENCIA' || !PLANO_QUE_DECIDE_O_TIPO.test(nome)) return atual;
    if (/\bCREDITO\b/.test(nome)) return 'RECEITA';
    if (/\bDEBITO\b/.test(nome)) return 'DESPESA';
    const doPlano = String(plano.type || '').toLowerCase();
    return doPlano === 'receita' ? 'RECEITA' : doPlano === 'despesa' ? 'DESPESA' : atual;
  }

  /**
   * Os campos que faltam ({ campo, rotulo, foco }), ou lista vazia.
   * `cnpjDoEstabelecimento`: o do estabelecimento do título — decide o centro.
   * `centroDisponivel`: false quando NENHUM centro de custo está liberado para
   * esse estabelecimento (24/10/2026, "não estou conseguindo mais faturar"):
   * exigir o que não dá para escolher travava a gravação do título — e, com
   * ela, o faturamento. Sem centro para escolher, ele fica opcional.
   * `cnpjDaConta`/`nomeDaConta`: a empresa da conta bancária — a de
   * EMPRESAS_SEM_CENTRO não tem centro nenhum, então nunca falta.
   */
  function faltando(lancamento) {
    const l = lancamento || {};
    if (String(l.type || '').toUpperCase() === 'TRANSFERENCIA') return [];
    return CAMPOS
      .filter((c) => c.campo !== 'costCenter'
        || (exigeCentroDeCusto(l.cnpjDoEstabelecimento) && l.centroDisponivel !== false && !empresaSemCentro(l)))
      .filter((c) => !String(l[c.campo] == null ? '' : l[c.campo]).trim());
  }

  /** "Informe a conta bancária e o centro de custo do lançamento." */
  function mensagem(faltam) {
    if (!faltam || !faltam.length) return '';
    return `Informe ${faltam.map((c) => c.rotulo).join(' e ')} do lançamento.`;
  }

  const api = { CAMPOS, RAIZES_COM_CENTRO, exigeCentroDeCusto, EMPRESAS_SEM_CENTRO, empresaSemCentro, tipoPeloPlano, faltando, mensagem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisLancamentoObrigatorios = api;
})(typeof window !== 'undefined' ? window : globalThis);
