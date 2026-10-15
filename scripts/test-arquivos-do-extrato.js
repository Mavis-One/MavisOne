#!/usr/bin/env node
/**
 * CONCILIAÇÃO BANCÁRIA POR ARQUIVO + EMPRESA E CONTA NA JANELA DE CONCILIAR
 * (15/10/2026). Pedidos do usuário:
 *   "faça separação por arquivos ofx, preciso que tenha algum botão para limpar
 *    a área de títulos a serem conciliados por cada arquivo importado";
 *   "um filtro para empresa e contas bancárias para conseguir diferir de qual
 *    título se trata de qual empresa em qual conta".
 *
 * Provado no navegador (servidor local, dois OFX de teste em contas
 * diferentes): cada arquivo na lista com conta, período e contagens; a lista
 * abre no arquivo recém-importado; reimportar não cria arquivo novo; Limpar
 * tirou 2 não conciliadas + 1 ignorada do A e deixou o B; na janela, empresa
 * (Araquari) e conta (Caixa Dinheiro Electric) filtram as sugestões e a busca
 * manual. O db.json voltou igual ao de antes e a auditoria do teste foi apagada.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');
const E = require('../lib/extrato-bancario');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

console.log('\n--- 1. os arquivos ---');
const t = (id, extra) => ({ id, source: 'ofx', bankAccountId: 'c1', createdBy: 'u1', createdByName: 'Ana', status: 'nao_conciliado', date: '2026-10-10', amount: 10, type: 'entrada', ...extra });
const lista = [
  // importação antiga: três linhas seguidas, ms entre elas
  t('a1', { createdAt: '2026-10-01T10:00:00.000Z', date: '2026-09-02' }),
  t('a2', { createdAt: '2026-10-01T10:00:00.004Z', status: 'conciliado', date: '2026-09-30' }),
  t('a3', { createdAt: '2026-10-01T10:00:00.009Z', status: 'ignorado' }),
  // mesma conta e pessoa, 10 min depois: outro arquivo
  t('b1', { createdAt: '2026-10-01T10:10:00.000Z' }),
  // outra conta logo em seguida: outro arquivo
  t('c1', { createdAt: '2026-10-01T10:10:00.002Z', bankAccountId: 'c2' }),
  // manual e Open Finance não são arquivo
  t('m1', { createdAt: '2026-10-01T10:10:00.003Z', source: 'manual' }),
  t('o1', { createdAt: '2026-10-01T10:10:00.004Z', source: 'open_finance', bankAccountId: 'c2' }),
  // depois de uma manual, a sequência antiga recomeça
  t('c2', { createdAt: '2026-10-01T10:10:00.005Z', bankAccountId: 'c2' }),
  // importação nova: o id gravado manda, mesmo intercalada
  t('n1', { createdAt: '2026-10-14T09:00:00.000Z', importacaoId: 'imp-1', arquivo: 'itau-out.ofx', source: 'csv' }),
  t('x1', { createdAt: '2026-10-14T09:00:00.001Z', source: 'manual' }),
  t('n2', { createdAt: '2026-10-14T09:00:00.002Z', importacaoId: 'imp-1', arquivo: 'itau-out.ofx', source: 'csv' })
];
const { porTransacao, lista: arquivos } = E.importacoesDoExtrato(lista);
const ids = arquivos.map((a) => a.id);
check('importação antiga: linhas seguidas são um arquivo só (id da primeira)', ['a1', 'a2', 'a3'].every((id) => porTransacao.get(id) === 'antiga-a1'));
check('  10 min depois é outro arquivo', porTransacao.get('b1') === 'antiga-b1');
check('  outra conta é outro arquivo', porTransacao.get('c1') === 'antiga-c1');
check('  manual e Open Finance ficam fora', !porTransacao.has('m1') && !porTransacao.has('o1') && !porTransacao.has('x1'));
check('  depois de uma manual a sequência recomeça', porTransacao.get('c2') === 'antiga-c2');
check('importação nova: o id gravado junta as linhas', porTransacao.get('n1') === 'imp-1' && porTransacao.get('n2') === 'imp-1');
const a = arquivos.find((x) => x.id === 'antiga-a1');
check('contagem por situação e período do arquivo', a.total === 3 && a.naoConciliado === 1 && a.conciliado === 1 && a.ignorado === 1 && a.de === '2026-09-02' && a.ate === '2026-10-10',
  JSON.stringify(a));
check('nome, conta e quem importou', arquivos.find((x) => x.id === 'imp-1').arquivo === 'itau-out.ofx' && a.bankAccountId === 'c1' && a.importadoPor === 'Ana');
check('o mais recente primeiro', ids[0] === 'imp-1' && ids.indexOf('antiga-a1') === ids.length - 1, ids.join(','));
check('Limpar tira só o que não tem baixa', JSON.stringify(E.SITUACOES_QUE_O_LIMPAR_TIRA) === '["nao_conciliado","ignorado"]');

console.log('\n--- 2. o servidor ---');
const server = semComentarios(ler('server.js'));
check('a lista filtra por arquivo', /const importacao = query\.get\('importacao'\);\s*if \(importacao\) \{\s*const \{ porTransacao \} = extratoBancario\.importacoesDoExtrato\(data\.bankTransactions\);/.test(server));
check('  e devolve os arquivos com o nome da conta', /importacoes = extratoBancario\.importacoesDoExtrato\(data\.bankTransactions\)\.lista[\s\S]{0,120}bankAccountName: resolveById\(data\.bankAccounts, imp\.bankAccountId\)/.test(server)
  && /summary, importacoes \}\);/.test(server));
check('a importação marca cada linha com o arquivo', /const importacaoId = createId\('imp'\);\s*const arquivo = String\(body\.arquivo \|\| ''\)\.trim\(\)\.slice\(0, 200\);/.test(server)
  && /tx\.importacaoId = importacaoId;\s*tx\.arquivo = arquivo;/.test(server));
const ini = server.indexOf("pathname.startsWith('/api/finance/bank-transactions/importacoes/') && req.method === 'DELETE'");
const rotaLimpar = server.slice(ini, ini + 2600);
check('Limpar é DELETE (o portão cobra finance.excluir)', ini > 0);
check('  recusa no meio de uma conciliação', /if \(conciliacoesEmAndamento\.size\) \{\s*return sendJson\(res, \{ error: [^}]*\}, 409\);/.test(rotaLimpar));
check('  tira só as do arquivo e sem baixa', /porTransacao\.get\(tx\.id\) === id && extratoBancario\.SITUACOES_QUE_O_LIMPAR_TIRA\.includes\(tx\.status\)/.test(rotaLimpar));
check('  e fica na auditoria', /action: 'limparArquivoDoExtrato'/.test(rotaLimpar) && ler('public/modules/settings/subs/access_logs.js').includes("limparArquivoDoExtrato: 'Limpeza de arquivo importado do extrato'"));
check('sugestões: empresa, conta e busca filtram ANTES de escolher as melhores',
  /function findBankTransactionMatches\(tx, data, \{ filtro = null, limite = 8 \} = \{\}\)/.test(server)
  && /\.filter\(\(entry\) => !filtro \|\| filtro\(entry\)\)\s*\.map\(\(entry\) => \{/.test(server)
  && /\.slice\(0, limite\);/.test(server));
check('  a empresa pela mesma regra da lista de Lançamentos', /const empresaDe = await empresasDosTitulos\(candidatos, data\);/.test(server));
check('  a busca pela mesma leitura da busca de Lançamentos', /filterFinanceEntries\(\{ \.\.\.data, finance: candidatos \}, new URLSearchParams\(\{ search: busca \}\)\)/.test(server));
check('  a resposta traz as opções de empresa e conta', /return sendJson\(res, \{ matches, empresas, contas \}\);/.test(server));

console.log('\n--- 3. a tela ---');
const tela = semComentarios(ler('public/modules/finance/subs/extrato_open_finance.js'));
check('a importação manda o nome do arquivo', /origem: 'ofx', arquivo: nomeDoArquivoEscolhido/.test(tela) && /text: formData\.get\('csvText'\), arquivo: nomeDoArquivoEscolhido/.test(tela));
check('  e a lista abre no arquivo que entrou', /if \(result\.importacaoId\) \{\s*filters\.importacao = result\.importacaoId;/.test(tela));
check('filtro "Arquivo importado"', /<span>Arquivo importado<\/span>\s*<select name="importacao">/.test(tela) && /filters\.importacao = formData\.get\('importacao'\) \|\| '';/.test(tela));
check('painel dos arquivos com Ver e Limpar', /data-arquivo-ver=/.test(tela) && /data-arquivo-limpar="\$\{escapeHtml\(imp\.id\)\}" \$\{limpaveis \? '' : 'disabled'\}/.test(tela));
check('  Limpar pede confirmação e chama o DELETE', /const confirmed = await confirmModal\([\s\S]{0,600}if \(!confirmed\) return;\s*try \{\s*const resultado = await api\(`\/api\/finance\/bank-transactions\/importacoes\/\$\{encodeURIComponent\(id\)\}`, \{ method: 'DELETE' \}\);/.test(tela));
check('janela de conciliar: Empresa e Conta bancária', /id="extratoConciliarEmpresa"/.test(tela) && /id="extratoConciliarConta"/.test(tela));
check('  cada título diz a empresa e a conta', /Empresa: \$\{escapeHtml\(empresaDoTitulo\(m\)\)\} · Conta: \$\{escapeHtml\(m\.bankAccountName \|\| '-'\)\}/.test(tela));
check('  a busca manual vai pelas sugestões, com os filtros', /const res = await sugestoes\(term\);/.test(tela) && !/\/api\/finance\/entries\?search=/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
