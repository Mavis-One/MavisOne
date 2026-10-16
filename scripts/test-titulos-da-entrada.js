#!/usr/bin/env node
/**
 * A EDIÇÃO DE TÍTULO COMO PARTE DO LANÇAMENTO DA NOTA (15/10/2026). Pedido do
 * usuário: "o lançamento pela tela notas contra o CNPJ deve abrir como parte do
 * processo de lançamento a tela de edição de títulos para conseguirmos alterar
 * a forma como vamos lançar financeiramente".
 *
 * Provado no navegador (servidor local, nota recebida da Matriz com 3
 * duplicatas injetadas só para o teste): Notas contra CNPJ › Dar entrada ›
 * Lançar entrada abriu "Edição de Título" com "Entrada da NF-e 291733 · título
 * 1 de 3", estabelecimento Matriz, valor travado; salvar abriu o 2 e o 3 (o
 * vencimento alterado no 2 ficou gravado); no último, "Voltar às Notas contra
 * CNPJ" voltou à lista com a nota já lançada. A auditoria da entrada foi para
 * a tabela (antes caía no db.json: texto solto numa coluna jsonb). Tudo o que
 * o teste criou foi apagado e a nota recebida voltou ao XML original.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => semComentarios(fs.readFileSync(path.join(__dirname, '..', p), 'utf8'));

console.log('\n--- a entrada abre a Edição de Título ---');
const entrada = ler('public/modules/purchases/subs/entrada_nfe.js');
check('com os títulos que a nota gerou, e só com o módulo Financeiro',
  /const titulos = \(resposta\.financeiro \|\| \[\]\)\.map\(\(l\) => l && l\.id\)\.filter\(Boolean\);\s*if \(titulos\.length && \(state\.user\?\.allowedModules \|\| \[\]\)\.includes\('finance'\)\) \{/.test(entrada));
check('  a fila guarda os títulos, a nota e a volta (Notas contra CNPJ ou Notas de Entrada)',
  /state\.financeFilaDaEntrada = \{\s*ids: titulos,/.test(entrada)
  && /\{ module: 'fiscal', sub: 'notas_contra_cnpj', rotulo: 'Voltar às Notas contra CNPJ' \}/.test(entrada)
  && /\{ module: 'purchases', sub: 'entrada_nfe', rotulo: 'Voltar às Notas de Entrada' \}/.test(entrada));
check('  e abre o primeiro como Edição de Título', /state\.financeEditEntryId = titulos\[0\];[\s\S]{0,120}state\.activeSub = 'edicao_titulo';[\s\S]{0,80}ctx\.loadModule\('finance'\);\s*return;/.test(entrada));
// Uma transferência desligava o "Gerar contas a pagar" e ele seguia desligado
// nas notas seguintes: sem conta a pagar, a Edição de Título não abria.
// Desde 16/10/2026 sem exceção para a transferência: a Edição de Título vale
// para todos os lançamentos pelas Notas contra CNPJ (pedido do usuário).
check('cada nota analisada volta a gerar contas a pagar (transferência inclusive)', /tela\.gerarFinanceiro = true;/.test(entrada)
  && !/if \(resposta\.transferencia\) tela\.gerarFinanceiro = false;/.test(entrada) && !/tela\.gerarFinanceiro = !resposta\.transferencia;/.test(entrada));
check('  a marca na nota recebida acontece antes de sair da tela', entrada.indexOf("/api/fiscal/dfe/${encodeURIComponent(tela.dfeId)}/entrada") < entrada.indexOf('state.financeFilaDaEntrada = {'));

console.log('\n--- a Edição de Título segue a fila ---');
const titulo = ler('public/modules/finance/subs/novo_lancamento.js');
check('reconhece o título da fila (e outro título encerra a fila)',
  /const filaDaEntrada = state\.financeFilaDaEntrada && editEntry\s*&& state\.financeFilaDaEntrada\.ids\.includes\(editEntry\.id\)/.test(titulo)
  && /if \(!filaDaEntrada\) state\.financeFilaDaEntrada = null;/.test(titulo));
// Desde 16/10/2026 a fila serve também à aprovação do pedido (titulo/aviso
// próprios; test-titulos-na-aprovacao.js). Sem eles, o texto da entrada.
check('  mostra a nota e a posição', /\$\{escapeHtml\(\(filaDaEntrada\.tituloDe && filaDaEntrada\.tituloDe\[editEntry\.id\]\) \|\| filaDaEntrada\.titulo \|\| `Entrada da \$\{filaDaEntrada\.nota\}`\)\} · título \$\{posicaoNaFila \+ 1\} de \$\{filaDaEntrada\.ids\.length\}/.test(titulo));
check('  salvar abre o seguinte', /if \(filaDaEntrada && proximoDaFila\) \{[\s\S]{0,200}abrirProximoDaFila\(\);\s*return;/.test(titulo));
check('  o último oferece a volta, que encerra a fila',
  /id="financeFilaVolta">\$\{escapeHtml\(filaDaEntrada\.volta\.rotulo\)\}/.test(titulo)
  && /function voltarDaFila\(\) \{\s*const volta = filaDaEntrada\.volta;\s*state\.financeFilaDaEntrada = null;/.test(titulo));

console.log('\n--- o servidor ---');
const server = ler('server.js');
check('o título nasce com o estabelecimento do CNPJ que recebeu a nota',
  /const docDestino = entradaNfe\.digitos\(nota\.destinatario && nota\.destinatario\.documento\);/.test(server)
  && /estabelecimentoId: estabDestino \? estabDestino\.id : '',/.test(server));
check('a auditoria da entrada vai como objeto (a coluna é jsonb)',
  /action: 'entrada-nfe-lancada',[\s\S]{0,200}details: \{ nota: `\$\{nota\.numero\}\/\$\{nota\.serie\}`, chave: nota\.chave,/.test(server)
  && !/details: `NF-e \$\{nota\.numero\}/.test(server));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
