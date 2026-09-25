/**
 * CSV DOS RELATÓRIOS FINANCEIRO E DE ESTOQUE (fase DB).
 *
 * POR QUE ESTES DOIS ESTAVAM DE FORA
 * ----------------------------------
 * A barra que tem o botão "Excel (CSV)" é a barra de filtros do relatório de
 * VENDAS, e só Vendas e Por Vendedor a chamam. Financeiro e Estoque nunca
 * tiveram como exportar nada — e o Financeiro não tinha nem tabela: os números
 * do fluxo existiam apenas como desenho do gráfico, então quem precisava do
 * valor de um mês tinha de medir a altura da linha com o olho.
 *
 * PURO, como lib/relatorios-vendas.js: recebe as linhas já calculadas e devolve
 * texto. Não fala com banco, não sabe o que é requisição, e por isso o teste
 * prova o arquivo inteiro com quatro objetos em vez de um banco de pé.
 *
 * O FORMATO NÃO MORA AQUI. Escape, vírgula decimal e a neutralização de fórmula
 * (célula que começa com `=`, `+`, `-` ou `@` é programa para o Excel) estão em
 * lib/csv.js, e é de lá que estas colunas saem. Escrever `join(';')` à mão aqui
 * seria abrir de novo o buraco que a fase DA fechou.
 *
 * A EXPORTAÇÃO DO ESTOQUE NÃO É O QUE ESTÁ NA TELA, e isso é deliberado: a tela
 * mostra os 15 que mais prendem dinheiro, porque é a pergunta que ela responde;
 * o arquivo leva a lista INTEIRA, porque ninguém abre uma planilha para reler
 * quinze linhas que já estavam na tela. Quem chama é que decide o recorte — e a
 * tela avisa que o arquivo vem completo, senão a diferença pareceria defeito.
 */
const csv = require('./csv');

const texto = (v) => (v === undefined || v === null ? '' : String(v));

/**
 * O FLUXO DO PERÍODO — a tabela que o gráfico desenha.
 *
 * `serie` é o mesmo array que alimenta o gráfico (`buildFinanceChartSeries`):
 * cada item tem o rótulo do período e os totais. Sai daqui com o SALDO
 * calculado, e não lido: guardar um terceiro número que deveria ser a diferença
 * dos outros dois é como ele passa a discordar deles.
 */
function financeiro(serie) {
  const linhas = (serie || []).map((ponto) => {
    const receitas = Number(ponto.receitas ?? 0);
    const despesas = Number(ponto.despesas ?? 0);
    return [
      csv.celula(texto(ponto.label)),
      // AS DATAS DO BALDE, que a tela não mostra. "set/26" é legível para quem
      // está olhando o gráfico e ambíguo numa planilha que vai circular: o
      // recorte "Semanal" gera rótulos que não dizem de quando a quinta semana
      // do mês vai até quando.
      csv.celula(texto(ponto.from)),
      csv.celula(texto(ponto.to)),
      csv.numero(receitas, 2),
      csv.numero(despesas, 2),
      // CALCULADO das duas colunas ao lado, e não lido de `ponto.saldo` — que
      // existe e vale o mesmo. A diferença aparece no dia em que a série passar
      // a trazer um saldo com outra regra (acumulado, por exemplo): o arquivo
      // teria uma coluna que não fecha com as duas vizinhas, e quem abre a
      // planilha confia na subtração que está vendo.
      csv.numero(Math.round((receitas - despesas) * 100) / 100, 2)
    ];
  });
  return csv.documento(['Período', 'De', 'Até', 'Receitas', 'Despesas', 'Saldo'], linhas);
}

/**
 * O ESTOQUE, produto a produto.
 *
 * "Valor parado" é custo × quantidade, a mesma conta da tela. Vai como coluna
 * própria apesar de ser derivada porque é a razão de o relatório existir, e
 * obrigar quem abre a planilha a escrever a multiplicação seria entregar o
 * trabalho pela metade.
 */
function estoque(produtos) {
  const linhas = (produtos || []).map((p) => [
    csv.celula(texto(p.name)),
    csv.celula(texto(p.sku)),
    csv.numero(Number(p.quantidade || 0)),
    csv.numero(Number(p.custo || 0), 2),
    csv.numero(Number(p.valor || 0), 2)
  ]);
  return csv.documento(['Produto', 'SKU', 'Quantidade', 'Custo', 'Valor parado'], linhas);
}

module.exports = { financeiro, estoque };
