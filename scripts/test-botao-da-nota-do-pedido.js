#!/usr/bin/env node
/**
 * PEDIDOS E ORÇAMENTOS: O BOTÃO DA NOTA AO LADO DO CÓDIGO (15/10/2026). Pedido
 * do usuário: "coloque um botão ao lado dos números de pedidos referente às NF
 * geradas por eles, esse botão tem que levar o usuário a uma página viewer pdf
 * com possibilidade para download".
 *
 * Provado no navegador (Chromium completo; o headless-shell não tem
 * visualizador de PDF), com uma NF-e AUTORIZADA de mentira ligada ao pedido
 * 14757 e apagada no fim: o botão apareceu ao lado de "14757" com "Ver a NF-e
 * 1042"; o clique abriu a página "DANFE — NF-e 1042" com Imprimir, "Baixar PDF"
 * (arquivo DANFE-NFe-1042.pdf) e o PDF embutido no visualizador do navegador.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (arquivo) => semComentarios(fs.readFileSync(path.join(__dirname, '..', arquivo), 'utf8'));
const app = ler('public/app.js');
const server = ler('server.js');
const banco = ler('lib/db/vendas-compras.js');
const danfe = ler('public/modules/shared/abrir_danfe.js');
const css = fs.readFileSync(path.join(__dirname, '..', 'public/app.css'), 'utf8');

console.log('\n--- o modelo da nota chega à lista ---');
check('o índice das notas lê o modelo', /select id, numero, status, modelo from nfe/.test(banco)
  && /modelo: Number\(row\.modelo \|\| 55\)/.test(banco));
check('o pedido serializado leva nfeModelo (0 sem nota do Fiscal)',
  /nfeModelo: \(\(\) => \{\s*if \(!record\.nfeId\) return 0;\s*const fiscal = indiceDasNotas\(data\)\.fiscais\.get\(record\.nfeId\);\s*return fiscal \? Number\(fiscal\.modelo \|\| 55\) : 0;/.test(server));

console.log('\n--- o botão ao lado do código ---');
check('só para nota AUTORIZADA ou CANCELADA (as que têm DANFE)',
  /if \(!r\.nfeId \|\| !\['AUTORIZADO', 'CANCELADO'\]\.includes\(situacao\)\) return '';/.test(app));
check('diz NF-e ou NFC-e, com o número', /const tipo = Number\(r\.nfeModelo\) === 65 \? 'NFC-e' : 'NF-e';/.test(app));
check('vai na coluna do código', /valor: \(r\) => escapeHtml\(String\(r\.code\)\) \+ botaoDaNotaDoPedido\(r\)/.test(app));
check('o clique não chega à linha e abre a página da nota',
  /\[data-ver-nota\]'\)\.forEach\(\(botao\) => \{\s*botao\.addEventListener\('click', \(evento\) => \{\s*evento\.stopPropagation\(\);[\s\S]{0,200}window\.MavisDanfe\.abrirNota\(\{/.test(app));
check('  com o nome do arquivo pela nota', /nomeDoArquivo: `\$\{nfce \? 'DANFCe-NFCe' : 'DANFE-NFe'\}/.test(app));
check('o duplo clique da linha ignora botões', /if \(evento\.target\.closest\('input, button, a, select, label'\)\) return;/.test(app));
check('o botão tem estilo', /\.table \.sales-ver-nota \{/.test(css));

console.log('\n--- a página da nota ---');
check('abre a aba dentro do clique', /function abrirNota\([^)]*\) \{\s*const win = window\.open\('', '_blank'\);/.test(danfe));
check('busca a DANFE com o token da sessão', /fetch\(`\/api\/fiscal\/nfe\/\$\{encodeURIComponent\(nfeId\)\}\/danfe`, \{ headers: \{ 'x-auth-token': token \|\| '' \} \}\)/.test(danfe));
check('Baixar com o nome da nota', /baixar\.setAttribute\('download', `\$\{nomeDoArquivo\}\.\$\{ehHtml \? 'html' : 'pdf'\}`\);/.test(danfe));
check('o endereço do PDF é da aba da nota', /const url = \(win\.URL \|\| URL\)\.createObjectURL\(blob\);/.test(danfe));
check('PDF embutido; DANFCe (HTML) em iframe sandbox sem script',
  /if \(ehHtml\) \{\s*iframe\.setAttribute\('sandbox', 'allow-same-origin allow-modals'\);\s*iframe\.srcdoc = await blob\.text\(\);\s*\} else \{\s*iframe\.src = url;/.test(danfe));
check('a CSP deixa embutir o PDF por blob:', /"frame-src 'self' blob:"/.test(server));

console.log('\n--- pop-up bloqueado ---');
(async () => {
  global.window = { open: () => null };
  const { abrirNota } = require('../public/modules/shared/abrir_danfe');
  const erro = await abrirNota({ nfeId: 'x' }).then(() => null, (e) => e);
  check('avisa em vez de falhar calado', erro && /bloqueou a aba nova/.test(erro.message));
  delete global.window;

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
  process.exit(falhas ? 1 : 0);
})();
