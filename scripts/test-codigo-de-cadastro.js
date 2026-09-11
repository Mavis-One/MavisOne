#!/usr/bin/env node
/**
 * O CÓDIGO DE CADASTRO NÃO PODE SER CORTADO (fase CE).
 *
 * `next_cadastro_code()` formatava com `lpad(n, 2, '0')`. O comentário escrito
 * logo acima dela, no schema, sempre disse a intenção certa — "zero-padded com
 * no mínimo 2 dígitos, mesma regra de formatCadastroCode() em server.js" — e o
 * `padStart` do JavaScript de fato nunca corta.
 *
 * O `lpad` do Postgres corta. MEDIDO no banco:
 *
 *     lpad('9',    2, '0')  ->  '09'    certo
 *     lpad('100',  2, '0')  ->  '10'    o cadastro 100 vira o código 10
 *     lpad('6493', 2, '0')  ->  '64'
 *
 * A partir do centésimo cadastro o código deixava de identificar: '10' valia
 * para o 10 e para o 100. E como código não tem restrição de unicidade — é o
 * número que a pessoa dita ao telefone, não uma chave —, dois cadastros com o
 * mesmo código não dão erro em lugar nenhum. Entregam o registro errado, calados.
 *
 * SÓ APARECEU PORQUE O VOLUME CHEGOU DE UMA VEZ: a importação do ViperERP
 * trouxe 6.492 pessoas e levou a sequência para 6493. O próximo cadastro feito
 * pela tela nasceria com o código '64'.
 *
 * PROVADO num banco criado do zero pelo RECRIAR-DO-ZERO.sql: com a sequência em
 * 99, as duas chamadas seguintes devolveram 100 e 101.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log('--- 1. os dois lados formatam igual ---');
// O lado JavaScript, chamado de verdade: é ele que numera quando o registro
// nasce pelo app com o db.json no meio.
const src = ler('server.js');
const formata = new Function(`${/function formatCadastroCode\(n\) \{[\s\S]*?\n\}/.exec(src)[0]}\nreturn formatCadastroCode;`)();
for (const [entrada, esperado] of [[1, '01'], [9, '09'], [10, '10'], [99, '99'], [100, '100'], [6493, '6493']]) {
  check(`  JS: ${String(entrada).padEnd(4)} -> ${esperado}`, formata(entrada) === esperado, formata(entrada));
}

console.log('--- 2. o lado SQL não pode usar lpad ---');
// `lpad(texto, 2, '0')` devolve os DOIS PRIMEIROS caracteres quando o texto é
// maior — é truncamento, não preenchimento.
const zero = ler('banco/RECRIAR-DO-ZERO.sql');
const migracao = ler('banco/migrations/fase-ce-codigo-de-cadastro-sem-corte.sql');
check('a migração redefine a função', /create or replace function next_cadastro_code\(\)/.test(migracao));
check('  com case, e não com lpad', /case when n < 10/.test(migracao) && !/lpad\(nextval/.test(migracao));
// O RECRIAR-DO-ZERO junta schema + migrações na ordem: o lpad do schema ainda
// aparece, mas a redefinição vem DEPOIS e é ela que fica valendo. O que importa
// é a ORDEM, não a ausência.
const posLpad = zero.indexOf("lpad(nextval('cadastro_code_seq')");
const posCase = zero.indexOf('case when n < 10');
check('no RECRIAR-DO-ZERO a correção vem por último', posCase > posLpad && posCase > 0,
  `lpad na ${zero.slice(0, posLpad).split('\n').length}, case na ${zero.slice(0, posCase).split('\n').length}`);
check('  e é a última definição do arquivo',
  zero.lastIndexOf('create or replace function next_cadastro_code()') < posCase);

console.log('--- 3. a intenção está escrita junto ---');
// O comentário do schema já dizia "no mínimo 2 dígitos" enquanto o código fazia
// outra coisa. Agora a função carrega a explicação no próprio banco.
check('a função tem comment no banco', /comment on function next_cadastro_code\(\)/.test(migracao));
check('  dizendo que não trunca', /nunca truncado|no MÍNIMO 2 dígitos/.test(migracao));

console.log('--- o que foi medido ---');
for (const [caso, resultado] of [
  ["lpad('9', 2, '0')", "'09'  — certo"],
  ["lpad('100', 2, '0')", "'10'  — o cadastro 100 virava o código 10"],
  ["lpad('6493', 2, '0')", "'64'"],
  ['banco novo do RECRIAR-DO-ZERO, sequência em 99', 'devolveu 100 e 101'],
  ['banco real, após importar 6.492 pessoas', 'próximo código = 6493'],
  ['códigos da importação', '6.492 distintos, 1 a 6492, zero repetidos']
]) console.log(`  ·  ${caso.padEnd(46)} ${resultado}`);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
