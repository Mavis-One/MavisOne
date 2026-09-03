// Catálogo de Status de Compra — FONTE ÚNICA.
//
// Mora em public/ porque o navegador carrega por <script>, mas o server.js
// também faz require() dele. Mesma razão do sales_status.js: se a tela
// entendesse "recebida" de um jeito e o servidor de outro, o usuário veria um
// status e o sistema daria entrada no estoque (ou geraria contas a pagar) por
// outro.
//
// DESENHO — IGUAL AO DE VENDAS, DE PROPÓSITO
// -------------------------------------------
// Cotação e ordem de compra são o MESMO documento em pontos diferentes da vida.
// Não há tela de "Nova Cotação" separada da de "Nova Ordem": há uma tela, e o
// campo Status decide qual dos dois o documento é. Vendas chegou nesse desenho
// depois de ter as duas telas e descobrir que eram a mesma — ver o cabeçalho de
// sales_status.js.
//
// Aprovar uma cotação é mudar o status dela. Não se copia nada, então a ordem
// nunca perde de que cotação nasceu.
//
// CADA STATUS DECLARA SEUS DOIS EFEITOS, e é isso que o servidor obedece:
//   entraEstoque    — dá entrada dos itens no depósito da ordem
//   geraFinanceiro  — cria as contas a PAGAR
//
// Os dois são independentes, e o caso que os separa é real: mercadoria em
// bonificação, amostra, brinde ou troca em garantia ENTRA no estoque e não gera
// conta nenhuma. Era impossível representar isso quando "comprar" acendia os
// dois efeitos juntos.
//
// A ENTRADA EM DOBRO É O RISCO DESTE MÓDULO, e não se resolve aqui. Uma ordem
// recebida dá entrada no estoque; uma Nota de Entrada (XML do fornecedor)
// também. Se a mesma mercadoria passar pelos dois caminhos, o saldo dobra sem
// erro nenhum. Quem impede é purchase_orders.entrada_nfe_id: ordem com nota
// ligada não movimenta por conta própria, porque a nota já movimentou. O
// servidor confere isso antes de aplicar o efeito.
(function (raiz) {
  const CATALOGO = [
    // --- Os dois selecionáveis à mão ----------------------------------------
    {
      // O documento nasce aqui: ainda é pergunta de preço, não compromisso.
      value: 'cotacao', label: 'Cotação', tipo: 'quote', selecionavel: true,
      tom: 'info', entraEstoque: false, geraFinanceiro: false
    },
    {
      // Virou compromisso com o fornecedor. Ainda não chegou nada.
      value: 'ordem', label: 'Ordem de Compra', tipo: 'order', selecionavel: true,
      tom: 'warning', entraEstoque: false, geraFinanceiro: false
    },

    // --- Cotação: atribuídos pelo sistema -----------------------------------
    {
      value: 'cotacao-enviada', label: 'Cotação Enviada', tipo: 'quote',
      tom: 'info', entraEstoque: false, geraFinanceiro: false
    },
    {
      // Fim de linha da cotação que não virou compra. Fica no histórico: saber
      // que se cotou e o preço não serviu vale para a próxima cotação.
      value: 'cotacao-recusada', label: 'Cotação Recusada', tipo: 'quote',
      tom: 'danger', entraEstoque: false, geraFinanceiro: false, cancelado: true
    },

    // --- Ordem: atribuídos pelo sistema -------------------------------------
    {
      value: 'ordem-enviada', label: 'Ordem Enviada', tipo: 'order',
      tom: 'info', entraEstoque: false, geraFinanceiro: false
    },
    {
      // Chegou parte. NÃO movimenta estoque por si: o que chegou entra pela
      // Nota de Entrada ou pelo recebimento explícito, item a item. Marcar o
      // documento inteiro como recebido aqui daria entrada no que ainda está
      // com o fornecedor.
      value: 'ordem-recebida-parcial', label: 'Recebida Parcialmente', tipo: 'order',
      tom: 'warning', entraEstoque: false, geraFinanceiro: false
    },
    {
      // O caminho normal: a mercadoria chegou e nasceu conta a pagar.
      value: 'ordem-recebida', label: 'Ordem Recebida', tipo: 'order',
      tom: 'success', entraEstoque: true, geraFinanceiro: true
    },
    {
      // Entra mercadoria, NÃO nasce financeiro: bonificação, amostra, brinde,
      // troca em garantia, devolução de industrialização.
      value: 'ordem-recebida-sem-financeiro', label: 'Recebida Sem Financeiro', tipo: 'order',
      tom: 'success', entraEstoque: true, geraFinanceiro: false
    },
    {
      value: 'ordem-cancelada', label: 'Ordem Cancelada', tipo: 'order',
      tom: 'danger', entraEstoque: false, geraFinanceiro: false, cancelado: true
    }
  ];

  const porValor = new Map(CATALOGO.map((s) => [s.value, s]));

  // PARA ONDE CADA DOCUMENTO PODE CAMINHAR.
  //
  // Mora aqui, e não na tela, porque a tela não deve saber de cor a vida de um
  // documento: acrescentar um status novo tem de acender os botões sozinho.
  //
  // ISTO NÃO É VALIDAÇÃO DE SEGURANÇA, e a distinção importa. O servidor não
  // recusa um caminho fora desta lista de propósito — quem protege os dados lá
  // são os EFEITOS (stockApplied/financeApplied), que valem por qualquer
  // caminho. Uma correção legítima ("recebi, cancelei por engano, quero
  // receber de novo") não pode esbarrar num mapa de setas.
  const TRANSICOES = {
    'cotacao': ['cotacao-enviada', 'ordem', 'cotacao-recusada'],
    'cotacao-enviada': ['ordem', 'cotacao-recusada'],
    'cotacao-recusada': ['cotacao'],
    'ordem': ['ordem-enviada', 'ordem-recebida', 'ordem-recebida-sem-financeiro', 'ordem-cancelada'],
    'ordem-enviada': ['ordem-recebida-parcial', 'ordem-recebida', 'ordem-recebida-sem-financeiro', 'ordem-cancelada'],
    'ordem-recebida-parcial': ['ordem-recebida', 'ordem-cancelada'],
    'ordem-recebida': ['ordem-cancelada'],
    'ordem-recebida-sem-financeiro': ['ordem-cancelada'],
    'ordem-cancelada': ['ordem']
  };

  const proximos = (valor) => (TRANSICOES[String(valor || '')] || []).map((v) => obter(v));

  // Status desconhecido devolve um registro inerte em vez de undefined: um
  // documento gravado por uma versão futura não pode derrubar a lista de quem
  // ainda não atualizou, nem — pior — cair num `if (!status.entraEstoque)` que
  // explodiria antes de decidir coisa nenhuma.
  function obter(valor) {
    return porValor.get(String(valor || '')) || {
      value: String(valor || ''), label: String(valor || 'Desconhecido'),
      tipo: 'order', tom: 'muted', entraEstoque: false, geraFinanceiro: false
    };
  }

  const rotulo = (valor) => obter(valor).label;
  const tipoDoStatus = (valor) => obter(valor).tipo;
  const ehCotacao = (valor) => tipoDoStatus(valor) === 'quote';
  const ehCancelado = (valor) => Boolean(obter(valor).cancelado);
  const entraEstoque = (valor) => Boolean(obter(valor).entraEstoque);
  const geraFinanceiro = (valor) => Boolean(obter(valor).geraFinanceiro);
  const selecionaveis = () => CATALOGO.filter((s) => s.selecionavel);
  const doTipo = (tipo) => CATALOGO.filter((s) => s.tipo === tipo);

  const api = {
    CATALOGO, TRANSICOES, obter, rotulo, tipoDoStatus, ehCotacao, ehCancelado,
    entraEstoque, geraFinanceiro, selecionaveis, doTipo, proximos
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisPurchaseStatus = api;
})(typeof window !== 'undefined' ? window : globalThis);
