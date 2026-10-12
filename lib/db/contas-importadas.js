// CONTAS A PAGAR E A RECEBER DO VIPER — o que a API confere e grava (13/10/2026).
// O que entra e por quê: lib/importacao-contas-viper.js.
//
// Grava pelo mesmo createFinancialEntry dos lançamentos da tela: o número LF
// sai da sequence e o documento do Viper fica depois dele ("LF0042 ·
// COMPRA-2901/1") — é por ele que a reimportação reconhece o que já entrou.
'use strict';

const { consultar } = require('./conexao');
const financeiro = require('./financeiro');
const { planejar, comoLancamento, nomeComparavel } = require('../importacao-contas-viper');

async function carregarExistentes() {
  const { rows } = await consultar(
    "select id, type, document, client_supplier_name, amount, due_date::text as due_date from financial_entries where status <> 'cancelado'"
  );
  return rows.map((r) => ({
    id: r.id, type: r.type, document: r.document || '', clientSupplierName: r.client_supplier_name || '',
    amount: Number(r.amount || 0), dueDate: r.due_date
  }));
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

const somar = (lista) => Math.round(lista.reduce((s, t) => s + t.aberto, 0) * 100) / 100;

/**
 * @param titulos  saída de lerPlanilha().titulos (pagar e receber juntos)
 * @param opcoes   { simular, usuario }
 */
async function gravarContas(titulos, { simular = false, usuario = null } = {}) {
  if (!Array.isArray(titulos) || !titulos.length) {
    const erro = new Error('Nenhum título recebido.');
    erro.status = 400;
    throw erro;
  }
  const [existentes, pessoaDe, estabelecimentoDe] = await Promise.all([carregarExistentes(), indiceDePessoas(), indiceDeEstabelecimentos()]);
  const { novos, jaExistem } = planejar(titulos, existentes);
  const resumo = (tipo) => {
    const n = novos.filter((t) => t.tipo === tipo);
    return { novos: n.length, valorNovos: somar(n), jaExistiam: jaExistem.filter((t) => t.tipo === tipo).length };
  };
  const resultado = {
    simulado: simular,
    pagar: resumo('DESPESA'),
    receber: resumo('RECEITA'),
    semPessoaNoCadastro: novos.filter((t) => !pessoaDe(t.pessoa)).length,
    semEmpresa: novos.filter((t) => !estabelecimentoDe(t.cnpjEmpresa)).map((t) => t.empresa).filter((v, i, a) => a.indexOf(v) === i),
    novos: novos.map((t) => ({ tipo: t.tipo, documento: t.documento, pessoa: t.pessoa, vencimento: t.vencimento, aberto: t.aberto, empresa: t.empresa })),
    criados: 0,
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
  return resultado;
}

module.exports = { gravarContas };
