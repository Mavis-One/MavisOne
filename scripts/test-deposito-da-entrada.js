#!/usr/bin/env node
/**
 * O DEPÓSITO PADRÃO DA ENTRADA DE NF-e É O DO CNPJ QUE RECEBEU A NOTA
 * (15/10/2026). Pedido do usuário: "uma nota fiscal da matriz, quando eu for
 * dar entrada, o depósito padrão deve ser o matriz".
 *
 * Provado no servidor local com o XML de uma nota recebida pela Matriz e uma
 * cópia dele endereçada à Electric (só analisar, nada gravado): na mesma tela,
 * Matriz -> "Depósito Matriz"; depois de trocar à mão para Timbó e descartar,
 * a da Electric abriu em "Depósito Electric"; a Matriz de novo, em "Depósito
 * Matriz".
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');
const { depositoDoDestinatario } = require('../lib/entradaNfe');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const empresas = [
  { id: 'c-matriz', document: '43.792.899/0001-35' },
  { id: 'c-timbo', document: '43792899000569' },
  { id: 'c-electric', document: '46877837000114' },
  { id: 'c-sem-deposito', document: '11222333000181' }
];
const depositos = [
  { id: 'd-montados', companyId: 'c-matriz', code: 'DEP-0011', name: 'Depósito Matriz - Montados', classificacao: 'montados', status: 'ativo' },
  { id: 'd-sem-codigo', companyId: 'c-matriz', code: '', name: 'Aaa sem código', status: 'ativo' },
  { id: 'd-matriz', companyId: 'c-matriz', code: 'DEP-0001', name: 'Depósito Matriz', classificacao: 'desmontados', status: 'ativo' },
  { id: 'd-timbo-inativo', companyId: 'c-timbo', code: 'DEP-0004', name: 'Timbó antigo', status: 'inativo' },
  { id: 'd-timbo', companyId: 'c-timbo', code: 'DEP-0005', name: 'Depósito Timbó', status: 'ativo' },
  { id: 'd-electric', companyId: 'c-electric', code: '', name: 'Depósito Electric', status: 'ativo' }
];

console.log('\n--- a regra ---');
check('nota da Matriz: o depósito da Matriz (montados por último, sem código depois)', depositoDoDestinatario('43792899000135', depositos, empresas) === 'd-matriz');
check('CNPJ com pontuação no XML ou no cadastro dá no mesmo', depositoDoDestinatario('43.792.899/0001-35', depositos, empresas) === 'd-matriz');
check('filial: o depósito dela, sem o inativo', depositoDoDestinatario('43792899000569', depositos, empresas) === 'd-timbo');
check('Electric: o único dela, mesmo sem código', depositoDoDestinatario('46877837000114', depositos, empresas) === 'd-electric');
check('empresa sem depósito: nenhum (a tela segue como antes)', depositoDoDestinatario('11222333000181', depositos, empresas) === '');
check('CNPJ que não é nosso: nenhum', depositoDoDestinatario('99999999000191', depositos, empresas) === '');
check('sem destinatário: nenhum', depositoDoDestinatario('', depositos, empresas) === '' && depositoDoDestinatario(undefined, depositos, empresas) === '');

console.log('\n--- o servidor e a tela ---');
const server = semComentarios(ler('server.js'));
check('a análise devolve o depósito do destinatário',
  /depositoPadraoId: entradaNfe\.depositoDoDestinatario\(\s*conferencia\.nota && conferencia\.nota\.destinatario && conferencia\.nota\.destinatario\.documento,\s*data\.deposits,\s*data\.companies\s*\)/.test(server));
const tela = semComentarios(ler('public/modules/purchases/subs/entrada_nfe.js'));
check('a tela usa ele a cada nota (o da nota anterior não passa)',
  /if \(resposta\.depositoPadraoId && temNaLista\(resposta\.depositoPadraoId\)\) tela\.depositoId = resposta\.depositoPadraoId;/.test(tela)
  && !/if \(!tela\.depositoId && tela\.depositos\.length\) tela\.depositoId = tela\.depositos\[0\]\.id;/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
