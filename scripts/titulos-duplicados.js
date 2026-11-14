#!/usr/bin/env node
// OS TÍTULOS EM DUPLICIDADE DE UM VENCIMENTO (14/11/2026).
//
// Pedido do usuário: "verifique e resolva! Preciso excluir os lançamentos em
// duplicidade para o dia 25/11". SÓ LISTA — não muda nada. Rodar no VPS, na
// pasta do sistema (é lá que está o banco que as pessoas usam):
//
//   node scripts/titulos-duplicados.js                      (vencimento 25/11/2026)
//   node scripts/titulos-duplicados.js --vencimento 2026-11-25
//   node scripts/titulos-duplicados.js --vencimento 2026-11-25 --csv > duplicados.csv
//
// O QUE É DUPLICADO AQUI. Mesmo tipo, mesmo valor, mesmo vencimento, mesmo
// fornecedor/cliente E a mesma nota. Valor e data sozinhos não bastam: no banco
// local, 32 títulos de R$ 31,18 vencem em 25/11, cada um de uma NF diferente.
// O número da nota sai de onde cada origem o guarda:
//   - entrada de NF-e do MavisONE: a nota da entrada (reference_id);
//   - importação do Viper (11/09): "NF DE ENTRADA de codigo X - Nº 9262";
//   - planilha do Viper (14/10): "... — NF 9262" (lib/titulos-do-viper.js).
// Título sem nota (luz, aluguel, recorrência) com o mesmo tipo, valor,
// vencimento, fornecedor e descrição também entra, como "mesma descrição".
//
// QUAL FICA. O sugerido para ficar é o que tem baixa; senão o da entrada de
// NF-e ou do pedido (é o que o sistema criou e liga ao documento); senão o mais
// antigo. Os outros são os candidatos a excluir — pela tela (Financeiro ›
// Lançamentos, buscar o código, Excluir), que solta o extrato, guarda a trilha
// e devolve o pedido quando for o caso.
require('dotenv').config({ quiet: true });
const { consultar, fecharPool } = require('../lib/db/conexao');
const viper = require('../lib/titulos-do-viper');
const lancamentoCodigo = require('../public/modules/shared/lancamento_codigo');

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};
const vencimento = arg('--vencimento', '2026-11-25');
const comoCsv = process.argv.includes('--csv');

(async () => {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) throw new Error('Use --vencimento AAAA-MM-DD');
    const { rows } = await consultar(`
      select f.id, f.code, f.type, f.amount::float as amount, f.due_date::text as due_date, f.description, f.note,
             f.document, f.status, f.reference_id, f.nfe_id, f.client_supplier_id, f.client_supplier_name,
             f.created_at, f.created_by_name,
             coalesce(p.document, c.document, '') as documento,
             e.numero as nota_da_entrada, e.emitente_documento,
             (select count(*)::int from financial_payments b where b.entry_id = f.id) as baixas,
             exists (select 1 from orders o where o.id = f.reference_id) as do_pedido
        from financial_entries f
        left join people p on p.id = f.client_supplier_id
        left join cnpjs c on c.id = f.client_supplier_id
        left join nfe_entrada e on e.id = f.reference_id
       where f.due_date = $1 and coalesce(f.status, '') <> 'cancelado'`, [vencimento]);

    const centavos = (v) => Math.round(Number(v || 0) * 100);
    const digitos = (v) => String(v || '').replace(/\D/g, '');
    const origem = (t) => (t.nota_da_entrada ? 'entrada de NF-e'
      : t.do_pedido ? 'pedido'
        : t.nfe_id ? 'NF-e emitida'
          : /^Importado do Viper/.test(String(t.note || '')) || /^Referente a NF DE ENTRADA/i.test(String(t.description || '')) ? 'importado do Viper'
            : 'manual');
    const numeroDaNota = (t) => String(t.nota_da_entrada || viper.numeroDaNotaNoTitulo(t.description, t.note) || '').replace(/^0+/, '');
    const quem = (t) => digitos(t.documento || t.emitente_documento) || viper.nomeComparavel(t.client_supplier_name) || '?';

    const grupos = new Map();
    const juntar = (chave, t) => {
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(t);
    };
    for (const t of rows) {
      const base = `${t.type}|${centavos(t.amount)}|${quem(t)}`;
      const nota = numeroDaNota(t);
      if (nota) juntar(`${base}|nota ${nota}`, t);
      else juntar(`${base}|descrição ${viper.nomeComparavel(t.description)}`, t);
    }
    const duplicados = [...grupos.entries()].filter(([, lista]) => lista.length > 1);

    // Qual fica: com baixa > da entrada/pedido/NF-e > o mais antigo.
    const peso = (t) => (t.baixas > 0 ? 0 : (['entrada de NF-e', 'pedido', 'NF-e emitida'].includes(origem(t)) ? 1 : 2));
    const linhas = [];
    for (const [chave, lista] of duplicados) {
      const ordem = lista.slice().sort((a, b) => peso(a) - peso(b) || String(a.created_at).localeCompare(String(b.created_at)));
      ordem.forEach((t, i) => linhas.push({
        grupo: chave.split('|').slice(3).join(' '),
        sugestao: i === 0 ? 'FICA' : 'excluir?',
        codigo: lancamentoCodigo.formatar(t.code),
        tipo: t.type,
        valor: Number(t.amount).toFixed(2).replace('.', ','),
        fornecedor: t.client_supplier_name || '-',
        origem: origem(t),
        baixas: t.baixas,
        status: t.status,
        criadoEm: String(t.created_at instanceof Date ? t.created_at.toISOString() : t.created_at || '').slice(0, 16).replace('T', ' '),
        por: t.created_by_name || '-',
        descricao: String(t.description || '').replace(/\s+/g, ' ').slice(0, 90)
      }));
    }

    if (comoCsv) {
      const campos = ['grupo', 'sugestao', 'codigo', 'tipo', 'valor', 'fornecedor', 'origem', 'baixas', 'status', 'criadoEm', 'por', 'descricao'];
      console.log(campos.join(';'));
      linhas.forEach((l) => console.log(campos.map((c) => `"${String(l[c]).replace(/"/g, '""')}"`).join(';')));
      return;
    }
    const excluir = linhas.filter((l) => l.sugestao !== 'FICA');
    console.log(`Vencimento ${vencimento.split('-').reverse().join('/')}: ${rows.length} título(s) valendo; ${duplicados.length} grupo(s) em duplicidade; ${excluir.length} candidato(s) a excluir.\n`);
    let grupoAtual = null;
    for (const l of linhas) {
      if (l.grupo !== grupoAtual) {
        grupoAtual = l.grupo;
        console.log(`== ${l.tipo} R$ ${l.valor} · ${l.fornecedor} · ${l.grupo}`);
      }
      console.log(`   ${l.sugestao.padEnd(8)} ${l.codigo}  ${l.origem.padEnd(18)} baixas ${l.baixas}  ${l.status.padEnd(8)} criado ${l.criadoEm} por ${l.por}  ${l.descricao}`);
    }
    if (excluir.length) console.log(`\nCódigos sugeridos para excluir: ${excluir.map((l) => l.codigo).join(', ')}`);
  } finally {
    await fecharPool();
  }
})().catch((erro) => {
  console.error(erro.message || erro);
  process.exit(1);
});
