// A LISTA DE LANÇAMENTOS — o que a tela e o servidor precisam responder igual
// (fase EI, 13/10/2026: "pesquisa por valores, organização, ordenação, seleção").
//
// Mora em public/ e o server.js faz require() do mesmo arquivo, como
// lancamento_codigo.js e sales_bulk_actions.js. Cada coisa aqui é uma pergunta
// que os dois lados fazem, e que precisa de UMA resposta:
//
//   · o texto da busca é um valor? ("2.500,00" -> 2500). A tela usa para dizer
//     "buscando também pelo valor R$ 2.500,00"; o servidor, para filtrar. Se a
//     tela entendesse 2.500 e o servidor 2,5, o aviso mentiria;
//   · quais colunas ordenam. A tela só desenha seta onde o servidor ordena —
//     cabeçalho clicável que não muda nada é pior do que cabeçalho parado;
//   · quais situações cada aba junta ("Em aberto" = pendente + vencido +
//     parcial). A contagem da aba vem do servidor, o filtro sai da tela;
//   · quem pode ser baixado ou cancelado em lote. Mesmo contrato do lote de
//     vendas: elegivel(lancamento) -> true | 'motivo'. A tela desabilita o botão
//     com o motivo; o servidor confere de novo, porque entre desenhar a lista e
//     clicar outra pessoa pode ter baixado um dos selecionados.
(function (raiz) {
  // As chaves aceitas em ?sort= — o comparador de cada uma mora no server.js
  // (ORDENS_DA_LISTA_DE_LANCAMENTOS), que é quem tem o cadastro para resolver
  // nome de categoria e de cliente. Chave fora daqui = ordem padrão.
  const ORDENAVEIS = [
    'codigo', 'date', 'dueDate', 'description', 'type', 'category',
    'clienteFornecedor', 'amount', 'status', 'document', 'costCenter', 'bankAccount'
  ];

  // Texto ordena de A a Z no primeiro clique; data, número e valor, do maior
  // para o menor — o lançamento mais recente e o mais caro são os procurados.
  const COMECA_CRESCENTE = ['description', 'type', 'category', 'clienteFornecedor', 'status', 'document', 'costCenter', 'bankAccount'];

  // AS ABAS DE SITUAÇÃO. `status` é o que vai na URL da API, separado por
  // vírgula; a aba "Todos" não filtra nada. A ordem é a da tela.
  //
  // 'parcial-vencido' não é um rótulo: é o parcial cujo vencimento passou. Ele
  // continua "Parcial" (já recebeu uma parte), mas está vencido — o dashboard o
  // conta assim, e a aba Vencidos que o deixasse de fora mostraria menos do que
  // o cartão de lá. O servidor entende o recorte (filterFinanceEntries).
  const ABAS = [
    { chave: '', rotulo: 'Todos', status: [] },
    { chave: 'aberto', rotulo: 'Em aberto', status: ['pendente', 'vencido', 'parcial'] },
    { chave: 'vencido', rotulo: 'Vencidos', status: ['vencido', 'parcial-vencido'] },
    { chave: 'pendente', rotulo: 'A vencer', status: ['pendente'] },
    { chave: 'liquidado', rotulo: 'Pagos e recebidos', status: ['pago', 'recebido'] },
    { chave: 'cancelado', rotulo: 'Cancelados', status: ['cancelado'] }
  ];

  /** "pendente,vencido" -> ['pendente', 'vencido']. Vazio -> []. */
  function situacoesDoFiltro(texto) {
    return String(texto || '')
      .split(',')
      .map((parte) => parte.trim().toLowerCase())
      .filter(Boolean);
  }

  /**
   * O TEXTO DA BUSCA COMO VALOR EM REAIS, ou null quando não é valor.
   *
   * Escrito como se escreve no Brasil, e só o que não é ambíguo:
   *
   *   "2.500,00"  "2500,5"  "R$ 2.500"  ->  2500 / 2500,5 / 2500
   *   "2500"  "2500.50"  "25.73"         ->  2500 / 2500,5 / 25,73
   *   "2.500"                            ->  2500  (ponto com 3 dígitos é milhar)
   *   "1,234"  "2.50.0"  "12a"  "-5"     ->  null
   *
   * "1,234" fica de fora de propósito: em reais não existe terceira casa, e
   * adivinhar entre 1,234 e 1.234 faria a busca achar a coisa errada calada.
   */
  function valorDaBusca(texto) {
    const s = String(texto || '').trim().replace(/^r\$\s*/i, '').replace(/\s+/g, '');
    if (!s || !/^\d[\d.,]*$/.test(s)) return null;
    let numero = null;
    if (s.includes(',')) {
      const partes = s.split(',');
      if (partes.length !== 2) return null;
      const [inteira, decimal] = partes;
      if (!decimal || decimal.length > 2) return null;
      if (inteira.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(inteira)) return null;
      numero = Number(`${inteira.replace(/\./g, '')}.${decimal}`);
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      numero = Number(s.replace(/\./g, ''));
    } else if (/^\d+(\.\d{1,2})?$/.test(s)) {
      numero = Number(s);
    }
    return Number.isFinite(numero) ? numero : null;
  }

  /** O mesmo valor em centavos inteiros: comparar reais em ponto flutuante erra no último bit. */
  function centavos(valor) {
    return Math.round(Number(valor || 0) * 100);
  }

  /**
   * "LF42", "lf 0042", "LF-42" -> 42. Só com o prefixo: número solto ("42")
   * já é procurado no código formatado e como valor, e tratá-lo também como
   * número exato não acharia nada a mais.
   */
  function codigoDaBusca(texto) {
    const m = /^lf\s*-?\s*(\d+)$/i.exec(String(texto || '').trim());
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // --- Ações em lote --------------------------------------------------------
  //
  // `rawStatus` é o status gravado ('pending', 'parcial', 'paid', 'cancelado'),
  // o mesmo que as rotas de baixa e de cancelamento de UM lançamento conferem.
  // As regras abaixo são as delas, ditas antes do clique.
  const ACOES = {
    baixar: {
      rotulo: 'Baixar',
      elegivel: (l) => {
        const s = String((l && l.rawStatus) || '').toLowerCase();
        if (s === 'pending' || s === 'parcial') return true;
        if (s === 'cancelado') return 'Lançamento cancelado não recebe baixa.';
        if (s === 'paid') return 'Já está baixado.';
        return 'Situação não permite baixa.';
      }
    },
    cancelar: {
      rotulo: 'Cancelar',
      elegivel: (l) => {
        const s = String((l && l.rawStatus) || '').toLowerCase();
        if (s === 'cancelado') return 'Já está cancelado.';
        // O mesmo veto da rota de cancelar: a baixa precisa ser estornada
        // antes, senão o dinheiro que entrou some junto com o título.
        if (s === 'paid' || s === 'parcial') return 'Tem baixa registrada: estorne antes de cancelar.';
        return true;
      }
    },
    // EXCLUIR (19/10/2026): qualquer situação — com baixa, as baixas saem
    // junto (decisão do usuário). A permissão é finance.excluir, cobrada pelo
    // portão na rota DELETE /api/finance/entries.
    excluir: {
      rotulo: 'Excluir',
      elegivel: () => true
    }
  };

  // Um lote por vez não passa disto: a baixa de cada um é uma gravação no banco
  // e uma linha de auditoria, e a tela não seleciona mais de 100 por página.
  const MAXIMO_DO_LOTE = 200;

  function avaliar(acaoId, lancamentos) {
    // hasOwnProperty: ACOES['constructor'] é a função Object, e chamá-la de
    // `elegivel` derrubaria quem pergunta por uma ação que não existe.
    const acao = Object.prototype.hasOwnProperty.call(ACOES, acaoId) ? ACOES[acaoId] : null;
    const elegiveis = [];
    const ignorados = [];
    (lancamentos || []).forEach((l) => {
      const veredito = acao ? acao.elegivel(l) : 'Ação desconhecida.';
      if (veredito === true) elegiveis.push(l);
      else ignorados.push({ lancamento: l, motivo: String(veredito || 'Não elegível.') });
    });
    return { elegiveis, ignorados };
  }

  /** "3 processados, 1 ignorado." — sempre dizendo se sobrou alguém. */
  function resumo(processados, ignorados) {
    const p = `${processados} ${processados === 1 ? 'processado' : 'processados'}`;
    if (!ignorados) return `${p}.`;
    return `${p}, ${ignorados} ${ignorados === 1 ? 'ignorado' : 'ignorados'}.`;
  }

  const api = {
    ORDENAVEIS, COMECA_CRESCENTE, ABAS, ACOES, MAXIMO_DO_LOTE,
    situacoesDoFiltro, valorDaBusca, centavos, codigoDaBusca, avaliar, resumo
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisListaDeLancamentos = api;
})(typeof window !== 'undefined' ? window : null);
