#!/usr/bin/env node
/**
 * A NOTA EM EDIÇÃO SALVA ANTES DE EMITIR (fase EL, 14/10/2026) — e os outros
 * ajustes da tela de emissão do mesmo dia.
 *
 * Pedido do usuário: "faça um botão para salvar a nota fiscal em edição antes
 * de faturar ela". Provado no navegador (servidor local): preencher parte de
 * uma avulsa, "Salvar nota em edição", recarregar a página e reabrir trouxe
 * nome, rua e observação de volta, com "Descartar nota salva"; descartar e
 * reabrir voltou à tela vazia. A tabela ficou vazia depois.
 *
 * Também conferido no navegador, no mesmo dia:
 *   - cClassTrib na lista do CST do IBS/CBS: 000 -> 000001..000004, 200 ->
 *     200001..200008; CST sem código na tabela (410) deixa digitável;
 *   - a nota vinda do pedido abre com o endereço do cadastro (KACCAU: 89270000,
 *     RUA 28 de Agosto, 3015, SALA 1, Amizade, Guaramirim/SC, IBGE 4206504);
 *   - a lista aberta do CST legível nos dois temas (opções com as cores do tema).
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const tela = ler('public/modules/finance/subs/emitir_nfe_focus.js');
const servidor = ler('server.js');
const banco = ler('lib/db/rascunho-emissao.js');
const migracao = ler('banco/migrations/fase-el-rascunho-da-emissao.sql');
const css = ler('public/app.css');

console.log('--- 1. salvar a nota em edição ---');
check('tabela própria, fora de nfe, com RLS', /create table if not exists nfe_rascunho_emissao/.test(migracao)
  && /alter table if exists nfe_rascunho_emissao enable row level security;/.test(migracao));
check('uma por pedido e uma avulsa por usuário', banco.includes('return pedidoId ? `pedido:${pedidoId}` : `avulsa:${userId || \'\'}`;'));
check('rotas ler, salvar e descartar com a permissão de emitir',
  servidor.includes("if (pathname === '/api/fiscal/nfe/rascunho') return 'emitir';")
  && /if \(req\.method === 'GET'\) \{\s*return sendJson\(res, \{ rascunho: await rascunhoEmissaoDb\.lerRascunho\(chave\) \}\);/.test(servidor)
  && servidor.includes("if (req.method === 'DELETE') {"));
check('emitida e aceita, o salvo é apagado; rejeitada na hora, fica',
  servidor.includes("if (['AUTORIZADO', 'PROCESSANDO'].includes(String(nfe && nfe.status || '').toUpperCase())) {"));
// 14/10/2026: no canto superior direito e verde (botão principal, sem
// "secondary"), com "Visualizar NF" ao lado. Provado no navegador: o topo
// mostrou "Visualizar NF | Salvar nota em edição" (verde) e o rodapé só o
// Emitir; o Visualizar recebeu da Focus um PDF (application/pdf, 15,7 KB).
check('o salvar fica no canto superior direito, verde', tela.includes('<div class="cadastro-list-actions nfe-acoes-topo">')
  && tela.includes('<button type="button" id="nfeFocusSalvarRascunho">Salvar nota em edição</button>')
  && css.includes('.nfe-acoes-topo { display: flex;'));
check('Visualizar NF ao lado, pela pré-visualização da Focus',
  tela.includes('<button type="button" class="secondary" id="nfeFocusVisualizar">Visualizar NF</button>')
  && tela.includes("await fetch('/api/fiscal/nfe/danfe-previa', {")
  && servidor.includes("if (pathname === '/api/fiscal/nfe/danfe-previa' && req.method === 'POST') {")
  && servidor.includes('const pdf = await client.previsualizarDanfe(payload);'));
check('  a pré-visualização é POST /v2/nfe/danfe e não grava nada',
  ler('lib/focusNfe.js').includes('response = await fetch(`${FOCUS_NFE_BASE_URLS[ambiente]}/nfe/danfe`, {')
  && !/criar|insert|salvar/i.test(servidor.slice(servidor.indexOf("pathname === '/api/fiscal/nfe/danfe-previa' && req.method === 'POST'"), servidor.indexOf("pathname === '/api/fiscal/nfe/emitir' && req.method === 'POST'"))));
check('o estado da tela inteira vai junto (itens, transporte, cobrança, campos)',
  tela.includes('itens, complemento, informacoesEditadas, notaDoPedido, observacoes,')
  && tela.includes('transportadoraId, transporte, cobrancaEditada, cobranca'));
check('ao abrir, volta antes do primeiro desenho e os campos depois',
  /camposDoRascunho = aplicarEstadoSalvo\(resposta\.rascunho\.dados\);[\s\S]*?renderForm\(\);\s*if \(camposDoRascunho\) \{\s*preencherCamposSalvos\(camposDoRascunho\);/.test(tela));

// 14/10/2026: o estado "Em edição" nas NF-e Emitidas. Provado no navegador:
// uma avulsa e uma do pedido 16325 no topo da lista; o filtro "Em edição"
// mostrou só elas; "Continuar" reabriu a emissão com o destinatário e a
// observação salvos; "Descartar" removeu as duas.
const lista = ler('public/modules/finance/subs/nfe_emitidas.js');
check('estado "Em edição" (e no filtro de Status)', lista.includes("'em-edicao': { label: 'Em edição', tone: 'warning' }"));
check('as notas em edição vêm da rota própria', lista.includes("api('/api/fiscal/nfe/rascunhos').catch(() => ({ rascunhos: [] }))")
  && servidor.includes("if (pathname === '/api/fiscal/nfe/rascunhos' && req.method === 'GET') {"));
check('  de pedido (de qualquer um) e a avulsa da própria pessoa', banco.includes("where r.chave like 'pedido:%' or r.chave = $1"));
check('Continuar reabre a emissão pelo pedido', lista.includes('if (r.pedidoId) state.nfeFromOrder = { orderId: r.pedidoId, code: r.pedidoCodigo || 0 };'));
check('Descartar apaga só a nota em edição', lista.includes("{ method: 'DELETE' });") && lista.includes('data-descartar-rascunho'));

console.log('\n--- 2. os outros ajustes da tela ---');
check('cClassTrib na lista do CST do IBS/CBS', tela.includes("if (campo === 'classTrib') {") && tela.includes("return (tabelasFiscais.classificacaoTributaria || [])"));
check('  trocar o CST leva o cClassTrib junto', tela.includes('if (valor && doCst.length && !atual.startsWith(valor)) item.fiscal.classTrib = String(doCst[0].codigo).trim();'));
check('a nota do pedido abre com o endereço do cadastro',
  tela.includes('const end = (cliente && cliente.endereco) || {};') && tela.includes('value="${escapeHtml(destinatario.logradouro)}"'));
check('a lista aberta do select tem as cores do tema',
  css.includes('.nfe-imposto-campos select option,') && css.includes('background: color-mix(in srgb, var(--warning) 12%, var(--input-bg));'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
