#!/usr/bin/env node
// CUPOM DO PEDIDO PARA IMPRESSORA TÉRMICA (12/10/2026).
//
// Pedido do usuário: uma impressão a mais dos pedidos, para impressoras
// térmicas de cupom. Mais Ações › "Imprimir Cupom 80mm" e "Imprimir Cupom
// 58mm". Provado no navegador com um pedido real de 3 itens: nas duas
// larguras sem rolagem lateral, e no 58 mm a linha "quantidade × preço" não
// se parte (o total do item desce).
'use strict';
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');
const { montarCupom, LARGURAS } = require('../public/modules/shared/cupom_pedido');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');
const ler = (a) => fs.readFileSync(path.join(RAIZ, a), 'utf8');

const pedido = {
  titulo: 'Pedido', numero: '16330', data: '2026-10-12', hora: '14:30', status: 'Pedido',
  vendedor: 'EDUARDO HAAS',
  emitente: { nome: 'SAL INFINITY PLUS', cnpj: '43792899000135', endereco: 'Rua X, 1 - Centro', telefone: '4733330000' },
  cliente: { nome: 'JOÃO <TESTE>', documento: '12345678909', telefone: '47999990000' },
  itens: [
    { codigo: '10128', descricao: 'AUTOPROPELIDO RUNNER', quantidade: 2, unidade: 'UN', unitario: 6990 },
    { codigo: '100137', descricao: 'KIT ARO', quantidade: 1.5, unidade: 'UN', unitario: 10 }
  ],
  totais: { produtos: 13995, frete: 50, outros: 0, desconto: 45, total: 14000 },
  condicao: 'A prazo',
  pagamentos: [{ forma: 'Boleto', valor: 7000, vencimento: '2026-11-12' }, { forma: 'Boleto', valor: 7000, vencimento: '2026-12-12' }],
  observacao: 'Entregar à tarde',
  assinatura: true
};

console.log('\n--- 1. larguras ---');
const c80 = montarCupom(pedido, { largura: 80 });
const c58 = montarCupom(pedido, { largura: 58 });
check('80 mm: página de 80 e corpo de 72', /size: 80mm auto/.test(c80) && /width: 72mm/.test(c80));
check('58 mm: página de 58 e corpo de 48', /size: 58mm auto/.test(c58) && /width: 48mm/.test(c58));
check('largura desconhecida cai no 80', /size: 80mm auto/.test(montarCupom(pedido, { largura: 99 })));
check('as duas larguras declaradas', Object.keys(LARGURAS).sort().join() === '58,80');

console.log('\n--- 2. conteúdo ---');
check('cabeçalho: empresa e CNPJ com máscara', /SAL INFINITY PLUS/.test(c80) && /CNPJ 43\.792\.899\/0001-35/.test(c80));
check('título com o número', /PEDIDO Nº 16330/.test(c80));
check('data em formato brasileiro com a hora', /12\/10\/2026 14:30/.test(c80));
check('cliente com CPF mascarado', /CPF\/CNPJ: 123\.456\.789-09/.test(c80));
check('item: código e descrição', /10128 AUTOPROPELIDO RUNNER/.test(c80));
check('item: quantidade × unitário e total da linha', /2 UN x R\$\s6\.990,00/.test(c80) && /R\$\s13\.980,00/.test(c80));
check('quantidade fracionária sem zeros sobrando', /1,5 UN x/.test(c80));
check('frete e desconto só quando existem', /Frete/.test(c80) && /Desconto/.test(c80) && !/Outros/.test(c80));
check('TOTAL em destaque', /class="lv total"><span>TOTAL<\/span><span>R\$\s14\.000,00/.test(c80));
check('parcelas com vencimento', /Boleto 12\/11\/2026/.test(c80) && /Boleto 12\/12\/2026/.test(c80));
check('a prazo: linha de assinatura', /Assinatura do cliente/.test(c80) && !/Assinatura do cliente/.test(montarCupom({ ...pedido, assinatura: false })));
check('observação', /Entregar à tarde/.test(c80));
check('diz que não é documento fiscal', /DOCUMENTO SEM VALOR FISCAL/.test(c80));
check('escapa o que vem do cadastro', /JOÃO &lt;TESTE&gt;/.test(c80) && !/<TESTE>/.test(c80));
check('sem imagem (térmica imprime logo mal)', !/<img/i.test(c80));
check('pedido sem cliente: "Consumidor"', /Cliente: Consumidor/.test(montarCupom({ ...pedido, cliente: null })));
check('58 mm: "qtd × preço" não se parte; o total desce', /\.item \.lv span:first-child \{ white-space: nowrap; \}/.test(c58) && /flex-wrap: wrap/.test(c58));

console.log('\n--- 3. na tela ---');
const acoes = ler('public/modules/shared/sales_record_actions.js');
check('Mais Ações: Cupom 80mm e 58mm', /id: 'cupom_80', label: 'Imprimir Cupom 80mm'/.test(acoes) && /id: 'cupom_58', label: 'Imprimir Cupom 58mm'/.test(acoes));
check('  só depois de salvar', /id: 'cupom_80'[\s\S]{0,120}enabled: precisaSalvar/.test(acoes));
const app = semComentarios(ler('public/app.js'));
check('o formulário monta o cupom pelo módulo e manda imprimir', /window\.MavisCupomPedido\.montarCupom\(/.test(app) && /imprimirCupom: salesRecordCupom,/.test(app) && /win\.print\(\); \}, 250\)/.test(app));
const html = ler('public/index.html');
check('script carregado antes das ações do pedido', html.indexOf('/modules/shared/cupom_pedido.js') > 0 && html.indexOf('/modules/shared/cupom_pedido.js') < html.indexOf('/modules/shared/sales_record_actions.js'));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
