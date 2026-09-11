#!/usr/bin/env node
/**
 * LIMPAR O SISTEMA — tira o dado de teste e deixa o ERP pronto para começar.
 *
 * Uso:
 *   node scripts/limpar-sistema.js              mostra o que SERIA apagado (não apaga)
 *   node scripts/limpar-sistema.js --apagar     apaga, depois de tirar um backup
 *
 * O QUE FICA, E POR QUÊ
 * ---------------------
 * Só duas coisas, e nenhuma delas é dado de ninguém:
 *
 *   1. OS CATÁLOGOS DE REFERÊNCIA — CFOP, CST, CSOSN, origem de mercadoria,
 *      classificação tributária, transições de status, papéis e permissões.
 *      Nasceram junto com o schema, são tabelas da Receita e do desenho do
 *      sistema. Apagá-las não limparia nada: quebraria o ERP.
 *
 *   2. O USUÁRIO `admin`. Sem ele não há como entrar e recomeçar.
 *
 * Todo o resto sai: pedidos, produtos, estoque, financeiro, pessoas, contas
 * bancárias, NF-e, empresa, estabelecimento, regras fiscais, e a trilha de
 * auditoria.
 *
 * O PERIGO DO `TRUNCATE ... CASCADE`, E POR QUE ESTE SCRIPT EXISTE
 * ---------------------------------------------------------------
 * `CASCADE` no TRUNCATE não apaga LINHAS que referenciam — apaga as TABELAS
 * que referenciam, inteiras, tenham elas linhas apontando ou não.
 *
 * Desde a fase CD, `users.estabelecimento_id` referencia `estabelecimento`. Um
 * `TRUNCATE estabelecimento CASCADE` levaria a tabela `users` junto — inclusive
 * o admin, que é justamente o que esta limpeza existe para preservar. E sem
 * erro nenhum: CASCADE inclui em silêncio.
 *
 * Por isso o script NÃO decora a lista. Ele PERGUNTA ao banco quais tabelas
 * preservadas referenciam tabelas que vão ser apagadas, e:
 *   · coluna anulável  -> zera a coluna e tira a tabela referenciada do
 *                         TRUNCATE, apagando-a por DELETE no fim;
 *   · coluna obrigatória -> PARA e explica, em vez de escolher sozinho entre
 *                         quebrar a referência e apagar o que deveria ficar.
 *
 * Assim, uma chave estrangeira nova criada daqui a um ano não transforma esta
 * limpeza numa perda silenciosa.
 *
 * O `db.json` TAMBÉM É LIMPO. Ele guarda 17 coleções fora do Postgres, e
 * sobrou nele resíduo do teste (a NF-e, a empresa do cadastro, metadados de
 * produto). Sem limpar, o app sincroniza de volta o que o banco já não tem.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { consultar, fecharPool } = require('../lib/db/conexao');

const APAGAR = process.argv.includes('--apagar');
const ADMIN = 'user-admin';

// ---------------------------------------------------------------------------
// O QUE FICA. Cada grupo com o motivo — a lista sem o porquê vira adivinhação
// na próxima vez que alguém precisar mexer nela.
// ---------------------------------------------------------------------------
const PRESERVAR = {
  'tabelas da Receita e do fisco': [
    'cfop', 'csosn', 'cst_icms', 'cst_ipi', 'cst_pis_cofins', 'cst_ibs_cbs',
    'origem_mercadoria', 'classificacao_tributaria'
  ],
  'desenho do sistema': [
    // A máquina de status das vendas: quais transições existem.
    'sales_status_transicao',
    // O que cada papel pode fazer. É definição, não é dado de usuário.
    'roles', 'permissions', 'role_permissions',
    // Linha única exigida pelo schema (check id = 1).
    'settings'
  ],
  'o acesso que sobra': [
    // Parcial: só o admin. Tratadas fora do TRUNCATE, mais abaixo.
    'users', 'user_roles', 'user_permissions'
  ]
};
const CONJUNTO_PRESERVADO = new Set(Object.values(PRESERVAR).flat());

const fmt = (n) => String(n).padStart(6);

async function tabelasDoBanco() {
  const r = await consultar(
    "select tablename from pg_tables where schemaname = 'public' order by tablename"
  );
  return r.rows.map((l) => l.tablename);
}

async function contar(tabela) {
  // Nome entre aspas duplas: identificador, não texto. Os nomes vêm do próprio
  // pg_tables, então não há de onde vir injeção — as aspas são para o caso de
  // um nome que colida com palavra reservada.
  const r = await consultar(`select count(*)::int as n from "${tabela}"`);
  return r.rows[0].n;
}

/**
 * Até onde o CASCADE chegaria partindo das tabelas preservadas — TRANSITIVAMENTE.
 *
 * `TRUNCATE T CASCADE` esvazia T e toda tabela que referencia T, e toda que
 * referencia ESSAS, e assim por diante. Então truncar T é perigoso se alguma
 * tabela preservada alcançar T seguindo chaves estrangeiras, por mais longe que
 * esteja o caminho.
 *
 * A primeira versão desta função olhava só o primeiro salto, e o ensaio mostrou
 * que não bastava:
 *
 *     users -> estabelecimento -> empresa
 *
 * `estabelecimento` ficava de fora do TRUNCATE, certo. Mas `empresa` entrava — e
 * truncá-la levaria `estabelecimento` junto, que levaria `users`, que é o admin.
 * Um salto a mais, e a limpeza apagaria exatamente o que ela existe para
 * preservar, sem erro nenhum.
 */
async function alcancadasPeloCascade(paraApagar) {
  const r = await consultar(`
    select tc.table_name as origem,
           ccu.table_name as destino,
           kcu.column_name as coluna,
           c.is_nullable = 'YES' as anulavel
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    join information_schema.columns c
      on c.table_name = tc.table_name and c.column_name = kcu.column_name and c.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
  `);
  const apagar = new Set(paraApagar);
  const arestas = r.rows;

  // Caminhada a partir das preservadas, seguindo origem -> destino.
  const alcancadas = new Map();          // tabela apagável -> por onde se chegou
  const visitadas = new Set(CONJUNTO_PRESERVADO);
  const primeiroSalto = [];
  let fronteira = [...CONJUNTO_PRESERVADO];

  while (fronteira.length) {
    const proxima = [];
    for (const tabela of fronteira) {
      for (const a of arestas) {
        if (a.origem !== tabela) continue;
        // Só o PRIMEIRO salto precisa de coluna anulável: é o único que sai de
        // uma tabela que vai continuar existindo, com linhas dentro. Os saltos
        // seguintes são entre tabelas que vão ficar vazias de qualquer jeito.
        if (CONJUNTO_PRESERVADO.has(tabela) && apagar.has(a.destino)) primeiroSalto.push(a);
        if (!apagar.has(a.destino) || visitadas.has(a.destino)) continue;
        visitadas.add(a.destino);
        alcancadas.set(a.destino, `${a.origem}.${a.coluna}`);
        proxima.push(a.destino);
      }
    }
    fronteira = proxima;
  }
  return { primeiroSalto, alcancadas };
}

// As sequences que NÃO pertencem a uma coluna: o RESTART IDENTITY do TRUNCATE
// não as alcança, e sem zerar elas o primeiro pedido do sistema limpo nasceria
// com o número 9108.
const SEQUENCES = [
  'cadastro_code_seq', 'sales_code_seq', 'purchase_orders_code_seq',
  'financial_entries_code_seq', 'stock_movements_code_seq', 'stock_transfers_code_seq'
];

const DB_JSON = path.join(__dirname, '..', 'data', 'db.json');

/**
 * Zera o db.json PRESERVANDO A FORMA: cada chave continua existindo, lista vira
 * lista vazia. Trocar o arquivo por `{}` faria o app reconstruí-lo, e o que ele
 * reconstrói não é necessariamente o que estava lá.
 */
function limparDbJson({ apagar }) {
  if (!fs.existsSync(DB_JSON)) return { antes: {}, chaves: 0 };
  const dados = JSON.parse(fs.readFileSync(DB_JSON, 'utf8'));
  const antes = {};
  const novo = {};
  for (const [chave, valor] of Object.entries(dados)) {
    if (Array.isArray(valor)) {
      if (valor.length) antes[chave] = `${valor.length} itens`;
      novo[chave] = [];
    } else if (valor && typeof valor === 'object') {
      const n = Object.keys(valor).length;
      if (n) antes[chave] = `${n} chaves`;
      novo[chave] = {};
    } else if (typeof valor === 'number') {
      // nextCadastroCode e afins: o contador volta ao começo.
      if (valor !== 1) antes[chave] = String(valor);
      novo[chave] = 1;
    } else {
      novo[chave] = valor;
    }
  }
  if (apagar) fs.writeFileSync(DB_JSON, `${JSON.stringify(novo, null, 2)}\n`, 'utf8');
  return { antes, chaves: Object.keys(dados).length };
}

function tirarBackup() {
  console.log('\n--- backup antes de apagar ---');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'backup-banco.js')], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  if (r.status !== 0) {
    console.error('\nO backup FALHOU. Nada foi apagado.');
    process.exit(1);
  }
}

(async () => {
  const todas = await tabelasDoBanco();
  const paraApagar = todas.filter((t) => !CONJUNTO_PRESERVADO.has(t));

  // ---- a conferência que evita a perda silenciosa -------------------------
  const { primeiroSalto: arestas, alcancadas } = await alcancadasPeloCascade(paraApagar);
  const obrigatorias = arestas.filter((a) => !a.anulavel);
  if (obrigatorias.length) {
    console.error('\nPAREI. Uma tabela que deve FICAR aponta, por coluna obrigatória, para uma que seria apagada:');
    for (const a of obrigatorias) {
      console.error(`  ${a.origem}.${a.coluna} -> ${a.destino}  (NOT NULL)`);
    }
    console.error('\nApagar assim exigiria escolher entre quebrar a referência e apagar o que deveria ficar.');
    console.error('Essa escolha é de quem conhece o caso, não deste script.');
    await fecharPool();
    process.exit(1);
  }

  // Tudo que o CASCADE alcançaria sai do TRUNCATE e é apagado por DELETE no fim.
  // Não só o primeiro salto: a cadeia inteira, porque truncar a ponta puxaria a
  // corrente de volta até a tabela preservada.
  const foraDoTruncate = new Set(alcancadas.keys());
  const truncar = paraApagar.filter((t) => !foraDoTruncate.has(t));

  // ---- o que existe hoje --------------------------------------------------
  const comDados = [];
  for (const t of paraApagar) {
    const n = await contar(t);
    if (n > 0) comDados.push([t, n]);
  }
  comDados.sort((a, b) => b[1] - a[1]);

  const usuarios = await consultar('select id, username, name from users order by created_at');
  const sobram = usuarios.rows.filter((u) => u.id !== ADMIN);

  console.log(APAGAR ? '=== LIMPANDO O SISTEMA ===' : '=== ENSAIO — nada será apagado ===');
  console.log(`\nTabelas no banco: ${todas.length}   ·   ficam: ${CONJUNTO_PRESERVADO.size}   ·   esvaziam: ${paraApagar.length}`);

  console.log('\n--- o que SAI (só as que têm dado) ---');
  if (!comDados.length) console.log('  (nada — o banco já está limpo)');
  for (const [t, n] of comDados) console.log(`  ${fmt(n)}  ${t}`);

  console.log('\n--- usuários ---');
  for (const u of usuarios.rows) {
    console.log(`  ${u.id === ADMIN ? 'FICA' : ' sai'}  ${String(u.username).padEnd(16)} ${u.name}`);
  }

  if (arestas.length) {
    console.log('\n--- referências neutralizadas antes de apagar ---');
    for (const a of arestas) {
      console.log(`  ${a.origem}.${a.coluna} -> ${a.destino}   (zera a coluna)`);
    }
  }
  if (foraDoTruncate.size) {
    console.log('\n--- fora do TRUNCATE, apagadas por DELETE (o CASCADE chegaria nelas) ---');
    for (const [tabela, caminho] of alcancadas) {
      console.log(`  ${tabela.padEnd(22)} alcançada por ${caminho}`);
    }
  }

  const dbjson = limparDbJson({ apagar: false });
  console.log('\n--- data/db.json ---');
  const residuo = Object.entries(dbjson.antes);
  if (!residuo.length) console.log('  (já está vazio)');
  for (const [k, v] of residuo) console.log(`  ${k.padEnd(20)} ${v}`);

  console.log('\n--- contadores que voltam a 1 ---');
  const seqs = await consultar(
    `select sequencename, last_value from pg_sequences where schemaname = 'public' and sequencename = any($1)`,
    [SEQUENCES]
  );
  for (const s of seqs.rows) console.log(`  ${s.sequencename.padEnd(30)} ${s.last_value === null ? '(nunca usada)' : s.last_value}`);

  if (!APAGAR) {
    console.log('\n===========================================================');
    console.log('  Nada foi apagado. Para apagar de verdade:');
    console.log('      node scripts/limpar-sistema.js --apagar');
    console.log('  (o backup sai sozinho antes)');
    console.log('===========================================================');
    await fecharPool();
    return;
  }

  tirarBackup();

  console.log('\n--- apagando ---');
  // Uma transação só: uma limpeza pela metade é pior que nenhuma — deixaria o
  // sistema com pedido sem produto e lançamento sem conta.
  const cliente = await require('../lib/db/conexao').obterPool().connect();
  try {
    await cliente.query('begin');

    for (const a of arestas) {
      await cliente.query(`update ${a.origem} set ${a.coluna} = null`);
    }
    const lista = truncar.map((t) => `"${t}"`).join(', ');
    await cliente.query(`truncate table ${lista} restart identity cascade`);
    console.log(`  ${fmt(truncar.length)} tabelas esvaziadas`);

    // As que ficaram de fora do TRUNCATE, agora sem ninguém apontando para elas.
    // Em laço porque uma pode referenciar a outra (estabelecimento -> empresa).
    let pendentes = [...foraDoTruncate];
    for (let volta = 0; volta < 10 && pendentes.length; volta++) {
      const falharam = [];
      for (const t of pendentes) {
        try {
          await cliente.query('savepoint tentativa');
          await cliente.query(`delete from "${t}"`);
          await cliente.query('release savepoint tentativa');
        } catch (erro) {
          await cliente.query('rollback to savepoint tentativa');
          falharam.push(t);
        }
      }
      pendentes = falharam;
    }
    if (pendentes.length) throw new Error(`Não consegui esvaziar: ${pendentes.join(', ')}`);
    console.log(`  ${fmt(foraDoTruncate.size)} tabelas esvaziadas por DELETE (as referenciadas)`);

    await cliente.query('delete from user_permissions where user_id <> $1', [ADMIN]);
    await cliente.query('delete from user_roles where user_id <> $1', [ADMIN]);
    const apagados = await cliente.query('delete from users where id <> $1', [ADMIN]);
    console.log(`  ${fmt(apagados.rowCount)} usuários removidos`);

    for (const s of SEQUENCES) {
      await cliente.query(`alter sequence if exists ${s} restart with 1`);
    }
    console.log(`  ${fmt(SEQUENCES.length)} contadores de volta ao 1`);

    await cliente.query('commit');
  } catch (erro) {
    await cliente.query('rollback');
    console.error('\nFALHOU — nada foi apagado (a transação voltou atrás):');
    console.error('  ' + erro.message);
    cliente.release();
    await fecharPool();
    process.exit(1);
  }
  cliente.release();

  limparDbJson({ apagar: true });
  console.log('         data/db.json zerado, com a forma preservada');

  // ---- o que sobrou, lido do banco e não suposto --------------------------
  console.log('\n--- conferindo ---');
  let sujas = 0;
  for (const t of paraApagar) {
    const n = await contar(t);
    if (n > 0) { console.log(`  XX  ${t} ainda tem ${n}`); sujas++; }
  }
  const restantes = await consultar('select username, name, role from users');
  console.log(`  OK  ${paraApagar.length - sujas} de ${paraApagar.length} tabelas vazias`);
  for (const u of restantes.rows) console.log(`  OK  usuário ${u.username} (${u.name}, ${u.role})`);
  const cat = await contar('cfop');
  console.log(`  OK  catálogo fiscal intacto — ${cat} CFOPs`);

  console.log(sujas ? '\n===== SOBROU COISA =====' : '\n===== SISTEMA LIMPO =====');
  await fecharPool();
  process.exit(sujas ? 1 : 0);
})();
