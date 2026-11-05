/**
 * A CONCILIAÇÃO AUTOMÁTICA DO EXTRATO (28/10/2026).
 *
 * Pedido do usuário: "a conciliação deve ocorrer com os dados batendo,
 * empresa, fornecedor, valores e datas, isso vai ocorrer automaticamente; se
 * houver mais de um valor ela não é conciliada automaticamente e se tiver mais
 * de um lançamento para isso também não".
 *
 * SÓ TRÊS COISAS DESDE 05/11/2026 (pedido do usuário: "deixe a conciliação
 * automática apenas com três características específicas, valores, empresa
 * selecionada, e data"). O fornecedor na descrição saiu: o extrato do banco
 * quase nunca traz o nome (Sicoob de outubro: 0 de 45). Uma movimentação do
 * extrato (não conciliada) casa sozinha com um título em aberto quando:
 *
 *   · empresa — a raiz do CNPJ da empresa da conta do extrato é a do título;
 *   · valor — o que se espera ver no extrato (o líquido no título de cartão),
 *     centavo por centavo;
 *   · data — a do extrato é o vencimento, ou até o dia útil seguinte a ele
 *     (fim de semana, feriado, compensação do boleto no dia seguinte).
 *
 * E é ÚNICO dos dois lados: um só título em aberto daquela empresa com aquele
 * valor, e uma só movimentação não conciliada daquela empresa com aquele valor.
 * Havendo dois, nenhum é conciliado sozinho — fica para o clique. Exceto os
 * títulos do mesmo valor (as parcelas, 29/10/2026): o que vence na data da
 * movimentação, ou o único do mês dela, é o dela (ver parcelaDoMes).
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
 * A PARCELA DO MÊS (29/10/2026). Pedido do usuário: "se o título tiver várias
 * parcelas, quero que você coloque a do mês e concilie automaticamente".
 *
 * Os títulos em aberto da mesma empresa e do mesmo valor — o caso em que
 * "mais de um título com esse valor" travava tudo. Entre eles, a movimentação
 * fica com:
 *   1. o que vence na data dela (o vencimento, até o dia útil seguinte);
 *   2. sem nenhum, o que vence no mesmo mês dela (pago antes do vencimento,
 *      ou depois do dia útil seguinte, ainda no mês).
 * Dois no mesmo passo, ou um título sem empresa conhecida do mesmo valor que
 * também caberia ali, e não se concilia sozinho. Desde 05/11/2026 o
 * fornecedor não separa mais as parcelas: só empresa, valor e data.
 *
 * Devolve { titulo } ou { motivo }.
 */
function parcelaDoMes(m, candidatos, semEmpresa) {
  const daEmpresa = candidatos;
  const semDona = semEmpresa;
  const passos = [
    [(t) => dataBate(m.data, t.vencimento), 'nessa data'],
    [(t) => mesDe(t.vencimento) === mesDe(m.data), 'no mês da movimentação']
  ];
  for (const [regra, quando] of passos) {
    const escolhidos = daEmpresa.filter(regra);
    const duvida = semDona.filter(regra).length;
    if (!escolhidos.length && !duvida) continue;
    if (escolhidos.length !== 1 || duvida) return { motivo: `mais de um título em aberto com esse valor vence ${quando}` };
    return { titulo: escolhidos[0] };
  }
  return { motivo: 'nenhuma parcela com esse valor vence no mês da movimentação' };
}

/**
 * OS PARES QUE SE CONCILIAM SOZINHOS.
 *
 * `movimentacoes`: TODAS as não conciliadas (a unicidade do valor olha todas),
 *   cada uma { id, tipo: 'receita'|'despesa', valor, data, raiz }.
 * `alvos`: os ids das movimentações a tentar (o arquivo importado, o filtro).
 * `titulos`: os em aberto, cada um { id, tipo, esperado, raiz, vencimento, nome }
 *   — `raiz` vazia quando a empresa do título não é conhecida.
 *
 * Devolve { pares: [{ movimentacaoId, tituloId }], motivos: { [movimentacaoId]: texto },
 * sugestoes: [{ movimentacaoId, tituloId }] }.
 *
 * AS SUGESTÕES (04/11/2026; desde 05/11/2026, sem o nome do fornecedor): o
 * título ÚNICO da empresa com aquele valor (e a movimentação única com ele) que
 * vence no mesmo mês, mas não na data — pago antes do vencimento, ou o
 * vencimento do sábado que foi para a segunda. Não são conciliadas: a tela as
 * mostra para um clique de confirmação. Título sugerido para duas
 * movimentações, ou já escolhido por um par, não é sugerido.
 */
function paresAutomaticos({ movimentacoes = [], alvos = null, titulos = [] }) {
  const chave = (tipo, raiz, valor) => `${tipo}|${raiz}|${centavos(valor)}`;
  // Título sem empresa conhecida pode ser de qualquer uma: entra na contagem de
  // todas, e nunca é o par (a empresa tem de bater).
  const titulosPorValor = new Map();
  const semEmpresaPorValor = new Map();
  const juntar = (mapa, k, t) => {
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(t);
  };
  titulos.forEach((t) => {
    if (!(centavos(t.esperado) > 0)) return;
    if (t.raiz) juntar(titulosPorValor, chave(t.tipo, t.raiz, t.esperado), t);
    else juntar(semEmpresaPorValor, `${t.tipo}|${centavos(t.esperado)}`, t);
  });
  const movimentacoesPorValor = new Map();
  movimentacoes.forEach((m) => {
    if (!m.raiz) return;
    const k = chave(m.tipo, m.raiz, m.valor);
    movimentacoesPorValor.set(k, (movimentacoesPorValor.get(k) || 0) + 1);
  });

  // Todas as não conciliadas são analisadas, não só os alvos: duas que
  // escolhem a mesma parcela (uma delas fora do arquivo importado) não ficam
  // com nenhuma.
  const tentar = alvos ? new Set(alvos) : null;
  const propostas = [];
  const motivos = {};
  const sugeridas = [];
  movimentacoes.forEach((m) => {
    if (!m.raiz) { motivos[m.id] = 'a conta do extrato não tem empresa conhecida'; return; }
    const k = chave(m.tipo, m.raiz, m.valor);
    const candidatos = titulosPorValor.get(k) || [];
    const semEmpresa = semEmpresaPorValor.get(`${m.tipo}|${centavos(m.valor)}`) || [];
    if (!candidatos.length) { motivos[m.id] = semEmpresa.length ? 'o título com esse valor não tem empresa' : 'nenhum título em aberto da empresa com esse valor'; return; }
    if (candidatos.length + semEmpresa.length > 1) {
      const { titulo, motivo } = parcelaDoMes(m, candidatos, semEmpresa);
      if (titulo) propostas.push({ movimentacaoId: m.id, tituloId: titulo.id });
      else motivos[m.id] = motivo;
      return;
    }
    if (movimentacoesPorValor.get(k) > 1) { motivos[m.id] = 'mais de uma movimentação com esse valor'; return; }
    const [titulo] = candidatos;
    if (!dataBate(m.data, titulo.vencimento)) {
      motivos[m.id] = 'a data não bate com o vencimento';
      // No mesmo mês, vira sugestão: alguém confirma.
      if (mesDe(m.data) === mesDe(titulo.vencimento)) sugeridas.push({ movimentacaoId: m.id, tituloId: titulo.id });
      return;
    }
    propostas.push({ movimentacaoId: m.id, tituloId: titulo.id });
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

module.exports = { centavos, raizDoCnpj, dataBate, paresAutomaticos };
