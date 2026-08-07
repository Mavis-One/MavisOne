#!/usr/bin/env node
// Quais migrações já estão no Supabase e quais faltam.
//
// A pergunta "rodei o SQL ou não?" já custou caro neste projeto: o formulário
// de Pedidos ficou semanas gravando e perdendo campo em silêncio porque as
// colunas não existiam no banco — o código degrada de propósito, e a degradação
// é justamente o que esconde o problema.
//
// Este script não tem lista própria do que esperar: ele LÊ supabase/migrations/
// e cobra do banco exatamente o que os arquivos dizem criar. Migração nova passa
// a ser verificada sozinha, sem ninguém lembrar de atualizar nada aqui.
//
// Uso:  node scripts/verificar-migracoes.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { supabase } = require('../lib/db/client');

const DIR = path.join(__dirname, '..', 'supabase', 'migrations');

// Lê os arquivos e extrai o que cada um promete criar.
function lerMigracoes() {
  return fs.readdirSync(DIR)
    .filter((nome) => nome.endsWith('.sql'))
    .sort()
    .map((nome) => {
      const sql = fs.readFileSync(path.join(DIR, nome), 'utf8');
      const colunas = [...sql.matchAll(/alter\s+table\s+if\s+exists\s+(\w+)\s+add\s+column\s+if\s+not\s+exists\s+(\w+)/gi)]
        .map((m) => ({ tabela: m[1], coluna: m[2] }));
      const tabelas = [...sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+(\w+)/gi)].map((m) => m[1]);
      const superada = /SUPERADA PELA/i.test(sql);
      return { nome, colunas, tabelas, superada };
    });
}

// PostgREST devolve erro nomeando a coluna/tabela quando ela não existe — é o
// jeito de perguntar "isto existe?" sem acesso ao catálogo do Postgres.
async function existeColuna(tabela, coluna) {
  const { error } = await supabase.from(tabela).select(coluna).limit(1);
  if (!error) return true;
  if (/does not exist|Could not find|schema cache/i.test(error.message || '')) return false;
  throw new Error(`${tabela}.${coluna}: ${error.message}`);
}

async function existeTabela(tabela) {
  const { error } = await supabase.from(tabela).select('*').limit(1);
  if (!error) return true;
  if (/does not exist|Could not find|schema cache/i.test(error.message || '')) return false;
  throw new Error(`${tabela}: ${error.message}`);
}

(async () => {
  const migracoes = lerMigracoes();
  const pendentes = [];

  console.log('\n=== MIGRAÇÕES vs. SUPABASE ===\n');

  for (const migracao of migracoes) {
    const faltando = [];

    for (const tabela of [...new Set(migracao.tabelas)]) {
      if (!(await existeTabela(tabela))) faltando.push(`tabela ${tabela}`);
    }
    for (const { tabela, coluna } of migracao.colunas) {
      // Coluna de tabela que nem existe já foi contada acima.
      if (migracao.tabelas.includes(tabela)) continue;
      if (!(await existeTabela(tabela))) continue;
      if (!(await existeColuna(tabela, coluna))) faltando.push(`${tabela}.${coluna}`);
    }

    const total = migracao.tabelas.length + migracao.colunas.length;
    const estado = migracao.superada ? 'SUPERADA'
      : !total ? 'sem estrutura a conferir'
        : faltando.length === 0 ? 'APLICADA'
          : `PENDENTE (${faltando.length} de ${total} faltando)`;

    console.log(`  ${estado.padEnd(34)} ${migracao.nome}`);
    if (faltando.length && !migracao.superada) {
      console.log(`     falta: ${faltando.slice(0, 6).join(', ')}${faltando.length > 6 ? ` … +${faltando.length - 6}` : ''}`);
      pendentes.push(migracao.nome);
    }
  }

  console.log('');
  if (!pendentes.length) {
    console.log('===== BANCO EM DIA =====\n');
    process.exit(0);
  }
  console.log(`===== ${pendentes.length} MIGRAÇÃO(ÕES) PENDENTE(S) =====`);
  console.log('Rode no SQL Editor do Supabase, nesta ordem:');
  pendentes.forEach((n) => console.log(`  supabase/migrations/${n}`));
  console.log('');
  // Sai com erro de propósito: dá para usar no deploy como trava.
  process.exit(1);
})().catch((erro) => {
  console.error('Erro ao verificar as migrações:', erro.message);
  process.exit(2);
});
