/**
 * META DE VENDA — o alvo, e como ele se compara com qualquer recorte de tempo.
 *
 * POR QUE ISTO NÃO EXISTIA
 * ------------------------
 * O cabeçalho de lib/kpis.js registrava a falta com todas as letras: *"O mockup
 * previa '85% da meta'. Não há cadastro de meta em lugar nenhum... cartão com
 * número derivado de nada é pior do que cartão sem número, porque parece
 * confiável."* A barra do cartão (`faixa`) existia e media outra coisa —
 * proporção vencida, no caso de contas. O que faltava era o alvo.
 *
 * A META É MENSAL, E O RECORTE NÃO É
 * ----------------------------------
 * Meta se combina por mês ("a Filial 08 vende R$ 400 mil em setembro"), e o
 * Início tem quatro recortes: Diário, Semanal, Mensal e Anual. Comparar um
 * faturamento de terça-feira com a meta do mês daria 3% e não significaria
 * nada.
 *
 * A regra é o RATEIO POR DIAS CORRIDOS: a meta de um período é a soma, mês a
 * mês, da meta daquele mês multiplicada pela fração de dias do mês que o
 * período cobre.
 *
 *   meta do dia 25/09        = meta de setembro × 1/30
 *   meta de 28/09 a 04/10    = set × 3/30 + out × 4/31
 *   meta de setembro         = set × 30/30
 *   meta do ano              = soma das doze metas do ano
 *
 * DIAS CORRIDOS, E NÃO DIAS ÚTEIS, e a escolha é deliberada: dia útil depende
 * de feriado municipal, e feriado municipal depende de cadastro que não existe.
 * Uma regra que precisa de dado que ninguém tem é uma regra que erra em
 * silêncio. Dias corridos erra um pouco, erra igual todo mês, e é explicável em
 * uma frase — que é o que importa num número que alguém vai usar para cobrar
 * equipe.
 *
 * SEM META CADASTRADA, NÃO HÁ FAIXA. `null`, e não zero: zero diria "a meta é
 * zero e você a superou", que é a mentira mais fácil de acreditar. É a mesma
 * decisão do `variacao()` devolvendo null quando o período anterior foi zero.
 *
 * Puro de propósito: recebe as metas já lidas e devolve número. Não conhece
 * banco nem HTTP, e por isso o teste prova o rateio com quatro objetos.
 */

// 'filial' (fase DD): a loja como aparece na categoria do pedido — ver
// lib/filial-da-venda.js. 'empresa' aponta para `orders.company_id`, que está
// vazio em todos os pedidos; uma meta 'empresa' não teria venda para medir.
const ESCOPOS = ['empresa', 'vendedor', 'filial'];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Quantos dias tem o mês de uma data ISO (YYYY-MM-DD). */
function diasDoMes(ano, mes) {
  return new Date(ano, mes, 0).getDate();
}

/** A competência (primeiro dia do mês) de uma data ISO. */
function competenciaDe(iso) {
  return `${String(iso).slice(0, 7)}-01`;
}

/**
 * Os meses que um intervalo toca, e quantos dias de cada um ele cobre.
 *
 * Devolve [{ competencia, dias, diasDoMes }]. É a peça que o rateio usa, e está
 * separada porque é onde o erro de fronteira mora: um período que começa no dia
 * 28 e acaba no dia 4 do mês seguinte tem de aparecer como DOIS meses.
 */
function mesesDoIntervalo({ from, to } = {}) {
  const inicio = String(from || '');
  const fim = String(to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) return [];
  if (fim < inicio) return [];

  const meses = [];
  let ano = Number(inicio.slice(0, 4));
  let mes = Number(inicio.slice(5, 7));
  // Enquanto o primeiro dia do mês corrente não passar do fim do intervalo.
  for (let guarda = 0; guarda < 1200; guarda += 1) {
    const total = diasDoMes(ano, mes);
    const primeiro = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const ultimo = `${ano}-${String(mes).padStart(2, '0')}-${String(total).padStart(2, '0')}`;
    if (primeiro > fim) break;

    // A interseção entre [inicio, fim] e [primeiro, ultimo], em dias.
    const de = inicio > primeiro ? inicio : primeiro;
    const ate = fim < ultimo ? fim : ultimo;
    const dias = (new Date(`${ate}T00:00:00`) - new Date(`${de}T00:00:00`)) / 86400000 + 1;
    if (dias > 0) meses.push({ competencia: primeiro, dias, diasDoMes: total });

    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
  }
  return meses;
}

/**
 * A meta de um período, rateada por dias corridos.
 *
 * `metas` é a lista já filtrada por quem interessa (uma empresa, um vendedor, ou
 * o conjunto deles) — quem filtra é a rota, porque é ela que sabe o escopo do
 * usuário. Somar aqui metas de escopos diferentes seria somar o alvo da loja
 * com o alvo de cada vendedor dela e pedir o dobro.
 *
 * Devolve null quando não há meta nenhuma nos meses do período: o cartão então
 * não mostra faixa, que é o comportamento honesto.
 */
function metaDoPeriodo(metas, intervalo) {
  const meses = mesesDoIntervalo(intervalo);
  if (!meses.length) return null;

  const porCompetencia = new Map();
  for (const meta of (metas || [])) {
    const chave = competenciaDe(meta.competencia);
    porCompetencia.set(chave, (porCompetencia.get(chave) || 0) + num(meta.valor));
  }

  let total = 0;
  let achou = false;
  for (const mes of meses) {
    const alvo = porCompetencia.get(mes.competencia);
    if (alvo === undefined) continue;
    achou = true;
    total += alvo * (mes.dias / mes.diasDoMes);
  }
  if (!achou) return null;
  return Math.round(total * 100) / 100;
}

/**
 * A faixa do cartão: quanto do alvo já foi feito.
 *
 * O formato é o que dashboardCartaoKpi desenha — `{ valor, percentual, rotulo,
 * tom, contagem }` —, e não um objeto novo: a barra já existe na tela, e
 * inventar um segundo formato faria o cartão de meta parecer diferente dos
 * outros sem motivo.
 *
 * O PERCENTUAL NÃO É CORTADO EM 100, e o `tom` distingue os três casos que
 * importam para quem olha:
 *
 *   abaixo de 70%  -> alerta   (o mês não vai fechar sozinho)
 *   70% a 99%      -> atencao  (dá para virar)
 *   100% ou mais   -> ''       (sem cor de alarme; bateu)
 *
 * Cortar em 100% esconderia o mês excepcional, que é informação — e a barra da
 * tela já limita a LARGURA em 100%, então o número pode passar sem estourar o
 * desenho.
 */
function faixaDaMeta(valor, meta) {
  const alvo = num(meta);
  if (!(alvo > 0)) return null;
  const feito = num(valor);
  const percentual = Math.round((feito / alvo) * 100);
  return {
    valor: alvo,
    percentual,
    rotulo: 'da meta',
    tom: percentual >= 100 ? '' : (percentual >= 70 ? 'atencao' : 'alerta'),
    contagem: false
  };
}

/**
 * QUAIS METAS medem o mesmo universo que as vendas que a tela está mostrando.
 *
 * É a regra que o cartão Faturamento e a linha de meta do Fluxo de Vendas
 * precisam compartilhar — se cada um escolhesse do seu jeito, o cartão diria
 * "90% da meta" e a linha do gráfico passaria em outro lugar.
 *
 *   vendedor restrito, sem filial ... as metas DELE (escopo vendedor)
 *   vendedor restrito, com filial ... nenhuma: a meta dele não se divide por
 *                                     loja, e mostrar a meta inteira contra as
 *                                     vendas de uma loja só daria 20% sem
 *                                     significar nada
 *   vê tudo, com filial ............. a meta daquela filial
 *   vê tudo, "Todas" ................ a SOMA das metas de filial
 *
 * ----------------------------------------------------------------------------
 * A META DE EMPRESA DEIXOU DE VENCER NO "TODAS" (30/09/2026)
 * ----------------------------------------------------------------------------
 * Esta função dizia, no "Todas": *"as metas de EMPRESA, se houver alguma; senão,
 * a soma das metas de filial"*, com a justificativa de que "a meta da empresa já
 * contém a das lojas, e somar pediria o dobro".
 *
 * O RACIOCÍNIO ERA BOM E A PREMISSA ERA FALSA. A meta de empresa se compara com
 * `orders.company_id`, que está VAZIO em 14.864 de 14.864 pedidos — medido em
 * 30/09/2026, e é o mesmo fato que o cabeçalho de lib/filial-da-venda.js já
 * registrava. Uma meta de empresa não contém a das lojas: ela não contém nada.
 *
 * O EFEITO, MEDIDO: duas metas de filial de R$ 100 mil e R$ 400 mil davam
 * R$ 500 mil em "Todas as filiais". Bastava existir UMA meta de empresa de
 * R$ 300 mil — cadastrável em Configurações › Metas de Venda, onde "Loja" era a
 * primeira opção do seletor — e o número virava R$ 300 mil. As duas metas de
 * filial eram descartadas, sem nada na tela dizendo isso, e o alvo passava a ser
 * um número que nenhuma venda podia alcançar.
 *
 * Por isso o "Todas" agora soma SEMPRE as metas de filial. A meta de empresa não
 * é somada nem preferida: ela não mede nada, e o lugar de tratar isso é a tela
 * de cadastro, que deixou de oferecê-la e marca as que já existem.
 *
 * `mesmaFilial(a, b)` vem de fora para esta função não conhecer a regra de
 * grafia da filial (lib/filial-da-venda.js/chaveDaFilial).
 */
function metasDoRecorte(metas, { sellerIds = null, filial = '', mesmaFilial = (a, b) => a === b } = {}) {
  const lista = metas || [];
  if (sellerIds !== null && sellerIds !== undefined) {
    if (filial) return [];
    const meus = new Set(sellerIds);
    return lista.filter((m) => m.escopo === 'vendedor' && meus.has(m.referenciaId));
  }
  if (filial) return lista.filter((m) => m.escopo === 'filial' && mesmaFilial(m.referenciaId, filial));
  return lista.filter((m) => m.escopo === 'filial');
}

/**
 * AS REFERÊNCIAS QUE A META COBRE — e é isto que torna o percentual honesto.
 *
 * O PROBLEMA QUE ELA RESOLVE, medido em 30/09/2026: mesmo com meta em todas as
 * 12 filiais, o "Todas as filiais" comparava o faturamento INTEIRO da empresa
 * com a soma das metas de filial. E 6,5% do faturado de 2026 (R$ 874.912) não
 * pertence a filial nenhuma — são vendas cuja categoria não tem o sufixo de
 * loja. Esse dinheiro entrava no numerador e não tinha alvo no denominador, e o
 * percentual saía inflado sem ninguém saber por quanto.
 *
 * Com a lista de referências, quem chama restringe o numerador às MESMAS
 * filiais que estão no denominador. O percentual passa a ser exato, e a tela
 * diz quantas filiais entraram.
 *
 * Devolve lista vazia quando não há meta — e aí não há faixa para desenhar, que
 * é o comportamento de sempre.
 */
function referenciasDaMeta(metasEscolhidas) {
  const vistas = new Set();
  for (const m of (metasEscolhidas || [])) {
    if (m && m.referenciaId) vistas.add(m.referenciaId);
  }
  return [...vistas];
}

module.exports = {
  ESCOPOS, mesesDoIntervalo, competenciaDe, metaDoPeriodo, faixaDaMeta,
  metasDoRecorte, referenciasDaMeta
};
