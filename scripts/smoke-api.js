#!/usr/bin/env node
/**
 * Smoke test de leitura da API do MavisONE.
 *
 * Faz login e bate em todos os endpoints GET, reportando status e um resumo do
 * corpo (tamanho das coleções). Serve para confirmar rapidamente, depois de uma
 * migração ou de subir o projeto em outra máquina, que nenhuma rota quebrou.
 *
 * Uso:
 *   SMOKE_USER=admin SMOKE_PASS=suasenha node scripts/smoke-api.js
 *   node scripts/smoke-api.js --user admin --pass suasenha --base http://localhost:3000
 *
 * A autenticação usa o header `x-auth-token` (ver getCurrentUser em server.js).
 */

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const BASE = arg('base') || process.env.SMOKE_BASE || 'http://localhost:3000';
const USER = arg('user') || process.env.SMOKE_USER;
const PASS = arg('pass') || process.env.SMOKE_PASS;

if (!USER || !PASS) {
  console.error('Informe as credenciais: SMOKE_USER/SMOKE_PASS no ambiente ou --user/--pass.');
  process.exit(2);
}

const GETS = [
  '/api/audit',
  '/api/cadastros',
  '/api/cadastros/cnpjs',
  '/api/cadastros/deposits',
  '/api/cadastros/empresas',
  '/api/cadastros/meta',
  '/api/cadastros/pessoas',
  '/api/cadastros/product-cashbacks',
  '/api/dashboard/charts',
  '/api/finance',
  '/api/finance/bank-transactions',
  '/api/finance/entries',
  '/api/finance/meta',
  '/api/finance/nfe',
  '/api/finance/summary',
  '/api/fiscal/certificados',
  '/api/fiscal/empresas',
  '/api/fiscal/estabelecimentos',
  '/api/fiscal/nfe',
  '/api/fiscal/regras',
  '/api/focusnfe/status',
  '/api/open-finance/connections',
  '/api/open-finance/institutions',
  '/api/open-finance/status',
  '/api/purchases',
  '/api/sales',
  '/api/sales/dashboard',
  '/api/sales/meta',
  '/api/sales/records',
  '/api/settings',
  '/api/stock',
  '/api/stock/meta',
  '/api/stock/movements',
  '/api/stock/price-manager',
  '/api/stock/products',
  '/api/stock/transfers',
  '/api/users'
];

function describe(body) {
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) return `array(${parsed.length})`;
    if (parsed && typeof parsed === 'object') {
      const keys = Object.keys(parsed);
      const counts = keys.filter((k) => Array.isArray(parsed[k])).map((k) => `${k}:${parsed[k].length}`);
      return `obj{${keys.slice(0, 6).join(',')}${keys.length > 6 ? ',…' : ''}}` + (counts.length ? ` [${counts.join(' ')}]` : '');
    }
    return typeof parsed;
  } catch {
    return body.slice(0, 90).replace(/\s+/g, ' ');
  }
}

(async () => {
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS })
  });

  if (!login.ok) {
    console.error(`LOGIN falhou (${login.status}): ${await login.text()}`);
    process.exit(1);
  }

  const { token } = await login.json();
  console.log(`LOGIN ${login.status} em ${BASE}\n`);

  let ok = 0;
  const bad = [];
  for (const path of GETS) {
    try {
      const res = await fetch(BASE + path, { headers: { 'x-auth-token': token } });
      const line = `${String(res.status).padEnd(4)} ${path.padEnd(34)} ${describe(await res.text())}`;
      if (res.ok) {
        ok++;
        console.log('  ' + line);
      } else {
        bad.push(line);
        console.log('X ' + line);
      }
    } catch (error) {
      bad.push(`ERR  ${path} ${error.message}`);
      console.log(`X ERR  ${path} ${error.message}`);
    }
  }

  console.log(`\n=== ${ok}/${GETS.length} OK, ${bad.length} com falha ===`);
  process.exit(bad.length ? 1 : 0);
})();
