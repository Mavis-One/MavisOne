/**
 * KPIs do topo do hub.
 *
 * O QUE UM KPI PRECISA TER PARA SERVIR
 * ------------------------------------
 * Número sozinho não informa. "R$ 1,28 mi de faturamento" só vira decisão
 * quando se sabe se é mais ou menos do que no mês passado, e quanto disso já
 * está vencido. Por isso cada cartão carrega, além do valor:
 *
 *   variacao  — % contra o MESMO intervalo imediatamente anterior;
 *   detalhe   — a informação que muda o que se faz com o número;
 *   faixa     — proporção que merece alarme (vencido, a vencer).
 *
 * O QUE ESTE MÓDULO NÃO FAZ: inventar número que não existe.
 * O mockup previa "85% da meta" e uma variação para o estoque. Não há cadastro
 * de meta em lugar nenhum, e não há histórico de valor de estoque — o saldo é
 * uma foto do agora. Cartão sem esses campos é honesto; cartão com número
 * derivado de nada é pior do que cartão sem número, porque parece confiável.
 *
 * Puro de propósito: recebe listas prontas, não conhece banco nem HTTP.
 */

function num(v) {
  return Number(v || 0);
}

function soma(lista, pegar) {
  return (lista || []).reduce((total, item) => total + num(pegar(item)), 0);
}

/**
 * Variação percentual entre dois períodos.
 *
 * Devolve null — e não 0 — quando o período anterior foi zero: "cresceu 100%"
 * partindo do nada é uma frase sem conteúdo, e 0% mentiria dizendo que ficou
 * igual. Sem base de comparação, o cartão não mostra seta.
 */
function variacao(atual, anterior) {
  const a = num(anterior);
  if (a === 0) return null;
  return Math.round(((num(atual) - a) / a) * 1000) / 10;
}

/** Intervalo imediatamente anterior, do mesmo tamanho em dias. */
function periodoAnterior({ from, to }) {
  const inicio = new Date(`${from}T00:00:00`);
  const fim = new Date(`${to}T00:00:00`);
  const dias = Math.round((fim - inicio) / 86400000) + 1;
  const fimAnterior = new Date(inicio);
  fimAnterior.setDate(fimAnterior.getDate() - 1);
  const inicioAnterior = new Date(fimAnterior);
  inicioAnterior.setDate(inicioAnterior.getDate() - (dias - 1));
  return { from: inicioAnterior.toISOString().slice(0, 10), to: fimAnterior.toISOString().slice(0, 10) };
}

const dentro = (data, { from, to }) => Boolean(data) && data >= from && data <= to;

// Em aberto: nem pago, nem cancelado. Os dois vocabulários convivem no
// sistema ('pending' do banco, 'pendente' da tela).
function emAberto(entrada) {
  const s = String(entrada.status || '').toLowerCase();
  return s === 'pending' || s === 'pendente' || s === 'parcial';
}

const venc = (e) => e.dueDate || e.date;

/**
 * Faturamento do período, com comparação.
 * A sparkline vem da mesma série do gráfico de vendas — dois cálculos
 * diferentes fariam o cartão e o gráfico discordarem na mesma tela.
 */
function kpiFaturamento({ pedidos, intervalo, serie, statusQueFaturam }) {
  const anterior = periodoAnterior(intervalo);
  // O CARTÃO SE CHAMA FATURAMENTO E CONTAVA TODO PEDIDO (fase CO).
  //
  // Mesmo defeito que a linha do gráfico tinha: somava qualquer status —
  // cancelado, transferência, remessa. Medido nos dados reais, março de 2026
  // saía R$ 2,49 mi no cartão contra R$ 2,22 mi de faturamento de verdade, e
  // julho saía R$ 4,39 mi contra R$ 1,46 mi. O nome prometia receita.
  //
  // A lista de status vem de fora (do catálogo, em salesStatus): este módulo é
  // puro de propósito e não conhece o vocabulário de venda. Sem a lista, o
  // comportamento é o antigo — nenhum painel fica sem número por causa disto.
  const faturou = Array.isArray(statusQueFaturam) && statusQueFaturam.length
    ? (p) => statusQueFaturam.includes(String(p.status || '').toLowerCase())
    : () => true;
  const doIntervalo = (pedidos || []).filter((p) => dentro(p.date, intervalo) && faturou(p));
  const valor = soma(doIntervalo, (p) => p.totalAmount ?? p.amount);
  const base = soma((pedidos || []).filter((p) => dentro(p.date, anterior) && faturou(p)), (p) => p.totalAmount ?? p.amount);
  const quantidade = doIntervalo.length;
  return {
    id: 'faturamento',
    modulo: 'sales',
    titulo: 'Faturamento',
    valor,
    formato: 'moeda',
    variacao: variacao(valor, base),
    detalhe: `${quantidade} pedido${quantidade === 1 ? '' : 's'} faturado${quantidade === 1 ? '' : 's'}`,
    // A faísca acompanha o VALOR do cartão: era `b.pedidos`, que agora é outra
    // série. Cartão e gráfico discordando na mesma tela é o pior dos dois.
    serie: (serie || []).map((b) => num(b.faturado))
  };
}

/**
 * A receber. A faixa mostra quanto do total já VENCEU — é o número que decide
 * se alguém precisa cobrar hoje, e o motivo de este cartão existir.
 */
function kpiAReceber({ entradas, hoje }) {
  const abertas = (entradas || []).filter((e) => e.tipo === 'receita' && emAberto(e));
  const total = soma(abertas, (e) => e.amount);
  const vencidas = abertas.filter((e) => venc(e) && venc(e) < hoje);
  const totalVencido = soma(vencidas, (e) => e.amount);
  return {
    id: 'a-receber',
    modulo: 'finance',
    titulo: 'A receber',
    valor: total,
    formato: 'moeda',
    variacao: null,
    detalhe: `${abertas.length} título${abertas.length === 1 ? '' : 's'} em aberto`,
    faixa: total > 0
      ? { valor: totalVencido, percentual: Math.round((totalVencido / total) * 100), rotulo: 'vencido', tom: 'perigo' }
      : null
  };
}

/**
 * A pagar. A faixa mostra o que vence nos próximos 7 dias — aqui o alarme não
 * é o vencido (já perdido), é o que ainda dá para programar.
 */
function kpiAPagar({ entradas, hoje, dias = 7 }) {
  const abertas = (entradas || []).filter((e) => e.tipo === 'despesa' && emAberto(e));
  const total = soma(abertas, (e) => e.amount);
  const limite = new Date(`${hoje}T00:00:00`);
  limite.setDate(limite.getDate() + dias);
  const limiteISO = limite.toISOString().slice(0, 10);
  const proximas = abertas.filter((e) => venc(e) && venc(e) >= hoje && venc(e) <= limiteISO);
  const totalProximo = soma(proximas, (e) => e.amount);
  return {
    id: 'a-pagar',
    modulo: 'finance',
    titulo: 'A pagar',
    valor: total,
    formato: 'moeda',
    variacao: null,
    detalhe: `${abertas.length} título${abertas.length === 1 ? '' : 's'} em aberto`,
    faixa: total > 0
      ? { valor: totalProximo, percentual: Math.round((totalProximo / total) * 100), rotulo: `vencem em ${dias} dias`, tom: 'alerta' }
      : null
  };
}

/**
 * Estoque valorizado. SEM variação, de propósito: o saldo é uma foto do agora
 * e o sistema não guarda o valor de ontem. Uma seta aqui só poderia ser
 * inventada.
 */
function kpiEstoque({ produtos, depositos }) {
  const lista = produtos || [];
  const valor = soma(lista, (p) => num(p.stockQuantity) * num(p.costPrice));
  const unidades = soma(lista, (p) => p.stockQuantity);
  const qtdDepositos = (depositos || []).length;
  return {
    id: 'estoque',
    modulo: 'stock',
    titulo: 'Estoque',
    valor,
    formato: 'moeda',
    variacao: null,
    detalhe: `${unidades.toLocaleString('pt-BR')} un.${qtdDepositos ? ` · ${qtdDepositos} depósito${qtdDepositos === 1 ? '' : 's'}` : ''}`,
    // Quanto do estoque está furando o mínimo: é o que transforma "R$ 1,8 mi
    // parado" em "e uma parte já está faltando".
    // MESMO CRITÉRIO DO PAINEL DE PENDÊNCIAS (fase CO): 'zerado' só conta quando
    // alguém declarou um mínimo para aquele produto. Sem isso, a faixa dizia
    // "100% abaixo do mínimo" neste banco — os 5.475 produtos estão em zero
    // porque o razão de estoque nunca foi carregado, e nenhum tem mínimo
    // cadastrado. Ausência de dado não é falta de mercadoria.
    faixa: lista.length
      ? (() => {
        const abaixo = lista.filter((p) => (
          p.situation === 'abaixo-minimo' || (p.situation === 'zerado' && num(p.minStock) > 0)
        )).length;
        return abaixo ? { valor: abaixo, percentual: Math.round((abaixo / lista.length) * 100), rotulo: 'abaixo do mínimo', tom: 'alerta', contagem: true } : null;
      })()
      : null
  };
}

/**
 * Compras do período. Ocupa o lugar que o desenho reservava a "Importações",
 * módulo que não existe neste ERP — deixar o cartão com dado fictício seria
 * pior do que trocá-lo pelo que a empresa realmente movimenta.
 */
function kpiCompras({ compras, intervalo }) {
  const anterior = periodoAnterior(intervalo);
  const noPeriodo = (compras || []).filter((c) => dentro(c.date, intervalo));
  const valor = soma(noPeriodo, (c) => c.total ?? c.amount);
  const base = soma((compras || []).filter((c) => dentro(c.date, anterior)), (c) => c.total ?? c.amount);
  return {
    id: 'compras',
    modulo: 'purchases',
    titulo: 'Compras',
    valor,
    formato: 'moeda',
    variacao: variacao(valor, base),
    detalhe: `${noPeriodo.length} compra${noPeriodo.length === 1 ? '' : 's'} no período`
  };
}

/**
 * Monta os cartões visíveis.
 *
 * Permissão decide o que entra: mostrar faturamento para quem não pode abrir
 * Vendas é vazar número que a pessoa não deveria ver — e, pior, sem poder
 * conferir de onde veio.
 */
// `modulo` em cada cartão não é enfeite: é o que permite ao painel agrupar os
// cartões por área sem manter uma segunda lista dizendo qual é de qual — lista
// que ficaria desatualizada no primeiro cartão novo. O valor é o MESMO da
// permissão que libera o cartão, logo abaixo.
function montarKpis({ pedidos, compras, entradas, produtos, depositos, intervalo, serieVendas, statusQueFaturam, permissoes = {}, hoje } = {}) {
  const referencia = hoje || new Date().toISOString().slice(0, 10);
  const cartoes = [];
  if (permissoes.sales) cartoes.push(kpiFaturamento({ pedidos, intervalo, serie: serieVendas, statusQueFaturam }));
  if (permissoes.finance) {
    cartoes.push(kpiAReceber({ entradas, hoje: referencia }));
    cartoes.push(kpiAPagar({ entradas, hoje: referencia }));
  }
  if (permissoes.stock) cartoes.push(kpiEstoque({ produtos, depositos }));
  if (permissoes.purchases) cartoes.push(kpiCompras({ compras, intervalo }));
  return cartoes;
}

module.exports = {
  montarKpis,
  variacao,
  periodoAnterior,
  emAberto,
  kpiFaturamento,
  kpiAReceber,
  kpiAPagar,
  kpiEstoque,
  kpiCompras
};
