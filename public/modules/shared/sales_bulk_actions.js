// Menu "Mais Ações" da LISTA — as ações em lote.
//
// Mora em public/ e o server.js faz require() do mesmo arquivo, como os outros
// módulos compartilhados: é ela que diz quais registros são elegíveis, e a tela
// e o servidor precisam responder igual. Se a tela achasse que dá e o servidor
// achasse que não, a pessoa selecionaria 12 linhas para ver 12 recusas.
//
// O CONTRATO DE CADA AÇÃO — e o motivo de ele existir:
//
//   elegivel(registro) -> true | 'motivo pelo qual este não pode'
//
// Uma ação em lote sobre 15 pedidos quase nunca se aplica aos 15. O caminho
// fácil seria processar o que dá e ficar quieto sobre o resto; o resultado é
// alguém achando que faturou 15 quando faturou 9. Por isso toda ação devolve
// "N processados, M ignorados" com o motivo de CADA ignorado.
//
// AÇÃO SEM BACKEND NÃO VIRA BOTÃO QUE NÃO FAZ NADA. Fica no menu, desabilitada,
// dizendo por quê — é o que o briefing pede e é mais honesto do que esconder:
// escondido, a pessoa procura para sempre; desabilitado com motivo, ela sabe
// que existe e o que falta.
(function (raiz) {
  // No servidor vem por require; no navegador, do global que sales_status.js
  // publica. O nome é `MavisSalesStatus` — errar isto daria `undefined` só na
  // primeira vez que alguém abrisse o menu, e não ao carregar a página.
  const S = (typeof module !== 'undefined' && module.exports)
    ? require('./sales_status')
    : raiz.MavisSalesStatus;

  const EM_BREVE = (o_que) => () => `${o_que} ainda não existe neste sistema.`;

  // Imprimir, Impressão Direta e Baixar dependem do MESMO construtor de HTML, e
  // hoje ele mora dentro da tela de cadastro: monta o documento a partir do
  // estado do formulário — totais recalculados, grupos, linhas de pagamento. Da
  // lista não há formulário nenhum aberto.
  //
  // Extrair esse construtor para uma função que receba o registro e sirva aos
  // dois lados é o caminho certo, e é o próximo passo natural. Fazê-lo às
  // pressas poria em risco a impressão que hoje funciona.
  const IMPRESSAO_EM_BREVE = () => 'A impressão em lote depende de extrair o construtor do documento, hoje preso à tela de cadastro. Imprima pelo pedido.';

  // `icone` e o NOME de um desenho de MavisActionsMenu.ICONS, nao o SVG.
  // Este arquivo tambem roda no servidor por require(), onde nao existe
  // `window` -- montar o SVG aqui quebraria o server.js no boot. Quem desenha e
  // a tela, que resolve o nome na hora de montar a grade.
  const ehPedido = (r) => r.type === 'order';

  const CATALOGO = [
    // --- Fluxo de venda -------------------------------------------------------
    {
      id: 'aprovar', icone: 'check', grupo: 'Fluxo de venda', label: 'Aprovar', tone: 'success',
      // Aprovar significa coisas diferentes conforme o documento: orçamento
      // vira "Orçamento Aprovado", pedido vai para "Faturado". Uma ação só, com
      // o destino decidido por registro — separar em duas obrigaria a pessoa a
      // selecionar duas vezes.
      destino: (r) => (ehPedido(r) ? 'pedido-faturado' : 'orcamento-aprovado'),
      confirma: 'Aprovar os selecionados? Pedidos serão faturados: o estoque baixa e as contas a receber são geradas.',
      elegivel: (r) => {
        const destino = ehPedido(r) ? 'pedido-faturado' : 'orcamento-aprovado';
        if (S.normalizar(r.status) === destino) return 'Já está nesse estado.';
        if (!S.podeTransicionar(r.status, destino)) return S.motivoDaRecusa(r.status, destino);
        return true;
      }
    },
    {
      id: 'aprovar_sem_faturamento', icone: 'check', grupo: 'Fluxo de venda', label: 'Aprovar Sem Faturamento',
      // Saída de mercadoria que NÃO é venda: transferência, remessa,
      // bonificação, comodato. Baixa estoque e não cria nada a receber.
      destino: () => 'pedido-aprovado-sem-faturamento',
      confirma: 'Aprovar sem faturamento? O estoque será baixado e NENHUMA conta a receber será gerada.',
      elegivel: (r) => {
        if (!ehPedido(r)) return 'Só pedido baixa estoque — aprove o orçamento primeiro.';
        if (!S.podeTransicionar(r.status, 'pedido-aprovado-sem-faturamento')) {
          return S.motivoDaRecusa(r.status, 'pedido-aprovado-sem-faturamento');
        }
        return true;
      }
    },
    {
      id: 'cancelar', icone: 'cancel', grupo: 'Fluxo de venda', label: 'Cancelar', tone: 'danger',
      destino: (r) => (ehPedido(r) ? 'pedido-cancelado' : 'orcamento-reprovado'),
      confirma: 'Cancelar os selecionados? Isso não volta atrás — um cancelado não é reaberto, cria-se outro documento.',
      elegivel: (r) => {
        const destino = ehPedido(r) ? 'pedido-cancelado' : 'orcamento-reprovado';
        if (S.ehCancelado(r.status)) return 'Já está cancelado.';
        // Pedido faturado tem NF-e por trás: cancelar o pedido sem cancelar a
        // nota deixaria documento fiscal válido apontando para pedido morto.
        if (S.geraFinanceiro(r.status)) return 'Pedido faturado: cancele a NF-e primeiro, no módulo Fiscal.';
        if (!S.podeTransicionar(r.status, destino)) return S.motivoDaRecusa(r.status, destino);
        return true;
      }
    },
    { id: 'faturamento_parcial', icone: 'split', grupo: 'Fluxo de venda', label: 'Faturamento Parcial', elegivel: EM_BREVE('Faturamento parcial') },
    { id: 'devolver', icone: 'undo', grupo: 'Fluxo de venda', label: 'Devolver Produtos', tone: 'danger', elegivel: EM_BREVE('Devolução de produtos') },
    { id: 'boletos', icone: 'money', grupo: 'Fluxo de venda', label: 'Enviar Boleto(s) ao Cliente', elegivel: EM_BREVE('Emissão de boleto') },

    // --- Registro -------------------------------------------------------------
    {
      id: 'duplicar', icone: 'copy', grupo: 'Registro', label: 'Duplicar',
      // A cópia nasce como rascunho do próprio tipo: duplicar um pedido
      // faturado e a cópia já nascer faturada baixaria estoque de novo.
      elegivel: () => true
    },
    {
      id: 'excluir', icone: 'trash', grupo: 'Registro', label: 'Excluir', tone: 'danger',
      confirma: 'Excluir os selecionados? Os anexos vão junto e não há como recuperar.',
      elegivel: (r) => {
        // Faturado tem estoque baixado e financeiro gerado; sumir com o
        // registro deixaria os dois sem origem.
        if (S.geraFinanceiro(r.status)) return 'Pedido faturado não é excluído — cancele primeiro.';
        if (r.nfeId) return 'Tem NF-e emitida: documento fiscal não se apaga.';
        return true;
      }
    },
    { id: 'editar', icone: 'edit', grupo: 'Registro', label: 'Editar', elegivel: EM_BREVE('Edição em lote') },
    { id: 'observacoes', icone: 'comment', grupo: 'Registro', label: 'Observações', elegivel: EM_BREVE('Observação em lote') },

    // --- Fiscal ---------------------------------------------------------------
    {
      // Emissão em lote não entra enquanto a emissão de UMA nota depender de
      // escolha de estabelecimento, operação fiscal e conferência de item a
      // item. Nota fiscal errada não se apaga: cancela-se, e cancelamento tem
      // prazo de 24 h.
      id: 'nfe', icone: 'file', grupo: 'Fiscal', label: 'NF-e',
      elegivel: () => 'Emissão em lote não existe: cada nota exige escolher estabelecimento e operação fiscal. Emita pelo pedido.'
    },
    { id: 'nfce', icone: 'barcode', grupo: 'Fiscal', label: 'NFC-e / CF-e', elegivel: EM_BREVE('NFC-e') },
    { id: 'nfse', icone: 'tool', grupo: 'Fiscal', label: 'NFS-e', elegivel: EM_BREVE('NFS-e') },
    { id: 'cte', icone: 'truck', grupo: 'Fiscal', label: 'CT-e', elegivel: EM_BREVE('CT-e') },

    // --- Documentos -----------------------------------------------------------
    { id: 'imprimir', icone: 'printer', grupo: 'Documentos', label: 'Imprimir', elegivel: IMPRESSAO_EM_BREVE },
    { id: 'impressao_direta', icone: 'printer', grupo: 'Documentos', label: 'Impressão Direta', elegivel: IMPRESSAO_EM_BREVE },
    { id: 'baixar', icone: 'download', grupo: 'Documentos', label: 'Baixar', elegivel: IMPRESSAO_EM_BREVE },
    { id: 'email', icone: 'mail', grupo: 'Documentos', label: 'Enviar por E-mail', elegivel: EM_BREVE('Envio por e-mail') },
    { id: 'etiqueta', icone: 'tag', grupo: 'Documentos', label: 'Imprimir Etiqueta de Expedição', elegivel: EM_BREVE('Etiqueta de expedição') },

    // --- Expedição e Produção -------------------------------------------------
    { id: 'ordem_expedicao', icone: 'truck', grupo: 'Expedição', label: 'Gerar Ordem de Expedição', elegivel: EM_BREVE('Ordem de expedição') },
    { id: 'ver_expedicao', icone: 'list', grupo: 'Expedição', label: 'Ver Ordens de Expedição', elegivel: EM_BREVE('Ordem de expedição') },
    { id: 'op_individual', icone: 'factory', grupo: 'Produção', label: 'Gerar Ordens de Produção Individual', elegivel: EM_BREVE('Ordem de produção a partir do pedido') },
    { id: 'op_por_venda', icone: 'factory', grupo: 'Produção', label: 'Gerar Ordens de Produção Agrupado por Venda', elegivel: EM_BREVE('Ordem de produção a partir do pedido') },
    { id: 'op_por_produto', icone: 'factory', grupo: 'Produção', label: 'Gerar Ordens de Produção Agrupado por Produto', elegivel: EM_BREVE('Ordem de produção a partir do pedido') }
  ];

  const PORID = new Map(CATALOGO.map((a) => [a.id, a]));

  // Uma ação está disponível quando existe e ao menos um selecionado é
  // elegível. Habilitar com zero elegíveis levaria a um "0 processados, 15
  // ignorados" — resposta correta e inútil.
  function avaliar(acaoId, registros) {
    const acao = PORID.get(acaoId);
    if (!acao) return { acao: null, elegiveis: [], ignorados: [] };
    const elegiveis = [];
    const ignorados = [];
    (registros || []).forEach((registro) => {
      const veredito = acao.elegivel(registro);
      if (veredito === true) elegiveis.push(registro);
      else ignorados.push({ registro, motivo: String(veredito || 'Não elegível.') });
    });
    return { acao, elegiveis, ignorados };
  }

  // A frase do resumo. Sempre no plural correto e sempre dizendo o total —
  // "12 processados" sozinho não diz se sobrou alguém.
  function resumo(processados, ignorados) {
    const p = `${processados} ${processados === 1 ? 'processado' : 'processados'}`;
    if (!ignorados) return p + '.';
    return `${p}, ${ignorados} ${ignorados === 1 ? 'ignorado' : 'ignorados'}.`;
  }

  const api = { CATALOGO, PORID, avaliar, resumo };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisSalesBulkActions = api;
})(typeof window !== 'undefined' ? window : null);
