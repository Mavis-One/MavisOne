#!/usr/bin/env node
/**
 * AS REGRAS DO EXTRATO (lib/regras-extrato.js, 04/11/2026): "a descrição
 * contém TARIFA" lança e concilia; "contém APLIC" ignora. O servidor aplica no
 * fim da conciliação automática (server.js, aplicarRegrasDoExtrato) — aqui, a
 * validação e a escolha da regra.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { validarRegra, regraQueCasa, normalizar } = require('../lib/regras-extrato');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};

console.log('\n--- 1. validar ---');
check('texto curto é recusado', /3 letras/.test(validarRegra({ texto: 'IO', tipo: 'saida', acao: 'ignorar' }).erro || ''));
check('lançar sem plano de contas é recusado', /plano de contas/.test(validarRegra({ texto: 'TARIFA', tipo: 'saida', acao: 'lancar' }).erro || ''));
check('lançar vale para entrada OU saída, não as duas', /receita ou uma despesa/.test(validarRegra({ texto: 'TARIFA', tipo: 'ambos', acao: 'lancar', category: 'c1' }).erro || ''));
const ok = validarRegra({ texto: '  Tarifa ', tipo: 'saida', acao: 'lancar', category: 'c1', costCenter: 'cc', estabelecimentoId: 'e1', descricao: 'Tarifas bancárias' });
check('regra boa sai limpa', ok.regra && ok.regra.texto === 'Tarifa' && ok.regra.category === 'c1' && ok.regra.ativa === true, JSON.stringify(ok));
const ign = validarRegra({ texto: 'APLIC', tipo: 'ambos', acao: 'ignorar', category: 'c1', costCenter: 'cc' });
check('ignorar não guarda plano nem centro', ign.regra && ign.regra.category === '' && ign.regra.costCenter === '');

console.log('\n--- 2. qual regra casa ---');
const regras = [
  { id: 'r1', texto: 'TARIFA', tipo: 'saida', acao: 'lancar', category: 'tarifas' },
  { id: 'r2', texto: 'TARIFA PIX', tipo: 'saida', acao: 'lancar', category: 'pix' },
  { id: 'r3', texto: 'APLICAÇÃO', tipo: 'ambos', acao: 'ignorar' },
  { id: 'r4', texto: 'IOF', tipo: 'saida', acao: 'lancar', category: 'iof', bankAccountId: 'conta2' },
  { id: 'r5', texto: 'JUROS', tipo: 'saida', acao: 'lancar', category: 'juros', ativa: false }
];
const tx = (description, type = 'saida', bankAccountId = 'conta1') => ({ description, type, bankAccountId });
check('a descrição contém o texto, sem acento nem caixa', regraQueCasa(regras, tx('Tarifa cobrança')).id === 'r1');
check('a mais específica vence ("TARIFA PIX" antes de "TARIFA")', regraQueCasa(regras, tx('TARIFA PIX ENVIADO')).id === 'r2');
check('"ambos" vale para entrada e saída', regraQueCasa(regras, tx('RESGATE APLICACAO', 'entrada')).id === 'r3' && regraQueCasa(regras, tx('APLICACAO RDC')).id === 'r3');
check('regra de saída não pega entrada', regraQueCasa(regras, tx('ESTORNO TARIFA', 'entrada')) === null);
check('regra de uma conta só vale nela', regraQueCasa(regras, tx('IOF', 'saida', 'conta1')) === null && regraQueCasa(regras, tx('IOF', 'saida', 'conta2')).id === 'r4');
check('regra desativada não vale', regraQueCasa(regras, tx('JUROS CHEQUE ESPECIAL')) === null);
check('normalizar tira acento e espaço repetido', normalizar('  Aplicação   RDC ') === 'APLICACAO RDC');

console.log('\n--- 3. o servidor usa a regra no fim da automática ---');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
check('rotas das regras existem', /\/api\/finance\/regras-extrato/.test(server));
check('a automática aplica as regras depois dos títulos e das sugestões', /aplicarRegrasDoExtrato\(/.test(server));
check('o lançamento da regra passa pela mesma validação do lançamento da tela',
  /async function lancarPelaRegra[\s\S]*?validarLancamentoFinanceiro[\s\S]*?conferirContasDoEstabelecimento/.test(server));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
