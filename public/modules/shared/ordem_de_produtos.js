// A ORDEM DA LISTA DE PRODUTOS — fonte única, para os dois lados.
//
// POR QUE ISTO SAIU DA TELA
// -------------------------
// A lista de Estoque mostra 100 produtos por página e ordenava no navegador,
// depois de baixar todos. Medido nesta base:
//
//     /api/stock/products ..... 3.713 KB cru  ·  257 KB no fio  ·  5.475 itens
//     uma página de 100 ...........  68 KB cru  ·    6 KB no fio
//
// Para o servidor mandar só a página, ele precisa ordenar — e a ordem é de quem
// desenha a tela, com quatro decisões que não se adivinham (vazio sempre no fim,
// urgência da Situação, colação pt-BR, desempate estável). Escrita nos dois
// lados, ela concordaria até o dia em que alguém corrigisse um lado só, e o
// sintoma seria um produto que "some" ao virar a página.
//
// Então mora aqui, e os dois a chamam: a tela por `window.MavisOrdemDeProdutos`
// e o server.js por `require`.
//
// UMA RESSALVA HONESTA SOBRE A COLAÇÃO
// ------------------------------------
// O comparador de texto usa `Intl.Collator('pt-BR')`, e agora ele roda no
// SERVIDOR. Node e navegador trazem ICU próprio; para nome de produto em
// português a ordem é a mesma nos dois em tudo que eu medi, mas eu não tenho
// como provar daqui o ICU de cada navegador que abre o sistema. Se algum dia uma
// lista parecer fora de ordem por um acento, é aqui que se olha.
//
// Era uma troca que este projeto já havia feito: a lista de Vendas ordena no
// servidor desde o começo, pelo mesmo motivo.
(function (raiz) {
  // As colunas que a tela deixa ordenar, e de que TIPO cada uma é. O tipo é o
  // que decide a comparação — número não se compara como texto ("10" < "9"), e
  // a Situação não se compara nem como um nem como outro (ver URGENCIA).
  const COLUNAS = {
    name: { rotulo: 'Produto', tipo: 'texto' },
    sku: { rotulo: 'SKU', tipo: 'texto' },
    categoryName: { rotulo: 'Categoria', tipo: 'texto' },
    unit: { rotulo: 'Un.', tipo: 'texto' },
    costPrice: { rotulo: 'Custo', tipo: 'numero' },
    salePrice: { rotulo: 'Venda', tipo: 'numero' },
    margin: { rotulo: 'Margem', tipo: 'numero' },
    stockQuantity: { rotulo: 'Saldo', tipo: 'numero' },
    situation: { rotulo: 'Situacao', tipo: 'alerta' },
    status: { rotulo: 'Status', tipo: 'texto' }
  };

  // A Situacao em ordem alfabetica ('abaixo-minimo', 'acima-maximo', 'normal',
  // 'zerado') nao responde a pergunta que leva alguem a clicar nela, que e'
  // "o que precisa de mim primeiro?". Entao ela ordena por urgencia: crescente
  // traz o que esta faltando, decrescente traz o que esta sobrando.
  const URGENCIA = { zerado: 0, 'abaixo-minimo': 1, 'acima-maximo': 2, normal: 3 };

  // `sensitivity: 'base'` para "Ácido" e "acido" caírem juntos, e `numeric`
  // para "Cabo 10" vir depois de "Cabo 9" em vez de antes.
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

  /** O campo pedido, ou 'name' quando o pedido não é ordenável. */
  function campoValido(campo) {
    return COLUNAS[campo] ? campo : 'name';
  }

  const vazio = (v) => v === null || v === undefined || String(v).trim() === '';

  /**
   * Compara dois produtos por um campo e uma direção.
   *
   * O VAZIO VAI SEMPRE PARA O FIM, nos dois sentidos — e é por isso que a
   * direção é aplicada por último, e não invertendo o comparador inteiro.
   * Invertida junto, "maior primeiro" encheria o topo de traços, e quem ordena
   * por Categoria quer ver as categorias, não quem não tem. Aqui isso pesa: a
   * importação do Viper entrou sem categoria nenhuma, e sem esta regra um
   * clique em Categoria mostraria 100 linhas de "-".
   */
  function comparar(a, b, campoPedido, direcao) {
    const campo = campoValido(campoPedido);
    const tipo = COLUNAS[campo].tipo;
    const va = a[campo];
    const vb = b[campo];
    const vazioA = vazio(va);
    const vazioB = vazio(vb);
    // Só um deles vazio: ele vai para o fim, e essas duas saídas NÃO passam
    // pela inversão da direção lá embaixo — é isso que faz o vazio ficar no fim
    // tanto em crescente como em decrescente.
    if (vazioA && !vazioB) return 1;
    if (vazioB && !vazioA) return -1;

    let resultado;
    if (vazioA && vazioB) {
      // OS DOIS VAZIOS: EMPATE NO CAMPO, E NÃO "TANTO FAZ".
      //
      // Aqui havia `return 0`, herdado da versão que rodava no navegador, e ele
      // pulava o desempate de baixo. `Array.prototype.sort` é estável, então a
      // ordem passava a ser a ordem de ENTRADA da lista.
      //
      // No navegador isso não aparecia: a entrada era sempre a mesma lista que
      // o servidor mandava. Com a página vindo do servidor, aparece — e foi
      // medido: ordenando por Categoria, onde os 5.475 produtos desta base
      // estão TODOS sem categoria, a página 1 do servidor não batia com a
      // página 1 da referência. Duas ordens indiferentes, duas listas.
      //
      // O estrago real não é a ordem ser "outra": é que ela pode MUDAR entre
      // duas requisições, e aí um produto aparece em duas páginas e outro em
      // nenhuma, sem nada quebrar para avisar. Mesma história do desempate
      // final da lista de Vendas.
      resultado = 0;
    } else if (tipo === 'numero') {
      resultado = Number(va) - Number(vb);
    } else if (tipo === 'alerta') {
      const ua = URGENCIA[va] === undefined ? 99 : URGENCIA[va];
      const ub = URGENCIA[vb] === undefined ? 99 : URGENCIA[vb];
      resultado = ua - ub;
    } else {
      resultado = collator.compare(String(va), String(vb));
    }
    // Empate desempatado pelo nome, e depois pelo id. Sem isso, dois produtos
    // de mesmo custo trocariam de lugar entre um render e outro e a lista
    // pareceria se mexer sozinha — e, com a página vindo do servidor, um deles
    // poderia aparecer em duas páginas e outro em nenhuma.
    if (resultado === 0) resultado = collator.compare(String(a.name || ''), String(b.name || ''));
    if (resultado === 0) resultado = String(a.id).localeCompare(String(b.id));
    return direcao === 'asc' ? resultado : -resultado;
  }

  /** A lista ordenada, sem mexer na recebida. */
  function ordenar(lista, campo, direcao) {
    return (lista || []).slice().sort((a, b) => comparar(a, b, campo, direcao));
  }

  const api = { COLUNAS, URGENCIA, campoValido, comparar, ordenar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisOrdemDeProdutos = api;
})(typeof window !== 'undefined' ? window : globalThis);
