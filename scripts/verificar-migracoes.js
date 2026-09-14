#!/usr/bin/env node
// Quais migrações já estão no banco e quais faltam.
//
// A pergunta "rodei o SQL ou não?" já custou caro neste projeto: o formulário
// de Pedidos ficou semanas gravando e perdendo campo em silêncio porque as
// colunas não existiam no banco — o código degrada de propósito, e a degradação
// é justamente o que esconde o problema.
//
// Este script não tem lista própria do que esperar: ele LÊ banco/migrations/
// e cobra do banco exatamente o que os arquivos dizem criar. Migração nova passa
// a ser verificada sozinha, sem ninguém lembrar de atualizar nada aqui. A
// leitura, a ordem e a conferência moram em lib/migracoes.js, compartilhadas
// com o aplicador e com o gerador do "recriar do zero".
//
// Uso:  node scripts/verificar-migracoes.js      (npm run migracoes)
require('dotenv').config();
const { banco } = require('../lib/db/client');
const { conferir } = require('../lib/migracoes');

// O cliente devolve erro nomeando a coluna/tabela quando ela não existe — é o
// jeito de perguntar "isto existe?" sem acesso ao catálogo do Postgres.
async function existeColuna(tabela, coluna) {
  const { error } = await banco.from(tabela).select(coluna).limit(1);
  if (!error) return true;
  if (/does not exist|Could not find|schema cache/i.test(error.message || '')) return false;
  throw new Error(`${tabela}.${coluna}: ${error.message}`);
}

async function existeTabela(tabela) {
  const { error } = await banco.from(tabela).select('*').limit(1);
  if (!error) return true;
  if (/does not exist|Could not find|schema cache/i.test(error.message || '')) return false;
  throw new Error(`${tabela}: ${error.message}`);
}

(async () => {
  console.log('\n=== MIGRAÇÕES vs. BANCO ===\n');

  const { migracoes, pendentes, naoConferidas } = await conferir({ existeTabela, existeColuna });
  const porNome = new Map();
  [...pendentes, ...naoConferidas].forEach((m) => porNome.set(m.nome, m));

  for (const migracao of migracoes) {
    if (migracao.consolidado) {
      console.log(`  ${'pacote (não conta)'.padEnd(34)} ${migracao.nome}`);
      continue;
    }
    const achado = porNome.get(migracao.nome);
    const estado = achado ? achado.estado : (migracao.superada ? 'SUPERADA' : 'APLICADA');
    console.log(`  ${estado.padEnd(34)} ${migracao.nome}`);
    if (achado && achado.faltando.length) {
      const f = achado.faltando;
      console.log(`     falta: ${f.slice(0, 6).join(', ')}${f.length > 6 ? ` … +${f.length - 6}` : ''}`);
    }
  }

  console.log('');
  // "Não sei conferir" não pode sair com a mesma cara de "está certo". A versão
  // anterior somava as duas coisas e imprimia BANCO EM DIA — quem rodava isto
  // antes de subir uma versão recebia uma garantia que o script não tinha.
  // Migração sem tabela nem coluna existe de verdade (só insere dado, só cria
  // índice ou trigger), então isto NÃO é erro: é uma ressalva, e por isso a
  // saída continua 0. O que mudou é que ela aparece.
  if (naoConferidas.length) {
    console.log(`  ${naoConferidas.length} migração(ões) sem tabela ou coluna declarada — este script não`);
    console.log('  tem como confirmar se rodaram. Confira à mão o que elas fazem:');
    naoConferidas.forEach((m) => console.log(`     ${m.nome}`));
    console.log('');
  }

  if (!pendentes.length) {
    console.log(naoConferidas.length
      ? `===== EM DIA no que dá para conferir (${naoConferidas.length} não conferida(s)) =====\n`
      : '===== BANCO EM DIA =====\n');
    process.exit(0);
  }
  console.log(`===== ${pendentes.length} MIGRAÇÃO(ÕES) PENDENTE(S) =====`);
  // NÃO EXISTE MAIS "COLAR NO SQL EDITOR DO SUPABASE".
  //
  // O Supabase saiu em agosto de 2026 e o banco virou um Postgres em Docker
  // (docker-compose.yml, serviço `banco`). A mensagem antiga mandava abrir um
  // painel web que esta instalação não tem mais — e o deploy do VPS parava
  // esperando alguém executar um passo que não existe.
  console.log('Aplique com:');
  console.log('');
  console.log('    npm run migracoes:aplicar');
  console.log('');
  console.log('Ele roda estes arquivos, nesta ordem, cada um numa transação:');
  pendentes.forEach((m) => console.log(`  banco/migrations/${m.nome}`));
  console.log('');
  // Sai com erro de propósito: dá para usar no deploy como trava.
  process.exit(1);
})().catch((erro) => {
  console.error('Erro ao verificar as migrações:', erro.message);
  process.exit(2);
});
