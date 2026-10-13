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

/**
 * UM INVENTÁRIO GRAVADO (fase EG), item por item, como saiu na geração.
 *
 * O custo unitário vai com 6 casas, as do razão: arredondar para 2 faria a
 * coluna Valor deixar de ser quantidade × custo na planilha.
 */
const ORIGEM_DO_CUSTO = { medio: 'Custo médio', cadastro: 'Custo do cadastro', sem_custo: 'Sem custo' };

function inventario(itens) {
  const linhas = (itens || []).map((i) => [
    csv.celula(texto(i.sku)),
    csv.celula(texto(i.productName)),
    csv.celula(texto(i.ncm)),
    csv.celula(texto(i.unidade)),
    csv.numero(Number(i.quantidade || 0)),
    csv.numero(Number(i.custoUnitario || 0), 6),
    csv.numero(Number(i.valor || 0), 2),
    csv.celula(ORIGEM_DO_CUSTO[i.origemCusto] || texto(i.origemCusto))
  ]);
  return csv.documento(
    ['SKU', 'Produto', 'NCM', 'Unidade', 'Quantidade', 'Custo unitário', 'Valor', 'Origem do custo'],
    linhas
  );
}

/**
 * A LISTA DE LANÇAMENTOS (fase EI), como a tela a serializa
 * (serializeFinanceEntry): uma linha por lançamento, todas as colunas que a
 * lista sabe mostrar — inclusive as que a pessoa escondeu na tela. A planilha
 * é para cruzar dados, e esconder coluna lá é um clique.
 *
 * A DESCRIÇÃO VAI INTEIRA. A tela mostra o resumo (descricao_lancamento.js,
 * `resumir`) porque a coluna não cabe; na planilha não há esse aperto, e o
 * texto gravado é o que vale como registro.
 *
 * "Em aberto" é o da serialização (`emAberto`): a conta da rota de baixa, a
 * mesma do "Saldo em aberto" do modal — zero para o pago e o cancelado.
 */
const SITUACAO = {
  pendente: 'Pendente', vencido: 'Vencido', parcial: 'Parcial',
  pago: 'Pago', recebido: 'Recebido', cancelado: 'Cancelado'
};
const TIPO = { receita: 'Receita', despesa: 'Despesa', transferencia: 'Transferência', outro: 'Outro' };

// O "-" que a tela usa para "não tem" vira célula vazia: na planilha ele
// passaria pela neutralização de fórmula e sairia como `'-`.
const semTraco = (v) => (texto(v).trim() === '-' ? '' : texto(v));

function lancamentos(lista) {
  const linhas = (lista || []).map((l) => {
    const previsto = Number(l.amountPrevisto || 0);
    const realizado = Number(l.amountRealizado || 0);
    // O da serialização (financeEntryEmAberto: a regra da baixa, com juros,
    // multa e desconto). Previsto − realizado só para quem chamar sem ele.
    const emAberto = l.emAberto != null
      ? Number(l.emAberto)
      : (['cancelado', 'pago', 'recebido'].includes(l.status) ? 0 : Math.max(0, Math.round((previsto - realizado) * 100) / 100));
    return [
      csv.celula(texto(l.codigo)),
      csv.celula(texto(l.date)),
      csv.celula(texto(l.dueDate)),
      csv.celula(semTraco(l.description)),
      csv.celula(TIPO[l.type] || texto(l.type)),
      csv.celula(semTraco(l.categoryName)),
      csv.celula(semTraco(l.costCenterName)),
      csv.celula(semTraco(l.bankAccountName)),
      csv.celula(semTraco(l.clienteFornecedor)),
      csv.numero(previsto, 2),
      csv.numero(realizado, 2),
      csv.numero(emAberto, 2),
      csv.celula(SITUACAO[l.status] || texto(l.status)),
      csv.celula(semTraco(l.document)),
      csv.celula(semTraco(l.note))
    ];
  });
  return csv.documento(
    ['Código', 'Data', 'Vencimento', 'Descrição', 'Tipo', 'Categoria', 'Centro de custo', 'Conta bancária',
      'Cliente/Fornecedor', 'Valor previsto', 'Valor realizado', 'Em aberto', 'Situação', 'Documento', 'Observação'],
    linhas
  );
}

module.exports = { financeiro, estoque, inventario, lancamentos };
