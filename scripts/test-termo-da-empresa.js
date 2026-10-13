#!/usr/bin/env node
/**
 * O TEXTO PADRÃO DA EMPRESA NAS OBSERVAÇÕES DO PEDIDO E NA NF-e (13/10/2026).
 *
 * O termo da SAL INFINITY ELECTRIC (Configurações › Empresa, "Observação
 * padrão das notas deste CNPJ") não chegava ao pedido — ele nascia sempre com
 * o texto do sistema — nem à NF-e do pedido, e corrigir só o pedido faria o
 * termo sair DUAS vezes na nota. Provado no navegador (banco local): Nova
 * Venda troca o texto com a empresa, não mexe no texto editado, e a emissão
 * vinda do pedido escolhe o emitente pelo CNPJ e põe o termo uma vez só.
 */
const fs = require('fs');
const path = require('path');
const T = require('../public/modules/shared/nfe_texto_padrao');
const { observacoesDasEmpresas } = require('../lib/observacao-da-empresa');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const vezes = (texto, trecho) => texto.split(trecho).length - 1;

const TERMO = '# TERMO DE CIÊNCIA E RESPONSABILIDADE\nO CLIENTE DECLARA QUE RECEBEU\nO EQUIPAMENTO EM PERFEITO ESTADO.';

console.log('--- 1. o termo é reconhecido como padrão ---');
check('ehTextoPadrao(termo, termo)', T.ehTextoPadrao(TERMO, TERMO) === true);
check('  mesmo com espaços e quebras diferentes', T.ehTextoPadrao(TERMO.replace(/\n/g, '\r\n  '), TERMO) === true);
check('  e o PADRAO do sistema continua reconhecido sem base', T.ehTextoPadrao(T.PADRAO) === true);
check('texto livre não é padrão', T.ehTextoPadrao('texto livre', TERMO) === false);
check('sem base, o termo não é padrão (regra antiga intacta)', T.ehTextoPadrao(TERMO) === false);

console.log('\n--- 2. montar() sem perder nem repetir ---');
const so = T.montar({ observacaoDoPedido: TERMO, base: TERMO });
check('pedido com o termo: o termo UMA vez', vezes(so, '# TERMO DE CIÊNCIA') === 1, JSON.stringify(so.slice(0, 50)));
const comObs = T.montar({ observacaoDoPedido: `${TERMO}\n\nobs do vendedor`, base: TERMO });
check('termo + obs do vendedor: fica o texto do pedido, termo uma vez', comObs === `${TERMO}\n\nobs do vendedor` && vezes(comObs, '# TERMO') === 1);
const livre = T.montar({ observacaoDoPedido: 'texto livre', base: TERMO });
check('texto livre: termo e depois o texto', livre === `${TERMO}\n\ntexto livre`);
check('sem observação: só o termo', T.montar({ observacaoDoPedido: '', base: TERMO }) === TERMO);
check('empresa sem termo: o de sempre (PADRAO)', T.montar({ observacaoDoPedido: '' }) === T.PADRAO);

console.log('\n--- 3. o texto com que o pedido nasce ---');
check('empresa com termo -> o termo', T.padraoDaEmpresa({ observacaoPadrao: TERMO }) === TERMO);
check('empresa sem termo -> PADRAO', T.padraoDaEmpresa({ observacaoPadrao: '' }) === T.PADRAO);
check('sem empresa -> PADRAO', T.padraoDaEmpresa(undefined) === T.PADRAO);

console.log('\n--- 4. trocar a empresa ---');
check('texto intocado: troca', T.observacaoAoTrocarEmpresa({ atual: T.PADRAO, padraoAnterior: T.PADRAO, padraoNovo: TERMO }) === TERMO);
check('  e volta', T.observacaoAoTrocarEmpresa({ atual: TERMO, padraoAnterior: TERMO, padraoNovo: T.PADRAO }) === T.PADRAO);
check('texto editado: fica', T.observacaoAoTrocarEmpresa({ atual: 'escrito pelo vendedor', padraoAnterior: T.PADRAO, padraoNovo: TERMO }) === 'escrito pelo vendedor');
check('  inclusive o padrão com uma linha a mais', T.observacaoAoTrocarEmpresa({ atual: `${T.PADRAO}\nX`, padraoAnterior: T.PADRAO, padraoNovo: TERMO }) === `${T.PADRAO}\nX`);

console.log('\n--- 5. a ponte empresa do cadastro -> empresa fiscal ---');
const termos = observacoesDasEmpresas(
  [
    { id: 'c-electric', document: '46.877.837/0001-00' },
    { id: 'c-plus', document: '43792899000216' },
    { id: 'c-raiz', document: '46877837000299' },
    { id: 'c-sem', document: '' }
  ],
  [
    { cnpj: '46877837000100', empresaId: 'e-electric' },
    { cnpj: '43792899000216', empresaId: 'e-plus' }
  ],
  [
    { id: 'e-electric', cnpjRaiz: '46877837', observacaoPadraoNfe: `  ${TERMO}  ` },
    { id: 'e-plus', cnpjRaiz: '43792899', observacaoPadraoNfe: null }
  ]
);
check('pelo CNPJ do estabelecimento', termos.get('c-electric') === TERMO);
check('empresa fiscal sem termo -> vazio (o pedido usa o PADRAO)', termos.get('c-plus') === '');
check('sem estabelecimento do CNPJ, vale a raiz', termos.get('c-raiz') === TERMO);
check('empresa sem CNPJ -> vazio', termos.get('c-sem') === '');

console.log('\n--- 6. onde cada peça está ligada ---');
const servidor = ler('server.js');
check('/api/sales/meta manda o termo em cada empresa', /observacaoPadrao: termos\.get\(c\.id\) \|\| ''/.test(servidor));
check('  e a falha do fiscal não derruba o formulário', /Promise\.all\(\[fiscalDb\.getEstabelecimentos\(\), fiscalDb\.getEmpresas\(\)\]\)\.catch/.test(servidor));
const app = ler('public/app.js');
check('pedido novo nasce com o texto da empresa', /note: origem \? \(origem\.note \|\| ''\) : padraoDaEmpresaDoPedido\(/.test(app));
check('a troca compara com a empresa ANTERIOR (lida antes do sync)', /const empresaAnterior = formState\.companyId;\s*syncFormState\(\);/.test(app)
  && /padraoAnterior: padraoDaEmpresaDoPedido\(empresaAnterior\)/.test(app));
check('o pedido manda o CNPJ da empresa para a emissão', /empresaCnpj: String\(\(meta\.companies\.find/.test(app));
const emissao = ler('public/modules/finance/subs/emitir_nfe_focus.js');
check('a emissão escolhe o emitente pelo CNPJ do pedido', /if \(doMesmoCnpj\) selectedEstabelecimentoId = doMesmoCnpj\.id;/.test(emissao));
check('  e não monta mais o texto sem a base', !/TextoPadrao\.montar\(\{ observacaoDoPedido: notaDoPedido \}\)/.test(emissao));
check('  o texto sai de padraoAtual(), com a base do emitente', /return TextoPadrao\.montar\(\{ observacaoDoPedido: notaDoPedido, base: textoPadraoDoEmitente\(\) \}\)/.test(emissao));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
