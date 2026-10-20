// O CUSTO DO PRODUTO SÓ PARA ADMINISTRADOR (14/10/2026).
//
// Pedido do usuário, urgente: "nenhum usuário comum pode ter acesso ao preço
// de custo de um produto conforme pesquisam". O bloqueio é no SERVIDOR: para
// quem não é administrador, o custo nem sai da API — esconder só na tela
// deixaria o número no navegador, a um F12 de distância.
//
// `semCusto` passa em TODA resposta JSON desse usuário (ver sendJson): tira as
// chaves de custo em qualquer profundidade, as colunas de custo das listas de
// colunas ({ campo: 'custo' }) e os nomes de custo das listas de totais.
// `relatorioSemCusto` faz o mesmo num resultado do motor de relatórios antes
// do CSV — e, quando o relatório tinha coluna de custo, tira também o "valor",
// que ali é saldo × custo (custo = valor ÷ saldo).
'use strict';

const CAMPOS_DE_CUSTO = new Set([
  'costPrice', 'cost_price',
  'custo', 'custoMedio', 'custoUnitario', 'custoComponente', 'custoDasSaidas', 'custoTotal',
  // Os que dão o custo de volta por conta: margem e lucro (com o preço de
  // venda ou o faturamento), valor do estoque a custo (÷ saldo) e o último
  // preço de compra do produto, que é o próprio custo.
  'medios', 'margem', 'margin', 'margemPercentual', 'lucro',
  'valorParado', 'valorEmEstoque', 'stockValue', 'ultimoPreco',
  // O custo de cada movimentação de estoque (e o da linha da ordem de compra).
  'unitCost', 'totalCost'
]);

const ehColunaDeCusto = (item) => item && typeof item === 'object' && !Array.isArray(item)
  && typeof item.campo === 'string' && CAMPOS_DE_CUSTO.has(item.campo);

function semCusto(valor) {
  if (Array.isArray(valor)) {
    return valor
      .filter((item) => !ehColunaDeCusto(item) && !(typeof item === 'string' && CAMPOS_DE_CUSTO.has(item)))
      .map(semCusto);
  }
  if (valor && typeof valor === 'object' && !(valor instanceof Date) && !Buffer.isBuffer(valor)) {
    const saida = {};
    for (const [chave, v] of Object.entries(valor)) {
      if (CAMPOS_DE_CUSTO.has(chave)) continue;
      saida[chave] = semCusto(v);
    }
    return saida;
  }
  return valor;
}

/** Um resultado do motor de relatórios ({ colunas, linhas, totais, ... }) sem custo. */
function relatorioSemCusto(resultado) {
  if (!resultado || !Array.isArray(resultado.colunas)) return semCusto(resultado);
  const tinhaCusto = resultado.colunas.some(ehColunaDeCusto);
  const fora = new Set(CAMPOS_DE_CUSTO);
  if (tinhaCusto) fora.add('valor');
  const tirar = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const saida = {};
    for (const [k, v] of Object.entries(obj)) if (!fora.has(k)) saida[k] = v;
    return saida;
  };
  return semCusto({
    ...resultado,
    colunas: resultado.colunas.filter((c) => !(c && fora.has(c.campo))),
    linhas: Array.isArray(resultado.linhas) ? resultado.linhas.map(tirar) : resultado.linhas,
    totais: Array.isArray(resultado.totais) ? resultado.totais.filter((t) => !fora.has(t)) : tirar(resultado.totais)
  });
}

// O VALOR PAGO NAS COMPRAS (14/10/2026, mesmo pedido).
//
// Em Compras o preço pago É o custo: o unitário da ordem e o da nota do
// fornecedor dão o custo do produto direto, e os totais (itens, nota,
// duplicatas, impostos) dão por divisão. `semValorPago` passa nas respostas de
// /api/purchases* desse usuário e tira essas chaves QUANDO O VALOR É NÚMERO:
// assim `produtos` (a lista do seletor) e `icms` (o grupo do item, com CST)
// ficam, e só o número sai. `total` só sai de dentro dos registros — no topo
// da resposta ele é contagem de linhas.
const CAMPOS_DE_VALOR_PAGO = new Set([
  'itemsTotal', 'freight', 'otherExpenses', 'discountAmount', 'totalAmount',
  'valorUnitario', 'valorTotal', 'valorProdutos', 'valor',
  'base', 'baseSt', 'valorSt', 'valorFcpSt', 'fcp',
  'desconto', 'frete', 'seguro', 'outros',
  'produtos', 'nota', 'baseIcms', 'icms', 'baseIcmsSt', 'icmsSt', 'ipi', 'pis', 'cofins'
]);

function semValorPago(valor, profundidade = 0) {
  if (Array.isArray(valor)) return valor.map((item) => semValorPago(item, profundidade + 1));
  if (valor && typeof valor === 'object' && !(valor instanceof Date) && !Buffer.isBuffer(valor)) {
    const saida = {};
    for (const [chave, v] of Object.entries(valor)) {
      const numero = typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
      if (numero && (CAMPOS_DE_VALOR_PAGO.has(chave) || (chave === 'total' && profundidade > 0))) continue;
      saida[chave] = semValorPago(v, profundidade + 1);
    }
    return saida;
  }
  return valor;
}

// OS VALORES DAS PARCELAS PARA QUEM ACESSA O FINANCEIRO (20/10/2026, decisão
// do usuário: "os valores das parcelas não estão aparecendo mais").
//
// Na conferência da entrada (rota /analisar), quem tem o módulo Financeiro vê
// o valor de cada parcela e o total da nota que elas somam: são os mesmos
// números que ele vê em Contas a Pagar logo depois de lançar. Volta só isso —
// duplicatas, total da nota e os títulos já lançados no Viper —, tirado da
// resposta ANTES de semValorPago; o custo e o unitário dos itens seguem fora.
function comValoresDasParcelas(original, filtrado) {
  if (!original || !filtrado || !original.nota || !filtrado.nota) return filtrado;
  const valorDe = (lista, i) => (Array.isArray(lista) && lista[i] ? lista[i].valor : undefined);
  const nota = { ...filtrado.nota };
  if (Array.isArray(nota.duplicatas)) {
    nota.duplicatas = nota.duplicatas.map((d, i) => ({ ...d, valor: valorDe(original.nota.duplicatas, i) }));
  }
  if (nota.totais && original.nota.totais) nota.totais = { ...nota.totais, nota: original.nota.totais.nota };
  const saida = { ...filtrado, nota };
  if (Array.isArray(filtrado.titulosDoViper)) {
    saida.titulosDoViper = filtrado.titulosDoViper.map((t, i) => ({ ...t, valor: valorDe(original.titulosDoViper, i) }));
  }
  return saida;
}

module.exports = { CAMPOS_DE_CUSTO, CAMPOS_DE_VALOR_PAGO, semCusto, relatorioSemCusto, semValorPago, comValoresDasParcelas };
