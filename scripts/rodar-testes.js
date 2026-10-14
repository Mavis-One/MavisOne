#!/usr/bin/env node
// RODA A SUÍTE DE TESTES (`npm test`) — 14/10/2026.
//
// A suíte era uma linha só no package.json: "node scripts/a.js && node
// scripts/b.js && ...". Com ~200 testes ela passou de 8.191 caracteres, o
// limite do cmd.exe, e o `npm test` no Windows parou com "Linha de comando
// muito longa" antes de rodar qualquer teste (no Linux do VPS o limite é
// outro, e passaria).
//
// A lista continua no package.json, em "test:lista", no mesmo formato; aqui
// cada teste roda em sequência, como antes, e a suíte para no primeiro que
// falhar, com o código de saída dele.
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const lista = String(require(path.join(RAIZ, 'package.json')).scripts['test:lista'] || '')
  .split('&&')
  .map((comando) => comando.trim())
  .filter(Boolean);

if (!lista.length) {
  console.error('package.json sem "test:lista".');
  process.exit(2);
}

for (const comando of lista) {
  const partes = comando.split(/\s+/);
  if (partes[0] !== 'node') {
    console.error(`Comando da suíte fora do formato "node scripts/...": ${comando}`);
    process.exit(2);
  }
  console.log(`\n> ${comando}`);
  const r = spawnSync(process.execPath, partes.slice(1), { cwd: RAIZ, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\nFALHOU: ${comando} (saída ${r.status === null ? r.signal : r.status})`);
    process.exit(r.status || 1);
  }
}
console.log(`\n===== SUÍTE COMPLETA: ${lista.length} TESTES PASSARAM =====`);
