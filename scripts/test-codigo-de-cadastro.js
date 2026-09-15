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
 * DOIS CONSERTOS, PORQUE SÃO DOIS BANCOS DIFERENTES
 * -------------------------------------------------
 * A migração fase-ce redefine a função nos bancos que JÁ EXISTEM — o local e o
 * de produção têm o `case` desde 15/09/2026. Mas o schema.sql continuou com o
 * `lpad`, e ele é a PRIMEIRA definição que um banco novo recebe: o
 * RECRIAR-DO-ZERO.sql é gerado a partir dele. Um banco criado do zero nascia
 * com o bug e só o perdia ao chegar na última migração do arquivo; um banco
 * criado só com o schema.sql nascia com o bug e ficava.
 *
 * Por isso o schema.sql também passou a formatar com `case`. Este teste cobrava
 * "no RECRIAR-DO-ZERO a correção vem por último" — uma ordem que só fazia
 * sentido enquanto a primeira definição estava errada. Agora cobra o que vale:
 * NENHUMA definição da função, em nenhum dos três arquivos, usa lpad.
 *
 * PROVADO num banco de rascunho, com a sequência e a função copiadas do
 * schema.sql corrigido: sequência em 8 devolveu '09'; em 99 devolveu '100' e
 * depois '101'; em 6492 devolveu '6493'.
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

console.log('--- 2. o lado SQL não pode usar lpad, em nenhuma definição ---');
const schema = ler('banco/schema.sql');
const zero = ler('banco/RECRIAR-DO-ZERO.sql');
const migracao = ler('banco/migrations/fase-ce-codigo-de-cadastro-sem-corte.sql');

// Olha-se o CORPO de cada `create or replace function next_cadastro_code()` —
// o que fica entre `as $$` e `$$;` — e não o arquivo inteiro. Os três arquivos
// citam `lpad` de propósito, nos comentários que explicam o bug; uma busca no
// texto todo acusaria a explicação como se fosse o defeito.
function corposDaFuncao(sql) {
  const corpos = [];
  const re = /create or replace function next_cadastro_code\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/g;
  let m;
  while ((m = re.exec(sql))) corpos.push(m[1]);
  return corpos;
}
// `lpad(texto, 2, '0')` devolve os DOIS PRIMEIROS caracteres quando o texto é
// maior — é truncamento, não preenchimento. O `case` completa quando falta e
// não mexe quando já passa, que é o que `padStart` faz do lado do JavaScript.
const formataComCase = (corpo) => /case when n < 10 then '0' \|\| n::text else n::text end/.test(corpo)
  && /from nextval\('cadastro_code_seq'\) as n/.test(corpo);
const usaLpad = (corpo) => /lpad\(/.test(corpo);

for (const [nome, sql] of [['schema.sql', schema], ['migração fase-ce', migracao], ['RECRIAR-DO-ZERO.sql', zero]]) {
  const corpos = corposDaFuncao(sql);
  check(`${nome}: define a função`, corpos.length > 0, `${corpos.length} definição(ões)`);
  check('  toda definição formata com case', corpos.every(formataComCase));
  check('  e nenhuma usa lpad', !corpos.some(usaLpad));
}
// O RECRIAR-DO-ZERO é schema + migrações na ordem das fases, então a função
// aparece nele mais de uma vez: a do schema e a da fase-ce. Antes só a última
// podia estar certa; agora todas têm de estar — é o que o `every` acima cobra,
// e este check garante que ele olhou mais de uma.
check('o RECRIAR-DO-ZERO carrega a definição do schema E a da fase-ce',
  corposDaFuncao(zero).length >= 2, `${corposDaFuncao(zero).length} definições`);

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
  ['função do schema.sql corrigido, sequência em 8', "devolveu '09'"],
  ['função do schema.sql corrigido, sequência em 99', "devolveu '100' e depois '101'"],
  ['função do schema.sql corrigido, sequência em 6492', "devolveu '6493'"],
  ['banco real, após importar 6.492 pessoas', 'próximo código = 6493'],
  ['códigos da importação', '6.492 distintos, 1 a 6492, zero repetidos']
]) console.log(`  ·  ${caso.padEnd(50)} ${resultado}`);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
