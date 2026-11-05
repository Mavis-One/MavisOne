#!/usr/bin/env node
/**
 * DE QUAL EMPRESA É O TÍTULO (15/10/2026). Pedido do usuário: nas Contas a
 * Pagar e a Receber "está faltando referente a qual empresa se trata aquele
 * título ... retirar informações inúteis e coloque o CNPJ e/ou o nome".
 *
 * Provado no navegador (banco local): Contas a Pagar e a Receber sem a coluna
 * Tipo (era sempre "Despesa"/"Receita"), com Empresa — "SAL INFINITY PLUS
 * (MARCOLLA) · 43.792.899/0002-16", "(TIMBO)", "(BARRA)", "(MATRIZ)" quando o
 * título ou a origem diz a filial; "SAL INFINITY ELECTRIC · 46.877.837/0001-14"
 * e "SAL INFINITY PLUS COMERCIO LTDA · 43.792.899" pela conta bancária.
 * Lançamentos mantém o Tipo.
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
const tela = ler('public/modules/finance/subs/lancamentos.js');
const funcao = servidor.slice(servidor.indexOf('async function empresasDosTitulos'), servidor.indexOf('// `baixasDoLancamento` (fase EI)'));

check('a empresa sai na ordem: título, NF-e, pedido, dono da conta, nome da conta, vínculos de uma empresa só',
  // (19/10/2026: a regra virou resolvedorDeEmpresas, que o filtro de empresa
  // também usa; o nome da conta é lembrado por conta — pelaContaUmaVez.
  // 05/11/2026: o vínculo de Contas por Estabelecimento é permissão, não dono —
  // vem depois do nome, e só quando todos os vínculos são da mesma empresa.)
  /doEstab\(estabPorId\.get\(String\(e\.estabelecimentoId[\s\S]{0,120}estabDaNfe[\s\S]{0,160}companhiaDoPedido[\s\S]{0,160}donoDaConta[\s\S]{0,80}pelaContaUmaVez\(e\.bankAccountId\)[\s\S]{0,80}vinculoUnicoDaConta/.test(funcao));
check('  vínculos de duas empresas não decidem (a conta da Electric liberada para a matriz)',
  /if \(raizes\.size !== 1\) return;/.test(funcao));
check('  "SICOOB ELECTRICS" acha a Electric: palavra da conta que começa com uma da razão social (5+ letras)',
  /daRazao\.length >= 5 && w\.startsWith\(daRazao\)/.test(funcao));
check('  pelo nome da conta: a palavra da razão social que só uma empresa tem (sem lista fixa)',
  funcao.includes('.find((r) => r && r.size === 1)') && !/['"]PLUS['"]|['"]KACCAU['"]/.test(funcao));
check('  empresa de várias filiais sai pela razão social e a raiz do CNPJ', funcao.includes('return { nome: razao, cnpj: raiz };'));
check('só para a página da lista', servidor.includes('const empresasDaPagina = await empresasDosTitulos(data.finance, data);'));
check('coluna Empresa com nome e CNPJ, também para quem já escolheu colunas', tela.includes("chave: 'empresa',") && tela.includes("const FINANCE_COLUNAS_NOVAS = ['empresa'];")
  && tela.includes('conhecidas: FINANCE_LISTA_COLUNAS.map((c) => c.chave)'));
check('Contas a Pagar e a Receber sem a coluna Tipo (Lançamentos mantém)', tela.includes("!(tipoFixo && col.chave === 'type')"));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
