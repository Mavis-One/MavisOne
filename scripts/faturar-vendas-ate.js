#!/usr/bin/env node
/**
 * MARCA COMO FATURADAS AS VENDAS ATÉ UMA DATA (14/10/2026).
 *
 * Pedido do usuário: "todos os pedidos e orçamentos do dia 10/10 e anteriores
 * como pedidos faturados". Decidido com ele:
 *
 *   - SÓ O STATUS. Nada de baixa de estoque nem conta a receber: o estoque foi
 *     carregado do Viper e as contas vieram da planilha — faturar de verdade
 *     baixaria e cobraria em dobro. stock_applied/finance_applied ficam como
 *     estão, e é isso que faz um cancelamento futuro não devolver estoque que
 *     nunca saiu por aqui.
 *   - ORÇAMENTO VIRA PEDIDO FATURADO, do mesmo jeito que a tela converte
 *     (server.js, atualização do registro de venda): mesmo id e mesmo código
 *     gravados em `orders`, e depois apagados de `quotes`.
 *   - Cancelado continua cancelado; faturado já está.
 *
 * A guarda de transição do banco (orders_status_guarda) recusa
 * "aprovado sem faturamento -> faturado"; ela é desligada SÓ dentro da
 * transação deste script e religada antes do COMMIT.
 *
 * Uso (na pasta do sistema, com o .env do banco):
 *   node scripts/faturar-vendas-ate.js --ate 2026-10-10            simula
 *   node scripts/faturar-vendas-ate.js --ate 2026-10-10 --aplicar  grava
 *
 * Ao gravar, salva em logs/ um JSON com o status anterior de cada pedido e os
 * orçamentos inteiros, para desfazer se for preciso.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { consultar, emTransacao, fecharPool } = require('../lib/db/conexao');

const argumento = (nome) => { const i = process.argv.indexOf('--' + nome); return i >= 0 ? process.argv[i + 1] : undefined; };
const ate = argumento('ate');
const aplicar = process.argv.includes('--aplicar');
const FATURADO = 'pedido-faturado';
const NAO_MEXER = ['pedido-faturado', 'pedido-cancelado'];
const MARCA = 'Faturado em lote (vendas até ' + (ate || '') + ')';

(async () => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ate || ''))) {
    console.error('Uso: node scripts/faturar-vendas-ate.js --ate AAAA-MM-DD [--aplicar]');
    process.exit(1);
  }

  const pedidos = await consultar(
    `select id, code, date::text as date, status from orders
      where date <= $1::date and status <> all($2::text[]) order by date, code`, [ate, NAO_MEXER]);
  const orcamentos = await consultar(
    `select * from quotes where date <= $1::date order by date, code`, [ate]);

  const porStatus = {};
  pedidos.rows.forEach((p) => { porStatus[p.status] = (porStatus[p.status] || 0) + 1; });
  console.log(`Vendas até ${ate.split('-').reverse().join('/')}:`);
  console.log(`  pedidos que viram faturados ..... ${pedidos.rows.length}`);
  Object.entries(porStatus).sort((a, b) => b[1] - a[1]).forEach(([s, n]) => console.log(`      ${s.padEnd(34, '.')} ${n}`));
  console.log(`  orçamentos que viram pedido faturado ${orcamentos.rows.length}`);
  if (orcamentos.rows.length) {
    console.log(`      do ${orcamentos.rows[0].code} (${String(orcamentos.rows[0].date).slice(0, 10)}) ao ${orcamentos.rows[orcamentos.rows.length - 1].code}`);
  }
  console.log('  estoque e financeiro .............. não mexe');

  if (!aplicar) {
    console.log('\nSimulação. Para gravar, rode de novo com --aplicar.');
    await fecharPool();
    return;
  }

  // As colunas que as duas tabelas têm: o orçamento não tem as da NF-e e da
  // dispensa de documento fiscal, que nascem vazias no pedido.
  const colunas = (await consultar(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'quotes'
      intersect
     select column_name from information_schema.columns where table_schema = 'public' and table_name = 'orders'`
  )).rows.map((l) => l.column_name).filter((c) => !['type', 'status', 'updated_at', 'updated_by_name'].includes(c));
  const lista = colunas.map((c) => `"${c}"`).join(', ');

  const resultado = await emTransacao(async (cliente) => {
    await cliente.query('alter table orders disable trigger orders_status_guarda');
    const ids = pedidos.rows.map((p) => p.id);
    const atualizados = ids.length ? await cliente.query(
      `update orders set status = $2, updated_at = now(), updated_by_name = $3
        where id = any($1::text[]) and status <> all($4::text[])`, [ids, FATURADO, MARCA, NAO_MEXER]) : { rowCount: 0 };
    const idsOrc = orcamentos.rows.map((q) => q.id);
    const convertidos = idsOrc.length ? await cliente.query(
      `insert into orders (${lista}, type, status, updated_at, updated_by_name)
       select ${lista}, 'order', $2, now(), $3 from quotes where id = any($1::text[])`, [idsOrc, FATURADO, MARCA]) : { rowCount: 0 };
    const apagados = idsOrc.length ? await cliente.query('delete from quotes where id = any($1::text[])', [idsOrc]) : { rowCount: 0 };
    await cliente.query('alter table orders enable trigger orders_status_guarda');
    if (convertidos.rowCount !== apagados.rowCount) {
      throw new Error(`Convertidos ${convertidos.rowCount} e apagados ${apagados.rowCount}: nada foi gravado.`);
    }
    return { atualizados: atualizados.rowCount, convertidos: convertidos.rowCount };
  });

  const pasta = path.join(__dirname, '..', 'logs');
  fs.mkdirSync(pasta, { recursive: true });
  const arquivo = path.join(pasta, `faturados-ate-${ate}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(arquivo, JSON.stringify({ ate, em: new Date().toISOString(), pedidos: pedidos.rows, orcamentos: orcamentos.rows }, null, 2));

  console.log(`\nGravado: ${resultado.atualizados} pedidos faturados e ${resultado.convertidos} orçamentos convertidos em pedido faturado.`);
  console.log(`Para desfazer, o estado anterior está em ${path.relative(process.cwd(), arquivo)}`);
  await fecharPool();
})().catch(async (erro) => {
  console.error('ERRO:', erro.message);
  if (/must be owner|permission denied/i.test(erro.message)) {
    console.error('O usuário do banco precisa ser dono da tabela orders para desligar a guarda dentro da transação.');
  }
  try { await fecharPool(); } catch { /* já fechado */ }
  process.exit(1);
});
