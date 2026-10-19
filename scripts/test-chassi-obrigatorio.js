#!/usr/bin/env node
/**
 * CHASSI OBRIGATÓRIO NO VEÍCULO (16/10/2026). Pedido do usuário: "deixe o
 * campo chassi em questão de um produto de um novo pedido/orçamento como
 * obrigatório"; escolhido: só veículos, NCM 8711 (autopropelidos, motos e
 * bicicletas elétricas — 113 produtos no catálogo local nesse dia). Peça,
 * acessório e serviço seguem sem chassi.
 *
 * A regra é uma só (shared/venda_obrigatorios.js): a tela confere antes de
 * salvar e leva ao campo; o servidor recusa na gravação.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');
const regra = require('../public/modules/shared/venda_obrigatorios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => semComentarios(fs.readFileSync(path.join(__dirname, '..', p), 'utf8'));

console.log('--- 1. a regra ---');
const NCM = { moto: '8711.60.00', peca: '87149990', servico: '' };
const ncmDoItem = (item) => NCM[item.productId];
const base = { companyId: 'e', category: 'Venda', depositId: 'd', sellerId: 'v', payments: [{ methodId: 'din', amount: 10 }] };
const falta = (items, extra = {}) => regra.faltando({ ...base, items }, { ncmDoItem, total: 10, ...extra });
check('NCM 8711 é veículo (com ou sem pontos)', regra.ehVeiculo('8711.60.00') && regra.ehVeiculo('87116000') && !regra.ehVeiculo('87149990') && !regra.ehVeiculo(''));
const semChassi = falta([{ productId: 'peca', name: 'PASTILHA' }, { productId: 'moto', name: 'AUTOPROPELIDO KACCAU V8', chassi: '' }]);
check('veículo sem chassi falta, e diz qual', semChassi && semChassi.rotulo === 'Chassi' && semChassi.itemSemChassi === 1
  && semChassi.mensagem === 'Informe o chassi de AUTOPROPELIDO KACCAU V8 (item 2).', semChassi && semChassi.mensagem);
check('  só espaço também falta', (falta([{ productId: 'moto', name: 'X', chassi: '   ' }]) || {}).rotulo === 'Chassi');
check('com chassi passa', falta([{ productId: 'moto', name: 'X', chassi: '9BW123' }]) === null);
check('peça e serviço não pedem chassi', falta([{ productId: 'peca', name: 'P' }, { productId: 'servico', name: 'S' }]) === null);
check('orçamento também pede', (falta([{ productId: 'moto', name: 'X' }], { tipoRegistro: 'quote' }) || {}).rotulo === 'Chassi');
check('sem saber o NCM, não confere', regra.faltando({ ...base, items: [{ productId: 'moto', name: 'X' }] }, { total: 10 }) === null);
check('empresa, categoria, depósito e vendedor continuam antes',
  (regra.faltando({ ...base, companyId: '', items: [{ productId: 'moto', name: 'X' }] }, { ncmDoItem, total: 10 }) || {}).campo === 'companyId');

console.log('\n--- 2. o servidor recusa na gravação ---');
const servidor = ler('server.js');
check('o NCM vem só dos produtos da venda',
  /async function ncmDosItensDaVenda\(itens\) \{[\s\S]{0,200}const produtos = await db\.getProductsEmMapaPorIds\(ids\);/.test(servidor));
check('  na criação e na alteração', (servidor.match(/ncmDoItem: await ncmDosItensDaVenda\(body\.items\), montagemDoItem: await montagemDosItensDaVenda\(body\.items\) \}\);/g) || []).length === 2);
check('  e cancelar continua sem conferir', /const obrigatorioQueFalta = vaiCancelar(?: \|\| travadoPorAprovacao)? \? null : vendaObrigatorios\.faltando\(/.test(servidor));

console.log('\n--- 3. a tela ---');
const app = ler('public/app.js');
check('confere antes de salvar, com o NCM do catálogo', /tipoRegistro: recordType, ncmDoItem: \(item\) => produtoDoItem\(item\)\?\.ncm, montagemDoItem: /.test(app));
check('  e leva ao chassi que falta', /if \(obrigatorioQueFalta\.itemSemChassi !== undefined\) content\.querySelector\(`\.sales-item-chassi\[data-index="\$\{obrigatorioQueFalta\.itemSemChassi\}"\]`\)\?\.focus\(\);/.test(app));
check('o campo do veículo diz "Obrigatório"', /placeholder="\$\{window\.MavisVendaObrigatorios\.ehVeiculo\(produto\?\.ncm\) \? 'Obrigatório' : '—'\}"/.test(app));
check('  e a borda marca o vazio', /\.sales-item-chassi\.is-obrigatorio:placeholder-shown \{ border-color: var\(--warning\); \}/.test(fs.readFileSync(path.join(__dirname, '..', 'public/app.css'), 'utf8')));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
