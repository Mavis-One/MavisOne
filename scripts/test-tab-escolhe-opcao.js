/**
 * TAB ESCOLHE A OPÇÃO NOS CAMPOS DE BUSCA (16/11/2026).
 *
 * Pedido do usuário (print do Novo Lançamento, "dinh" digitado em Conta
 * bancária com "CAIXA DINHEIRO ELECTRIC" na lista): "quero poder apertar TAB pra
 * selecionar as opções pra melhor navegação dentro do sistema".
 *
 * Provado no navegador (porta 3999): "dinh" + Tab escolhe a primeira e o foco
 * vai para Plano de Contas; ↓ + Enter escolhe a segunda sem enviar o
 * formulário; Tab no campo já escolhido não troca; lupa + Tab não escolhe.
 *
 *   node scripts/test-tab-escolhe-opcao.js
 */
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'public/app.css'), 'utf8');
const lancamento = fs.readFileSync(path.join(raiz, 'public/modules/finance/subs/novo_lancamento.js'), 'utf8');
let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas++;
};
const inicio = app.indexOf('function attachSearchableSelect(');
const campo = app.slice(inicio, app.indexOf('\nfunction sanitizeDigits(', inicio));

console.log('--- o teclado no campo de busca (attachSearchableSelect) ---');
check('a primeira opção da lista já vem destacada', /ativa = 0;\s*navegouComSetas = false;\s*destacar\(\);\s*abrirLista\(\);/.test(campo));
check('↓ / ↑ andam pela lista, em volta, e a destacada aparece',
  /\(evento\.key === 'ArrowDown' \|\| evento\.key === 'ArrowUp'\) && lista\.length/.test(campo)
  && /ativa = \(ativa \+ \(evento\.key === 'ArrowDown' \? 1 : -1\) \+ lista\.length\) % lista\.length;/.test(campo)
  && /scrollIntoView\(\{ block: 'nearest' \}\)/.test(campo));
check('Enter com a lista aberta escolhe e não envia o formulário',
  /if \(evento\.key === 'Enter' && lista\.length\) \{\s*evento\.preventDefault\(\);\s*escolher\(/.test(campo));
check('Tab escolhe e segue para o próximo campo (sem preventDefault)',
  /if \(evento\.key === 'Tab' && !evento\.shiftKey && lista\.length\s*&& \(navegouComSetas \|\| \(input\.value\.trim\(\) && !hidden\.value\)\)\) \{\s*\/\/[^\n]*\n\s*escolher\(/.test(campo));
check('  só com algo digitado sem escolha, ou depois das setas', /navegouComSetas = true;/.test(campo));
check('a lista fechada não muda nada (o Enter faz o que sempre fez)', /const lista = dropdown\.hidden \? \[\] : opcoesNaLista\(\);/.test(campo));
check('clique, Tab e Enter escolhem pelo mesmo caminho', (campo.match(/escolher\(/g) || []).length >= 4
  && /function escolher\(value\) \{[\s\S]{0,300}if \(onSelect\) onSelect\(value, found\);/.test(campo));
check('o mouse em cima também destaca', /dropdown\.addEventListener\('mousemove'/.test(campo));
check('a destacada tem estilo', /\.searchable-select-option\.ativa \{/.test(css));

console.log('\n--- a ordem do Tab ---');
check('a lupa fica fora do Tab (continua clicável)', /class="searchable-select-lupa" id="\$\{id\}Lupa" tabindex="-1"/.test(app));
check('os "+" de cadastro do lançamento ficam fora do Tab',
  (lancamento.match(/class="icon-button edit" tabindex="-1" data-inline-add=/g) || []).length === 6
  && !/class="icon-button edit" data-inline-add=/.test(lancamento));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
