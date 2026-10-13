#!/usr/bin/env node
// IMPORTA PESSOAS DO VIPER (PLANILHA "PESSOAS") COMO CLIENTE — 13/10/2026.
//
//   node scripts/importar-pessoas-viper.js --planilha pessoas.xlsx
//       só lê a planilha e mostra o que ela tem.
//
//   ... --url https://mavisone.cloud
//       CONFERE no servidor (login de administrador), sem gravar: quem já é
//       cliente, quem ganha o papel e quem é cadastrado.
//
//   ... --url ... --enviar
//       grava. Rodar de novo não duplica.
//
// Por que tudo vira Cliente e o que não muda: lib/importacao-pessoas-viper.js.
// A planilha NÃO entra no repositório.
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { lerXlsx } = require('../lib/xlsx-leitor');
const { lerPlanilha } = require('../lib/importacao-pessoas-viper');

const argumento = (nome) => { const i = process.argv.indexOf('--' + nome); return i >= 0 ? process.argv[i + 1] : undefined; };
const tem = (nome) => process.argv.includes('--' + nome);

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) => rl.question(texto, (r) => { rl.close(); ok(r); }));
}

async function main() {
  const arquivo = argumento('planilha');
  if (!arquivo || !fs.existsSync(arquivo)) {
    console.error('Uso: node scripts/importar-pessoas-viper.js --planilha <xlsx> [--url <endereço> [--enviar]]');
    if (arquivo) console.error('Não encontrado: ' + arquivo);
    process.exitCode = 2;
    return;
  }
  const { empresa, itens, ignorados } = lerPlanilha(lerXlsx(arquivo));
  console.log(`Planilha: ${path.basename(arquivo)} — ${empresa || 'empresa não identificada'}`);
  console.log(`  pessoas: ${itens.length} | CPF: ${itens.filter((i) => i.tipo === 'pessoa-fisica').length} | CNPJ: ${itens.filter((i) => i.tipo === 'pessoa-juridica').length} | inativas: ${itens.filter((i) => !i.ativo).length}`);
  ignorados.forEach((x) => console.log(`  fora: ${x.codigo} ${x.nome || ''} — ${x.motivo}`));

  const url = argumento('url');
  if (!url) {
    console.log('\nSó leitura da planilha. Com --url <endereço>, o servidor confere (sem gravar).');
    return;
  }
  const base = String(url).replace(/\/+$/, '');
  const usuario = process.env.IMPORT_USER || 'admin';
  const senha = process.env.IMPORT_PASS || await perguntar(`Senha do usuário ${usuario} em ${base}: `);
  const chamar = async (rota, corpo, token) => {
    const r = await fetch(base + rota, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-auth-token': token } : {}) },
      body: JSON.stringify(corpo)
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${rota} respondeu ${r.status}: ${json.error || ''}`);
    return json;
  };
  const { token } = await chamar('/api/login', { username: usuario, password: senha });
  const enviar = tem('enviar');
  const r = await chamar('/api/cadastros/importacao/viper-pessoas', { itens, simular: !enviar }, token);

  console.log(`\n${enviar ? 'GRAVADO' : 'CONFERÊNCIA (nada gravado)'} em ${base}:`);
  console.log(`  já eram cliente: ${r.jaTinham}`);
  console.log(`  ganham o papel Cliente: ${enviar ? r.papelGravado + ' gravados' : r.ganhamPapel.length + ' ganhariam'}`);
  console.log(`  cadastros novos: ${enviar ? r.criados + ' gravados' : r.novos.length + ' entrariam'}`);
  r.novos.forEach((n) => console.log(`    novo ${n.codigo}  ${n.nome}  ${n.documento}`));
  r.invalidos.forEach((n) => console.log(`    FORA (CPF/CNPJ com dígito errado) ${n.codigo}  ${n.nome}  ${n.documento}`));
  if (!enviar) console.log('Para gravar, rode de novo com --enviar.');
}

// exitCode, e não process.exit(): ver scripts/completar-chaves-nfe.js.
main().catch((erro) => { console.error('\nFALHOU:', erro.message); process.exitCode = 1; });
