/**
 * O EXTRATO BANCÁRIO — as regras da Conciliação Bancária que não dependem da
 * requisição (fase EI, 13/10/2026: "uma geral no módulo financeiro ... com
 * pesquisa por valores, organização, ordenação, seleção").
 *
 * Mora fora do server.js para o teste rodar sem subir o servidor
 * (scripts/test-extrato-bancario.js). Três perguntas, uma resposta cada:
 *
 *   · que data é esta linha do extrato? (importação e lançamento manual);
 *   · em que ordem a lista sai? (?sort= e ?dir=);
 *   · quanto há em cada situação? (os cartões do topo da tela).
 */
'use strict';

// Centavos inteiros: comparar e somar reais em ponto flutuante erra no último
// centavo. A mesma conta de listaDeLancamentos.centavos, repetida aqui para o
// teste deste arquivo não depender da tela de Lançamentos.
const centavos = (valor) => Math.round(Number(valor || 0) * 100);

/**
 * A DATA DE UMA LINHA DO EXTRATO, em AAAA-MM-DD, ou null quando não é data.
 *
 * A importação gravava o texto como viesse, e a hora da linha sem data virava
 * "hoje". O CSV de banco brasileiro costuma trazer 13/10/2026: gravado assim,
 * '13/10/2026' >= '2026-10-01' é falso (comparação de texto) e a movimentação
 * sumia do filtro de Data inicial, ia para um lugar qualquer da ordem, e a
 * sugestão de conciliação a comparava com a data de hoje (parseDateOnly cai em
 * hoje quando não entende). Por isso só entram os dois formatos sem
 * ambiguidade, com a hora opcional ("2026-10-13 00:00:00" é como algumas
 * planilhas exportam), e a data tem de existir no calendário: 31/02 não passa.
 * Quem recebe null conta a linha como inválida em vez de inventar uma data.
 */
function dataDoExtrato(valor) {
  const texto = String(valor == null ? '' : valor).trim();
  let ano;
  let mes;
  let dia;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\S*)?$/.exec(texto);
  if (m) {
    [, ano, mes, dia] = m;
  } else {
    m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(texto);
    if (!m) return null;
    [, dia, mes, ano] = m;
  }
  const d = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  if (d.getUTCFullYear() !== Number(ano) || d.getUTCMonth() !== Number(mes) - 1 || d.getUTCDate() !== Number(dia)) {
    return null;
  }
  return `${ano}-${mes}-${dia}`;
}

// A situação na ordem em que se trabalha: o que falta conciliar primeiro.
const ORDEM_DA_SITUACAO = { nao_conciliado: 0, conciliado: 1, ignorado: 2 };

/**
 * AS ORDENS ACEITAS EM ?sort= (fase EI). Antes a lista saía sempre por data
 * decrescente, e achar o crédito de R$ 1.250,00 no meio de 300 linhas era rolar
 * a tela. O valor ordena COM SINAL, como a coluna mostra (+ entrada, - saída):
 * ordenado pelo valor absoluto, uma coluna de +/- pareceria fora de ordem.
 * `conta` recebe quem traduz o id no nome, porque o cadastro de contas mora no
 * banco e quem o carrega é a rota.
 */
const ORDENS_DO_EXTRATO = {
  data: (a, b) => String(a.date || '').localeCompare(String(b.date || '')),
  descricao: (a, b) => String(a.description || '').localeCompare(String(b.description || ''), 'pt-BR', { sensitivity: 'base' }),
  valor: (a, b) => valorComSinal(a) - valorComSinal(b),
  tipo: (a, b) => String(a.type || '').localeCompare(String(b.type || '')),
  conta: (a, b, nomeDaConta) => String(nomeDaConta(a) || '').localeCompare(String(nomeDaConta(b) || ''), 'pt-BR', { sensitivity: 'base' }),
  status: (a, b) => (ORDEM_DA_SITUACAO[a.status] ?? 9) - (ORDEM_DA_SITUACAO[b.status] ?? 9)
};

// Data e valor começam do maior: a movimentação mais recente e a maior são as
// procuradas. Texto começa de A a Z. Mesma regra da lista de Lançamentos.
const COMECA_DECRESCENTE = ['data', 'valor'];

function valorComSinal(tx) {
  const valor = centavos(tx.amount);
  return tx.type === 'saida' ? -valor : valor;
}

/** { campo, direcao } a partir da URL; chave desconhecida = data decrescente. */
function ordemDoExtrato(query) {
  const pedido = query.get('sort');
  const campo = Object.prototype.hasOwnProperty.call(ORDENS_DO_EXTRATO, pedido) ? pedido : 'data';
  const dir = query.get('dir');
  const direcao = dir === 'asc' || dir === 'desc' ? dir : (COMECA_DECRESCENTE.includes(campo) ? 'desc' : 'asc');
  return { campo, direcao };
}

/**
 * Ordena NO LUGAR e devolve a lista. O desempate é sempre a ordem antiga (data
 * decrescente, depois id): com ele a mesma busca não troca linhas de lugar entre
 * uma página e outra.
 */
function ordenarExtrato(lista, ordem, nomeDaConta = () => '') {
  const sinal = ordem.direcao === 'asc' ? 1 : -1;
  const comparar = ORDENS_DO_EXTRATO[ordem.campo] || ORDENS_DO_EXTRATO.data;
  return lista.sort((a, b) => sinal * comparar(a, b, nomeDaConta)
    || String(b.date || '').localeCompare(String(a.date || ''))
    || String(b.id || '').localeCompare(String(a.id || '')));
}

const CHAVE_DO_RESUMO = { nao_conciliado: 'naoConciliado', conciliado: 'conciliado', ignorado: 'ignorado' };

/**
 * OS CARTÕES DO TOPO: quantas movimentações e quanto dinheiro em cada situação.
 * Somado em centavos inteiros (somar reais em ponto flutuante erra no último
 * centavo) e devolvido em reais. Quem chama decide sobre qual lista: a rota
 * passa a lista SEM o filtro de situação, senão filtrar "Conciliado" zerava o
 * cartão "Não conciliadas" e a conciliação parecia em dia.
 */
function resumoDoExtrato(lista) {
  const contagem = { naoConciliado: 0, conciliado: 0, ignorado: 0 };
  const somas = {};
  Object.values(CHAVE_DO_RESUMO).forEach((k) => { somas[k] = { entrada: 0, saida: 0 }; });
  (lista || []).forEach((tx) => {
    const k = CHAVE_DO_RESUMO[tx.status];
    if (!k) return;
    contagem[k] += 1;
    somas[k][tx.type === 'saida' ? 'saida' : 'entrada'] += centavos(tx.amount);
  });
  const valores = {};
  Object.entries(somas).forEach(([k, s]) => { valores[k] = { entrada: s.entrada / 100, saida: s.saida / 100 }; });
  return { ...contagem, valores };
}

module.exports = {
  dataDoExtrato,
  ORDENS_DO_EXTRATO,
  ordemDoExtrato,
  ordenarExtrato,
  resumoDoExtrato
};
