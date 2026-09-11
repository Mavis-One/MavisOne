#!/usr/bin/env node
/**
 * O ERRO QUE CHEGA NA TELA (fase CC — achado 08 da varredura de 11/09/2026).
 *
 * REPRODUZIDO num banco descartavel (mavis_cb, criado do RECRIAR-DO-ZERO.sql)
 * com uma restricao que o app nao conhece — `check (name not like 'CB-DEP%')`
 * na tabela deposits —, cadastrando um deposito por POST /api/cadastros/deposits:
 *
 *   ANTES:  "createDeposit: new row for relation "deposits" violates check
 *            constraint "prova_cb_dep""
 *   DEPOIS: "Erro ao salvar depósito (código 377d6a)"
 *           e no log do servidor, sob o mesmo codigo, o erro inteiro com a pilha:
 *           assertNoError -> createDeposit -> a linha da rota.
 *
 * E o mesmo pelo caminho contrario, na rota legada POST /api/stock, que
 * descartava o erro inteiro sem registrar nada:
 *
 *   ANTES:  "Erro ao salvar produto"   — e nada em lugar nenhum
 *   DEPOIS: "Erro ao salvar produto (código 198829)"
 *           + upsertProduct: ... violates check constraint ... no log
 *
 * SEM REGRESSAO nas mensagens escritas para a pessoa ler: seis casos de negocio
 * sondados na mesma rodada, todos chegando inteiros — "CEP não encontrado.",
 * "CNPJ inválido. Informe 14 dígitos válidos.", "Informe o nome do depósito.",
 * "Produto não encontrado", "Pedido/orçamento não encontrado", "Não encontrado".
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const { respostaDeErro } = require('../lib/erro-para-o-usuario');
const src = ler('server.js');
const srcCodigo = semComentarios(src);

console.log('--- 1. a regra: quem escreveu a mensagem? ---');
// `.status` = alguem escolheu o codigo HTTP, logo escreveu a mensagem para ser
// lida. E' o criterio que o Estoque ja usava, agora valendo para o servidor todo.
const nosso = Object.assign(new Error('Informe o nome do depósito.'), { status: 400 });
const rNosso = respostaDeErro(nosso, 'Erro ao salvar depósito');
check('erro NOSSO mostra a mensagem', rNosso.mensagem === 'Informe o nome do depósito.');
check('  com o status que escolhemos', rNosso.status === 400);
check('  e sem codigo, porque nada foi escondido', rNosso.codigo === null);

const doBanco = new Error('createDeposit: new row for relation "deposits" violates check constraint "x"');
const rBanco = respostaDeErro(doBanco, 'Erro ao salvar depósito');
check('erro do BANCO nao mostra a mensagem', !/relation|constraint|createDeposit/.test(rBanco.mensagem));
check('  mostra o texto de reserva', rBanco.mensagem.startsWith('Erro ao salvar depósito'));
check('  com um codigo para achar no log', /\(código [0-9a-f]{6}\)$/.test(rBanco.mensagem), rBanco.mensagem);
check('  e o codigo volta para quem for registrar', /^[0-9a-f]{6}$/.test(rBanco.codigo || ''));

// Bug de programacao tambem nao e' mensagem para o usuario.
const bug = new TypeError("Cannot read properties of undefined (reading 'id')");
check('TypeError de bug tambem fica escondido',
  !respostaDeErro(bug, 'Erro ao salvar venda').mensagem.includes('undefined'));
// Nem tudo que chega no catch e' um Error.
check('erro nulo nao derruba a resposta',
  respostaDeErro(null, 'Erro ao salvar venda').mensagem.startsWith('Erro ao salvar venda'));
check('  nem string solta', respostaDeErro('quebrou', 'Erro ao salvar').mensagem.startsWith('Erro ao salvar'));
// Status do erro manda sobre o padrao do ponto de saida.
check('o status do erro vence o padrao do ponto',
  respostaDeErro(Object.assign(new Error('x'), { status: 404 }), 'reserva', 500).status === 404);
check('  e sem status vale o padrao do ponto',
  respostaDeErro(new Error('x'), 'reserva', 500).status === 500);
// Erro nosso sem texto ainda tem o que dizer.
check('erro nosso sem mensagem cai na reserva',
  respostaDeErro(Object.assign(new Error(''), { status: 409 }), 'Erro ao salvar').mensagem === 'Erro ao salvar');

console.log('--- 2. dois codigos seguidos nao se repetem ---');
// Sequencial contaria quantos erros o sistema deu; aleatorio nao conta nada.
const codigos = new Set();
for (let i = 0; i < 200; i++) codigos.add(respostaDeErro(new Error('x'), 'y').codigo);
check('200 codigos, 200 diferentes', codigos.size === 200, `${codigos.size} distintos`);

console.log('--- 3. nenhum ponto de saida escapou ---');
// O que NAO pode voltar: mensagem de erro indo crua para a resposta.
const linhas = src.split('\n');
const vazamentos = [];
const silenciosos = [];
for (let i = 0; i < linhas.length; i++) {
  const t = linhas[i].trim();
  if (t.startsWith('//') || t.startsWith('*')) continue;
  if (/error:\s*[^,]*\.message/.test(linhas[i]) && !linhas[i].includes('error.message || reserva')) {
    vazamentos.push(`${i + 1}: ${t.slice(0, 90)}`);
  }
  // catch que responde texto fixo sem registrar nada: sem vazamento, e sem rastro.
  if (/^\} catch \(\w+\) \{$/.test(t)) {
    const bloco = linhas.slice(i + 1, i + 5).join('\n');
    if (!/console\.(error|warn)/.test(bloco) && /return sendJson\(res, \{ error: '[^']+' \}, \d{3}\)/.test(bloco)) {
      silenciosos.push(`${i + 1}`);
    }
  }
}
// A UNICA excecao e' a mensagem COMPOSTA com o rotulo do item, na entrada de
// NF-e: ela so' recebe erro de `assertMovementIsPossible`, que e' checagem em
// memoria e lanca por `stockCore.stockError` — com status e texto para a pessoa.
check('so' + " ha' UM ponto mandando .message cru", vazamentos.length === 1, `${vazamentos.length}`);
check('  e e' + ' o da entrada de NF-e, com o rotulo do item',
  vazamentos.length === 1 && vazamentos[0].includes('${rotulo}'), vazamentos[0]);
check('  documentado como excecao de proposito',
  /ÚNICO PONTO QUE NÃO PASSA PELO sendErro/.test(src));
check('nenhum catch descarta o erro em silencio', silenciosos.length === 0,
  silenciosos.length ? `${silenciosos.length} em ${silenciosos.slice(0, 5).join(', ')}` : '0');

console.log('--- 4. um jeito so de responder erro ---');
const quantos = (srcCodigo.match(/sendErro\(res, /g) || []).length;
check('o servidor responde erro por sendErro', quantos >= 100, `${quantos} pontos`);
check('  e sendStockError nao existe mais', !/sendStockError/.test(srcCodigo));
check('a decisao mora na lib', /const \{ respostaDeErro \} = require\('\.\/lib\/erro-para-o-usuario'\);/.test(srcCodigo));
check('  e o servidor so registra e responde',
  /if \(resposta\.codigo\) \{\s*\n\s*console\.error\(`\[erro \$\{resposta\.codigo\}\]/.test(src));

console.log('--- 5. as mensagens de negocio ganharam a marca que faltava ---');
// Sem `.status`, uma mensagem escrita para a pessoa cairia no texto de reserva
// junto com os erros de banco. Duas estavam assim.
check('"Registro não encontrado." agora tem status',
  !/if \(!current\) throw new Error\('Registro não encontrado\.'\);/.test(srcCodigo)
  && !/if \(!record\) throw new Error\('Registro não encontrado\.'\);/.test(srcCodigo));
check('  e o status e 404', (srcCodigo.match(/const erro = new Error\('Registro não encontrado\.'\);\s*\n\s*erro\.status = 404;/g) || []).length === 2);

console.log('--- o que foi medido contra a API ---');
for (const [caso, resultado] of [
  ['deposito recusado pelo banco, ANTES', 'nome da tabela + nome da restricao na tela'],
  ['o mesmo, DEPOIS', '"Erro ao salvar depósito (código 377d6a)"'],
  ['e no log do servidor', 'o erro inteiro, com a pilha, sob 377d6a'],
  ['rota legada que engolia o erro, ANTES', '"Erro ao salvar produto" e nada no log'],
  ['a mesma, DEPOIS', 'mesma frase + codigo, e o erro no log'],
  ['6 mensagens de negocio', 'chegaram inteiras, sem codigo'],
  ['pontos de saida convertidos', '71 + 39 catch silenciosos']
]) console.log(`  ·  ${caso.padEnd(42)} ${resultado}`);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
