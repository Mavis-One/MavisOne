/**
 * A CONCILIAÇÃO AUTOMÁTICA DO EXTRATO (28/10/2026).
 *
 * Pedido do usuário: "a conciliação deve ocorrer com os dados batendo,
 * empresa, fornecedor, valores e datas, isso vai ocorrer automaticamente; se
 * houver mais de um valor ela não é conciliada automaticamente e se tiver mais
 * de um lançamento para isso também não".
 *
 * Uma movimentação do extrato (não conciliada) casa sozinha com um título em
 * aberto quando TUDO bate:
 *
 *   · empresa — a raiz do CNPJ da empresa da conta do extrato é a do título;
 *   · fornecedor (ou cliente) — o nome do cadastro do título está na descrição
 *     da movimentação (as duas primeiras palavras que contam), ou o CPF/CNPJ
 *     dele está lá;
 *   · valor — o que se espera ver no extrato (o líquido no título de cartão),
 *     centavo por centavo;
 *   · data — a do extrato é o vencimento, ou até o dia útil seguinte a ele
 *     (fim de semana, feriado, compensação do boleto no dia seguinte).
 *
 * E é ÚNICO dos dois lados: um só título em aberto daquela empresa com aquele
 * valor, e uma só movimentação não conciliada daquela empresa com aquele valor.
 * Havendo dois, nenhum é conciliado sozinho — fica para o clique.
 *
 * Mora fora do server.js para o teste rodar sem subir o servidor
 * (scripts/test-conciliacao-automatica.js). O servidor monta as listas
 * (empresa de cada título e de cada conta, nome e documento do cadastro) e
 * grava as baixas.
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

/**
 * OS PARES QUE SE CONCILIAM SOZINHOS.
 *
 * `movimentacoes`: TODAS as não conciliadas (a unicidade do valor olha todas),
 *   cada uma { id, tipo: 'receita'|'despesa', valor, data, raiz, texto, documentos }.
 * `alvos`: os ids das movimentações a tentar (o arquivo importado, o filtro).
 * `titulos`: os em aberto, cada um { id, tipo, esperado, raiz, vencimento, nome, documento }
 *   — `raiz` vazia quando a empresa do título não é conhecida.
 *
 * Devolve { pares: [{ movimentacaoId, tituloId }], motivos: { [movimentacaoId]: texto } }.
 */
function paresAutomaticos({ movimentacoes = [], alvos = null, titulos = [] }) {
  const chave = (tipo, raiz, valor) => `${tipo}|${raiz}|${centavos(valor)}`;
  // Título sem empresa conhecida pode ser de qualquer uma: entra na contagem de
  // todas, e nunca é o par (a empresa tem de bater).
  const titulosPorValor = new Map();
  const semEmpresaPorValor = new Map();
  titulos.forEach((t) => {
    if (!(centavos(t.esperado) > 0)) return;
    if (t.raiz) {
      const k = chave(t.tipo, t.raiz, t.esperado);
      if (!titulosPorValor.has(k)) titulosPorValor.set(k, []);
      titulosPorValor.get(k).push(t);
    } else {
      const k = `${t.tipo}|${centavos(t.esperado)}`;
      semEmpresaPorValor.set(k, (semEmpresaPorValor.get(k) || 0) + 1);
    }
  });
  const movimentacoesPorValor = new Map();
  movimentacoes.forEach((m) => {
    if (!m.raiz) return;
    const k = chave(m.tipo, m.raiz, m.valor);
    movimentacoesPorValor.set(k, (movimentacoesPorValor.get(k) || 0) + 1);
  });

  const tentar = alvos ? new Set(alvos) : null;
  const pares = [];
  const motivos = {};
  movimentacoes.forEach((m) => {
    if (tentar && !tentar.has(m.id)) return;
    if (!m.raiz) { motivos[m.id] = 'a conta do extrato não tem empresa conhecida'; return; }
    const k = chave(m.tipo, m.raiz, m.valor);
    const candidatos = titulosPorValor.get(k) || [];
    const semEmpresa = semEmpresaPorValor.get(`${m.tipo}|${centavos(m.valor)}`) || 0;
    if (!candidatos.length) { motivos[m.id] = semEmpresa ? 'o título com esse valor não tem empresa' : 'nenhum título em aberto da empresa com esse valor'; return; }
    if (candidatos.length + semEmpresa > 1) { motivos[m.id] = 'mais de um título em aberto com esse valor'; return; }
    if (movimentacoesPorValor.get(k) > 1) { motivos[m.id] = 'mais de uma movimentação com esse valor'; return; }
    const [titulo] = candidatos;
    if (!fornecedorBate({ texto: m.texto, documentos: m.documentos, nome: titulo.nome, documento: titulo.documento })) {
      motivos[m.id] = 'o fornecedor/cliente do título não está na descrição'; return;
    }
    if (!dataBate(m.data, titulo.vencimento)) { motivos[m.id] = 'a data não bate com o vencimento'; return; }
    pares.push({ movimentacaoId: m.id, tituloId: titulo.id });
  });
  return { pares, motivos };
}

module.exports = { centavos, raizDoCnpj, palavrasDoNome, fornecedorBate, dataBate, paresAutomaticos };
