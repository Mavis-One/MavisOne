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
 *   - processando: a lista acompanha. Desde 14/10/2026 (pedido do usuário: "faça
 *     o teste de mudança de status a cada 0,3s e informe apenas quando
 *     houver"): 10 consultas em 3 s, nenhum aviso enquanto nada mudou; a nota
 *     virou autorizada no banco e o aviso "NF-e nº 5057 autorizada" apareceu
 *     0,7 s depois; a consulta parou; a Focus foi consultada uma vez no
 *     período (no máximo a cada 5 s por nota).
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
check('  erro: o popup do motivo, com Corrigir nota', /\['erro', 'denegado', 'denegada'\]\.includes\(status\)\) \{\s*abrirErroDaNota\(nota\.id\);/.test(lista));
check('processando: a tela pergunta a cada 0,3 s, só avisa quando muda',
  lista.includes('const VIGIA_INTERVALO_MS = 300;')
  && lista.includes("const mudaram = (res.notas || []).filter((n) => pendentes.has(n.id) && n.status !== 'processando');")
  && lista.includes('if (!mudaram.length) return;') && !lista.includes('A SEFAZ está processando'));
check('  liga depois de cada carga e para quando sai da tela', /renderView\(result\);\s*vigiarProcessando\(\);/.test(lista)
  && lista.includes('if (state.activeSub !== telaChave || state.activeModule !== moduloDaTela || !content.isConnected) { pararVigia(); return; }'));
check('  sem ciclo sobreposto', lista.includes('if (vigiaOcupado) return;'));
check('o servidor responde do banco e vai à Focus no máximo a cada 5 s por nota',
  servidor.includes('const CONSULTA_FOCUS_INTERVALO_MS = 5000;')
  && servidor.includes('if (agora - (ultimaConsultaFocus.get(r.id) || 0) < CONSULTA_FOCUS_INTERVALO_MS) return;')
  && servidor.includes('if (consultasEmCurso.has(id)) return;'));
check('  a rota fica antes da GET /api/fiscal/nfe/:id',
  servidor.indexOf("pathname === '/api/fiscal/nfe/status' && req.method === 'GET'") < servidor.indexOf("if (pathname.startsWith('/api/fiscal/nfe/') && req.method === 'GET')"));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
