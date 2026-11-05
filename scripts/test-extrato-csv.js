#!/usr/bin/env node
/**
 * O LEITOR DE CSV DE BANCO (public/modules/shared/extrato_csv.js, 04/11/2026).
 *
 * Os formatos são os que os bancos exportam: o do Sicoob (ponto e vírgula,
 * linhas de título, valor com C/D, histórico continuando nas linhas de baixo),
 * histórico com quebra de linha dentro da aspa, colunas de crédito e débito, e
 * o formato antigo da tela ("data,descricao,valor,tipo").
 */
'use strict';

const { lerCsvExtrato, valor, data } = require('../public/modules/shared/extrato_csv');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};

console.log('\n--- 1. valores e datas ---');
check('valor brasileiro, com sinal, C/D e parênteses',
  valor('1.234,56') === 1234.56 && valor('-89,90') === -89.9 && valor('1.500,00C') === 1500 && valor('89,90 D') === -89.9
  && valor('(10,00)') === -10 && valor('R$ 25,50') === 25.5 && valor('25.50') === 25.5 && valor('1.234,56-') === -1234.56
  && valor('') === null && valor('PIX') === null);
check('data dd/mm/aaaa, dd/mm/aa e ISO', data('13/10/2026') === '2026-10-13' && data('3/1/26') === '2026-01-03'
  && data('2026-10-13 10:00') === '2026-10-13' && data('Saldo') === '');

console.log('\n--- 2. o CSV do Sicoob ---');
const sicoob = [
  'SICOOB - Sistema de Cooperativas de Crédito do Brasil',
  'Extrato de Conta Corrente;;;',
  'Conta: 12345-6;;;',
  '',
  'Data;Documento;Histórico;Valor',
  '30/09/2026;;SALDO ANTERIOR;10.000,00C',
  '01/10/2026;Pix;PIX RECEB.OUTRA IF;1.500,00C',
  ';;Recebimento Pix;',
  ';;JOAO DA SILVA;',
  ';;***.123.456-**;',
  '02/10/2026;123;DÉB.TIT.COMPE EFETIVADO;890,00D',
  ';;GE MATERIAIS DE CONSTRUCAO LTDA;',
  '02/10/2026;;TARIFA COBRANÇA;2,50D',
  '02/10/2026;;SALDO DO DIA;8.607,50C'
].join('\r\n');
const s = lerCsvExtrato(sicoob);
check('3 lançamentos; saldo anterior e saldo do dia ficam fora',
  s.transacoes.length === 3 && s.ignoradas.filter((i) => i.motivo === 'saldo').length === 2, `${s.transacoes.length} / ${JSON.stringify(s.ignoradas)}`);
check('crédito com C é entrada, com data ISO', s.transacoes[0].type === 'entrada' && s.transacoes[0].amount === 1500 && s.transacoes[0].date === '2026-10-01');
check('o histórico das linhas de baixo entra na descrição',
  s.transacoes[0].description === 'PIX RECEB.OUTRA IF - Recebimento Pix - JOAO DA SILVA - ***.123.456-**', s.transacoes[0].description);
check('débito com D é saída, e o favorecido está na descrição',
  s.transacoes[1].type === 'saida' && s.transacoes[1].amount === 890 && /GE MATERIAIS/.test(s.transacoes[1].description), s.transacoes[1].description);
// (Desde 05/11/2026 a conciliação automática não olha o nome: o favorecido na
// descrição fica para quem lê o extrato e para a busca da tela.)
check('a coluna Documento (número) não vai para a descrição', !/\b123\b/.test(s.transacoes[1].description));

console.log('\n--- 3. histórico com quebra de linha dentro da aspa ---');
const comAspas = 'Data;Histórico;Valor\n"05/10/2026";"PIX EMIT.OUTRA IF\nPagamento Pix\nPOSTO GRID LTDA";"-350,00"\n';
const a = lerCsvExtrato(comAspas).transacoes;
check('uma movimentação, saída, com o nome', a.length === 1 && a[0].type === 'saida' && a[0].amount === 350
  && a[0].description === 'PIX EMIT.OUTRA IF Pagamento Pix POSTO GRID LTDA', JSON.stringify(a));

console.log('\n--- 4. crédito e débito em colunas ---');
const colunas = [
  'Data Lançamento;Lançamento;Detalhes;Crédito (R$);Débito (R$);Saldo (R$)',
  '06/10/2026;PIX RECEBIDO;MARIA SOUZA;250,00;;1.250,00',
  '06/10/2026;IOF;;;1,23;1.248,77'
].join('\n');
const c = lerCsvExtrato(colunas).transacoes;
check('crédito entra, débito sai, saldo não vira valor', c.length === 2 && c[0].type === 'entrada' && c[0].amount === 250
  && c[1].type === 'saida' && c[1].amount === 1.23 && c[0].description === 'PIX RECEBIDO - MARIA SOUZA', JSON.stringify(c));

console.log('\n--- 5. coluna Tipo e o formato antigo da tela ---');
const tipo = lerCsvExtrato('Data;Descrição;Valor;Tipo\n07/10/2026;TED RECEBIDA;100,00;C\n07/10/2026;BOLETO;40,00;D\n').transacoes;
check('C/D na coluna Tipo dá o sentido', tipo[0].type === 'entrada' && tipo[1].type === 'saida' && tipo[1].amount === 40);
const antigo = lerCsvExtrato('data,descricao,valor,tipo\n2026-08-01,PIX recebido Cliente X,2500,entrada\n2026-08-02,Tarifa bancaria,25.50,saida').transacoes;
check('"data,descricao,valor,tipo" continua entrando', antigo.length === 2 && antigo[0].amount === 2500 && antigo[0].type === 'entrada'
  && antigo[1].amount === 25.5 && antigo[1].type === 'saida' && antigo[1].date === '2026-08-02', JSON.stringify(antigo));

console.log('\n--- 6. o que não é extrato ---');
let recusa = '';
try { lerCsvExtrato('nome;idade\nana;30'); } catch (e) { recusa = e.message; }
check('sem Data e Valor, recusa dizendo o que falta', /Data/.test(recusa) && /Valor/.test(recusa), recusa);

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
