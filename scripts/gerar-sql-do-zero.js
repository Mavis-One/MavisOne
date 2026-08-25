#!/usr/bin/env node
/**
 * Gera supabase/RECRIAR-DO-ZERO.sql — o banco inteiro, num arquivo só, na
 * ORDEM CERTA, para colar no SQL Editor de um Supabase novo.
 *
 *   node scripts/gerar-sql-do-zero.js
 *
 * POR QUE ISTO PRECISA EXISTIR
 * ----------------------------
 * Recriar o banco é juntar schema.sql com as migrações. Parece trivial e tem
 * uma armadilha que só aparece depois do erro:
 *
 *   ORDEM ALFABÉTICA NÃO É A ORDEM DAS FASES.
 *
 * `fase-aa` vem antes de `fase-h` e de `fase-r` em qualquer listagem de pasta,
 * em qualquer sistema operacional. Quem colar "na ordem que apareceu" roda a
 * Fase AA (que altera `nfe`) antes da Fase C (que cria `nfe`) e leva
 * "relation does not exist" na cara — no meio de um arquivo de milhares de
 * linhas, sem saber qual pedaço falhou.
 *
 * A ordem certa é por TAMANHO e depois alfabética: h, i, ... z, aa, ab, ... al.
 * É a ordem em que as fases foram escritas, e é a única em que cada uma
 * encontra o que a anterior criou.
 *
 * POR QUE UM GERADOR, E NÃO UM ARQUIVO ESCRITO À MÃO
 * --------------------------------------------------
 * Um "recriar do zero" mantido à mão fica desatualizado na primeira fase nova —
 * e desatualiza EM SILÊNCIO: o arquivo continua rodando, só que produz um banco
 * sem a última tabela. O erro aparece semanas depois, no primeiro uso da tela
 * que dependia dela. Este script lê a pasta; fase nova entra sozinha.
 *
 * REPETIR É SEGURO
 * ----------------
 * Tudo que ele junta usa `if not exists` / `on conflict do nothing` (é regra
 * deste projeto desde o schema.sql). Rodar duas vezes no mesmo banco não
 * duplica nada e não apaga nada.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const DIR = path.join(RAIZ, 'supabase', 'migrations');
const SAIDA = path.join(RAIZ, 'supabase', 'RECRIAR-DO-ZERO.sql');

/**
 * A ordem das fases. Exportada e pura para o teste poder cobrá-la sem gerar
 * arquivo nenhum — é a única regra deste script que, se quebrar, quebra tudo.
 *
 * Uma letra vem antes de duas: `z` antes de `aa`. Dentro do mesmo tamanho,
 * alfabética. Arquivo sem `fase-<letras>-` no nome vai para o fim, em vez de
 * quebrar a ordenação por causa de um nome fora do padrão.
 */
function ordenarPorFase(nomes) {
  const letras = (nome) => {
    const m = /^fase-([a-z]+)-/i.exec(nome);
    return m ? m[1].toLowerCase() : null;
  };
  return nomes.slice().sort((a, b) => {
    const la = letras(a);
    const lb = letras(b);
    if (!la && !lb) return a.localeCompare(b);
    if (!la) return 1;
    if (!lb) return -1;
    if (la.length !== lb.length) return la.length - lb.length;
    return la.localeCompare(lb);
  });
}

function gerar() {
  const arquivos = ordenarPorFase(
    fs.readdirSync(DIR).filter((n) => n.endsWith('.sql') && !n.startsWith('PENDENTES'))
  );

  const cabecalho = `-- ============================================================================
-- RECRIAR O BANCO DO ZERO — arquivo GERADO. Não edite aqui.
--
--   Gerado por: node scripts/gerar-sql-do-zero.js
--   Fonte:      supabase/schema.sql + supabase/migrations/*.sql
--
-- COMO USAR
--   1. crie o projeto no Supabase e abra o SQL Editor;
--   2. cole este arquivo INTEIRO e rode;
--   3. confira com: npm run migracoes  (com o .env já apontando para o novo).
--
-- A ORDEM DESTE ARQUIVO NÃO É A ORDEM ALFABÉTICA DA PASTA, e isso é o ponto:
-- 'fase-aa' vem antes de 'fase-h' em qualquer listagem, e rodar nessa ordem
-- tenta alterar tabela que ainda não existe. Aqui as fases estão na ordem em
-- que foram escritas — uma letra antes de duas, alfabética dentro do mesmo
-- tamanho.
--
-- Rodar de novo no mesmo banco é seguro: tudo usa "if not exists" e
-- "on conflict do nothing".
--
-- ATENÇÃO À SENHA SEMENTE: o schema cria o usuário 'admin' com um hash que
-- está versionado neste repositório — ou seja, público para quem tem acesso ao
-- código. Troque a senha no primeiro acesso ao banco novo, antes de cadastrar
-- qualquer coisa de verdade.
--
-- Arquivos incluídos, nesta ordem:
--   supabase/schema.sql
${arquivos.map((n, i) => `--   ${String(i + 1).padStart(2, '0')}. supabase/migrations/${n}`).join('\n')}
-- ============================================================================

`;

  const bloco = (rotulo, conteudo) => `
-- ============================================================================
-- >>> ${rotulo}
-- ============================================================================

${conteudo.trim()}

`;

  const partes = [cabecalho, bloco('supabase/schema.sql', fs.readFileSync(path.join(RAIZ, 'supabase', 'schema.sql'), 'utf8'))];
  for (const nome of arquivos) {
    partes.push(bloco(`supabase/migrations/${nome}`, fs.readFileSync(path.join(DIR, nome), 'utf8')));
  }

  const sql = partes.join('');
  fs.writeFileSync(SAIDA, sql, 'utf8');
  return { arquivos, linhas: sql.split('\n').length };
}

if (require.main === module) {
  const { arquivos, linhas } = gerar();
  console.log(`\nsupabase/RECRIAR-DO-ZERO.sql gerado — ${linhas} linhas.`);
  console.log(`  schema.sql + ${arquivos.length} migrações, na ordem das fases.`);
  console.log(`  Primeira: ${arquivos[0]}`);
  console.log(`  Última:   ${arquivos[arquivos.length - 1]}\n`);
}

module.exports = { ordenarPorFase, gerar };
