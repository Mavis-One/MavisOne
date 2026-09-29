#!/usr/bin/env node
// O HISTÓRICO FISCAL VIGIA A LISTA INTEIRA (fase DJ).
//
// O QUE ESTE TESTE EXISTE PARA PEGAR
// ----------------------------------
// `produto_fiscal` guarda o retrato dos campos fiscais do produto, e a trigger
// `produto_fiscal_registrar` decide QUANDO tirar um retrato novo comparando uma
// lista de colunas, uma por uma. Essa lista é escrita à mão no SQL.
//
// O defeito que isso convida é silencioso e permanente: alguém acrescenta uma
// coluna fiscal em `products` numa fase futura — como a fase CS acrescentou
// cinco —, não mexe na trigger, e a partir daí o histórico responde "esse campo
// nunca mudou" com a autoridade de um registro. Não há erro, não há tela
// errada, e o estrago só aparece quando a EFD de um período antigo precisar do
// valor antigo, que não foi guardado. Histórico perdido não se recupera.
//
// ISTO JÁ ACONTECEU, NA PRIMEIRA VERSÃO DESTA PRÓPRIA FASE: das 13 colunas de
// `COLUNAS_FISCAIS`, a trigger vigiava 12. Faltava `numero_fci`, o número da
// Ficha de Conteúdo de Importação — que existe no cadastro desde antes, vai
// para a nota como nFCI, e está vazio nos 5.475 produtos, então nada em tela
// nenhuma denunciaria. Escrever este teste é o que achou.
//
// A FONTE DA VERDADE É `COLUNAS_FISCAIS`, em lib/db/estoque.js: é o mapa que o
// formulário de produto usa para saber o que é campo fiscal. Quem acrescenta
// campo fiscal mexe lá primeiro, por necessidade — sem isso o formulário não
// grava. Então comparar a trigger contra esse mapa cobra a atualização no
// lugar em que ela não pode ser esquecida.
//
// O QUE ESTE TESTE NÃO ALCANÇA
// ----------------------------
// Semântica do Postgres: se a trigger dispara, o que `is distinct from`
// responde com NULL de um lado, e que instante `now()` devolve dentro de uma
// transação. Isso é `scripts/prova-historico-fiscal.js`, que precisa do banco e
// não entra em `npm test`.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const MIGRACAO = 'banco/migrations/fase-dj-fundacao-fiscal.sql';
const sql = ler(MIGRACAO);
const estoque = ler('lib/db/estoque.js');

// Comentário de SQL casaria com quase todo padrão abaixo — a palavra "ncm" e a
// palavra "trigger" aparecem dezenas de vezes na prosa deste arquivo. Todas as
// buscas rodam contra o SQL SEM comentário, pelo mesmo motivo que o test-rls.js
// registra: teste que reclama de texto em vez de comando ensina a esconder a
// palavra.
const semComentario = sql.replace(/--[^\n]*/g, '');

// ---------------------------------------------------------------------------
console.log('--- a lista de campos fiscais, do lado de quem grava ---');

const blocoMapa = estoque.slice(estoque.indexOf('const COLUNAS_FISCAIS = {'));
const mapa = blocoMapa.slice(0, blocoMapa.indexOf('};'));
const COLUNAS_FISCAIS = [...mapa.matchAll(/^\s*\w+:\s*'([a-z_0-9]+)'/gm)].map((m) => m[1]);
check('COLUNAS_FISCAIS foi lida de lib/db/estoque.js', COLUNAS_FISCAIS.length > 10, `${COLUNAS_FISCAIS.length} colunas`);

// As colunas que a trigger vigia ALÉM das fiscais, cada uma com motivo. Se esta
// lista crescer sem que alguém escreva o porquê, o check de baixo reclama.
const EXTRAS_COM_MOTIVO = {
  sku: 'COD_ITEM do registro 0200 — muda de valor e a nota antiga passa a citar um código que não existe mais',
  name: 'DESCR_ITEM do registro 0200 — descrição trocada no meio do período é a pergunta clássica do fisco',
  tipo_produto_fiscal: 'separa mercadoria de item escritural, e não está em COLUNAS_FISCAIS porque não vem do formulário'
};

// ---------------------------------------------------------------------------
console.log('\n--- a tabela guarda todas elas ---');

const criaTabela = semComentario.slice(semComentario.indexOf('create table if not exists produto_fiscal'));
const corpoTabela = criaTabela.slice(0, criaTabela.indexOf('\n);'));
const colunasDaTabela = new Set([...corpoTabela.matchAll(/^\s{2}([a-z_0-9]+)\s+[a-z]/gm)].map((m) => m[1]));
check('o create table foi encontrado', colunasDaTabela.size > 10, `${colunasDaTabela.size} colunas`);

const semNaTabela = COLUNAS_FISCAIS.filter((c) => !colunasDaTabela.has(c));
check('produto_fiscal tem uma coluna para cada campo fiscal',
  semNaTabela.length === 0, semNaTabela.join(', ') || 'nenhuma faltando');

const extrasSemMotivo = [...colunasDaTabela].filter((c) =>
  !COLUNAS_FISCAIS.includes(c) && !EXTRAS_COM_MOTIVO[c] &&
  !['id', 'product_id', 'nome', 'vigencia_inicio', 'vigencia_fim', 'motivo', 'registrado_em'].includes(c));
check('e nenhuma coluna a mais sem estar prevista aqui',
  extrasSemMotivo.length === 0, extrasSemMotivo.join(', ') || 'nenhuma');

// ---------------------------------------------------------------------------
console.log('\n--- a TRIGGER vigia todas elas (o defeito que este teste achou) ---');

const funcao = semComentario.slice(semComentario.indexOf('create or replace function produto_fiscal_registrar'));
const corpoFuncao = funcao.slice(0, funcao.indexOf('$$;') + 3);
check('a função foi encontrada', corpoFuncao.length > 200, `${corpoFuncao.length} bytes`);

const guarda = corpoFuncao.slice(corpoFuncao.indexOf("if tg_op = 'UPDATE'"), corpoFuncao.indexOf('return new;'));
const vigiadas = new Set([...guarda.matchAll(/new\.([a-z_0-9]+)\s+is distinct from/g)].map((m) => m[1]));
check('a guarda usa `is distinct from`, e não `<>`',
  vigiadas.size > 10 && !/new\.[a-z_0-9]+\s*<>\s*old\./.test(guarda), `${vigiadas.size} colunas vigiadas`);

const naoVigiadas = COLUNAS_FISCAIS.filter((c) => !vigiadas.has(c));
check('nenhum campo fiscal fica fora da guarda',
  naoVigiadas.length === 0, naoVigiadas.join(', ') || 'nenhum fora');

for (const [col, motivo] of Object.entries(EXTRAS_COM_MOTIVO)) {
  check(`  e ${col} também é vigiada (${motivo.slice(0, 52)}...)`, vigiadas.has(col));
}

// ---------------------------------------------------------------------------
console.log('\n--- e o retrato GRAVA todas elas ---');

// Três listas de coluna escritas à mão: o insert da trigger, o values dele, e o
// insert da carga inicial. Uma coluna vigiada que não é gravada produziria um
// retrato novo com o campo nulo — pior que não tirar retrato nenhum, porque
// afirma que o valor era vazio.
const insertTrigger = corpoFuncao.slice(corpoFuncao.indexOf('insert into produto_fiscal ('));
const colsInsert = new Set(
  insertTrigger.slice(0, insertTrigger.indexOf(') values (')).split(/[(,]/).map((s) => s.trim()).filter((s) => /^[a-z_0-9]+$/.test(s))
);
const valuesInsert = new Set(
  [...insertTrigger.slice(insertTrigger.indexOf(') values (')).matchAll(/new\.([a-z_0-9]+)/g)].map((m) => m[1])
);

const semGravar = COLUNAS_FISCAIS.filter((c) => !colsInsert.has(c));
check('o insert da trigger nomeia cada campo fiscal', semGravar.length === 0, semGravar.join(', ') || 'nenhum faltando');
const semValor = COLUNAS_FISCAIS.filter((c) => !valuesInsert.has(c));
check('e passa o valor de cada um (new.<coluna>)', semValor.length === 0, semValor.join(', ') || 'nenhum faltando');

const cargaInicial = semComentario.slice(semComentario.lastIndexOf('insert into produto_fiscal ('));
const colsCarga = new Set(
  cargaInicial.slice(0, cargaInicial.indexOf(')\nselect')).split(/[(,]/).map((s) => s.trim()).filter((s) => /^[a-z_0-9]+$/.test(s))
);
const valoresCarga = new Set([...cargaInicial.matchAll(/\bp\.([a-z_0-9]+)/g)].map((m) => m[1]));
const semCarga = COLUNAS_FISCAIS.filter((c) => !colsCarga.has(c) || !valoresCarga.has(c));
check('a carga inicial também traz todos', semCarga.length === 0, semCarga.join(', ') || 'nenhum faltando');

// ---------------------------------------------------------------------------
console.log('\n--- as decisões que não se podem perder num refactor ---');

check('a vigência é estampada com now(), e não com o relógio de parede',
  /agora\s*:=\s*now\(\)/.test(corpoFuncao) && !/agora\s*:=\s*clock_timestamp\(\)/.test(corpoFuncao),
  (corpoFuncao.match(/agora\s*:=\s*[a-z_]+\(\)/) || ['?'])[0]);
// Duas chamadas separadas abririam um buraco entre o fim de um retrato e o
// início do outro. Uma variável é o que garante que são o mesmo instante.
check('  e uma só vez, guardada em variável',
  (corpoFuncao.match(/now\(\)/g) || []).length === 1, `${(corpoFuncao.match(/now\(\)/g) || []).length} chamada(s)`);
check('o motivo distingue carga inicial de alteração de verdade',
  /'CARGA_INICIAL'/.test(semComentario) && /when 'INSERT' then 'CADASTRO'/.test(corpoFuncao));
check('a trigger é AFTER, e dispara em insert E update',
  /after insert or update on products/.test(semComentario));
check('uma linha aberta por produto, por índice único parcial',
  /create unique index[^;]*produto_fiscal \(product_id\) where vigencia_fim is null/.test(semComentario));
check('intervalo invertido é recusado por CHECK',
  /check \(vigencia_fim is null or vigencia_fim >= vigencia_inicio\)/.test(semComentario));
// Sem FK de propósito: a linha tem de sobreviver à exclusão do produto.
check('product_id NÃO tem foreign key para products',
  /product_id text not null,/.test(semComentario) && !/product_id[^,]*references products/.test(semComentario));
check('RLS ligada nas duas tabelas novas',
  /alter table if exists fiscal_unidades enable row level security/.test(semComentario) &&
  /alter table if exists produto_fiscal enable row level security/.test(semComentario));

// ---------------------------------------------------------------------------
console.log('\n--- e o que a especificação pediu e ficou fora tem motivo escrito ---');

// A fase CP e a fase CS abriram este precedente, e ele é o que impede a próxima
// pessoa de "consertar" a ausência sem saber que ela foi decidida.
for (const recusado of ['regime_tributario', 'indicador_tipo_efd', 'produto_conversao_unidade', 'fiscal_participantes']) {
  const trecho = sql.slice(sql.indexOf('O QUE A ESPECIFICAÇÃO PEDE E NÃO ENTRA'));
  check(`  ${recusado}`, trecho.includes(recusado), trecho.includes(recusado) ? 'com motivo' : 'SEM MOTIVO ESCRITO');
}
check('e a seção de recusas existe', sql.includes('O QUE A ESPECIFICAÇÃO PEDE E NÃO ENTRA'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
