#!/usr/bin/env node
/**
 * CONTAS A PAGAR E CONTAS A RECEBER NO CATÁLOGO (13/10/2026).
 *
 * Pedido do usuário: relatório de contas a pagar e a receber do dia x ao dia
 * y, por conta bancária e por banco. Sem banco de dados: o `sql` é falso e
 * registra o que recebeu. A consulta de verdade foi conferida contra o banco
 * local (o total em aberto bateu com a soma direta, centavo a centavo).
 */
const fs = require('fs');
const path = require('path');
const catalogo = require('../lib/relatorios');
const motor = require('../lib/relatorios/motor');
const { bancoDaConta, bancosDasContas } = require('../lib/banco-da-conta');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

console.log('--- 1. o banco sai da conta ---');
// Os nomes são os das 28 contas que vieram do Viper, com o campo banco vazio.
const casos = [
  [{ name: 'ITAU PLUS', bank: '' }, 'Itaú'],
  [{ name: 'SICOOB PLUS 01 (MAXICREDITO)' }, 'Sicoob'],
  [{ name: 'VIACREDI KACCAU' }, 'Ailos (Viacredi)'],
  [{ name: 'BANCO DO BRASIL ELECTRIC' }, 'Banco do Brasil'],
  [{ name: 'MERCADO PAGO PLUS' }, 'Mercado Pago'],
  [{ name: 'FUNDO DE CONTINGÊNCIA PLUS' }, 'Outros']
];
for (const [conta, esperado] of casos) check(`${conta.name} -> ${esperado}`, bancoDaConta(conta) === esperado, bancoDaConta(conta));
check('"CAIXA DINHEIRO" é o caixa da loja, não a Caixa Econômica', bancoDaConta({ name: 'CAIXA DINHEIRO PLUS', bank: '0' }) === 'Caixa (dinheiro)');
check('  e "CAIXA ECONOMICA" é a Caixa', bancoDaConta({ name: 'CAIXA ECONOMICA FEDERAL' }) === 'Caixa Econômica Federal');
check('o código de compensação vale mais que o nome', bancoDaConta({ name: 'CONTA PRINCIPAL', bank: '341' }) === 'Itaú');
check('  inclusive no campo próprio', bancoDaConta({ name: 'X', bankCode: '756' }) === 'Sicoob');
const lista = bancosDasContas([{ name: 'SICOOB A' }, { name: 'FUNDO' }, { name: 'ITAU B' }, { name: 'SICOOB C' }]);
check('a lista de bancos não repete e deixa "Outros" no fim', JSON.stringify(lista) === JSON.stringify(['Itaú', 'Sicoob', 'Outros']), lista.join(', '));

console.log('\n--- 2. os dois relatórios ---');
const pagar = catalogo.relatorio('contas-a-pagar');
const receber = catalogo.relatorio('contas-a-receber');
check('os dois existem no grupo Financeiro', Boolean(pagar && receber && pagar.grupo === 'financeiro' && receber.grupo === 'financeiro'));
check('  com período, conta e banco', ['periodo', 'conta', 'banco'].every((x) => pagar.filtros.includes(x) && receber.filtros.includes(x)));
check('  logo depois da Síntese', catalogo.RELATORIOS.filter((r) => r.grupo === 'financeiro').slice(1, 3).map((r) => r.key).join() === 'contas-a-pagar,contas-a-receber');
const f = motor.normalizarFiltros(pagar, { banco: ' Itaú ' }, '2026-10-13T15:00:00Z');
check('sem datas, o mês corrente', f.de === '2026-10-01' && f.ate === '2026-10-13', `${f.de} a ${f.ate}`);
check('o banco chega aos filtros', f.banco === 'Itaú');
check('situação padrão: em aberto; data padrão: vencimento', f.situacao === 'aberto' && f.dataPor === 'vencimento');
check('escolha fora da lista vira o padrão', motor.normalizarFiltros(pagar, { situacao: "x' or 1=1" }).situacao === 'aberto');

console.log('\n--- 3. a execução, com sql falso ---');
const CONTAS = [
  { id: 'c1', name: 'ITAU PLUS', bank: '', bankCode: null },
  { id: 'c2', name: 'ITAU ELECTRIC', bank: '341', bankCode: null },
  { id: 'c3', name: 'SICOOB PLUS 01', bank: '', bankCode: null }
];
async function rodar(def, bruto, linhas) {
  const chamadas = [];
  const sql = async (texto, params) => {
    chamadas.push({ texto, params });
    return /from bank_accounts$/.test(texto.trim()) ? CONTAS : linhas;
  };
  const r = await motor.executar(def, motor.normalizarFiltros(def, bruto, '2026-10-13T15:00:00Z'), { sql });
  return { r, consulta: chamadas[1] };
}

const LINHAS = [
  { codigo: 1, vencimento: '2026-10-01', emissao: '2026-09-01', pessoa: 'A', descricao: '', categoria: '', conta_id: 'c1', conta: 'ITAU PLUS', status: 'pending', vencida: true, valor: '100', pago_total: '0', pago_periodo: '0', data_pagamento: null },
  { codigo: 2, vencimento: '2026-10-20', emissao: '2026-09-01', pessoa: 'B', descricao: '', categoria: '', conta_id: 'c3', conta: 'SICOOB PLUS 01', status: 'parcial', vencida: false, valor: '100', pago_total: '30', pago_periodo: '0', data_pagamento: '2026-10-05' },
  { codigo: 3, vencimento: '2026-10-02', emissao: '2026-09-01', pessoa: 'C', descricao: '', categoria: '', conta_id: 'c2', conta: 'ITAU ELECTRIC', status: 'paid', vencida: true, valor: '50', pago_total: '50', pago_periodo: '50', data_pagamento: '2026-10-02' }
];

(async () => {
  let x = await rodar(pagar, { banco: 'Itaú' }, []);
  check('banco Itaú vira as duas contas do Itaú', JSON.stringify(x.consulta.params[4]) === '["c1","c2"]', JSON.stringify(x.consulta.params[4]));
  check('  e só despesas', x.consulta.params[2] === 'DESPESA');
  x = await rodar(pagar, { banco: 'Itaú', contaId: 'c3' }, []);
  check('conta de outro banco: nenhuma conta, e não "todas"', JSON.stringify(x.consulta.params[4]) === '[]');
  x = await rodar(receber, {}, []);
  check('sem conta nem banco, sem filtro de conta', x.consulta.params[4] === null && x.consulta.params[2] === 'RECEITA');

  x = await rodar(pagar, { situacao: 'todas' }, LINHAS);
  const sit = x.r.linhas.map((l) => l.situacao).join(',');
  check('situação: vencida, parcial, paga', sit === 'Vencida,Parcial,Paga', sit);
  check('em aberto é o valor menos o pago (paga = 0)', x.r.linhas.map((l) => l.emAberto).join(',') === '100,70,0');
  check('o banco aparece na linha', x.r.linhas.map((l) => l.banco).join(',') === 'Itaú,Sicoob,Itaú');
  check('totais de valor, pago e em aberto', x.r.totais.valor === 250 && x.r.totais.pago === 80 && x.r.totais.emAberto === 170, JSON.stringify(x.r.totais));
  check('"todas" mostra a data da baixa', x.r.colunas.some((c) => c.campo === 'dataPagamento'));
  x = await rodar(pagar, {}, LINHAS.slice(0, 1));
  check('"em aberto" não mostra a data da baixa', !x.r.colunas.some((c) => c.campo === 'dataPagamento'));
  check('  nem a emissão', !x.r.colunas.some((c) => c.campo === 'emissao'));
  x = await rodar(receber, { dataPor: 'emissao' }, LINHAS.slice(0, 1));
  check('recorte por emissão mostra a emissão', x.r.colunas.some((c) => c.campo === 'emissao'));
  check('  e a consulta recorta por e.date', /e\.date >= \$1::date/.test(x.consulta.texto));
  x = await rodar(receber, { dataPor: 'pagamento', situacao: 'pago' }, LINHAS.slice(2));
  check('recorte por recebimento: pelas baixas do período', /pp\.pago is not null/.test(x.consulta.texto) && x.consulta.params[3] === true);
  check('  e "Recebido" é o baixado no período', x.r.linhas[0].pago === 50 && x.r.linhas[0].situacao === 'Recebida');
  check('a receber chama o cliente de Cliente', x.r.colunas.find((c) => c.campo === 'pessoa').rotulo === 'Cliente');
  check('  e a coluna do valor baixado de Recebido', x.r.colunas.find((c) => c.campo === 'pago').rotulo === 'Recebido');

  console.log('\n--- 4. tela e servidor ---');
  const tela = ler('public/modules/reports/subs/catalogo.js');
  check('a tela desenha o filtro Banco', /usa\('banco'\) \? select\('banco', 'Banco', opcoes\.bancos/.test(tela));
  const servidor = ler('server.js');
  check('o servidor manda os bancos das contas ativas', /bancos: bancosDasContas\(contas\.rows/.test(servidor));
  check('  e a lista de contas continua só id e nome', /contas: contas\.rows\.map\(\(c\) => \(\{ id: c\.id, name: c\.name \}\)\)/.test(servidor));

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHOU', e); process.exit(1); });
