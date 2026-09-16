#!/usr/bin/env node
/**
 * APLICA as migrações que faltam, na ordem das fases, cada uma numa transação.
 *
 *   node scripts/aplicar-migracoes.js            (npm run migracoes:aplicar)
 *   node scripts/aplicar-migracoes.js --simular  diz o que faria, sem escrever nada
 *
 * "Sem escrever nada" é literal: nem a tabela do livro-caixa. A primeira versão
 * criava `schema_migracoes` antes de olhar para o `--simular`, e o ensaio
 * deixava a tabela para trás — visto em produção, depois do dry-run no VPS ela
 * existia com 0 linhas. Ler, ele lê: precisa perguntar ao banco o que já está
 * lá para ter o que dizer.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * Até aqui, "aplicar migração" era um passo humano: o verificador listava o que
 * faltava e mandava colar no SQL Editor do Supabase — um painel web que esta
 * instalação não tem desde agosto de 2026, quando o banco virou um Postgres em
 * Docker. O deploy do VPS chegava nesse ponto e parava esperando alguém
 * executar um passo que não existe mais.
 *
 * O LIVRO-CAIXA, E POR QUE ELE NÃO EXISTIA ANTES
 * ----------------------------------------------
 * O verificador descobre o que falta OLHANDO O BANCO: ele lê as migrações e
 * pergunta se cada tabela e cada coluna estão lá. Isso responde bem "falta
 * alguma coisa?", e não responde "esta migração já rodou?" — são perguntas
 * diferentes, e a segunda é a que o aplicador precisa. Doze das migrações só
 * inserem dado (permissões, CSTs, status, categorias): elas não criam tabela
 * nem coluna, então o verificador as marca NÃO CONFERIDA, e rodar de novo o que
 * já rodou duplicaria linha.
 *
 * Daí a tabela `schema_migracoes`: um registro por arquivo já aplicado. A
 * gravação acontece DENTRO da mesma transação do SQL da migração — migração que
 * falha no meio não deixa registro, e a próxima tentativa a encontra pendente
 * de novo.
 *
 * A PRIMEIRA RODADA NUM BANCO QUE JÁ EXISTE
 * -----------------------------------------
 * Este banco tem 52 migrações aplicadas à mão ao longo de meses, e nenhum
 * registro delas. Se o livro-caixa nascesse vazio e o script simplesmente
 * "aplicasse tudo que não está registrado", ele rodaria as 52 de novo num banco
 * em produção — e as doze que inserem dado duplicariam.
 *
 * Então a primeira rodada ADOTA em vez de aplicar: pergunta ao banco, pelo
 * mesmo caminho do verificador, o que já está lá, e registra essas como
 * adotadas sem executar uma linha de SQL. Só o que o verificador aponta como
 * PENDENTE é executado de verdade.
 *
 * As NÃO CONFERIDAS entram como adotadas, e isso é uma aposta declarada: não há
 * como saber se rodaram. Num banco que já está no ar há meses, supor que
 * rodaram é o lado seguro — o outro lado duplica dado. O script diz quais
 * foram, uma por uma, para a decisão não ficar escondida.
 */
require('dotenv').config();
const { consultar, emTransacao } = require('../lib/db/conexao');
const { banco } = require('../lib/db/client');
const { lerMigracoes, conferir } = require('../lib/migracoes');

const SIMULAR = process.argv.includes('--simular');
// A volta ao comportamento antigo, para um banco antigo em que as não
// conferidas comprovadamente rodaram e ninguém quer arriscar rodá-las de novo.
// É opção, e não padrão, porque o padrão errado custou três migrações
// registradas sem nunca terem sido executadas — ver o bloco da primeira rodada.
const ADOTAR_NAO_CONFERIDAS = process.argv.includes('--adotar-nao-conferidas');

// Mesmas sondas do verificador: o cliente devolve erro nomeando a coluna ou a
// tabela quando ela não existe.
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

async function criarLivroCaixa() {
  await consultar(`
    create table if not exists schema_migracoes (
      nome text primary key,
      aplicada_em timestamptz not null default now(),
      -- 'aplicada' = este script rodou o SQL.
      -- 'adotada'  = o banco já tinha, registrada sem executar nada.
      como text not null default 'aplicada'
    )
  `);
}

async function jaRegistradas() {
  // Tabela ausente é resposta, não erro: significa "nenhuma registrada", que é
  // o retrato de uma primeira rodada. Sem isto, `--simular` teria de criar a
  // tabela só para poder consultá-la — e criar nada é o que ele promete.
  if (!(await existeTabela('schema_migracoes'))) return new Map();
  const { rows } = await consultar('select nome, como from schema_migracoes');
  return new Map(rows.map((r) => [r.nome, r.como]));
}

async function aplicar(migracao) {
  await emTransacao(async (cliente) => {
    await cliente.query(migracao.sql);
    // No MESMO commit do SQL: migração que falha no meio não deixa registro, e
    // a próxima rodada a encontra pendente de novo em vez de pulá-la.
    await cliente.query(
      "insert into schema_migracoes (nome, como) values ($1, 'aplicada') on conflict (nome) do nothing",
      [migracao.nome]
    );
  });
}

async function adotar(nomes) {
  if (!nomes.length) return;
  await consultar(
    "insert into schema_migracoes (nome, como) select unnest($1::text[]), 'adotada' on conflict (nome) do nothing",
    [nomes]
  );
}

(async () => {
  console.log('\n=== APLICAR MIGRAÇÕES ===\n');

  // Banco vazio não é caso deste script: aplicar migração sobre nada falha na
  // primeira que altera tabela. Quem cria o banco do zero é o
  // banco/RECRIAR-DO-ZERO.sql, que o container roda sozinho na primeira subida.
  if (!(await existeTabela('users'))) {
    console.log('  O banco não tem nem a tabela `users` — ele está vazio.');
    console.log('  Migração não cria banco: quem cria é banco/RECRIAR-DO-ZERO.sql,');
    console.log('  que o container do Postgres roda sozinho na primeira subida.');
    console.log('');
    console.log('      docker compose down -v && docker compose up -d banco');
    console.log('');
    process.exit(1);
  }

  // SIMULAR NÃO CRIA NEM ISTO.
  //
  // A criação ficava acima da checagem do `--simular`, então o "ensaio" deixava
  // a tabela `schema_migracoes` para trás — vazia, mas criada. Visto em
  // produção: depois do dry-run no VPS ela existia com 0 linhas, enquanto a
  // descrição da opção dizia "sem tocar no banco". O efeito era inofensivo
  // (nasceria minutos depois, no deploy), mas a promessa estava errada — e
  // promessa errada é consultada justamente quando o banco importa.
  if (!SIMULAR) await criarLivroCaixa();
  const registradas = await jaRegistradas();
  const todas = lerMigracoes().filter((m) => m.aplicavel);
  const primeiraRodada = registradas.size === 0;

  if (primeiraRodada) {
    console.log(SIMULAR
      ? '  Primeira rodada: ainda não existe a tabela schema_migracoes, e este'
      : '  Primeira rodada: a tabela schema_migracoes acabou de nascer, e este');
    console.log('  banco já tem migrações aplicadas à mão. Vou PERGUNTAR ao banco o que');
    console.log('  já está lá, em vez de rodar tudo de novo.\n');

    const { pendentes, naoConferidas } = await conferir({ existeTabela, existeColuna });
    const pendentesPorNome = new Set(pendentes.map((m) => m.nome));
    const naoConferidasPorNome = new Set(naoConferidas.map((m) => m.nome));

    // "NÃO CONFERIDA" NÃO É "APLICADA": É "NÃO SEI".
    //
    // `pendentes` e `naoConferidas` são coisas diferentes, e tratá-las como uma
    // só foi o defeito. Uma migração que não declara tabela nem coluna não
    // aparece em `pendentes` — não porque rodou, mas porque não há como
    // perguntar. Adotar "tudo que não está pendente" registrava essas como
    // aplicadas sem nunca terem sido executadas.
    //
    // Aconteceu no VPS em 14/09/2026, com 10 migrações adotadas às cegas. Três
    // realmente nunca haviam rodado:
    //
    //   fase-ay .... 27.362 lançamentos com `code` nulo, sem número LF
    //   fase-br .... a sequence sales_code_seq não existia
    //   fase-bx .... colunas card_acquirer_id/_name e o índice
    //
    // A fase-br só apareceu porque a fase-cg quebrou atrás dela ("relation
    // sales_code_seq does not exist"). As outras duas estavam silenciosas — que
    // é o estrago de verdade: o livro-caixa dizia que o banco estava em dia.
    //
    // Então só se adota o que o conferidor CONFIRMOU. Quem não dá para conferir
    // volta para a fila e é aplicada. As migrações daqui são idempotentes
    // (create if not exists, on conflict do nothing, update com filtro), então
    // rodar de novo não duplica nada — e esse é o lado seguro, não o contrário.
    const adotar0 = todas
      .filter((m) => !pendentesPorNome.has(m.nome))
      .filter((m) => ADOTAR_NAO_CONFERIDAS || !naoConferidasPorNome.has(m.nome))
      .map((m) => m.nome);

    // O verbo muda com o modo: em simulação nada foi registrado, e dizer que
    // foi seria o mesmo tipo de promessa falsa que a tabela criada no ensaio.
    console.log(SIMULAR
      ? `  ${adotar0.length} migração(ões) o banco já tem — seriam adotadas, sem executar.`
      : `  ${adotar0.length} migração(ões) o banco já tem — registradas como adotadas, sem executar.`);
    if (naoConferidas.length) {
      console.log('');
      console.log(`  ${naoConferidas.length} delas NÃO declaram tabela nem coluna, então não há como conferir se`);
      if (ADOTAR_NAO_CONFERIDAS) {
        console.log('  rodaram. Adotadas por suposição, a seu pedido (--adotar-nao-conferidas):');
      } else {
        console.log('  rodaram. Vão para a fila e serão aplicadas — são idempotentes:');
      }
      naoConferidas.forEach((m) => console.log(`     ${m.nome}`));
    }
    console.log('');
    if (!SIMULAR) await adotar(adotar0);
    adotar0.forEach((nome) => registradas.set(nome, 'adotada'));
  }

  const pendentes = todas.filter((m) => !registradas.has(m.nome));

  if (!pendentes.length) {
    console.log(SIMULAR
      ? `  Nada a aplicar. ${registradas.size} migração(ões) ficariam no livro-caixa.\n`
      : `  Nada a aplicar. ${registradas.size} migração(ões) no livro-caixa.\n`);
    console.log('===== BANCO EM DIA =====\n');
    process.exit(0);
  }

  console.log(`  ${pendentes.length} migração(ões) a aplicar, nesta ordem:\n`);
  pendentes.forEach((m) => console.log(`     ${m.nome}`));
  console.log('');

  if (SIMULAR) {
    console.log('===== SIMULAÇÃO: nada foi executado =====\n');
    process.exit(0);
  }

  for (const migracao of pendentes) {
    process.stdout.write(`  aplicando ${migracao.nome} ... `);
    try {
      await aplicar(migracao);
      console.log('ok');
    } catch (erro) {
      console.log('FALHOU');
      console.error('');
      console.error(`  ${erro.message}`);
      console.error('');
      console.error('  A transação foi desfeita: o banco está como estava antes DESTA');
      console.error('  migração, e ela continua pendente. As anteriores já estão aplicadas.');
      console.error('');
      process.exit(1);
    }
  }

  console.log('');
  console.log(`===== ${pendentes.length} MIGRAÇÃO(ÕES) APLICADA(S) =====\n`);
  process.exit(0);
})().catch((erro) => {
  console.error('Erro ao aplicar as migrações:', erro.message);
  process.exit(2);
});
