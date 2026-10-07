#!/usr/bin/env node
// A CARONA EM LEITURA IDÊNTICA NÃO PODE MUDAR O QUE NINGUÉM RECEBE.
//
// lib/db/conexao.js faz duas requisições que pedem o MESMO select ao mesmo
// tempo esperarem uma ida ao banco só (a abertura do sistema lia os 27 mil
// lançamentos três vezes em paralelo). Isso é seguro por quatro regras, e cada
// uma tem um modo de falha que não aparece na tela até aparecer no dinheiro:
//
//   1. só o SELECT do construtor pega carona — rpc, nextval e SQL cru passam
//      direto (um `next_cadastro_code` compartilhado daria o MESMO código a
//      dois cadastros);
//   2. gravação terminada separa: quem lê depois de gravar nunca recebe a foto
//      de antes (o "salvei e não apareceu");
//   3. cada um recebe linhas PRÓPRIAS: uma rota que ordena no lugar ou escreve
//      num campo não pode mexer no que a outra está montando (um vendedor
//      vendo o filtro do outro, um total somado duas vezes);
//   4. nada fica guardado e a janela é curta: em sequência não há carona, e voo
//      mais velho que o teto não é aproveitado.
//
// SEM BANCO: o pool do driver é trocado por um falso que conta as idas e
// devolve linhas novas a cada ida, como o de verdade. A prova de ponta a ponta
// (21 rotas, respostas iguais byte a byte com e sem carona, três chamadas
// simultâneas) foi rodada contra o servidor e o banco local.
'use strict';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://ninguem:nada@127.0.0.1:1/nenhum';
// Teto maior que o de produção (100 ms) para o teste não depender de a máquina
// estar ociosa: as caronas daqui saem no mesmo tick ou ~10 ms depois.
process.env.DATABASE_CARONA_MAX_MS = '300';

const fs = require('fs');
const path = require('path');
const pg = require('pg');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

// O pool falso. Cada ida monta linhas NOVAS (o driver faz isso), com um jsonb
// aninhado e um array, que são o que a cópia tem de copiar em profundidade.
let idas = [];
let atraso = 30;
let proximoErro = null;
let classeEstranha = false;
pg.Pool.prototype.query = function (sql, parametros) {
  idas.push({ sql, parametros });
  const erro = proximoErro; proximoErro = null;
  const estranha = classeEstranha;
  return new Promise((ok, falha) => setTimeout(() => {
    if (erro) { falha(erro); return; }
    const itens = JSON.parse('{"__proto__": {"x": 1}, "lista": [{"sku": "A", "qtd": 2}], "n": 3}');
    const linhas = [
      { id: 'b', nome: 'Beta', itens, tags: ['x', 'y'], valor: 10, quando: estranha ? new Date(0) : '2026-10-07T12:00:00.000Z' },
      { id: 'a', nome: 'Alfa', itens: null, tags: [], valor: 5, quando: '2026-10-06T12:00:00.000Z' }
    ];
    ok({ command: 'SELECT', rowCount: linhas.length, rows: linhas, fields: [] });
  }, atraso));
};
pg.Pool.prototype.connect = async function () {
  return { query: async (sql) => { idas.push({ sql }); return { rows: [] }; }, release() {} };
};

const conexao = require('../lib/db/conexao');
const { consultarLeitura, consultar, emTransacao, podeMudarDado, copiarLinhas } = conexao;
const SQL = 'select "t".* from "orders" as "t" where "t"."seller_id" = $1 order by "t"."code" desc';
const reset = () => { idas = []; atraso = 30; proximoErro = null; classeEstranha = false; };

(async () => {
  console.log('--- 1. duas leituras iguais ao mesmo tempo: uma ida ao banco ---');
  reset();
  const [r1, r2] = await Promise.all([consultarLeitura(SQL, ['v1']), consultarLeitura(SQL, ['v1'])]);
  check('uma ida ao banco', idas.length === 1, idas.length);
  check('as duas recebem o mesmo conteúdo', JSON.stringify(r1.rows) === JSON.stringify(r2.rows));
  check('mas não o mesmo array', r1.rows !== r2.rows);
  check('nem as mesmas linhas', r1.rows[0] !== r2.rows[0]);
  check('nem o mesmo jsonb aninhado', r1.rows[0].itens !== r2.rows[0].itens && r1.rows[0].itens.lista !== r2.rows[0].itens.lista
    && r1.rows[0].itens.lista[0] !== r2.rows[0].itens.lista[0]);
  check('nem o mesmo array de coluna', r1.rows[0].tags !== r2.rows[0].tags);
  check('"__proto__" do jsonb continua dado, não protótipo',
    Object.prototype.hasOwnProperty.call(r2.rows[0].itens, '__proto__') && Object.getPrototypeOf(r2.rows[0].itens) === Object.prototype
    && JSON.stringify(r2.rows[0].itens) === JSON.stringify(r1.rows[0].itens), JSON.stringify(r2.rows[0].itens));

  console.log('\n--- 2. o que uma rota faz no resultado não aparece na outra ---');
  reset();
  const pa = consultarLeitura(SQL, ['v1']);
  const pb = consultarLeitura(SQL, ['v1']);
  const a = await pa;
  // A líder mexe em tudo assim que recebe — antes de a carona continuar.
  a.rows.sort((x, y) => x.nome.localeCompare(y.nome));
  a.rows[0].nome = 'MEXIDO';
  a.rows[1].itens.lista[0].qtd = 999;
  a.rows[1].tags.push('z');
  const b = await pb;
  check('ordem preservada para a carona', b.rows.map((l) => l.id).join(',') === 'b,a', b.rows.map((l) => l.id).join(','));
  check('campo escrito pela líder não vaza', b.rows.every((l) => l.nome !== 'MEXIDO'));
  check('jsonb aninhado intacto', b.rows[0].itens.lista[0].qtd === 2, b.rows[0].itens.lista[0].qtd);
  check('array de coluna intacto', b.rows[0].tags.join(',') === 'x,y', b.rows[0].tags.join(','));
  // E no sentido contrário: três na rajada, a segunda mexe, a terceira não vê.
  reset();
  const [c1, c2, c3] = [consultarLeitura(SQL, ['v1']), consultarLeitura(SQL, ['v1']), consultarLeitura(SQL, ['v1'])];
  const linhasC2 = (await c2).rows; linhasC2[0].itens.n = -1; linhasC2.reverse();
  const linhasC3 = (await c3).rows; const linhasC1 = (await c1).rows;
  check('uma carona não mexe na outra nem na líder', linhasC3[0].itens.n === 3 && linhasC1[0].itens.n === 3 && linhasC3[0].id === 'b');
  check('  com uma ida ao banco para as três', idas.length === 1, idas.length);

  console.log('\n--- 3. gravação que TERMINA no meio separa ---');
  // A líder demora 400 ms; o que acontece no meio é rápido; a segunda leitura
  // sai ~10 ms depois da primeira, bem dentro do teto (300 ms neste teste). Se
  // ela for ao banco, foi a GERAÇÃO que separou — não a janela nem o fim do voo.
  async function leiturasComAlgoNoMeio(acao) {
    reset();
    atraso = 400;
    const antes = consultarLeitura(SQL, ['v1']);
    await esperar(5);
    atraso = 1;
    await acao();
    const depois = consultarLeitura(SQL, ['v1']);
    await Promise.all([antes, depois]);
    return idas.filter((i) => i.sql === SQL).length;
  }
  const comInsert = await leiturasComAlgoNoMeio(() => consultar('insert into "orders" ("id") values ($1)', ['novo']));
  check('quem lê depois de um insert vai ao banco', comInsert === 2, `${comInsert} leitura(s)`);
  const comTransacao = await leiturasComAlgoNoMeio(() => emTransacao(async (cliente) => {
    await cliente.query('update "orders" set "x" = 1 where "id" = $1', ['a']);
  }));
  check('fim de transação também separa', comTransacao === 2, `${comTransacao} leitura(s)`);
  const comErro = await leiturasComAlgoNoMeio(() => {
    proximoErro = Object.assign(new Error('falhou a escrita'), { code: '23505' });
    return consultar('insert into "orders" ("id") values ($1)', ['dup']).catch(() => {});
  });
  check('escrita que deu erro também separa (pode ter gravado parte)', comErro === 2, `${comErro} leitura(s)`);
  const comNextval = await leiturasComAlgoNoMeio(() => consultar("select nextval('financial_entries_numero_seq') as numero"));
  check('nextval no meio separa', comNextval === 2, `${comNextval} leitura(s)`);
  // O controle: sem isto, os quatro de cima passariam também se a carona
  // simplesmente nunca acontecesse nesse arranjo.
  const comLeitura = await leiturasComAlgoNoMeio(() => consultar('select "t".* from "sessoes" as "t" where "t"."token_hash" = $1', ['h']));
  check('uma LEITURA crua no meio NÃO separa (a sessão de cada requisição mataria a carona)', comLeitura === 1, `${comLeitura} leitura(s)`);

  console.log('\n--- 4. parâmetros e SQL diferentes não se misturam ---');
  reset();
  const [d1, d2] = await Promise.all([consultarLeitura(SQL, ['v1']), consultarLeitura(SQL, ['v2'])]);
  check('vendedores diferentes: duas idas', idas.length === 2 && d1 !== d2, idas.length);
  reset();
  await Promise.all([consultarLeitura(SQL, ['1']), consultarLeitura(SQL, [1])]);
  check('"1" e 1 são parâmetros diferentes', idas.length === 2, idas.length);
  reset();
  await Promise.all([consultarLeitura(SQL, [['a', 'b']]), consultarLeitura(SQL, [['a', 'b']])]);
  check('lista igual (filtro in) pega carona', idas.length === 1, idas.length);
  reset();
  await Promise.all([consultarLeitura(SQL, [new Date(0)]), consultarLeitura(SQL, [new Date(0)])]);
  check('parâmetro que não é simples (Date) não pega carona', idas.length === 2, idas.length);
  reset();
  await Promise.all([consultarLeitura(SQL, [NaN]), consultarLeitura(SQL, [null])]);
  check('NaN e null não viram a mesma chave', idas.length === 2, idas.length);

  console.log('\n--- 5. erro chega a todos e nada fica guardado ---');
  reset();
  proximoErro = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
  const resultados = await Promise.allSettled([consultarLeitura(SQL, ['v1']), consultarLeitura(SQL, ['v1'])]);
  check('as duas rejeitam com o erro do banco', resultados.every((r) => r.status === 'rejected' && r.reason.code === '57014'));
  reset();
  await consultarLeitura(SQL, ['v1']);
  await consultarLeitura(SQL, ['v1']);
  check('em sequência NÃO compartilha (não é cache)', idas.length === 2, idas.length);

  console.log('\n--- 6. a janela: voo velho não é aproveitado ---');
  reset();
  atraso = 900;
  const velho = consultarLeitura(SQL, ['v1']);
  await esperar(450); // teto do teste: 300 ms
  const tarde = consultarLeitura(SQL, ['v1']);
  const logo = consultarLeitura(SQL, ['v1']);
  await Promise.all([velho, tarde, logo]);
  check('quem chega depois do teto vai ao banco; quem chega junto dele pega carona no novo', idas.length === 2, idas.length);

  console.log('\n--- 7. classe que a cópia não conhece: cada um vai ao banco ---');
  reset();
  classeEstranha = true;
  const [e1, e2] = await Promise.all([consultarLeitura(SQL, ['v1']), consultarLeitura(SQL, ['v1'])]);
  check('com um Date na linha, a carona refaz a leitura sozinha', idas.length === 2, idas.length);
  check('  e não recebe o mesmo objeto', e1.rows[0].quando !== e2.rows[0].quando);
  check('copiarLinhas recusa (null) em vez de compartilhar', copiarLinhas([{ d: new Date(0) }]) === null);
  check('copiarLinhas copia primitivos, arrays e json', JSON.stringify(copiarLinhas([{ a: 1, b: 'x', c: [1, [2]], d: { e: { f: null } }, g: true }]))
    === '[{"a":1,"b":"x","c":[1,[2]],"d":{"e":{"f":null}},"g":true}]');

  console.log('\n--- 8. o que conta como escrita ---');
  const casos = [
    ['insert', 'insert into "orders" ("id") values ($1)', true],
    ['update ... returning', 'update "orders" as "t" set "x" = $1 where "t"."id" = $2 returning "t".*', true],
    ['delete', 'delete from "orders" as "t" where "t"."id" = $1', true],
    ['with ... insert', 'with x as (insert into a values (1) returning *) select * from x', true],
    ['select nextval (número do lançamento)', "select nextval('financial_entries_numero_seq') as numero", true],
    ['select setval', "select setval('seq', 10)", true],
    ['rpc next_cadastro_code', 'select * from "next_cadastro_code"()', true],
    ['select for update', 'select * from "orders" where "id" = $1 for update', true],
    ['select ... for share', 'select * from "orders" for share', true],
    ['texto que não é string', null, true],
    ['select simples NÃO', 'select "t".* from "orders" as "t" order by "t"."code" desc', false],
    ['count do construtor NÃO', 'select count(*)::int as total from "orders" as "t" where "t"."x" = $1', false],
    ['embutido do construtor NÃO', 'select "t".*, (select json_build_object(\'id\', "nfe"."id") from "nfe" where "nfe"."id" = "t"."nfe_id") as "nfe" from "nfe_eventos" as "t"', false]
  ];
  for (const [nome, sql, esperado] of casos) check(`${nome}`, podeMudarDado(sql) === esperado);

  console.log('\n--- 9. por fonte: as portas certas ---');
  const raiz = path.join(__dirname, '..');
  const consulta = semComentarios(fs.readFileSync(path.join(raiz, 'lib/db/consulta.js'), 'utf8'));
  const fonteConexao = semComentarios(fs.readFileSync(path.join(raiz, 'lib/db/conexao.js'), 'utf8'));
  // Só o modo select usa a porta da carona; insert/update/delete/upsert (com ou
  // sem returning) continuam no consultar, que é quem conta a geração.
  check('consulta.js: o SELECT de dados usa consultarLeitura só no modo select',
    /estado\.modo === 'select'\s*\?\s*await consultarLeitura\(texto, valores\)\s*:\s*await consultar\(texto, valores\)/.test(consulta));
  check('consulta.js: o count(*) também', /await consultarLeitura\(`select count\(\*\)::int as total/.test(consulta));
  check('client.js (rpc) continua no consultar',
    !/consultarLeitura/.test(semComentarios(fs.readFileSync(path.join(raiz, 'lib/db/client.js'), 'utf8'))));
  const corpoTransacao = (/async function emTransacao\(callback\) \{[\s\S]*?\n\}/.exec(fonteConexao) || [''])[0];
  check('emTransacao incrementa a geração no finally', /finally \{[\s\S]*geracaoDeEscrita \+= 1/.test(corpoTransacao));
  const corpoConsultar = (/async function consultar\(sql, parametros\) \{[\s\S]*?\n\}/.exec(fonteConexao) || [''])[0];
  check('consultar incrementa a geração no finally', /finally \{[\s\S]*if \(escreve\) geracaoDeEscrita \+= 1/.test(corpoConsultar));
  check('a geração está na chave da carona', /const chave = `\$\{geracaoDeEscrita\}/.test(fonteConexao));

  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})().catch((erro) => { console.error(erro); process.exit(1); });
