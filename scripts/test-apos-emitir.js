#!/usr/bin/env node
/**
 * EMITIU, VAI PARA NF-e EMITIDAS (14/10/2026). Pedido do usuário: "quando o
 * usuário apertar em emitir a NF a página recarrega já nas NF-e emitidas e já
 * mostra erro ou aprovação".
 *
 * Provado no navegador (resposta da emissão simulada, notas de teste apagadas):
 *   - emitir com retorno ERRO: a tela foi para #/finance/nfe_emitidas e abriu
 *     o motivo ("Código SEFAZ 598 ..."), com o estado da tela enviado junto;
 *   - autorizada: "NF-e nº 5055 autorizada.";
 *   - processando: "A SEFAZ está processando — o resultado aparece aqui"; a
 *     nota virou ERRO no banco e o popup do motivo abriu sozinho.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const servidor = ler('server.js');
const emissao = ler('public/modules/finance/subs/emitir_nfe_focus.js');
const lista = ler('public/modules/finance/subs/nfe_emitidas.js');

check('falha depois de gravar: a rota devolve a nota (status ERRO)',
  servidor.includes('error.nfeId = nfe.id;') && servidor.includes('return sendJson(res, { success: false, nfe: gravada });'));
check('  falha antes de gravar continua erro', servidor.includes('if (!gravada) throw erroDaEmissao;'));
check('a emissão vai para NF-e Emitidas com a nota', emissao.includes("state.nfeAposEmissao = { id: notaEmitida.id, status: notaEmitida.status, numero: notaEmitida.numero || '' };")
  && emissao.includes("state.activeSub = 'nfe_emitidas';"));
check('  o que não virou nota fica na tela, com o motivo', emissao.includes("titulo: 'A NF-e não foi emitida'"));
check('a lista mostra o resultado ao abrir', lista.includes('mostrarResultadoDaEmissao(resultado);') && lista.includes('delete state.nfeAposEmissao;'));
check('  autorizada: aviso com o número', lista.includes("showToast(`NF-e${nota.numero ? ` nº ${nota.numero}` : ''} autorizada.`, 'success', 7000);"));
check('  erro: o popup do motivo, com Corrigir nota', /status === 'ERRO' \|\| status === 'DENEGADO'\) \{\s*abrirErroDaNota\(nota\.id\);/.test(lista));
check('  processando: acompanha (12 × 5 s) e para se sair da tela',
  lista.includes('for (let tentativa = 0; tentativa < 12; tentativa += 1) {') && lista.includes('if (state.activeSub !== telaChave) return;'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
