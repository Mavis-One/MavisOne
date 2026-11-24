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

const ofx = require('../public/modules/shared/ofx');

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

/**
 * OS ARQUIVOS IMPORTADOS (15/10/2026, pedido do usuário: "faça separação por
 * arquivos ofx ... algum botão para limpar a área de títulos a serem
 * conciliados por cada arquivo importado").
 *
 * Desde hoje cada importação grava em todas as suas linhas o mesmo
 * `importacaoId` e o nome do arquivo. As de antes não têm: a importação as
 * gravou numa tacada só, em sequência no db.json, da mesma origem, conta e
 * pessoa, com milissegundos entre uma e outra — e é por isso que se reconhecem
 * (a sequência se quebra com outra origem, conta, pessoa, ou 5 s de intervalo).
 * O id dessas é o da primeira linha, sem gravar nada.
 *
 * Devolve o arquivo de cada movimentação (porTransacao) e a lista dos arquivos,
 * do mais recente para o mais antigo, com quanto há em cada situação.
 */
const ORIGENS_DE_ARQUIVO = ['ofx', 'csv'];
const INTERVALO_DA_IMPORTACAO_ANTIGA_MS = 5000;

// O ARQUIVO INTEIRO (23/11/2026, pedido do usuário: "não estou conseguindo
// fazer a verificação completa desse arquivo OFX"). A movimentação que um
// arquivo novo traz de novo (o extrato do mês baixado outra vez) não é criada
// de novo: fica ligada também a ele, em `tambemNosArquivos` ({ id, arquivo,
// em, por }). Assim o "Ver" do arquivo mostra TODAS as linhas dele — antes
// mostrava só as que entraram naquela vez, e o resto parecia ter sumido.
function importacoesDoExtrato(transacoes) {
  const porTransacao = new Map();
  const arquivosDaTransacao = new Map();
  const grupos = new Map();
  const grupo = (id, base) => {
    if (!grupos.has(id)) {
      grupos.set(id, {
        id,
        arquivo: String(base.arquivo || ''),
        origem: base.origem,
        bankAccountId: base.bankAccountId || '',
        importadoEm: base.importadoEm || '',
        importadoPor: base.importadoPor || '',
        de: '',
        ate: '',
        total: 0,
        naoConciliado: 0,
        conciliado: 0,
        ignorado: 0
      });
    }
    return grupos.get(id);
  };
  const contar = (g, tx) => {
    g.total += 1;
    const k = CHAVE_DO_RESUMO[tx.status];
    if (k) g[k] += 1;
    if (tx.date && (!g.de || tx.date < g.de)) g.de = tx.date;
    if (tx.date && tx.date > g.ate) g.ate = tx.date;
  };
  let anterior = null;
  (transacoes || []).forEach((tx) => {
    if (!ORIGENS_DE_ARQUIVO.includes(tx.source)) {
      anterior = null;
      return;
    }
    let id = String(tx.importacaoId || '');
    if (id) {
      anterior = null;
    } else {
      const chave = [tx.source, tx.bankAccountId, tx.createdBy].join('|');
      const emMs = Date.parse(tx.createdAt || '');
      const continua = anterior && anterior.chave === chave && Number.isFinite(emMs)
        && emMs >= anterior.emMs && emMs - anterior.emMs <= INTERVALO_DA_IMPORTACAO_ANTIGA_MS;
      id = continua ? anterior.id : `antiga-${tx.id}`;
      anterior = { chave, emMs, id };
    }
    porTransacao.set(tx.id, id);
    const g = grupo(id, { arquivo: tx.arquivo, origem: tx.source, bankAccountId: tx.bankAccountId, importadoEm: tx.createdAt, importadoPor: tx.createdByName });
    if (tx.createdAt && (!g.importadoEm || tx.createdAt < g.importadoEm)) g.importadoEm = tx.createdAt;
    contar(g, tx);
    const todos = [id];
    (Array.isArray(tx.tambemNosArquivos) ? tx.tambemNosArquivos : []).forEach((ligacao) => {
      const outro = String((ligacao && ligacao.id) || '');
      if (!outro || todos.includes(outro)) return;
      todos.push(outro);
      contar(grupo(outro, { arquivo: ligacao.arquivo, origem: tx.source, bankAccountId: tx.bankAccountId, importadoEm: ligacao.em, importadoPor: ligacao.por }), tx);
    });
    arquivosDaTransacao.set(tx.id, todos);
  });
  const lista = [...grupos.values()].sort((a, b) => String(b.importadoEm).localeCompare(String(a.importadoEm))
    || String(b.id).localeCompare(String(a.id)));
  /** A movimentação está no arquivo `id` (veio dele, ou ele a trouxe de novo)? */
  const estaNoArquivo = (tx, id) => (arquivosDaTransacao.get(tx.id) || []).includes(id);
  return { porTransacao, arquivosDaTransacao, estaNoArquivo, lista };
}

/**
 * QUAIS LINHAS DO OFX JÁ ESTÃO NO EXTRATO (23/11/2026, pedido do usuário: "não
 * estou conseguindo encontrar 100% dos títulos ... deixe como padrão o formato
 * dele" — o extrato do Itaú).
 *
 * ERA PELO FITID, e o FITID do Itaú não identifica o lançamento: é a data mais
 * a POSIÇÃO no dia (20261103001, 20261103002...). O extrato baixado no meio do
 * dia e o baixado de novo depois numeram o mesmo dia de outro jeito, e o
 * 20261123005 de um é outro lançamento no outro: o novo era descartado como
 * "já existia" e não aparecia em lugar nenhum.
 *
 * AGORA É PELO CONTEÚDO — data, valor, entrada/saída e descrição (sem acento,
 * sem caixa, com o acento quebrado consertado) — CONTANDO: cada movimentação
 * que já existe responde por UMA linha do arquivo. Dois PIX iguais no mesmo dia
 * entram os dois; reimportar o mesmo arquivo não duplica nada. O FITID fica
 * como segunda tentativa, só para o que sobrou e só com a mesma data, valor e
 * tipo (o banco que mudou o texto da descrição entre um download e outro).
 *
 * `linhas`: [{ date, amount, type, description, fitid }] do arquivo.
 * `existentes`: as movimentações da MESMA conta.
 * Devolve, linha a linha, a movimentação que já é ela, ou null.
 */
function descricaoComparavel(texto) {
  return ofx.consertarAcentos(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

function casarComExistentes(linhas, existentes) {
  const doConteudo = (x) => [x.date, centavos(x.amount), x.type, descricaoComparavel(x.description)].join('|');
  const doFitid = (x, fitid) => [String(fitid).trim(), x.date, centavos(x.amount), x.type].join('|');
  const porConteudo = new Map();
  const porFitid = new Map();
  const guardar = (mapa, chave, tx) => {
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(tx);
  };
  (existentes || []).forEach((tx) => {
    guardar(porConteudo, doConteudo(tx), tx);
    if (tx.source === 'ofx' && tx.providerTransactionId) guardar(porFitid, doFitid(tx, tx.providerTransactionId), tx);
  });
  const usadas = new Set();
  const tomar = (lista) => {
    const tx = (lista || []).find((item) => !usadas.has(item.id));
    if (tx) usadas.add(tx.id);
    return tx || null;
  };
  // Primeiro todo o conteúdo, depois o FITID: assim o FITID de um não toma a
  // movimentação que o conteúdo de outra linha do arquivo reconheceria.
  const casadas = (linhas || []).map((linha) => tomar(porConteudo.get(doConteudo(linha))));
  (linhas || []).forEach((linha, i) => {
    if (!casadas[i] && linha.fitid) casadas[i] = tomar(porFitid.get(doFitid(linha, linha.fitid)));
  });
  return casadas;
}

// O que "Limpar" tira do arquivo: o que não tem baixa. A conciliada fica — ela
// é o lado do extrato de uma baixa feita, e sumir com ela deixaria a baixa sem
// a movimentação que a justificou (para tirar, Desconciliar antes).
const SITUACOES_QUE_O_LIMPAR_TIRA = ['nao_conciliado', 'ignorado'];

module.exports = {
  dataDoExtrato,
  ORDENS_DO_EXTRATO,
  ordemDoExtrato,
  ordenarExtrato,
  resumoDoExtrato,
  importacoesDoExtrato,
  casarComExistentes,
  descricaoComparavel,
  SITUACOES_QUE_O_LIMPAR_TIRA
};
