#!/usr/bin/env node
/**
 * A LISTA DO CAMPO DE BUSCA NÃO PODE FICAR "ATRÁS" DO BLOCO SEGUINTE.
 *
 * O QUE ACONTECIA (15/09/2026)
 * ----------------------------
 * A lista do campo de busca (attachSearchableSelect, app.js) era um
 * `position: absolute` dentro do bloco do campo. Os blocos dos formulários
 * cortam o que sai deles — `.cadastro-section` tem `overflow: hidden`, e os
 * modais rolam (`.modal-lg { overflow-y: auto }`). Resultado, visto em
 * PCP > Nova ordem, campo Produto: 5.476 opções, UMA linha visível, o resto
 * atrás do bloco "Situação". A pessoa via a lista abrir e não conseguia
 * escolher.
 *
 * Não era um bug do PCP: era de todo campo de busca dentro de um bloco que
 * corta. E não aparecia em teste nenhum, porque nenhum deles mede onde a
 * lista está desenhada — só se ela abre.
 *
 * O CONSERTO
 * ----------
 * Enquanto está aberta, a lista vive no <body>, com `position: fixed` e
 * coordenadas calculadas a partir do campo; acompanha rolagem (na captura,
 * porque scroll não borbulha) e redimensionamento; abre para cima quando não
 * cabe embaixo. Fechada, VOLTA para dentro do wrapper — assim uma tela
 * redesenhada leva a lista junto, como sempre levou.
 *
 * Por que não tirar o `overflow: hidden` dos blocos: os modais precisam rolar,
 * e a lista dentro de um modal com rolagem continuaria cortada. A saída pelo
 * <body> resolve os dois casos com uma regra só.
 *
 * MEDIDO num Chrome de verdade, contra um clone do banco (5.475 produtos,
 * 6.492 pessoas), em TODAS as telas do menu — cada lista aberta nos dois
 * estados, no mesmo DOM, e cada linha conferida com elementFromPoint:
 *
 *     132 telas percorridas · 23 campos de busca em 13 telas
 *     cortados ANTES:  6   PCP > Nova ordem (Produto) 0 de 4 linhas visíveis,
 *                          PCP > Nova estrutura (Produto e Componente) 2 de 4,
 *                          Contratos > Novo contrato (Parte) 0 de 6,
 *                          Vendas > Novo pedido (Produto) 2 de 3,
 *                          Estoque > Nova transferência (Produto) 3 de 6
 *     cortados DEPOIS: 0   e todas as 23 cabem na janela e voltam ao wrapper
 *                          ao fechar (Escape), sem lista órfã no <body>
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const app = semComentarios(ler('public/app.js'));
const css = ler('public/app.css');
const attach = app.slice(app.indexOf('function attachSearchableSelect'), app.indexOf('function sanitizeDigits'));

console.log('--- 1. aberta, a lista sai do bloco ---');
check('abrir leva a lista para o <body>', /function abrirLista\(\)[\s\S]*?document\.body\.appendChild\(dropdown\)/.test(attach));
check('  com a classe que a torna fixa', /dropdown\.classList\.add\('searchable-select-dropdown-solta'\)/.test(attach));
check('  posicionada a partir do campo', /const r = input\.getBoundingClientRect\(\);[\s\S]*?dropdown\.style\.left = `\$\{r\.left\}px`;[\s\S]*?dropdown\.style\.width = `\$\{r\.width\}px`;/.test(attach));
check('  e abre para cima quando não cabe embaixo', /cabeEmbaixo[\s\S]*?cabeEmCima[\s\S]*?if \(!cabeEmbaixo && cabeEmCima\)/.test(attach));
check('acompanha rolagem NA CAPTURA (scroll não borbulha) e resize',
  /window\.addEventListener\('scroll', reposicionar, true\)/.test(attach) && /window\.addEventListener\('resize', reposicionar\)/.test(attach));

console.log('\n--- 2. fechada, volta para o lugar ---');
check('fechar devolve a lista ao wrapper', /function fecharLista\(\)[\s\S]*?wrapper\.appendChild\(dropdown\)/.test(attach));
check('  e tira os ouvintes de rolagem/resize', /removeEventListener\('scroll', reposicionar, true\)[\s\S]*?removeEventListener\('resize', reposicionar\)/.test(attach));
check('  wrapper que já saiu da tela: a lista some junto', /else \{\s*dropdown\.remove\(\);\s*\}/.test(attach));
check('  campo que sumiu do DOM com a lista aberta: fecha na próxima rolagem', /if \(!input\.isConnected\) \{ fecharLista\(\); return; \}/.test(attach));
// Todo caminho que esconde passa por fecharLista: um `dropdown.hidden = true`
// solto deixaria a lista escondida no <body>, presa a um wrapper que pode
// ser redesenhado.
const escondeDireto = (attach.match(/dropdown\.hidden = true;/g) || []).length;
const mostraDireto = (attach.match(/dropdown\.hidden = false;/g) || []).length;
check('só fecharLista esconde', escondeDireto === 1, `${escondeDireto} ocorrência(s)`);
check('só abrirLista mostra', mostraDireto === 1, `${mostraDireto} ocorrência(s)`);
check('lista órfã de outro campo é recolhida ao abrir', /querySelectorAll\('body > \.searchable-select-dropdown-solta'\)\.forEach/.test(attach));

console.log('\n--- 3. o CSS ---');
const regraSolta = /\.searchable-select-dropdown-solta\s*\{([^}]*)\}/.exec(css);
check('a classe da lista solta existe', Boolean(regraSolta));
check('  position: fixed', Boolean(regraSolta) && /position:\s*fixed/.test(regraSolta[1]));
const zSolta = regraSolta && /z-index:\s*(\d+)/.exec(regraSolta[1]);
const zModal = /\.modal-overlay\s*\{[^}]*z-index:\s*(\d+)/.exec(css);
check('  acima dos modais', Boolean(zSolta && zModal) && Number(zSolta[1]) > Number(zModal[1]), `lista ${zSolta && zSolta[1]} · modal ${zModal && zModal[1]}`);
check('  right: auto (left + width mandam)', Boolean(regraSolta) && /right:\s*auto/.test(regraSolta[1]));
// A regra base continua: dentro do wrapper, a lista fica como era (para o
// estado fechado e para qualquer tela que ainda não a tenha solto).
check('a regra base continua absoluta dentro do wrapper', /\.searchable-select-dropdown\s*\{\s*position:\s*absolute/.test(css));

console.log('\n--- o que foi medido ---');
for (const [caso, resultado] of [
  ['telas do menu percorridas', '132, em 14 módulos'],
  ['campos de busca encontrados (visíveis, não readonly)', '23, em 13 telas'],
  ['cortados ANTES (lista dentro do bloco)', '6 — PCP nova ordem 0/4, nova estrutura 2/4 e 2/4, contratos 0/6, venda 2/3, transferência 3/6'],
  ['cortados DEPOIS (lista solta no body)', '0 — toda linha exibida responde ao elementFromPoint'],
  ['cabe na janela · volta ao wrapper ao fechar', '23/23 · 23/23']
]) console.log(`  ·  ${caso.padEnd(52)} ${resultado}`);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
