#!/usr/bin/env node
/**
 * MOVE O RAZÃO DE ESTOQUE do data/db.json para o Postgres (fase AP).
 *
 *   node scripts/migrar-estoque-para-o-banco.js            (só mostra o que faria)
 *   node scripts/migrar-estoque-para-o-banco.js --confirmo (move de verdade)
 *
 * RODA UMA VEZ SÓ, e é idempotente por conferência: se as tabelas já tiverem
 * linha, ele para e diz — em vez de duplicar o razão, que é o estrago que não
 * dá para desfazer olhando.
 *
 * POR QUE ELE ESVAZIA O ARRAY NO db.json
 * --------------------------------------
 * Copiar sem cortar bifurca o razão. Basta UMA requisição ainda passar pelo
 * caminho antigo para o arquivo ganhar um movimento que o banco não tem — e a
 * partir daí existem dois saldos, os dois plausíveis, sem nada que diga qual
 * vale. O corte é parte da migração, não uma limpeza para depois.
 *
 * MAPEAMENTO POR NOME, NUNCA POR POSIÇÃO
 * --------------------------------------
 * Os 23 registros existentes têm TRÊS formatos diferentes, de épocas
 * diferentes: 16, 18 e 22 chaves, em ordens diferentes. Um script que montasse
 * a tupla pela ordem das chaves gravaria `note` na coluna de `document` em
 * parte dos registros — e ninguém olharia. Aqui cada campo é lido pelo nome, e
 * uma chave desconhecida ABORTA a migração em vez de ser ignorada em silêncio.
 */
require('dotenv').config();
const fs = require('fs');
const http = require('http');
const path = require('path');
const { consultar, emTransacao, fecharPool } = require('../lib/db/conexao');
const razao = require('../lib/db/estoque-razao');

const RAIZ = path.join(__dirname, '..');
const ESTADO = path.join(RAIZ, 'data', 'db.json');

// A união dos campos gravados pelos DOIS escritores do sistema
// (buildMovementRecord e registrarMovimentoEstoque). Chave fora desta lista
// aborta: o db.json acumulou formatos, e o que não está aqui é campo que
// ninguém sabe para onde vai.
const CAMPOS_MOVIMENTO = new Set([
  'id', 'code', 'type', 'date', 'productId', 'productName', 'depositId',
  'classId', 'classValueId', 'quantity', 'unitCost', 'categoryId', 'document',
  'note', 'transferId', 'origin', 'motivo', 'referenceType', 'referenceId',
  'createdBy', 'createdByName', 'createdAt'
]);
const CAMPOS_TRANSFERENCIA = new Set([
  'id', 'code', 'batchId', 'date', 'productId', 'originDepositId',
  'destinationDepositId', 'classId', 'classValueId', 'quantity', 'note',
  'movementOutId', 'movementInId', 'createdBy', 'createdByName', 'createdAt'
]);

const texto = (v) => (v === undefined || v === null ? '' : String(v));
const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** O saldo por produto+depósito, do jeito que o sistema calcula hoje. */
function saldos(movimentos) {
  const mapa = {};
  for (const m of movimentos) {
    const chave = `${m.productId}@${m.depositId || ''}`;
    mapa[chave] = (mapa[chave] || 0) + (String(m.type).toLowerCase() === 'saida' ? -1 : 1) * numero(m.quantity);
  }
  return mapa;
}

function sistemaNoAr(porta) {
  return new Promise((resolver) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: '/', method: 'HEAD', timeout: 1200 }, () => {
      req.destroy(); resolver(true);
    });
    req.on('error', () => resolver(false));
    req.on('timeout', () => { req.destroy(); resolver(false); });
    req.end();
  });
}

(async () => {
  const confirmado = process.argv.includes('--confirmo');
  const porta = Number(process.env.PORT) || 3000;

  const estado = JSON.parse(fs.readFileSync(ESTADO, 'utf8'));
  const movimentos = estado.stockMovements || [];
  const transferencias = estado.stockTransfers || [];

  console.log('--- o que está no arquivo ---');
  console.log(`  ${movimentos.length} movimento(s), ${transferencias.length} transferência(s)`);

  // Campo desconhecido para antes de qualquer coisa. Ver o cabeçalho.
  for (const [lista, campos, nome] of [[movimentos, CAMPOS_MOVIMENTO, 'movimento'], [transferencias, CAMPOS_TRANSFERENCIA, 'transferência']]) {
    for (const r of lista) {
      const estranhos = Object.keys(r).filter((k) => !campos.has(k));
      if (estranhos.length) {
        console.error(`\nABORTADO: o ${nome} ${r.id || r.code} tem campo(s) que este script não sabe migrar: ${estranhos.join(', ')}`);
        console.error('Acrescente a coluna na fase-ap e o campo na lista deste script — ignorar perderia o dado.');
        await fecharPool();
        process.exit(1);
      }
    }
  }
  console.log('  todos os campos são conhecidos');

  const saldoAntes = saldos(movimentos);
  console.log('\n--- saldo que precisa sobreviver ---');
  for (const [chave, valor] of Object.entries(saldoAntes)) console.log(`  ${chave.replace('@', ' @ ') || '(nenhum)'} = ${valor}`);

  // Órfãos: informação, não impedimento. O razão sobrevive ao cadastro — é por
  // isso que a fase-ap não tem FK para products nem deposits.
  const produtos = (await consultar('select id from products')).rows.map((r) => r.id);
  const depositos = (await consultar('select id from deposits')).rows.map((r) => r.id);
  const produtosOrfaos = [...new Set(movimentos.map((m) => m.productId))].filter((id) => !produtos.includes(id));
  const depositosOrfaos = [...new Set(movimentos.map((m) => m.depositId).filter(Boolean))].filter((id) => !depositos.includes(id));
  if (produtosOrfaos.length || depositosOrfaos.length) {
    console.log('\n--- órfãos (migram assim mesmo: razão é histórico) ---');
    produtosOrfaos.forEach((id) => console.log(`  produto que não existe mais: ${id}`));
    depositosOrfaos.forEach((id) => console.log(`  depósito que não existe mais: ${id}`));
  }

  const jaTem = (await consultar('select count(*)::int as n from stock_movements')).rows[0].n;
  if (jaTem > 0) {
    console.error(`\nABORTADO: stock_movements já tem ${jaTem} linha(s). Migrar de novo duplicaria o razão.`);
    await fecharPool();
    process.exit(1);
  }

  if (!confirmado) {
    console.log('\nNada foi movido. Para mover de verdade: --confirmo');
    console.log('(o array do db.json é esvaziado na mesma operação — copiar sem cortar bifurca o razão)');
    await fecharPool();
    process.exit(0);
  }

  if (await sistemaNoAr(porta)) {
    console.error(`\nABORTADO: tem alguém respondendo na porta ${porta}. Pare o MavisONE antes:`);
    console.error('  uma requisição em voo grava o db.json depois do corte e ressuscita o array.');
    await fecharPool();
    process.exit(1);
  }

  await emTransacao(async (cliente) => {
    await razao.inserirMovimentos(cliente, movimentos.map((m) => ({
      id: m.id, code: m.code, type: m.type, date: m.date,
      productId: m.productId, productName: texto(m.productName), depositId: texto(m.depositId),
      classId: texto(m.classId), classValueId: texto(m.classValueId),
      quantity: numero(m.quantity), unitCost: numero(m.unitCost),
      categoryId: texto(m.categoryId), document: texto(m.document), note: texto(m.note),
      transferId: texto(m.transferId), origin: texto(m.origin), motivo: texto(m.motivo),
      referenceType: texto(m.referenceType), referenceId: texto(m.referenceId),
      createdBy: texto(m.createdBy), createdByName: texto(m.createdByName)
    })));
    await razao.inserirTransferencias(cliente, transferencias.map((t) => ({
      id: t.id, code: t.code, batchId: texto(t.batchId), date: t.date,
      productId: t.productId, originDepositId: texto(t.originDepositId),
      destinationDepositId: texto(t.destinationDepositId),
      classId: texto(t.classId), classValueId: texto(t.classValueId),
      quantity: numero(t.quantity), note: texto(t.note),
      movementOutId: texto(t.movementOutId), movementInId: texto(t.movementInId),
      createdBy: texto(t.createdBy), createdByName: texto(t.createdByName)
    })));

    // A sequence continua de onde a numeração parou. Sem isto, o próximo
    // movimento nasceria MOV-0001 e colidiria com o histórico recém-migrado.
    const maiorNumero = (lista) => lista.reduce((maior, r) => {
      const n = Number(String(r.code || '').split('-')[1] || 0);
      return n > maior ? n : maior;
    }, 0);
    await cliente.query(`select setval('stock_movements_code_seq', $1, true)`, [Math.max(1, maiorNumero(movimentos))]);
    await cliente.query(`select setval('stock_transfers_code_seq', $1, true)`, [Math.max(1, maiorNumero(transferencias))]);
  });

  const depois = await razao.listarMovimentos();
  const saldoDepois = saldos(depois);
  console.log('\n--- conferência ---');
  console.log(`  linhas no banco: ${depois.length} (esperado ${movimentos.length})`);
  let divergiu = false;
  for (const chave of new Set([...Object.keys(saldoAntes), ...Object.keys(saldoDepois)])) {
    const a = saldoAntes[chave] ?? 0;
    const b = saldoDepois[chave] ?? 0;
    if (a !== b) { divergiu = true; console.error(`  XX ${chave}: ${a} -> ${b}`); }
  }
  if (divergiu || depois.length !== movimentos.length) {
    console.error('\nO SALDO NÃO BATE. O arquivo NÃO foi cortado — o razão antigo continua lá.');
    await fecharPool();
    process.exit(1);
  }
  console.log('  o saldo bate em todos os pares produto/depósito');

  // Só agora o corte, e com cópia de segurança ao lado.
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.copyFileSync(ESTADO, `${ESTADO}.antes-da-fase-ap-${carimbo}`);
  const novo = JSON.parse(fs.readFileSync(ESTADO, 'utf8'));
  novo.stockMovements = [];
  novo.stockTransfers = [];
  const temporario = `${ESTADO}.novo`;
  fs.writeFileSync(temporario, JSON.stringify(novo, null, 2));
  fs.renameSync(temporario, ESTADO);

  console.log(`\n  o db.json foi cortado (cópia em ${path.basename(ESTADO)}.antes-da-fase-ap-${carimbo})`);
  console.log('\n===== RAZÃO DE ESTOQUE MIGRADO =====');
  await fecharPool();
})().catch(async (erro) => {
  console.error(erro);
  try { await fecharPool(); } catch { /* já fechado */ }
  process.exit(1);
});
