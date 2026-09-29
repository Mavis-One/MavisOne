#!/usr/bin/env node
// O HISTORICO FISCAL DO PRODUTO, testado POR FORA do servidor (fase DJ).
//
// NAO entra em `npm test`: precisa do banco de verdade. Roda a mao depois de
// aplicar a fase-DJ, ou quando a lista de campos vigiados pela trigger mudar:
//
//   node scripts/prova-historico-fiscal.js
//
// POR QUE A SUITE ESTATICA NAO ALCANCA ISTO
// -----------------------------------------
// O que esta fase entrega e uma TRIGGER, e trigger e' semantica do Postgres:
// quando ela dispara, o que `is distinct from` responde com NULL de um lado, e
// que instante `now()` devolve dentro de uma transacao. Nada disso aparece
// lendo o .sql -- e foi exatamente aqui que esta prova pegou um defeito meu.
//
// O DEFEITO QUE ELA PEGOU, em 29/09/2026
// --------------------------------------
// A primeira versao da trigger estampava a vigencia com `clock_timestamp()`, o
// relogio de parede, com um motivo escrito e errado. `clock_timestamp()` e
// sempre DEPOIS do `now()` da transacao, entao `vigencia_inicio <= now()` dava
// FALSO para o retrato recem-criado e a consulta "qual e o NCM agora" devolvia
// o ANTIGO -- com cara de resposta certa. O check "qual e agora responde a
// linha nova" e' o que reprovou; ele fica aqui para nao voltar.
//
// Escreve no banco DENTRO DE UMA TRANSACAO e faz ROLLBACK no fim: ao contrario
// de prova-gatilho-status.js, que limpa os registros de prova depois, aqui
// nada e' commitado -- inclusive a empresa de prova, quando o banco nao tem
// nenhuma. Se o script morrer no meio, o rollback vem do proprio Postgres ao
// fechar a conexao.
require('dotenv').config();
const { obterPool } = require('../lib/db/conexao.js');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

(async () => {
  const pool = obterPool();
  const c = await pool.connect();
  try {
    await c.query('begin');

    console.log('--- a carga inicial ---');
    let r = await c.query("select count(*) n from produto_fiscal where motivo = 'CARGA_INICIAL'");
    const carga = Number(r.rows[0].n);
    r = await c.query('select count(*) n from products');
    const produtos = Number(r.rows[0].n);
    check('uma linha por produto', carga === produtos, `${carga} linhas / ${produtos} produtos`);

    r = await c.query('select count(*) n from produto_fiscal where vigencia_fim is not null');
    check('e todas ainda abertas', Number(r.rows[0].n) === 0, `${r.rows[0].n} fechadas`);

    // A COMPARAÇÃO É EXAUSTIVA, e a lista de colunas sai do BANCO — não de uma
    // lista escrita aqui. A primeira versão comparava quatro colunas escolhidas
    // a dedo (ncm, sku, cest, origem) e teria dado verde com `numero_fci`
    // faltando no retrato, que foi justamente o defeito desta fase. Derivada da
    // interseção das duas tabelas, ela cobre a coluna que entrar amanhã.
    //
    // `nome` fica de fora do laço por ser o único nome que difere entre as duas
    // (`produto_fiscal.nome` guarda `products.name`), então é comparado à parte.
    r = await c.query(`select a.column_name c from information_schema.columns a
                       join information_schema.columns b
                         on b.table_name = 'products' and b.column_name = a.column_name
                       where a.table_name = 'produto_fiscal'
                         and a.column_name not in ('id','product_id','nome','vigencia_inicio','vigencia_fim','motivo','registrado_em')
                       order by 1`);
    const comparaveis = r.rows.map((x) => x.c);
    const onde = comparaveis.map((col) => `pf.${col} is distinct from p.${col}`).join(' or ');
    r = await c.query(`select count(*) n from produto_fiscal pf join products p on p.id = pf.product_id
                       where ${onde} or pf.nome is distinct from p.name`);
    check(`o retrato bate com a fonte nas ${comparaveis.length + 1} colunas`,
      Number(r.rows[0].n) === 0, `${r.rows[0].n} divergencias | ${comparaveis.join(', ')}, nome`);
    // Se a interseção encolher, o check acima passa comparando menos colunas —
    // e passaria com o retrato mutilado. Este número é a trava disso.
    check('  e são todas as colunas do retrato, sem sobrar nenhuma',
      comparaveis.length >= 14, `${comparaveis.length} comparaveis`);

    console.log('\n--- mudanca de campo FISCAL: fecha um retrato e abre outro ---');
    r = await c.query("select id, ncm, name from products where ncm is not null order by id limit 1");
    const p = r.rows[0];
    const ncmNovo = p.ncm === '73181500' ? '73181600' : '73181500';
    await c.query('update products set ncm = $1 where id = $2', [ncmNovo, p.id]);

    r = await c.query(`select ncm, motivo, vigencia_inicio, vigencia_fim from produto_fiscal
                       where product_id = $1 order by vigencia_inicio`, [p.id]);
    check('agora sao duas linhas', r.rows.length === 2, `${r.rows.length} linhas`);
    if (r.rows.length === 2) {
      const [velha, nova] = r.rows;
      check('a velha guarda o NCM ANTIGO', velha.ncm === p.ncm, `${velha.ncm} (era ${p.ncm})`);
      check('a velha foi fechada', velha.vigencia_fim !== null);
      check('a nova guarda o NCM NOVO', nova.ncm === ncmNovo, nova.ncm);
      check('a nova esta aberta', nova.vigencia_fim === null);
      check('a nova e ALTERACAO, nao CARGA_INICIAL', nova.motivo === 'ALTERACAO', nova.motivo);
      // O ponto do `agora :=` em variavel: sem buraco na linha do tempo.
      const semBuraco = String(velha.vigencia_fim) === String(nova.vigencia_inicio);
      check('SEM BURACO: o fim de uma e o inicio da outra',
        semBuraco, `${velha.vigencia_fim} vs ${nova.vigencia_inicio}`);
    }

    console.log('\n--- a pergunta retroativa ---');
    r = await c.query(`select vigencia_fim - interval '1 microsecond' t from produto_fiscal
                       where product_id = $1 and vigencia_fim is not null`, [p.id]);
    const antes = r.rows[0].t;
    r = await c.query(`select ncm from produto_fiscal
                       where product_id = $1 and vigencia_inicio <= $2
                         and (vigencia_fim is null or vigencia_fim > $2)`, [p.id, antes]);
    check('"qual era o NCM naquele instante" responde UMA linha', r.rows.length === 1, `${r.rows.length} linhas`);
    check('  e responde o valor ANTIGO', r.rows[0] && r.rows[0].ncm === p.ncm, r.rows[0] && r.rows[0].ncm);

    r = await c.query(`select ncm from produto_fiscal
                       where product_id = $1 and vigencia_inicio <= now()
                         and (vigencia_fim is null or vigencia_fim > now())`, [p.id]);
    check('"qual e agora" responde UMA linha, a nova', r.rows.length === 1 && r.rows[0].ncm === ncmNovo, r.rows[0] && r.rows[0].ncm);

    console.log('\n--- mudanca NAO fiscal: nao registra nada ---');
    r = await c.query('select count(*) n from produto_fiscal where product_id = $1', [p.id]);
    const antesDoCusto = Number(r.rows[0].n);
    await c.query('update products set cost_price = cost_price + 1 where id = $1', [p.id]);
    await c.query('update products set stock_quantity = stock_quantity + 1 where id = $1', [p.id]);
    await c.query('update products set sale_price = sale_price + 1 where id = $1', [p.id]);
    r = await c.query('select count(*) n from produto_fiscal where product_id = $1', [p.id]);
    check('custo, saldo e preco nao criam retrato', Number(r.rows[0].n) === antesDoCusto,
      `${r.rows[0].n} linhas depois de 3 updates (eram ${antesDoCusto})`);

    console.log('\n--- NULL -> valor tambem conta como mudanca (o erro que `<>` faria) ---');
    r = await c.query('select id from products where cst_ipi is null order by id limit 1');
    const semIpi = r.rows[0].id;
    r = await c.query('select count(*) n from produto_fiscal where product_id = $1', [semIpi]);
    const antesIpi = Number(r.rows[0].n);
    await c.query("update products set cst_ipi = '50' where id = $1", [semIpi]);
    r = await c.query('select count(*) n from produto_fiscal where product_id = $1', [semIpi]);
    check('preencher um campo fiscal vazio registra', Number(r.rows[0].n) === antesIpi + 1,
      `${r.rows[0].n} (era ${antesIpi})`);

    console.log('\n--- produto NOVO nasce com retrato, marcado CADASTRO ---');
    await c.query(`insert into products (id, name, sku, ncm, unidade_comercial, stock_quantity, cost_price, sale_price)
                   values ('prova-dj-1', 'Produto de prova DJ', 'PROVA-DJ-1', '84821000', 'UN', 0, 0, 0)`);
    r = await c.query("select motivo, ncm, sku, vigencia_fim from produto_fiscal where product_id = 'prova-dj-1'");
    check('uma linha', r.rows.length === 1, `${r.rows.length}`);
    check('  marcada CADASTRO', r.rows[0] && r.rows[0].motivo === 'CADASTRO', r.rows[0] && r.rows[0].motivo);
    check('  aberta, com o NCM e o sku copiados', r.rows[0] && r.rows[0].vigencia_fim === null && r.rows[0].ncm === '84821000' && r.rows[0].sku === 'PROVA-DJ-1');

    console.log('\n--- a trava de uma linha aberta por produto ---');
    let barrou = false;
    try {
      await c.query('savepoint sp1');
      await c.query(`insert into produto_fiscal (product_id, ncm) values ('prova-dj-1', '11111111')`);
      await c.query('release savepoint sp1');
    } catch (e) {
      barrou = e.code === '23505';
      await c.query('rollback to savepoint sp1');
    }
    check('uma segunda linha ABERTA e recusada', barrou, barrou ? 'unique_violation' : 'PASSOU, e nao devia');

    console.log('\n--- intervalo invertido e recusado ---');
    let barrou2 = false;
    try {
      await c.query('savepoint sp2');
      await c.query(`insert into produto_fiscal (product_id, vigencia_inicio, vigencia_fim)
                     values ('prova-dj-1', now(), now() - interval '1 day')`);
      await c.query('release savepoint sp2');
    } catch (e) {
      barrou2 = e.code === '23514';
      await c.query('rollback to savepoint sp2');
    }
    check('vigencia_fim antes do inicio e recusada', barrou2, barrou2 ? 'check_violation' : 'PASSOU, e nao devia');

    console.log('\n--- o motivo nao aceita valor inventado ---');
    let barrou3 = false;
    try {
      await c.query('savepoint sp3');
      await c.query(`insert into produto_fiscal (product_id, motivo, vigencia_fim) values ('prova-dj-2', 'SEI_LA', now())`);
      await c.query('release savepoint sp3');
    } catch (e) {
      barrou3 = e.code === '23514';
      await c.query('rollback to savepoint sp3');
    }
    check('motivo fora do catalogo e recusado', barrou3, barrou3 ? 'check_violation' : 'PASSOU, e nao devia');

    console.log('\n--- fiscal_unidades: a trava do codigo repetido ---');
    r = await c.query('select id from empresa limit 1');
    if (!r.rows.length) {
      // O banco local nao tem empresa (nem estabelecimento). Cria uma DENTRO da
      // transacao so para a trava poder ser exercitada; o rollback a leva embora.
      r = await c.query("insert into empresa (cnpj_raiz, razao_social, regime_tributario, crt) values ('12345678', 'Empresa de prova DJ', 'LUCRO_PRESUMIDO', 3) returning id");
      console.log('  (sem empresa no banco: uma foi criada dentro da transacao)');
    }
    {
      const emp = r.rows[0].id;
      await c.query("insert into fiscal_unidades (empresa_id, codigo, descricao) values ($1, 'UN', 'UNIDADE')", [emp]);
      let dup = false;
      try {
        await c.query('savepoint sp4');
        await c.query("insert into fiscal_unidades (empresa_id, codigo, descricao) values ($1, ' un ', 'unidade')", [emp]);
        await c.query('release savepoint sp4');
      } catch (e) { dup = e.code === '23505'; await c.query('rollback to savepoint sp4'); }
      check('" un " colide com "UN" (sem caso, sem espaco)', dup, dup ? 'unique_violation' : 'PASSOU, e nao devia');

      let vazia = false;
      try {
        await c.query('savepoint sp5');
        await c.query("insert into fiscal_unidades (empresa_id, codigo, descricao) values ($1, 'XX', '   ')", [emp]);
        await c.query('release savepoint sp5');
      } catch (e) { vazia = e.code === '23514'; await c.query('rollback to savepoint sp5'); }
      check('descricao em branco e recusada', vazia, vazia ? 'check_violation' : 'PASSOU, e nao devia');
    }

    console.log('\n--- o estabelecimento: os dois campos e os dominios ---');
    r = await c.query(`select column_name, data_type from information_schema.columns
                       where table_name = 'estabelecimento' and column_name in ('perfil_sped','indicador_atividade','regime_tributario','codigo','indicador_tipo_efd')
                       order by column_name`);
    const cols = r.rows.map((x) => x.column_name);
    check('perfil_sped existe', cols.includes('perfil_sped'));
    check('indicador_atividade existe', cols.includes('indicador_atividade'));
    check('regime_tributario NAO foi duplicado aqui', !cols.includes('regime_tributario'), cols.join(', ') || '(nenhuma das recusadas)');
    check('codigo NAO entrou', !cols.includes('codigo'));
    check('indicador_tipo_efd NAO entrou', !cols.includes('indicador_tipo_efd'));
    r = await c.query("select count(*) n from information_schema.columns where table_name='empresa' and column_name='regime_tributario'");
    check('  e ele continua existindo em empresa', Number(r.rows[0].n) === 1);

    console.log('\n--- RLS ligada nas duas tabelas novas ---');
    r = await c.query(`select relname, relrowsecurity from pg_class
                       where relname in ('fiscal_unidades','produto_fiscal') order by relname`);
    for (const x of r.rows) check(`${x.relname}`, x.relrowsecurity === true, String(x.relrowsecurity));
    check('as duas foram encontradas', r.rows.length === 2, `${r.rows.length}`);

    await c.query('rollback');
    console.log('\n(rollback: o banco ficou como estava)');
  } catch (e) {
    try { await c.query('rollback'); } catch (_) {}
    console.error('\nERRO NA PROVA:', e.message);
    falhas++;
  } finally {
    c.release();
  }
  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== O HISTORICO FISCAL REGISTRA =====');
  process.exit(falhas ? 1 : 0);
})();
