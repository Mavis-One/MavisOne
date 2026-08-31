#!/usr/bin/env node
/**
 * A VOLTA: backup -> apaga -> restaura -> confere.
 *
 *   node scripts/test-backup-restauracao.js --confirmo
 *
 * NÃO entra em `npm test`: mexe no banco de verdade e RESTAURA por cima dele.
 * Roda à mão depois de mexer no backup ou no restaurador.
 *
 * Um backup que nunca foi restaurado não é um backup — é um arquivo. Este
 * teste é o que transforma um no outro.
 *
 * POR QUE ELE FICOU MUITO MENOR
 * -----------------------------
 * A versão anterior exportava tabela por tabela pelo PostgREST e precisava
 * exercitar à mão o ciclo de chave estrangeira (hr_departments <-> hr_employees)
 * e as colunas de identidade — dois caminhos que só existiam porque o backup era
 * feito na unha, sem pg_dump. Com pg_dump esses caminhos não existem mais: quem
 * resolve ordem, ciclo e identidade é o Postgres. O que sobrou para provar é o
 * que sempre importou de verdade — o dado volta, e a ESTRUTURA volta junto.
 *
 * O QUE ELE FAZ COM O SEU BANCO
 * -----------------------------
 * Restaura o backup que ele mesmo acabou de tirar, segundos antes. Na prática o
 * banco volta ao ponto em que estava — mas é uma restauração de verdade, então
 * qualquer escrita que aconteça DURANTE o teste se perde. Não rode com outra
 * pessoa usando o sistema.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { banco, fecharPool } = require('../lib/db/client');
const { consultar } = require('../lib/db/conexao');
const { esquecerCatalogo } = require('../lib/db/catalogo');

const RAIZ = path.join(__dirname, '..');
const MARCA = `zz-teste-backup-${Date.now()}`;

let falhas = 0;
const check = (ok, t, d) => { console.log(`  ${ok ? 'OK ' : 'XX '} ${t}${d !== undefined ? ' -> ' + d : ''}`); if (!ok) falhas++; };

function rodar(script, argumentos = []) {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', script), ...argumentos], {
    cwd: RAIZ, encoding: 'utf8'
  });
  if (r.stdout) process.stdout.write(r.stdout.split('\n').map((l) => (l ? '      ' + l : l)).join('\n'));
  if (r.status !== 0 && r.stderr) process.stderr.write(r.stderr);
  return r;
}

(async () => {
  if (!process.argv.includes('--confirmo')) {
    console.error('Este teste RESTAURA o banco por cima do atual (ver o cabeçalho).');
    console.error('Se for isso mesmo: node scripts/test-backup-restauracao.js --confirmo');
    process.exit(1);
  }

  console.log('--- 1. uma linha marcada, para ter o que procurar depois ---');
  // `document` e `name` são NOT NULL; o resto tem padrão no schema. O `extra`
  // vai preenchido de propósito: é jsonb, e o dump ter de levar jsonb de volta
  // intacto é uma das coisas que este teste prova.
  const { error: erroInsert } = await banco.from('people').insert({
    id: MARCA, name: 'PROVA DE BACKUP', document: '00000000000', type: 'pessoa-fisica',
    extra: { prova: true, quando: new Date().toISOString() }
  });
  check(!erroInsert, 'linha de prova criada', erroInsert ? erroInsert.message : MARCA);
  if (erroInsert) { await fecharPool(); process.exit(1); }

  console.log('\n--- 2. backup ---');
  const backup = rodar('backup-banco.js');
  check(backup.status === 0, 'npm run backup terminou bem', String(backup.status));
  const arquivo = (backup.stdout.match(/restaurar-banco\.js (\S+)/) || [])[1];
  check(Boolean(arquivo) && fs.existsSync(path.join(RAIZ, arquivo)), 'o arquivo existe', arquivo);
  if (!arquivo) { await fecharPool(); process.exit(1); }

  console.log('\n--- 3. apaga a linha (e confere que sumiu mesmo) ---');
  await banco.from('people').delete().eq('id', MARCA);
  const sumiu = await banco.from('people').select('id').eq('id', MARCA).maybeSingle();
  check(sumiu.data === null, 'a linha não está mais lá');

  console.log('\n--- 4. restaura ---');
  const restauro = rodar('restaurar-banco.js', [arquivo, '--confirmo']);
  check(restauro.status === 0, 'a restauração terminou bem', String(restauro.status));
  // O restore derruba e recria as tabelas, então o catálogo lido na subida
  // ficou falando de objetos que não existem mais. Sem esquecê-lo, as
  // consultas abaixo montariam SQL contra o schema antigo.
  esquecerCatalogo();

  console.log('\n--- 5. o DADO voltou ---');
  const voltou = await banco.from('people').select('id, name, extra').eq('id', MARCA).maybeSingle();
  check(voltou.data !== null, 'a linha marcada está de volta', voltou.data ? voltou.data.name : 'sumiu');
  check(Boolean(voltou.data && voltou.data.extra && voltou.data.extra.prova === true),
    '  e o jsonb dela voltou como estrutura, não como texto',
    voltou.data ? JSON.stringify(voltou.data.extra) : '—');

  console.log('\n--- 6. a ESTRUTURA voltou junto (o que o backup antigo não trazia) ---');
  // Função: existia no schema.sql e o backup por PostgREST nunca a levava.
  const funcao = await banco.rpc('next_cadastro_code');
  check(!funcao.error && funcao.data != null, 'a função next_cadastro_code responde', funcao.error ? funcao.error.message : String(funcao.data));

  // Gatilho: a fase-AJ instalou o guarda de transição de status. Se o dump não
  // trouxesse gatilhos, o banco voltaria aceitando transição inválida em
  // silêncio — o pior tipo de restauração "bem-sucedida".
  const idPedido = `zz-teste-backup-ped-${Date.now()}`;
  await banco.from('orders').insert({
    id: idPedido, type: 'order', code: 999996, status: 'pedido-faturado',
    date: '2026-08-31', customer: 'PROVA DE BACKUP', amount: 10, items: []
  });
  const recusa = await banco.from('orders').update({ status: 'orcamento' }).eq('id', idPedido);
  check(Boolean(recusa.error), 'o gatilho de status voltou e ainda recusa', recusa.error ? recusa.error.code : 'PASSOU (não deveria)');

  const { rows } = await consultar(`select count(*)::int as n from pg_indexes where schemaname = 'public'`);
  check(rows[0].n > 50, 'os índices voltaram', `${rows[0].n} índices`);

  const { rows: tabelas } = await consultar(`select count(*)::int as n from information_schema.tables where table_schema = 'public'`);
  check(tabelas[0].n > 70, 'as tabelas voltaram', `${tabelas[0].n} tabelas`);

  console.log('\n--- 7. limpeza ---');
  await banco.from('orders').delete().eq('id', idPedido);
  await banco.from('people').delete().eq('id', MARCA);
  const limpo = await banco.from('people').select('id').eq('id', MARCA).maybeSingle();
  check(limpo.data === null, 'as linhas de prova saíram');

  await fecharPool();
  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== O BACKUP VOLTA, COM ESTRUTURA E TUDO =====');
  process.exit(falhas ? 1 : 0);
})().catch(async (e) => { console.error('EXPLODIU:', e.message); await fecharPool().catch(() => {}); process.exit(1); });
