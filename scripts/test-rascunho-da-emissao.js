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
check('o botão fica ao lado do Emitir', tela.includes('<button type="button" class="secondary" id="nfeFocusSalvarRascunho">Salvar nota em edição</button>')
  && css.includes('.nfe-acoes-emissao { display: flex;'));
check('o estado da tela inteira vai junto (itens, transporte, cobrança, campos)',
  tela.includes('itens, complemento, informacoesEditadas, notaDoPedido, observacoes,')
  && tela.includes('transportadoraId, transporte, cobrancaEditada, cobranca'));
check('ao abrir, volta antes do primeiro desenho e os campos depois',
  /camposDoRascunho = aplicarEstadoSalvo\(resposta\.rascunho\.dados\);[\s\S]*?renderForm\(\);\s*if \(camposDoRascunho\) \{\s*preencherCamposSalvos\(camposDoRascunho\);/.test(tela));

console.log('\n--- 2. os outros ajustes da tela ---');
check('cClassTrib na lista do CST do IBS/CBS', tela.includes("if (campo === 'classTrib') {") && tela.includes("return (tabelasFiscais.classificacaoTributaria || [])"));
check('  trocar o CST leva o cClassTrib junto', tela.includes('if (valor && doCst.length && !atual.startsWith(valor)) item.fiscal.classTrib = String(doCst[0].codigo).trim();'));
check('a nota do pedido abre com o endereço do cadastro',
  tela.includes('const end = (cliente && cliente.endereco) || {};') && tela.includes('value="${escapeHtml(destinatario.logradouro)}"'));
check('a lista aberta do select tem as cores do tema',
  css.includes('.nfe-imposto-campos select option,') && css.includes('background: color-mix(in srgb, var(--warning) 12%, var(--input-bg));'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
