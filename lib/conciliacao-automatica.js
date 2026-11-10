/**
 * A CONCILIAÇÃO AUTOMÁTICA DO EXTRATO (28/10/2026).
 *
 * Pedido do usuário: "a conciliação deve ocorrer com os dados batendo,
 * empresa, fornecedor, valores e datas, isso vai ocorrer automaticamente; se
 * houver mais de um valor ela não é conciliada automaticamente e se tiver mais
 * de um lançamento para isso também não".
 *
 * QUATRO COISAS DESDE 10/11/2026 (pedido do usuário: "o sistema está
 * conciliando contas bancárias erradas, vamos refazer as validações pra
 * conciliação automática: conta bancária, fornecedor, valor e data"). De
 * 05/11 a 10/11 a regra era empresa, valor e data: a empresa da conta do
 * extrato contra a do título, e uma empresa tem várias contas — o título do
 * Itaú se baixava pelo extrato do Sicoob. Uma movimentação do extrato (não
 * conciliada) casa sozinha com um título em aberto quando TUDO bate:
 *
 *   · conta bancária — a do título é a própria conta do extrato (título sem
 *     conta nunca entra sozinho);
 *   · fornecedor (ou cliente) — o nome do cadastro do título está na descrição
 *     da movimentação (as duas primeiras palavras que contam), ou o CPF/CNPJ
 *     dele está lá;
 *   · valor — o que se espera ver no extrato (o líquido no título de cartão),
 *     centavo por centavo;
 *   · data — a do extrato é o vencimento, ou até o dia útil seguinte a ele
 *     (fim de semana, feriado, compensação do boleto no dia seguinte).
 *
 * E é ÚNICO dos dois lados: um só título passa nas quatro (e nenhum título sem
 * conta do mesmo fornecedor, valor e data, que poderia ser ele), e esse título
 * é escolhido por uma só movimentação não conciliada. Havendo dois, nenhum é
 * conciliado sozinho — fica para o clique. O "único do mês" entre parcelas do
 * mesmo valor (29/10) deixou de ser automático: a data tem de bater, e o
 * título do mês vira sugestão de 1 clique.
 *
 * Mora fora do server.js para o teste rodar sem subir o servidor
 * (scripts/test-conciliacao-automatica.js). O servidor monta as listas (conta,
 * nome e documento do cadastro de cada título) e grava as baixas.
 */
'use strict';

const diaUtil = require('../public/modules/shared/dia_util');

const centavos = (valor) => Math.round(Number(valor || 0) * 100);
const raizDoCnpj = (cnpj) => String(cnpj || '').replace(/\D/g, '').slice(0, 8);

const normalizar = (texto) => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

// Palavras que não identificam ninguém: preposições, tipo de sociedade e o
// ramo genérico ("COMERCIO", "SERVICOS").
const PALAVRAS_QUE_NAO_CONTAM = new Set([
  'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'LTDA', 'ME', 'MEI', 'EPP', 'EIRELI', 'SA', 'S', 'A', 'CIA',
  'COMERCIO', 'INDUSTRIA', 'SERVICOS', 'COM', 'IND'
]);

function palavras(texto) {
  return normalizar(texto).split(/[^A-Z0-9]+/).filter(Boolean);
}

/** As palavras do nome que identificam a pessoa: com letra, fora as que não contam. */
function palavrasDoNome(nome) {
  return palavras(nome).filter((p) => /[A-Z]/.test(p) && !PALAVRAS_QUE_NAO_CONTAM.has(p));
}

/**
 * O FORNECEDOR (OU CLIENTE) DO TÍTULO ESTÁ NA MOVIMENTAÇÃO? Pelo documento
 * (CPF/CNPJ inteiro, com ou sem pontuação) ou pelo nome: as duas primeiras
 * palavras que contam têm de aparecer na descrição — inteiras, ou cortadas pelo
 * banco com pelo menos 4 letras ("DISTRIB" de "DISTRIBUIDORA").
 */
function fornecedorBate({ texto, documentos = [], nome, documento }) {
  const doc = String(documento || '').replace(/\D/g, '');
  if (doc.length >= 11) {
    const daMovimentacao = [
      ...(String(texto || '').replace(/[.\-/]/g, '').match(/\d+/g) || []),
      ...documentos.map((d) => String(d || '').replace(/\D/g, ''))
    ];
    if (daMovimentacao.includes(doc)) return true;
  }
  const exigidas = palavrasDoNome(nome).slice(0, 2);
  if (!exigidas.length) return false;
  const daDescricao = palavras(texto);
  return exigidas.every((p) => daDescricao.some((d) => d === p || (d.length >= 4 && p.startsWith(d))));
}

/** A data do extrato é o vencimento, ou até o dia útil seguinte a ele. */
function dataBate(dataDoExtrato, vencimento) {
  const dia = String(dataDoExtrato || '').slice(0, 10);
  const venc = String(vencimento || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !/^\d{4}-\d{2}-\d{2}$/.test(venc)) return false;
  const seguinte = new Date(Date.parse(`${venc}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return dia >= venc && dia <= diaUtil.proximoDiaUtil(seguinte);
}

const mesDe = (data) => String(data || '').slice(0, 7);

/**
 * OS PARES QUE SE CONCILIAM SOZINHOS.
 *
 * `movimentacoes`: TODAS as não conciliadas (a unicidade olha todas), cada uma
 *   { id, tipo: 'receita'|'despesa', valor, data, conta, texto, documentos }.
 * `alvos`: os ids das movimentações a tentar (o arquivo importado, o filtro).
 * `titulos`: os em aberto, cada um { id, tipo, esperado, conta, vencimento, nome, documento }
 *   — `conta` vazia quando o título não tem conta bancária.
 *
 * Devolve { pares: [{ movimentacaoId, tituloId }], motivos: { [movimentacaoId]: texto },
 * sugestoes: [{ movimentacaoId, tituloId }] }.
 *
 * AS SUGESTÕES (04/11/2026; desde 10/11/2026, só da mesma conta): o título
 * ÚNICO da conta do extrato, com aquele valor, que vence na data ou no mesmo
 * mês, quando só o nome na descrição ou a data impediram a automática (o
 * extrato que não traz o nome; o pago antes do vencimento; o vencimento do
 * sábado que foi para a segunda). Não são conciliadas: a tela as mostra para
 * um clique de confirmação. Título sugerido para duas movimentações, ou já
 * escolhido por um par, não é sugerido.
 */
function paresAutomaticos({ movimentacoes = [], alvos = null, titulos = [] }) {
  const titulosPorValor = new Map();
  titulos.forEach((t) => {
    if (!(centavos(t.esperado) > 0)) return;
    const k = `${t.tipo}|${centavos(t.esperado)}`;
    if (!titulosPorValor.has(k)) titulosPorValor.set(k, []);
    titulosPorValor.get(k).push(t);
  });

  // Todas as não conciliadas são analisadas, não só os alvos: duas que
  // escolhem o mesmo título (uma delas fora do arquivo importado) não ficam
  // com nenhum.
  const tentar = alvos ? new Set(alvos) : null;
  const propostas = [];
  const motivos = {};
  const sugeridas = [];
  movimentacoes.forEach((m) => {
    if (!m.conta) { motivos[m.id] = 'a movimentação não tem conta bancária'; return; }
    const doValor = titulosPorValor.get(`${m.tipo}|${centavos(m.valor)}`) || [];
    if (!doValor.length) { motivos[m.id] = 'nenhum título em aberto com esse valor'; return; }
    const daConta = doValor.filter((t) => t.conta === m.conta);
    const semConta = doValor.filter((t) => !t.conta);
    if (!daConta.length) {
      motivos[m.id] = semConta.length
        ? 'o título com esse valor não tem conta bancária'
        : 'o título com esse valor é de outra conta bancária';
      return;
    }
    const doFornecedor = (lista) => lista.filter((t) => fornecedorBate({ texto: m.texto, documentos: m.documentos, nome: t.nome, documento: t.documento }));
    // A sugestão: um só título desta conta e valor vencendo na data ou no mês.
    const sugerir = () => {
      const noMes = daConta.filter((t) => dataBate(m.data, t.vencimento) || mesDe(t.vencimento) === mesDe(m.data));
      if (noMes.length === 1) sugeridas.push({ movimentacaoId: m.id, tituloId: noMes[0].id });
    };
    const comFornecedor = doFornecedor(daConta);
    if (!comFornecedor.length) {
      motivos[m.id] = 'o fornecedor/cliente do título não está na descrição';
      sugerir();
      return;
    }
    const naData = comFornecedor.filter((t) => dataBate(m.data, t.vencimento));
    if (!naData.length) {
      motivos[m.id] = 'a data não bate com o vencimento';
      sugerir();
      return;
    }
    if (naData.length > 1) {
      motivos[m.id] = 'mais de um título desta conta, desse fornecedor/cliente e valor vence nessa data';
      return;
    }
    if (doFornecedor(semConta).some((t) => dataBate(m.data, t.vencimento))) {
      motivos[m.id] = 'há título sem conta bancária com o mesmo fornecedor/cliente, valor e data';
      return;
    }
    propostas.push({ movimentacaoId: m.id, tituloId: naData[0].id });
  });
  const escolhas = new Map();
  propostas.forEach((p) => escolhas.set(p.tituloId, (escolhas.get(p.tituloId) || 0) + 1));
  const pares = [];
  propostas.forEach((p) => {
    if (escolhas.get(p.tituloId) > 1) motivos[p.movimentacaoId] = 'mais de uma movimentação para o mesmo título';
    else pares.push(p);
  });
  const usados = new Set(pares.map((p) => p.tituloId));
  const vezes = new Map();
  sugeridas.forEach((s) => vezes.set(s.tituloId, (vezes.get(s.tituloId) || 0) + 1));
  const sugestoes = sugeridas.filter((s) => vezes.get(s.tituloId) === 1 && !usados.has(s.tituloId));
  if (!tentar) return { pares, motivos, sugestoes };
  const soAlvos = {};
  Object.keys(motivos).forEach((id) => { if (tentar.has(id)) soAlvos[id] = motivos[id]; });
  return {
    pares: pares.filter((p) => tentar.has(p.movimentacaoId)),
    motivos: soAlvos,
    sugestoes: sugestoes.filter((s) => tentar.has(s.movimentacaoId))
  };
}

module.exports = { centavos, raizDoCnpj, palavrasDoNome, fornecedorBate, dataBate, paresAutomaticos };
