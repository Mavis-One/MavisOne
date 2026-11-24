/**
 * POR QUE ESTA MOVIMENTAÇÃO DO EXTRATO NÃO SE CONCILIOU SOZINHA? (24/11/2026)
 *
 * Pedido do usuário: "um titulo especifico não puxou pode verificar? o valor
 * dele é de 1281" (o PIX ENVIADO de 13/11 no extrato do Itaú).
 *
 * SÓ LÊ. Acha no extrato as movimentações daquele valor e, nos títulos, os
 * daquele valor (o valor do título, o líquido do cartão ou o que falta pagar),
 * e diz, par a par, cada regra da conciliação automática
 * (lib/conciliacao-automatica.js — a MESMA que o servidor usa): tipo, em
 * aberto, valor, conta bancária, fornecedor/cliente (nome ou CPF/CNPJ na
 * descrição) e data. No fim, o motivo que a regra dá para cada movimentação.
 *
 * Uso, no VPS, como mavis, em /var/www/mavisone:
 *   node scripts/por-que-nao-conciliou.js --valor 1281
 *   node scripts/por-que-nao-conciliou.js --valor 1281,00 --data 2026-11-13
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { consultar, fecharPool } = require('../lib/db/conexao');
const regra = require('../lib/conciliacao-automatica');
const lancamentoCodigo = require('../public/modules/shared/lancamento_codigo');

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? String(process.argv[i + 1] || '') : '';
}

/** "1281", "1281,00", "1.281,00", "1281.00" -> 1281 */
function lerValor(texto) {
  let t = String(texto || '').trim().replace(/^R\$\s*/i, '');
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '-');
const sim = (ok) => (ok ? 'OK ' : 'NÃO');
const codigoDo = (t) => (t && (lancamentoCodigo.formatar(t.code) || t.id)) || '?';
const tipoDoTitulo = (tipo) => {
  const t = String(tipo || '').toLowerCase();
  if (t === 'sale' || t === 'receita') return 'receita';
  if (t === 'purchase' || t === 'despesa') return 'despesa';
  return t || 'outro';
};

async function main() {
  const valor = lerValor(argumento('valor'));
  const data = argumento('data');
  if (!valor) {
    console.log('Uso: node scripts/por-que-nao-conciliou.js --valor 1281 [--data AAAA-MM-DD]');
    process.exitCode = 1;
    return;
  }
  const alvo = regra.centavos(valor);

  // O extrato mora no db.json (data/db.json), como no servidor.
  const banco = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
  const doValor = (banco.bankTransactions || []).filter((tx) => regra.centavos(tx.amount) === alvo && (!data || tx.date === data));

  const contas = new Map((await consultar('select id, name from bank_accounts')).rows.map((c) => [c.id, c.name]));
  const nomeDaConta = (id) => (id ? `${contas.get(id) || id}` : '(sem conta)');

  // Os títulos: o valor, o líquido do cartão, ou o que falta pagar.
  const { rows: titulos } = await consultar(`
    select e.*, coalesce(p.pago, 0)::float as pago
      from financial_entries e
      left join (select entry_id, sum(amount) as pago from financial_payments group by entry_id) p on p.entry_id = e.id
     where round(e.amount * 100) = $1
        or round(coalesce(e.net_amount, 0) * 100) = $1
        or round((e.amount - coalesce(p.pago, 0)) * 100) = $1
     order by e.due_date desc`, [alvo]);

  // Nome e CPF/CNPJ do cadastro de cada título (o que a regra compara).
  const ids = [...new Set(titulos.map((t) => t.client_supplier_id).filter(Boolean))];
  const cadastro = new Map();
  if (ids.length) {
    for (const tabela of ['people', 'cnpjs']) {
      (await consultar(`select id, name, document from ${tabela} where id = any($1::text[])`, [ids])).rows
        .forEach((c) => cadastro.set(c.id, c));
    }
  }
  const pessoaDo = (t) => {
    const c = t.client_supplier_id ? cadastro.get(t.client_supplier_id) : null;
    return { nome: (c && c.name) || t.client_supplier_name || '', documento: String((c && c.document) || '').replace(/\D/g, '') };
  };
  const esperadoDo = (t) => {
    const combinado = Number(t.juros_a_baixar || 0) + Number(t.multa_a_baixar || 0) - Number(t.desconto_a_baixar || 0);
    const restante = Math.round((Number(t.amount || 0) - Number(t.pago || 0)) * 100) / 100;
    if (Math.abs(combinado) > 0.005) return Math.round((restante + combinado) * 100) / 100;
    if (Number(t.pago || 0) > 0.005) return restante;
    return Number(t.net_amount || 0) > 0 ? Number(t.net_amount) : restante;
  };

  console.log(`Valor ${reais(valor)}${data ? ` em ${dataBr(data)}` : ''}: ${doValor.length} movimentação(ões) no extrato, ${titulos.length} título(s).`);
  if (!doValor.length) console.log('  Nenhuma movimentação no extrato com esse valor: o arquivo foi importado na conta certa?');

  const abertos = titulos.filter((t) => ['pending', 'parcial'].includes(String(t.status || '').toLowerCase()));
  const titulosDaRegra = abertos.map((t) => ({
    id: t.id, tipo: tipoDoTitulo(t.type), esperado: esperadoDo(t), conta: String(t.bank_account_id || ''),
    vencimento: String(t.due_date || '').slice(0, 10), ...pessoaDo(t)
  }));

  for (const tx of doValor) {
    const tipoTx = tx.type === 'entrada' ? 'receita' : 'despesa';
    const texto = [tx.description, tx.counterpartyName, tx.merchantName].filter(Boolean).join(' ');
    const documentos = [tx.counterpartyDocument, tx.merchantDocument].filter(Boolean);
    console.log(`\n== EXTRATO ${dataBr(tx.date)} · ${tx.type === 'entrada' ? 'entrada' : 'saída'} ${reais(tx.amount)} · ${nomeDaConta(tx.bankAccountId)} · ${tx.status}`);
    console.log(`   "${tx.description}"`);
    if (tx.status === 'conciliado') {
      const com = titulos.find((t) => t.id === tx.matchedEntryId);
      console.log(`   Já está conciliada${com ? ` com ${codigoDo(com)} (${com.description || ''})` : ` (título ${tx.matchedEntryId || '?'})`}.`);
    }
    if (tx.sugestao) console.log(`   Sugerida para confirmar: ${tx.sugestao.descricao || tx.sugestao.entryId}.`);

    if (!titulos.length) console.log('   Nenhum título com esse valor (nem líquido, nem saldo a pagar): o título existe com outro valor?');
    for (const t of titulos) {
      const p = pessoaDo(t);
      const esperado = esperadoDo(t);
      const status = String(t.status || '').toLowerCase();
      const checks = [
        [`tipo ${tipoDoTitulo(t.type)} (a ${tx.type === 'entrada' ? 'entrada' : 'saída'} pede ${tipoTx})`, tipoDoTitulo(t.type) === tipoTx],
        [`em aberto (status ${t.status})`, ['pending', 'parcial'].includes(status)],
        [`valor esperado no extrato ${reais(esperado)}`, regra.centavos(esperado) === regra.centavos(tx.amount)],
        [`conta do título: ${nomeDaConta(t.bank_account_id)}`, Boolean(t.bank_account_id) && t.bank_account_id === tx.bankAccountId],
        [`fornecedor/cliente: ${p.nome || '(sem nome)'}${p.documento ? ` · ${p.documento}` : ' · sem CPF/CNPJ no cadastro'} (palavras exigidas: ${regra.palavrasDoNome(p.nome).slice(0, 2).join(' + ') || 'nenhuma'})`,
          regra.fornecedorBate({ texto, documentos, nome: p.nome, documento: p.documento })],
        [`vencimento ${dataBr(t.due_date)} (o extrato pode vir do vencimento até o dia útil seguinte)`, regra.dataBate(tx.date, t.due_date)]
      ];
      console.log(`   -- ${codigoDo(t)} · ${t.description || ''}`);
      checks.forEach(([texto2, ok]) => console.log(`      ${sim(ok)} ${texto2}`));
    }

    // O motivo que a regra dá, com todos os títulos em aberto desse valor e as
    // movimentações não conciliadas desse valor (a unicidade olha todas).
    if (tx.status === 'nao_conciliado') {
      const movimentacoes = (banco.bankTransactions || [])
        .filter((m) => m.status === 'nao_conciliado' && regra.centavos(m.amount) === alvo)
        .map((m) => ({
          id: m.id, tipo: m.type === 'entrada' ? 'receita' : 'despesa', valor: Number(m.amount || 0), data: m.date,
          conta: String(m.bankAccountId || ''), texto: [m.description, m.counterpartyName, m.merchantName].filter(Boolean).join(' '),
          documentos: [m.counterpartyDocument, m.merchantDocument].filter(Boolean)
        }));
      const r = regra.paresAutomaticos({ movimentacoes, alvos: [tx.id], titulos: titulosDaRegra });
      const par = r.pares[0];
      const sugestao = r.sugestoes[0];
      console.log(`   => ${par ? `CONCILIARIA sozinha com ${codigoDo(titulos.find((t) => t.id === par.tituloId))} — rode "Conciliar automático" no extrato.`
        : sugestao ? `viraria SUGESTÃO de 1 clique (${codigoDo(titulos.find((t) => t.id === sugestao.tituloId))}).`
          : `não concilia sozinha: ${r.motivos[tx.id] || 'sem motivo registrado'}.`}`);
    }
  }
}

main()
  .catch((erro) => { console.error(erro && erro.stack ? erro.stack : erro); process.exitCode = 1; })
  .finally(() => fecharPool().catch(() => {}));
