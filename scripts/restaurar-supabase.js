#!/usr/bin/env node
/**
 * RESTAURAÇÃO de um backup feito por scripts/backup-supabase.js.
 *
 *   node scripts/restaurar-supabase.js data/backup/<data-hora>            # ensaio
 *   node scripts/restaurar-supabase.js data/backup/<data-hora> --executar # vale
 *   node scripts/restaurar-supabase.js data/backup/<data-hora> --executar --tabelas orders,quotes
 *
 * ENSAIO É O PADRÃO. Sem `--executar` nada é escrito: o script lê o backup,
 * confere contra o banco e diz o que faria. Restauração é a operação que se
 * usa no pior dia do ano, e um script que escreve por engano nesse dia não tem
 * defesa.
 *
 * COMO ELE ESCREVE
 * ----------------
 * Upsert por chave primária (Prefer: resolution=merge-duplicates): a linha que
 * não existe é criada, a que existe é sobrescrita. Isso torna a restauração
 * repetível — rodar duas vezes dá o mesmo resultado — e permite restaurar por
 * cima de um banco parcialmente vivo.
 *
 * Ele NÃO apaga o que está no banco e não está no backup. Restauração que apaga
 * é migração ao contrário; se for isso que se quer, apague antes, à mão,
 * olhando o que vai embora.
 *
 * DUAS PASSADAS, POR CAUSA DE CICLO
 * ---------------------------------
 * `hr_departments.manager_id` aponta para `hr_employees`, e
 * `hr_employees.department_id` aponta de volta. Não existe ordem que satisfaça
 * as duas. A primeira passada insere com essas colunas vazias; a segunda
 * preenche. É o que o pg_dump faz adiando a checagem de constraint — aqui,
 * sem transação, é feito à mão.
 *
 * O GATILHO DE STATUS PODE RECUSAR
 * --------------------------------
 * Desde a fase-AJ, orders e quotes têm gatilho de transição. Num banco VAZIO
 * (o caso de desastre) a restauração é INSERT e passa livre. Restaurando POR
 * CIMA de linhas mais novas, o upsert vira UPDATE e o gatilho pode recusar
 * — por exemplo devolver um pedido faturado para "pedido". O script não
 * contorna: relata a linha e o motivo, porque contornar seria desfazer no
 * escuro a regra que existe para proteger estoque e financeiro.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { criarRest } = require('./lib-backup');

const RAIZ = path.join(__dirname, '..');
const LOTE = 500;

const args = process.argv.slice(2);
const pasta = args.find((a) => !a.startsWith('--'));
const executar = args.includes('--executar');
const iTabelas = args.indexOf('--tabelas');
const filtro = iTabelas >= 0 && args[iTabelas + 1] ? args[iTabelas + 1].split(',').map((s) => s.trim()) : null;

if (!pasta) {
  console.error('Informe a pasta do backup. Ex.: node scripts/restaurar-supabase.js data/backup/20260824-094251');
  process.exit(1);
}
const dir = path.isAbsolute(pasta) ? pasta : path.join(RAIZ, pasta);
if (!fs.existsSync(path.join(dir, 'manifesto.json'))) {
  console.error(`Não achei manifesto.json em ${dir}. Esta pasta é mesmo um backup?`);
  process.exit(1);
}

const manifesto = JSON.parse(fs.readFileSync(path.join(dir, 'manifesto.json'), 'utf8'));

(async () => {
  const rest = criarRest();

  console.log(`Backup de ${manifesto.criadoEm} (projeto ${manifesto.projeto})`);
  console.log(executar ? 'MODO: EXECUTAR — vai escrever no banco.\n' : 'MODO: ENSAIO — nada será escrito. Use --executar para valer.\n');

  if (manifesto.erros && manifesto.erros.length) {
    console.log(`AVISO: este backup registrou ${manifesto.erros.length} erro(s) na coleta — está incompleto.\n`);
  }

  // Quais colunas precisam ficar vazias na primeira passada: as que apontam
  // para tabela que ainda não foi inserida.
  const jaInseridas = new Set();
  const adiadas = [];

  const ordem = (manifesto.ordemDeInsercao || []).filter((t) => !filtro || filtro.includes(t));
  let totalEnviado = 0;
  let totalFalhas = 0;

  for (const tabela of ordem) {
    const arquivo = path.join(dir, 'tabelas', `${tabela}.json`);
    if (!fs.existsSync(arquivo)) continue;
    const linhas = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    if (!linhas.length) { jaInseridas.add(tabela); continue; }

    // TABELA COM COLUNA GERADA PELO BANCO (identity/serial).
    //
    // O Postgres recusa receber o valor pronto ("Column is an identity column
    // defined as GENERATED ALWAYS"), então só dá para restaurar sem o id — e
    // aí as linhas voltam com ids NOVOS. Duas consequências:
    //
    //   1. não dá para casar linha do backup com linha do banco, então a
    //      restauração deixa de ser repetível: rodar duas vezes DUPLICARIA;
    //   2. quem apontasse para esses ids ficaria apontando para o nada.
    //
    // Por isso a regra é: restaura só se a tabela estiver VAZIA. Com linhas
    // dentro, avisa e sai — é `access_logs`, uma trilha de acesso, e duplicar
    // trilha de auditoria é pior do que não restaurá-la.
    const identidade = (manifesto.colunasIdentidade && manifesto.colunasIdentidade[tabela]) || [];
    if (identidade.length) {
      const existentes = Number(await contar(rest, tabela)) || 0;
      if (existentes > 0) {
        console.log(`  ${'-'.padStart(6)}  ${tabela.padEnd(28)} PULADA: já tem ${existentes} linha(s) e o id é gerado pelo banco`
          + ` (${identidade.join(', ')}) — restaurar duplicaria.`);
        jaInseridas.add(tabela);
        continue;
      }
      if (!executar) {
        console.log(`  ${String(linhas.length).padStart(6)}  ${tabela.padEnd(28)} (vazia; volta com ids NOVOS em ${identidade.join(', ')})`);
        jaInseridas.add(tabela);
        totalEnviado += linhas.length;
        continue;
      }
      const semId = linhas.map((l) => { const c = { ...l }; identidade.forEach((k) => delete c[k]); return c; });
      const falhasId = await enviar(rest, tabela, semId, { upsert: false });
      jaInseridas.add(tabela);
      totalEnviado += linhas.length - falhasId.length;
      totalFalhas += falhasId.length;
      console.log(`  ${String(linhas.length - falhasId.length).padStart(6)}  ${tabela.padEnd(28)} ids NOVOS em ${identidade.join(', ')}`
        + (falhasId.length ? `  ${falhasId.length} FALHA(S): ${falhasId[0].slice(0, 90)}` : ''));
      continue;
    }

    const fks = (manifesto.colunasFk && manifesto.colunasFk[tabela]) || [];
    const paraAdiar = fks.filter((f) => !jaInseridas.has(f.alvo) && f.alvo !== tabela).map((f) => f.coluna);

    const payload = linhas.map((linha) => {
      if (!paraAdiar.length) return linha;
      const copia = { ...linha };
      paraAdiar.forEach((c) => { if (copia[c] !== undefined) copia[c] = null; });
      return copia;
    });
    if (paraAdiar.length) {
      // Guarda o original para a segunda passada devolver o valor.
      adiadas.push({ tabela, colunas: paraAdiar, linhas });
    }

    if (!executar) {
      const existentes = await contar(rest, tabela);
      console.log(`  ${String(linhas.length).padStart(6)}  ${tabela.padEnd(28)} (no banco agora: ${existentes})`
        + (paraAdiar.length ? `  [adia ${paraAdiar.join(', ')}]` : ''));
      jaInseridas.add(tabela);
      totalEnviado += linhas.length;
      continue;
    }

    const falhas = await enviar(rest, tabela, payload);
    jaInseridas.add(tabela);
    totalEnviado += linhas.length - falhas.length;
    totalFalhas += falhas.length;
    console.log(`  ${String(linhas.length - falhas.length).padStart(6)}  ${tabela.padEnd(28)}`
      + (falhas.length ? `  ${falhas.length} FALHA(S): ${falhas[0].slice(0, 100)}` : '')
      + (paraAdiar.length ? `  [adiou ${paraAdiar.join(', ')}]` : ''));
  }

  if (adiadas.length) {
    console.log(`\nSegunda passada — devolvendo ${adiadas.length} coluna(s) de ciclo:`);
    for (const { tabela, colunas, linhas } of adiadas) {
      const comValor = linhas.filter((l) => colunas.some((c) => l[c] !== null && l[c] !== undefined));
      if (!comValor.length) { console.log(`  ${tabela}: nenhuma linha tinha valor nessas colunas.`); continue; }
      if (!executar) { console.log(`  ${tabela}: ${comValor.length} linha(s) a completar em ${colunas.join(', ')}`); continue; }
      const falhas = await enviar(rest, tabela, comValor);
      console.log(`  ${tabela}: ${comValor.length - falhas.length} completada(s)`
        + (falhas.length ? `, ${falhas.length} FALHA(S): ${falhas[0].slice(0, 100)}` : ''));
      totalFalhas += falhas.length;
    }
  }

  const arquivosStorage = manifesto.storage || [];
  if (arquivosStorage.length) {
    console.log(`\nStorage — ${arquivosStorage.length} arquivo(s):`);
    for (const item of arquivosStorage) {
      const local = path.join(dir, 'storage', item.bucket, ...item.caminho.split('/'));
      if (!fs.existsSync(local)) { console.log(`  FALTA no backup: ${item.bucket}/${item.caminho}`); totalFalhas++; continue; }
      if (!executar) { console.log(`  ${item.bucket}/${item.caminho} (${item.tamanho} B)`); continue; }
      await garantirBucket(rest, item.bucket, item.publico);
      // upsert=true aqui: restaurar duas vezes tem de dar o mesmo resultado, e
      // o arquivo é o mesmo conteúdo sob a mesma chave.
      const r = await fetch(`${rest.base}/storage/v1/object/${item.bucket}/${item.caminho}`, {
        method: 'POST',
        headers: Object.assign(rest.cabecalhos({ 'x-upsert': 'true' }), { 'content-type': 'application/octet-stream' }),
        body: fs.readFileSync(local)
      });
      console.log(`  ${r.ok ? 'ok  ' : 'FALHOU '} ${item.bucket}/${item.caminho}${r.ok ? '' : ' — ' + (await r.text()).slice(0, 90)}`);
      if (!r.ok) totalFalhas++;
    }
  }

  console.log(`\n${totalEnviado} linha(s) ${executar ? 'gravadas' : 'a gravar'}${totalFalhas ? `, ${totalFalhas} FALHA(S)` : ''}.`);
  if (!executar) console.log(`\nEnsaio. Para valer:  node scripts/restaurar-supabase.js ${pasta} --executar`);
  process.exit(totalFalhas ? 1 : 0);
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });

async function contar(rest, tabela) {
  const r = await fetch(`${rest.base}/rest/v1/${tabela}?select=*`, {
    headers: rest.cabecalhos({ Range: '0-0', Prefer: 'count=exact' })
  });
  if (!r.ok) return '?';
  return (r.headers.get('content-range') || '').split('/')[1] || '?';
}

// Em lotes: um POST com 10 mil linhas estoura o limite de corpo do PostgREST, e
// o erro que volta não diz que o problema foi o tamanho.
// `upsert:false` para tabela de id gerado: sem chave para casar, merge nao
// tem em que se apoiar e o Postgres reclama de "no unique constraint".
async function enviar(rest, tabela, linhas, { upsert = true } = {}) {
  const falhas = [];
  for (let i = 0; i < linhas.length; i += LOTE) {
    const lote = linhas.slice(i, i + LOTE);
    const r = await fetch(`${rest.base}/rest/v1/${tabela}`, {
      method: 'POST',
      headers: rest.cabecalhos({ Prefer: (upsert ? 'resolution=merge-duplicates,' : '') + 'return=minimal' }),
      body: JSON.stringify(lote)
    });
    if (!r.ok) falhas.push(`${(await r.text()).slice(0, 300)}`);
  }
  return falhas;
}

async function garantirBucket(rest, nome, publico) {
  const r = await fetch(`${rest.base}/storage/v1/bucket/${nome}`, { headers: rest.cabecalhos() });
  if (r.ok) return;
  await fetch(`${rest.base}/storage/v1/bucket`, {
    method: 'POST',
    headers: rest.cabecalhos(),
    // O bucket volta com a MESMA visibilidade que tinha: recriar um bucket
    // privado como público exporia todo anexo a quem tivesse a URL.
    body: JSON.stringify({ name: nome, id: nome, public: Boolean(publico) })
  });
}
