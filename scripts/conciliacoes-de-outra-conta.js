#!/usr/bin/env node
// AS CONCILIAÇÕES AUTOMÁTICAS FEITAS COM TÍTULO DE OUTRA CONTA (10/11/2026).
//
// Pedido do usuário: "o sistema está conciliando contas bancárias erradas".
// De 05/11 a 10/11/2026 a automática comparava a EMPRESA da conta do extrato
// com a do título, e uma empresa tem várias contas: o título do Itaú podia se
// baixar pelo extrato do Banco do Brasil. A regra nova (conta bancária,
// fornecedor, valor e data) não faz mais isso, mas o que já foi conciliado
// continua conciliado. Este script SÓ LISTA — não muda nada. Cada linha se
// desfaz pela tela (Financeiro > Extrato > Desconciliar), que tira a baixa.
//
//   node scripts/conciliacoes-de-outra-conta.js            (no VPS, na pasta do sistema)
//   node scripts/conciliacoes-de-outra-conta.js --csv > conciliacoes-erradas.csv
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { consultar, fecharPool } = require('../lib/db/conexao');

const comoCsv = process.argv.includes('--csv');
const DATA_FILE = path.join(__dirname, '..', 'data', 'db.json');

(async () => {
  try {
    const dados = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const automaticas = (dados.bankTransactions || []).filter((tx) => tx.status === 'conciliado' && tx.conciliadoAutomaticamente);
    const titulosDe = (tx) => (Array.isArray(tx.conciliacoes) && tx.conciliacoes.length
      ? tx.conciliacoes.map((c) => c.entryId)
      : [tx.matchedEntryId]).filter(Boolean);
    const ids = [...new Set(automaticas.flatMap(titulosDe))];
    const titulos = new Map();
    if (ids.length) {
      const { rows } = await consultar(
        'select id, code, description, bank_account_id, client_supplier_name from financial_entries where id = any($1)', [ids]);
      rows.forEach((r) => titulos.set(r.id, r));
    }
    const { rows: contas } = await consultar('select id, name from bank_accounts');
    const nomeDaConta = new Map(contas.map((c) => [c.id, c.name]));
    const conta = (id) => (id ? nomeDaConta.get(id) || id : '(sem conta)');

    const erradas = [];
    automaticas.forEach((tx) => {
      titulosDe(tx).forEach((entryId) => {
        const t = titulos.get(entryId);
        const contaDoTitulo = t ? t.bank_account_id || '' : '';
        if (t && contaDoTitulo === String(tx.bankAccountId || '')) return;
        erradas.push({
          data: tx.date,
          valor: Number(tx.amount || 0).toFixed(2).replace('.', ','),
          tipo: tx.type === 'entrada' ? 'entrada' : 'saída',
          extrato: String(tx.description || '').replace(/\s+/g, ' ').trim(),
          contaDoExtrato: conta(tx.bankAccountId),
          titulo: t ? `${t.code ? `${t.code} ` : ''}${t.description || ''}`.trim() : `(título ${entryId} não encontrado)`,
          contaDoTitulo: t ? conta(contaDoTitulo) : '-',
          movimentacaoId: tx.id
        });
      });
    });
    erradas.sort((a, b) => String(a.data).localeCompare(String(b.data)));

    if (comoCsv) {
      const campos = ['data', 'valor', 'tipo', 'extrato', 'contaDoExtrato', 'titulo', 'contaDoTitulo', 'movimentacaoId'];
      const celula = (v) => `"${String(v).replace(/"/g, '""')}"`;
      console.log(campos.join(';'));
      erradas.forEach((e) => console.log(campos.map((c) => celula(e[c])).join(';')));
      return;
    }
    console.log(`Conciliações automáticas no extrato: ${automaticas.length}`);
    console.log(`Com título de outra conta (ou sem conta): ${erradas.length}\n`);
    erradas.forEach((e) => {
      console.log(`${e.data}  R$ ${e.valor}  ${e.tipo}  ${e.extrato}`);
      console.log(`    extrato: ${e.contaDoExtrato}   título: ${e.titulo}   conta do título: ${e.contaDoTitulo}`);
    });
  } finally {
    await fecharPool();
  }
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
