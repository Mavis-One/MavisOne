#!/usr/bin/env node
// EXIGÊNCIAS DE NF-e POR CLIENTE (fase FB, 22/10/2026).
//
// O usuário colou "006_exigencias_nfe_cliente.sql" (ARWEG / Grupo WEG). Adaptado,
// não rodado. Decidido com ele: o pedido de compra do cliente é digitado no
// próprio pedido de venda, e o perfil de cada cliente fica em Fiscal ›
// Exigências de NF-e por Cliente.
//
// Provado no servidor local, com a Focus substituída (a prévia da DANFE
// gravava o payload, o e-mail gravava o pedido), e um perfil de teste na
// KACCAU: sem os dados, a pré-visualização foi recusada com os 10 problemas de
// uma vez; completa, cada item levou pedido_compra 4519374627,
// numero_item_pedido_compra 10/20, a unidade do pedido (PC no 2º) e
// "MATERIAL KACCAU: MAT-1" no texto do item, e o texto do pedido entrou nas
// informações complementares; item do pedido repetido, dados bancários e nº
// com 16 caracteres, recusados; cliente sem perfil saiu como antes. O
// reenvio do XML por e-mail chamou a Focus com o e-mail do perfil e ficou em
// nfe_email_envio. Na tela: o perfil da ARWEG com as 11 marcas; o bloco
// "Pedido do cliente" só com a KACCAU, gravando no pedido e voltando ao
// reabrir; na emissão, o bloco veio preenchido pelo pedido e sumiu com outro
// destinatário. Tudo apagado depois.
'use strict';
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');
const ler = (a) => fs.readFileSync(path.join(RAIZ, a), 'utf8');

console.log('\n--- 1. as regras (shared/exigencias_nfe.js) ---');
const X = require('../public/modules/shared/exigencias_nfe');
const tudo = Object.fromEntries(X.MARCAS.map((m) => [m.campo, true]));
const { perfil, erros } = X.normalizarPerfil({
  ...tudo, cnpjCpf: '84.434.240/0001-94', nome: 'ARWEG', emailsXml: 'nfe@weg.net; NFE@weg.net, outro@weg.net',
  rotuloMaterial: 'MATERIAL ARWEG', modeloInfcpl: 'PEDIDO: {pedido} | COND: {cond_pagto} | CENTRO: {centro} | DEP: {deposito}'
});
check('perfil normalizado: só dígitos e e-mails sem repetir', erros.length === 0 && perfil.cnpjCpf === '84434240000194' && perfil.emailsXml.join() === 'nfe@weg.net,outro@weg.net', perfil.emailsXml.join());
check('e-mail inválido, documento curto e mais de 10 e-mails são recusados',
  X.normalizarPerfil({ cnpjCpf: '123', nome: 'x', emailsXml: 'a' }).erros.length === 2
  && X.normalizarPerfil({ cnpjCpf: '84434240000194', nome: 'x', emailsXml: Array.from({ length: 11 }, (_, i) => `e${i}@x.com`) }).erros.length === 1);
const pedido = { numero: '4519374627', condicaoPagamento: '10 dias', centro: '1000', deposito: 'D01' };
check('o texto do modelo troca as quatro variáveis', X.textoDoPedido(perfil, pedido) === 'PEDIDO: 4519374627 | COND: 10 dias | CENTRO: 1000 | DEP: D01');
check('o código do material com o rótulo do perfil', X.textoDoMaterial(perfil, ' 123 ') === 'MATERIAL ARWEG: 123' && X.textoDoMaterial(perfil, '') === '');
const item = (n, extra = {}) => ({ descricao: `P${n}`, itemPedidoCliente: String(n * 10), codigoMaterialCliente: `M${n}`, unidadeCliente: 'UN', ...extra });
const ok = { perfil, pedido, itens: [item(1), item(2)], infCpl: X.textoDoPedido(perfil, pedido), tipoOperacao: 'VENDA' };
check('nota completa: nada falta', X.conferir(ok).length === 0);
const vazia = X.conferir({ perfil, pedido: {}, itens: [{ descricao: 'P1' }], infCpl: '', tipoOperacao: 'VENDA' });
check('nota vazia: pedido, cond., centro, depósito e os 3 campos do item', vazia.length === 7, vazia.map((p) => p.exigencia).join(','));
check('item do pedido repetido (10 e 010) é a mesma linha', X.conferir({ ...ok, itens: [item(1), item(1, { itemPedidoCliente: '010' })] }).some((p) => p.exigencia === 'linhas'));
check('dados bancários nas observações', X.conferir({ ...ok, infCpl: ok.infCpl + ' Agência 1234 C/C 5678' }).some((p) => p.exigencia === 'dados_bancarios'));
check('  "conta corrente" e "chave pix" também', X.DADOS_BANCARIOS.test('conta corrente 1') && X.DADOS_BANCARIOS.test('Chave PIX: x') && !X.DADOS_BANCARIOS.test('Forma: PIX'));
check('xPed tem até 15 caracteres', X.conferir({ ...ok, pedido: { ...pedido, numero: '1234567890123456' } }).some((p) => /até 15 caracteres/.test(p.problema)));
check('nItemPed tem até 6 dígitos', X.conferir({ ...ok, itens: [item(1, { itemPedidoCliente: '1234567' })] }).some((p) => /até 6 dígitos/.test(p.problema)));
check('retorno sem a chave da remessa', X.conferir({ ...ok, tipoOperacao: 'RETORNO', referencias: [] }).some((p) => p.exigencia === 'retorno')
  && !X.conferir({ ...ok, tipoOperacao: 'RETORNO', referencias: [{ chaveAcesso: '4'.repeat(44) }] }).length);
check('perfil inativo ou ausente não confere nada', X.conferir({ ...ok, perfil: { ...perfil, ativo: false }, pedido: {} }).length === 0 && X.conferir({ pedido: {} }).length === 0);
check('perfilDe acha pelo documento com máscara, e não o inativo',
  X.perfilDe([perfil], '84.434.240/0001-94') === perfil && X.perfilDe([{ ...perfil, ativo: false }], '84434240000194') === null);

console.log('\n--- 2. a migração ---');
const sql = ler('banco/migrations/fase-fb-exigencias-nfe-cliente.sql').replace(/--[^\n]*/g, '');
check('tabela do perfil pela chave CNPJ/CPF', /create table if not exists cliente_exigencia_nfe \(\s*cnpj_cpf\s+varchar\(14\) primary key/.test(sql));
check('  uma coluna por marca', X.MARCAS.every((m) => new RegExp(`\\b${m.coluna}\\s+boolean not null default false`).test(sql)));
check('  no máximo 10 e-mails', /coalesce\(array_length\(emails_xml, 1\), 0\) <= 10/.test(sql));
check('tabela dos envios por e-mail', /create table if not exists nfe_email_envio/.test(sql));
check('o perfil da ARWEG vem cadastrado', /'84434240000194', 'ASSOCIACAO RECREATIVA WEG - ARWEG JARAGUA DO SUL'/.test(sql) && /array\['nfe@weg\.net'\]/.test(sql));
check('o SQL do zero termina nela', /fase-fb-exigencias-nfe-cliente\.sql/.test(ler('banco/RECRIAR-DO-ZERO.sql')));

console.log('\n--- 3. o XML (lib/nfePayloadBuilder.js) ---');
const builder = semComentarios(ler('lib/nfePayloadBuilder.js'));
check('xPed e nItemPed com os nomes da Focus', /base\.pedido_compra = String\(item\.pedidoCompra\)\.slice\(0, 15\)/.test(builder)
  && /base\.numero_item_pedido_compra = Number\(item\.numeroItemPedidoCompra\)/.test(builder));
check('o código do material na frente do texto do item', /\[item\.textoDoMaterial, regra\.observacaoFisco,/.test(builder));

console.log('\n--- 4. o servidor ---');
const servidor = semComentarios(ler('server.js'));
const preparar = servidor.slice(servidor.indexOf('async function prepararNfeParaTransmitir('), servidor.indexOf('async function prepararNfeParaTransmitir(') + 40000);
check('o perfil é lido pelo documento do destinatário (NF-e, não NFC-e)', /const perfilDoCliente = nfce \? null : await perfilDeExigencias\(destinatario\.documento, opcoes\.leituras\);/.test(preparar));
check('  sem perfil, o pedido do cliente não vai', /const pedidoDoCliente = perfilDoCliente \? exigenciasNfe\.normalizarPedido\(body\.pedidoCliente\) : null;/.test(preparar));
check('  cada item leva pedido, item do pedido, material e unidade',
  /if \(pedidoDoCliente\.numero\) item\.pedidoCompra = pedidoDoCliente\.numero;/.test(preparar)
  && /item\.numeroItemPedidoCompra = Number\(doPedido\.itemPedidoCliente\)/.test(preparar)
  && /item\.textoDoMaterial = exigenciasNfe\.textoDoMaterial\(perfilDoCliente, doPedido\.codigoMaterialCliente\);/.test(preparar)
  && /if \(doPedido\.unidadeCliente\) item\.unidadeComercial = doPedido\.unidadeCliente;/.test(preparar));
check('  o texto do pedido entra nas informações complementares (uma vez)', /!String\(body\.informacoesAdicionais \|\| ''\)\.includes\(textoDoPedidoDoCliente\)/.test(preparar)
  && /\binformacoesAdicionais,\s*ambiente: focusNfe\.ambienteEfetivo/.test(preparar));
const posConferir = preparar.indexOf('exigenciasNfe.conferir({');
check('a conferência roda na nota montada, antes do limite de texto', posConferir > preparar.indexOf('buildNfePayload({') && posConferir < preparar.indexOf('conferirLimitesDeTexto(payload'));
check('  menos na prévia automática de impostos', /if \(perfilDoCliente && !opcoes\.semExigencias\)/.test(preparar)
  && /prepararNfeParaTransmitir\(body, \{ semTravaDePagamento: true, semExigencias: true, semConferirPagamentos: true, semConferirRegime: true \}\);\s*return sendJson\(res, resumoFiscalDaPrevia\(payload\)\)/.test(servidor));
check('o pré-check lê os perfis uma vez', /perfisDeExigencia: \(\) => umaVez\('perfis-de-exigencia', \(\) => exigenciasNfeDb\.listar\(\)\)/.test(servidor));
check('o pedido de venda guarda o pedido do cliente (cabeçalho e linha)', /pedidoCliente: \(\(\{ condicaoPagamento, centro, deposito \}\) => \(\{ condicaoPagamento, centro, deposito \}\)\)\(/.test(servidor)
  && /\.\.\.exigenciasNfe\.normalizarItem\(item\),\s*quantity,/.test(servidor));
check('  e o pedido -> nota do servidor o leva', /numero: pedido\.customerPoCode \|\| ''/.test(servidor));
check('autorizada, o XML vai por e-mail', /enviarXmlAoCliente\(atualizada\)\.catch\(/.test(servidor)
  && /await client\.enviarEmailNfe\(nfe\.referencia, emails\);/.test(servidor) && /status: 'ERRO', erro: erro\.message/.test(servidor));
check('rotas: ler é visualizar, gravar é configurar, reenviar é emitir',
  /if \(pathname === '\/api\/fiscal\/exigencias-cliente'\) return 'visualizar';/.test(servidor)
  && /if \(pathname\.startsWith\('\/api\/fiscal\/exigencias-cliente\/'\)\) return 'configurar';/.test(servidor)
  && /\\\/email\$\/\.test\(pathname\)\) return method === 'GET' \? 'visualizar' : 'emitir';/.test(servidor));
check('as telas recebem os perfis sem e-mails', /\.map\(\(\{ observacoes, alteradoEm, alteradoPorNome, emailsXml, \.\.\.resto \}\) => \(\{ \.\.\.resto, temEmail:/.test(servidor)
  && /exigenciasNfe: perfisParaAsTelas\(perfisDeExigencia\)/.test(servidor));
const focus = semComentarios(ler('lib/focusnfe.js'));
check('Focus: POST /nfe/{ref}/email com { emails }', /focusRequest\('POST', `\/nfe\/\$\{encodeURIComponent\(ref\)\}\/email`, \{ emails \}, credentials\)/.test(focus));

console.log('\n--- 5. as telas ---');
const app = semComentarios(ler('public/app.js'));
check('o menu do Fiscal tem a tela', /key: 'exigencias_cliente', label: 'Exigências de NF-e por Cliente'/.test(app));
const index = ler('public/index.html');
check('index.html carrega a regra e a tela', /shared\/exigencias_nfe\.js/.test(index) && /fiscal\/subs\/exigencias_cliente\.js/.test(index));
check('pedido: o bloco só para cliente com perfil', /ExigenciasNfe\.perfilDe\(meta\.exigenciasNfe, cliente\.document\)/.test(app) && /\$\{blocoPedidoDoCliente\(\)\}/.test(app));
check('  o nº é o mesmo customerPoCode das Informações Gerais', /const geral = content\.querySelector\('\[name="customerPoCode"\]'\);/.test(app));
check('  e vai para a NF-e com os campos de cada linha', /pedidoCliente: \{\s*numero: formState\.customerPoCode \|\| '',/.test(app) && /codigoMaterialCliente: item\.codigoMaterialCliente \|\| '',/.test(app));
const nfe = semComentarios(ler('public/modules/finance/subs/emitir_nfe_focus.js'));
check('emissão: o bloco pelo documento do destinatário', /ExigenciasNfe\.perfilDe\(meta\.exigenciasNfe, campo \? campo\.value : destinatario\.documento\)/.test(nfe)
  && /<div id="nfeFocusPedidoCliente" hidden><\/div>/.test(nfe) && /<section class="nfe-bloco" data-bloco="pedidoCliente">/.test(nfe));
check('  o corpo leva o pedido e os campos de cada item', /unidadeCliente: item\.unidadeCliente \|\| ''\s*\}\)\),\s*pedidoCliente,/.test(nfe));
check('  e a nota em edição guarda o pedido do cliente', /desconto, frete, outrasDespesas, seguro, pedidoCliente,/.test(nfe));
check('retorno: a chave da remessa, opcional', /name="retornoChave"/.test(nfe) && /if \(tipoOperacao === 'RETORNO'\) \{/.test(nfe));
// O "Reenviar XML por e-mail" no modal da NF-e autorizada (22/10/2026). Provado
// com uma nota autorizada de teste: "Ainda não foi enviado" -> clique -> a Focus
// (simulada) recebeu o e-mail do perfil e a linha "enviado ... por
// Administrador" apareceu. Apagado depois.
const emitidas = semComentarios(ler('public/modules/finance/subs/nfe_emitidas.js'));
check('NF-e Emitidas: envios e "Reenviar" só na NF-e fiscal autorizada',
  /if \(nfe\.origem === 'fiscal' && nfe\.status === 'autorizada' && nomeDoDocumento === 'NF-e'\) desenharEnviosPorEmail\(nfe\.id\);/.test(emitidas)
  && /\/api\/fiscal\/nfe\/\$\{encodeURIComponent\(nfeId\)\}\/email`, \{ method: 'POST'/.test(emitidas));
check('  e só quando há e-mail no perfil ou envio feito', /if \(!envios\.length && !emails\.length\) \{ alvo\.innerHTML = ''; return; \}/.test(emitidas)
  && /return sendJson\(res, \{ envios, emails: perfil \? perfil\.emailsXml : \[\] \}\);/.test(servidor));
const tela = semComentarios(ler('public/modules/fiscal/subs/exigencias_cliente.js'));
check('a tela do Fiscal grava pela rota e confere antes com a mesma regra', /\/api\/fiscal\/exigencias-cliente\/\$\{encodeURIComponent\(editando\)\}`, \{ method: 'PUT'/.test(tela)
  && /Exigencias\.normalizarPerfil\(corpo\)/.test(tela));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
