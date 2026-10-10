#!/usr/bin/env node
// AS OPERAÇÕES FISCAIS EDITÁVEIS PELA TELA (fase DW, 10/10/2026).
//
// Pedido do usuário: "faça um botão para modificar e editar as operações
// fiscais". O catálogo de lib/operacaoFiscal.js continua sendo o PADRÃO; a tela
// grava alterações em `operacao_fiscal_ajuste` e lib/db/operacoes-fiscais.js
// as aplica por cima, em memória. O que este teste guarda:
//
//   1. a alteração CHEGA a quem obedece (deveGerarFinanceiro, natureza da
//      nota), e "restaurar" volta exatamente ao padrão;
//   2. as combinações que a SEFAZ recusa ou o sistema não cumpre são barradas
//      no servidor, não só na tela;
//   3. editar pede 'configurar' (ler continua 'visualizar'), fica na auditoria,
//      e a chave é contrato — operação inexistente é 404, não criação;
//   4. a tela tem o lápis por linha, à vista (primeira coluna), e a emissão lê
//      nome e natureza do servidor em vez da cópia escrita.
//
// SEM BANCO: as funções puras rodam de verdade; o resto é lido do fonte.
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
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');
const op = require('../lib/operacaoFiscal');

console.log('\n--- 1. a alteração chega a quem obedece, e restaurar volta ao padrão ---');
check('o padrão é uma cópia congelada', Object.isFrozen(op.PADRAO) && Object.isFrozen(op.PADRAO.VENDA));
check('VENDA gera financeiro no padrão', op.deveGerarFinanceiro({ tipoOperacao: 'VENDA' }) === true);
op.aplicarAjustes([{ chave: 'VENDA', geraFinanceiro: false, natureza: 'VENDA TESTE' }]);
check('com o ajuste, a emissão deixa de gerar financeiro', op.deveGerarFinanceiro({ tipoOperacao: 'VENDA' }) === false);
check('  e a nota leva a natureza nova', op.naturezaDaOperacao('VENDA') === 'VENDA TESTE');
check('  e a operação aparece como alterada', op.foiAlterada('VENDA') === true && op.foiAlterada('REMESSA') === false);
check('  o resto da operação continua o padrão', op.OPERACOES.VENDA.movimentaEstoque === true && op.OPERACOES.VENDA.rotulo === 'Venda');
check('a referência exportada é a mesma (quem importou vê a mudança)', require('../lib/operacaoFiscal').OPERACOES === op.OPERACOES);
op.aplicarAjustes([{ chave: 'NAO_EXISTE_MAIS', rotulo: 'x' }]);
check('ajuste de chave que saiu do código é ignorado', !op.OPERACOES.NAO_EXISTE_MAIS);
op.aplicarAjustes([]);
check('sem ajustes, volta exatamente ao padrão',
  op.deveGerarFinanceiro({ tipoOperacao: 'VENDA' }) === true
  && op.naturezaDaOperacao('VENDA') === op.PADRAO.VENDA.natureza
  && Object.keys(op.PADRAO).every((k) => !op.foiAlterada(k)));
check('o padrão não foi tocado por nada disso', op.PADRAO.VENDA.geraFinanceiro === true);

console.log('\n--- 2. as combinações recusadas ---');
const erros = (chave, campos) => op.validarAjuste(chave, campos);
check('ajuste coerente passa', erros('BONIFICACAO', { rotulo: 'Brinde', natureza: 'REMESSA EM BONIFICACAO' }).length === 0);
check('devolução sem nota referenciada', erros('DEVOLUCAO', { exigeReferencia: false }).length === 1);
check('complementar sem nota referenciada', erros('COMPLEMENTO_ICMS', { exigeReferencia: false }).length === 1);
check('virar devolução obriga a referência', erros('VENDA', { finalidade: 4 }).length === 1);
check('escritural movimentando estoque', erros('VENDA', { exigeProdutoEscritural: true }).length === 1);
check('natureza acima de 60 caracteres (natOp)', erros('VENDA', { natureza: 'X'.repeat(61) }).length === 1);
check('nome vazio', erros('VENDA', { rotulo: '  ' }).length === 1);
check('finalidade fora de 1-4', erros('VENDA', { finalidade: 9 }).length === 1);
check('operação desconhecida', erros('INVENTADA', {}).length === 1);
const norm = op.normalizarAjuste({ natureza: '  venda x ', finalidade: '2', geraFinanceiro: 'true', exigeIcms: false });
check('normaliza: natureza em maiúsculas, finalidade número, booleanos de verdade',
  norm.natureza === 'VENDA X' && norm.finalidade === 2 && norm.geraFinanceiro === true && norm.exigeIcms === false);

console.log('\n--- 3. servidor, permissão, auditoria, migração ---');
const server = semComentarios(ler('server.js'));
const permissao = server.slice(server.indexOf('function resolveFiscalPermission'), server.indexOf('\n}', server.indexOf('function resolveFiscalPermission')));
check('ler continua visualizar', /if \(pathname === '\/api\/fiscal\/operacoes'\) return 'visualizar';/.test(permissao));
check('editar e restaurar pedem configurar', /if \(pathname\.startsWith\('\/api\/fiscal\/operacoes\/'\)\) return 'configurar';/.test(permissao));
const rota = server.slice(server.indexOf('const rotaOperacao = '), server.indexOf('const rotaOperacao = ') + 1600);
check('a rota valida no servidor antes de gravar',
  /const erros = operacaoFiscal\.validarAjuste\(chave,[^)]*\);\s*if \(erros\.length\) return sendJson\(res, \{ error: erros\.join\(' '\) \}, 400\);\s*await operacoesFiscaisDb\.salvar/.test(rota));
check('operação inexistente é 404, não criação', /if \(!antes\) return sendJson\(res, \{ error: 'Operação não encontrada\.' \}, 404\);/.test(rota));
check('fica na auditoria com antes e depois', /registrarAuditoria\(\{[\s\S]*?fiscal\.operacao\.restaurar' : 'fiscal\.operacao\.editar'[\s\S]*?details: \{ antes, depois \}/.test(rota));
check('o GET relê as alterações', /pathname === '\/api\/fiscal\/operacoes' && req\.method === 'GET'\) \{\s*const ajustes = await operacoesFiscaisDb\.carregar\(\);/.test(server));
check('o servidor carrega as alterações ao subir', /ligarLinhaDeSaude\(\);\s*operacoesFiscaisDb\.carregar\(\);/.test(server));
const dbOps = ler('lib/db/operacoes-fiscais.js');
check('falha ao ler o banco deixa o padrão valendo', /catch \(erro\) \{[\s\S]{0,200}operacaoFiscal\.aplicarAjustes\(\[\]\);/.test(dbOps));
const mig = ler('banco/migrations/fase-dw-operacoes-fiscais-editaveis.sql');
check('a migração cria a tabela com RLS', /create table if not exists operacao_fiscal_ajuste/.test(mig) && /alter table operacao_fiscal_ajuste enable row level security/.test(mig));
check('  e o banco também recusa natOp acima de 60', /natureza text check \(natureza is null or char_length\(natureza\) <= 60\)/.test(mig));

console.log('\n--- 4. a tela e a emissão ---');
const tela = ler('public/modules/fiscal/subs/operacoes.js');
const primeiraCelula = /<tr>\s*<td>\s*<button type="button" class="icon-button edit" data-editar-operacao=/.test(tela);
check('lápis em cada linha, na PRIMEIRA coluna (a tabela rola para o lado)', primeiraCelula);
check('salva por PUT e restaura por POST, com confirmação',
  /method: 'PUT'/.test(tela) && /\/restaurar`, \{ method: 'POST' \}/.test(tela) && /confirmModal\(/.test(tela));
check('restaurar só aparece em operação alterada', /\$\{op\.alterada \? '<button type="button" class="secondary" id="fiscalOperacaoRestaurar">/.test(tela));
const emissao = ler('public/modules/finance/subs/emitir_nfe_focus.js');
check('a emissão pede as operações ao servidor', /api\('\/api\/fiscal\/operacoes'\)/.test(emissao));
check('  e usa nome e natureza de lá', /opcao\.label = op\.rotulo \|\| opcao\.label;/.test(emissao) && /opcao\.natureza = op\.natureza \|\| undefined;/.test(emissao));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
