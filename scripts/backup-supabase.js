#!/usr/bin/env node
/**
 * BACKUP do Supabase — dados de todas as tabelas + arquivos do Storage.
 *
 *   node scripts/backup-supabase.js
 *
 * O QUE ISTO É E O QUE NÃO É
 * --------------------------
 * NÃO é um substituto do pg_dump. Ele salva DADOS, não estrutura: não traz
 * tabelas, funções, gatilhos, políticas nem índices.
 *
 * Isso é aceitável aqui por um motivo específico e verificável: a estrutura
 * deste banco vive em supabase/schema.sql e nas migrações, versionadas no git.
 * Recriar o banco vazio é rodar aqueles arquivos; o que o git não guarda são os
 * dados, e é exatamente isso que este script tira.
 *
 * O dia em que a estrutura passar a ser alterada direto pelo painel do Supabase
 * — e não por migração — esta premissa cai, e aí é pg_dump de verdade.
 *
 * O QUE ELE COBRE
 *   - todas as tabelas declaradas no schema/migrações, paginadas;
 *   - os arquivos do Supabase Storage, como arquivos mesmo (não base64);
 *   - um manifesto com contagens, para a restauração conferir o que recebeu.
 *
 * ONDE ELE ESCREVE
 *   data/backup/<data-hora>/ — e `data/` está no .gitignore, de propósito:
 *   backup com dado de cliente e hash de senha não entra em repositório.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { lerEstrutura, ordenarPorDependencia, criarRest } = require('./lib-backup');

const RAIZ = path.join(__dirname, '..');
// PostgREST devolve no máximo 1000 por vez por padrão. Sem paginar, uma tabela
// grande volta cortada e o backup fica silenciosamente incompleto — o pior
// jeito de um backup falhar.
const PAGINA = 1000;

async function baixarTabela(rest, tabela) {
  const linhas = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const r = await fetch(`${rest.base}/rest/v1/${tabela}?select=*`, {
      headers: rest.cabecalhos({ Range: `${inicio}-${inicio + PAGINA - 1}`, Prefer: 'count=exact' })
    });
    if (!r.ok) throw new Error(`${tabela}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
    const lote = await r.json();
    linhas.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return linhas;
}

async function listarStorage(rest, bucket, prefixo = '') {
  const achados = [];
  const r = await fetch(`${rest.base}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: rest.cabecalhos(),
    body: JSON.stringify({ prefix: prefixo, limit: 1000, sortBy: { column: 'name', order: 'asc' } })
  });
  if (!r.ok) return achados;
  for (const item of await r.json()) {
    const caminho = prefixo ? `${prefixo}${item.name}` : item.name;
    // Sem `id` é pasta, não arquivo: o Storage não tem pasta de verdade, mas a
    // listagem finge que tem, e é preciso descer nela.
    if (item.id) achados.push({ caminho, tamanho: (item.metadata && item.metadata.size) || 0 });
    else achados.push(...await listarStorage(rest, bucket, `${caminho}/`));
  }
  return achados;
}

(async () => {
  const rest = criarRest();
  const { tabelas, dependencias, colunasFk, colunasIdentidade } = lerEstrutura();
  const { ordem, ciclos } = ordenarPorDependencia(tabelas, dependencias);

  // Nome pela data/hora local: backup com nome fixo se sobrescreve, e um
  // backup sobrescrito por um backup ruim é a forma mais comum de não ter
  // backup nenhum.
  const agora = new Date();
  const carimbo = [
    agora.getFullYear(),
    String(agora.getMonth() + 1).padStart(2, '0'),
    String(agora.getDate()).padStart(2, '0'),
    '-',
    String(agora.getHours()).padStart(2, '0'),
    String(agora.getMinutes()).padStart(2, '0'),
    String(agora.getSeconds()).padStart(2, '0')
  ].join('');
  const destino = path.join(RAIZ, 'data', 'backup', carimbo);
  fs.mkdirSync(path.join(destino, 'tabelas'), { recursive: true });

  console.log(`Backup em data/backup/${carimbo}`);
  console.log(`${tabelas.length} tabelas declaradas.\n`);

  const manifesto = {
    criadoEm: agora.toISOString(),
    projeto: (process.env.SUPABASE_URL || '').replace(/^https:\/\//, '').split('.')[0],
    // A ordem vai NO manifesto: a restauração não recalcula, usa a que valia
    // quando o backup foi tirado. Se o schema mudar depois, restaurar com a
    // ordem nova sobre dados antigos é justamente o que dá erro de chave.
    ordemDeInsercao: ordem,
    colunasFk,
    // Colunas que o banco gera e recusa receber prontas: a restauracao
    // precisa saber quais sao para nao tentar e nao mentir sobre o resultado.
    colunasIdentidade,
    ciclos,
    tabelas: [],
    storage: [],
    erros: []
  };

  let totalLinhas = 0;
  for (const tabela of ordem) {
    try {
      const linhas = await baixarTabela(rest, tabela);
      // Tabela vazia também gera arquivo: a ausência do arquivo passaria a
      // significar duas coisas (vazia OU não coletada), e na hora de restaurar
      // ninguém saberia qual.
      fs.writeFileSync(path.join(destino, 'tabelas', `${tabela}.json`), JSON.stringify(linhas, null, 1));
      manifesto.tabelas.push({ nome: tabela, linhas: linhas.length });
      totalLinhas += linhas.length;
      if (linhas.length) console.log(`  ${String(linhas.length).padStart(6)}  ${tabela}`);
    } catch (erro) {
      // Erro numa tabela não derruba o backup das outras — mas VAI para o
      // manifesto. Backup com buraco não anunciado é pior do que backup que
      // falhou barulhentamente.
      manifesto.erros.push({ tabela, erro: erro.message });
      console.error(`  ERRO   ${tabela}: ${erro.message}`);
    }
  }

  console.log('\nStorage:');
  const buckets = await (await fetch(`${rest.base}/storage/v1/bucket`, { headers: rest.cabecalhos() })).json();
  for (const bucket of (Array.isArray(buckets) ? buckets : [])) {
    const arquivos = await listarStorage(rest, bucket.name);
    for (const arquivo of arquivos) {
      const r = await fetch(`${rest.base}/storage/v1/object/${bucket.name}/${arquivo.caminho}`, { headers: rest.cabecalhos() });
      if (!r.ok) {
        manifesto.erros.push({ storage: `${bucket.name}/${arquivo.caminho}`, erro: `HTTP ${r.status}` });
        continue;
      }
      const destinoArquivo = path.join(destino, 'storage', bucket.name, ...arquivo.caminho.split('/'));
      fs.mkdirSync(path.dirname(destinoArquivo), { recursive: true });
      fs.writeFileSync(destinoArquivo, Buffer.from(await r.arrayBuffer()));
      manifesto.storage.push({ bucket: bucket.name, caminho: arquivo.caminho, tamanho: arquivo.tamanho, publico: bucket.public });
    }
    console.log(`  ${String(arquivos.length).padStart(6)}  ${bucket.name}${bucket.public ? ' (PÚBLICO)' : ' (privado)'}`);
  }

  fs.writeFileSync(path.join(destino, 'manifesto.json'), JSON.stringify(manifesto, null, 2));

  console.log(`\n${totalLinhas} linhas em ${manifesto.tabelas.filter((t) => t.linhas).length} tabelas com dados.`);
  console.log(`${manifesto.storage.length} arquivo(s) do Storage.`);
  if (ciclos.length) {
    console.log(`\nAVISO: ${ciclos.length} ciclo(s) de chave estrangeira — a restauração resolve em duas passadas.`);
  }
  if (manifesto.erros.length) {
    console.log(`\n${manifesto.erros.length} ERRO(S) — este backup está INCOMPLETO. Veja manifesto.json.`);
    process.exit(1);
  }
  console.log(`\nRestaure com:  node scripts/restaurar-supabase.js data/backup/${carimbo}`);
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
