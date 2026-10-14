// CONTAS A PAGAR E A RECEBER DO VIPER — o que a API confere e grava (13/10/2026).
// O que entra e por quê: lib/importacao-contas-viper.js.
//
// Grava pelo mesmo createFinancialEntry dos lançamentos da tela: o número LF
// sai da sequence e o documento do Viper fica depois dele ("LF0042 ·
// COMPRA-2901/1") — é por ele que a reimportação reconhece o que já entrou.
//
// ESPELHO (14/10/2026): além dos títulos novos, o que já existe é comparado
// com a planilha — baixa (createFinancialPayment, como a baixa da tela) ou
// ajuste de valor. Ver acaoDoEspelho.
'use strict';

const { consultar } = require('./conexao');
const financeiro = require('./financeiro');
const {
  planejar, comoLancamento, nomeComparavel, casarQuitados, acaoDoEspelho, criarCasador
} = require('../importacao-contas-viper');

async function carregarExistentes() {
  const [{ rows }, { rows: baixas }] = await Promise.all([
    consultar(
      "select id, type, document, client_supplier_name, amount, due_date::text as due_date, status, note, bank_account_id from financial_entries where status <> 'cancelado' order by id"
    ),
    consultar(
      // As baixas PRESUMIDAS da carga de 11/09 são reconhecidas pelo texto que
      // aquela carga gravou. Ver acaoDoEspelho.
      "select entry_id, sum(amount) as pago, sum(coalesce(interest, 0) + coalesce(fine, 0) - coalesce(discount, 0)) as ajuste, count(*) as n, "
        + "coalesce(array_agg(id) filter (where note like 'Baixa importada do ViperERP (presumida%'), '{}') as presumidas "
        + 'from financial_payments group by entry_id'
    )
  ]);
  const porLancamento = new Map(baixas.map((b) => [b.entry_id, {
    pago: Number(b.pago || 0), ajuste: Number(b.ajuste || 0), n: Number(b.n || 0), presumidas: b.presumidas || []
  }]));
  return rows.map((r) => {
    const b = porLancamento.get(r.id) || { pago: 0, ajuste: 0, n: 0, presumidas: [] };
    const amount = Number(r.amount || 0);
    const pago = String(r.status || '').toLowerCase() === 'paid';
    return {
      id: r.id, type: r.type, document: r.document || '', clientSupplierName: r.client_supplier_name || '',
      amount, dueDate: r.due_date, status: r.status, note: r.note || '', bankAccountId: r.bank_account_id || '',
      pagoTotal: b.pago,
      devido: amount + b.ajuste,
      emAberto: pago ? 0 : Math.max(0, Math.round((amount + b.ajuste - b.pago) * 100) / 100),
      temBaixas: b.n > 0,
      nBaixas: b.n,
      baixasPresumidas: b.presumidas.length,
      idsPresumidas: b.presumidas
    };
  });
}

/** Pessoa do Cadastros pelo nome — só quando o nome aponta para UMA pessoa. */
async function indiceDePessoas() {
  const [pessoas, empresas] = await Promise.all([
    consultar('select id, name from people').then((r) => r.rows).catch(() => []),
    consultar('select id, name from cnpjs').then((r) => r.rows).catch(() => [])
  ]);
  const porNome = new Map();
  for (const p of [...pessoas, ...empresas]) {
    const k = nomeComparavel(p.name);
    if (!k) continue;
    porNome.set(k, [...(porNome.get(k) || []), p.id]);
  }
  return (nome) => {
    const ids = porNome.get(nomeComparavel(nome)) || [];
    return ids.length === 1 ? ids[0] : '';
  };
}

async function indiceDeEstabelecimentos() {
  const { rows } = await consultar('select id, cnpj from estabelecimento').catch(() => ({ rows: [] }));
  const porCnpj = new Map(rows.map((r) => [String(r.cnpj || '').replace(/\D/g, ''), r.id]));
  return (cnpj) => porCnpj.get(String(cnpj || '').replace(/\D/g, '')) || '';
}

const somar = (lista, campo = 'aberto') => Math.round(lista.reduce((s, t) => s + Number(t[campo] || 0), 0) * 100) / 100;
const hojeEmBrasilia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const real = (n) => Number(n || 0).toFixed(2).replace('.', ',');

/**
 * @param titulos   saída de lerPlanilha().titulos (pagar e receber juntos)
 * @param opcoes    { simular, usuario, quitados } — `quitados`: lerPlanilha().quitados
 */
async function gravarContas(titulos, { simular = false, usuario = null, quitados = [] } = {}) {
  if (!Array.isArray(titulos) || !titulos.length) {
    const erro = new Error('Nenhum título recebido.');
    erro.status = 400;
    throw erro;
  }
  const [existentes, pessoaDe, estabelecimentoDe] = await Promise.all([carregarExistentes(), indiceDePessoas(), indiceDeEstabelecimentos()]);
  const porId = new Map(existentes.map((e) => [e.id, e]));
  const listaDeQuitados = Array.isArray(quitados) ? quitados : [];
  // O casador conhece a planilha inteira (em aberto + quitados): é assim que
  // sabe quando um documento se repete. Ver criarCasador.
  const { novos, jaExistem, casar } = planejar(titulos, existentes, criarCasador(existentes, [...titulos, ...listaDeQuitados]));
  const quitadosCasados = casarQuitados(listaDeQuitados, casar);

  // O espelho: o que fazer com cada lançamento que já existe.
  const baixas = [];
  const ajustes = [];
  const reaberturas = [];
  const divergencias = [];
  for (const t of [...jaExistem, ...quitadosCasados]) {
    const e = porId.get(t.existenteId);
    if (!e) continue;
    const plano = acaoDoEspelho(t, e);
    const linha = { tipo: t.tipo, documento: t.documento, pessoa: t.pessoa, vencimento: t.vencimento, empresa: t.empresa, lancamentoId: e.id, emAbertoAqui: e.emAberto, emAbertoViper: t.aberto };
    if (plano.acao === 'reabrir') {
      // Desfaz a baixa presumida; o que vem depois (baixa parcial ou ajuste)
      // entra nas listas de sempre, já contando com o título reaberto.
      reaberturas.push({ ...linha, valor: e.pagoTotal });
      const depois = plano.depois || { acao: 'nada' };
      if (depois.acao === 'baixar') baixas.push({ ...linha, valor: depois.valor, total: depois.total, aposReabrir: true });
      else if (depois.acao === 'ajustar') ajustes.push({ ...linha, de: e.amount, para: depois.novoValor, aposReabrir: true });
      continue;
    }
    if (plano.acao === 'baixar') baixas.push({ ...linha, valor: plano.valor, total: plano.total });
    else if (plano.acao === 'ajustar') ajustes.push({ ...linha, de: e.amount, para: plano.novoValor });
    else if (plano.acao === 'divergencia') divergencias.push({ ...linha, motivo: plano.motivo });
  }

  const resumo = (tipo) => {
    const n = novos.filter((t) => t.tipo === tipo);
    const b = baixas.filter((t) => t.tipo === tipo);
    return {
      novos: n.length,
      valorNovos: somar(n),
      jaExistiam: jaExistem.filter((t) => t.tipo === tipo).length,
      baixas: b.length,
      valorBaixas: somar(b, 'valor'),
      ajustes: ajustes.filter((t) => t.tipo === tipo).length,
      reaberturas: reaberturas.filter((t) => t.tipo === tipo).length,
      valorReaberto: somar(reaberturas.filter((t) => t.tipo === tipo), 'emAbertoViper'),
      divergencias: divergencias.filter((t) => t.tipo === tipo).length
    };
  };
  const resultado = {
    simulado: simular,
    pagar: resumo('DESPESA'),
    receber: resumo('RECEITA'),
    semPessoaNoCadastro: novos.filter((t) => !pessoaDe(t.pessoa)).length,
    semEmpresa: novos.filter((t) => !estabelecimentoDe(t.cnpjEmpresa)).map((t) => t.empresa).filter((v, i, a) => a.indexOf(v) === i),
    novos: novos.map((t) => ({ tipo: t.tipo, documento: t.documento, pessoa: t.pessoa, vencimento: t.vencimento, aberto: t.aberto, empresa: t.empresa })),
    baixas,
    ajustes,
    reaberturas,
    divergencias,
    criados: 0,
    reabertos: 0,
    baixados: 0,
    ajustados: 0,
    falhas: []
  };
  if (simular) return resultado;

  for (const t of novos) {
    try {
      await financeiro.createFinancialEntry({
        ...comoLancamento(t, { estabelecimentoId: estabelecimentoDe(t.cnpjEmpresa), pessoaId: pessoaDe(t.pessoa) }),
        createdBy: usuario ? usuario.id : null,
        createdByName: usuario ? usuario.name : 'Importação Viper'
      });
      resultado.criados += 1;
    } catch (erro) {
      // Um título ruim não derruba os outros; reimportar tenta só os que
      // faltaram (os gravados são reconhecidos pelo documento).
      resultado.falhas.push({ documento: t.documento, motivo: erro.message || 'falhou' });
    }
  }

  // REABERTURAS primeiro: as baixas e ajustes que vêm depois contam com o
  // título já sem a baixa presumida.
  const reabertosOk = new Set();
  for (const r of reaberturas) {
    try {
      const e = porId.get(r.lancamentoId);
      for (const idBaixa of e.idsPresumidas) await financeiro.deleteFinancialPayment(idBaixa);
      const nota = [e.note, `Reaberto pela importação de ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}: a baixa presumida da carga de 11/09 foi desfeita — em aberto no Viper`].filter(Boolean).join(' | ');
      await financeiro.updateFinancialEntry(e.id, { status: 'pending', note: nota });
      e.pagoTotal = 0;
      e.devido = e.amount;
      e.note = nota;
      reabertosOk.add(e.id);
      resultado.reabertos += 1;
    } catch (erro) {
      resultado.falhas.push({ documento: r.documento, motivo: `reabrir: ${erro.message || 'falhou'}` });
    }
  }

  // BAIXAS: o pagamento foi feito no Viper. A planilha não traz a data nem a
  // conta: sai na data do vencimento (ou hoje, se ele ainda não chegou) e sem
  // conta — não mexe no saldo de banco nenhum.
  const hoje = hojeEmBrasilia();
  const quando = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  for (const b of baixas) {
    if (b.aposReabrir && !reabertosOk.has(b.lancamentoId)) continue;
    try {
      const e = porId.get(b.lancamentoId);
      await financeiro.createFinancialPayment({
        entryId: e.id,
        amount: b.valor,
        date: b.vencimento && b.vencimento < hoje ? b.vencimento : hoje,
        bankAccountId: e.bankAccountId || '',
        interest: 0,
        fine: 0,
        discount: 0,
        note: `Quitado no Viper (importação de ${quando}) — a planilha não traz data nem conta do pagamento`,
        createdBy: usuario ? usuario.id : null,
        createdByName: usuario ? usuario.name : 'Importação Viper'
      });
      const pagoAgora = e.pagoTotal + b.valor;
      await financeiro.updateFinancialEntry(e.id, { status: pagoAgora + 0.005 >= e.devido ? 'paid' : 'parcial' });
      resultado.baixados += 1;
    } catch (erro) {
      resultado.falhas.push({ documento: b.documento, motivo: `baixa: ${erro.message || 'falhou'}` });
    }
  }

  // AJUSTES: o valor do título mudou no Viper e o lançamento daqui não tem baixa.
  for (const a of ajustes) {
    if (a.aposReabrir && !reabertosOk.has(a.lancamentoId)) continue;
    try {
      const e = porId.get(a.lancamentoId);
      const nota = [e.note, `Valor ajustado ao Viper em ${quando}: R$ ${real(a.de)} → R$ ${real(a.para)}`].filter(Boolean).join(' | ');
      await financeiro.updateFinancialEntry(e.id, { amount: a.para, note: nota });
      resultado.ajustados += 1;
    } catch (erro) {
      resultado.falhas.push({ documento: a.documento, motivo: `ajuste: ${erro.message || 'falhou'}` });
    }
  }
  return resultado;
}

module.exports = { gravarContas };
