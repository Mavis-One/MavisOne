#!/usr/bin/env node
/**
 * A DATA/HORA DOS PEDIDOS (09/11/2026). Pedido do usuário: "preciso que conste
 * data/hora dos pedidos!".
 *
 * A hora é o campo "Hora" da aba Dados do pedido (orders.registration_time):
 * a tela preenche com a hora em que o pedido foi aberto. '00:00' é "sem hora"
 * (o que o Viper mandou nos pedidos de set–dez/2025); sem hora, sai só a data.
 * Uma regra só (lib/hora-do-pedido.js), em JavaScript e em SQL.
 *
 * Onde aparece: a lista de Vendas (coluna Data/Hora), Minhas Vendas, o Painel
 * do Vendedor, o relatório Pedidos (tela e Excel/PDF/CSV) e a coluna Hora dos
 * relatórios em que cada linha é um pedido ou orçamento. Nos dois casos, no
 * mesmo dia, ordena pela hora.
 *
 * Provado no banco local (15.191 pedidos): o SQL e o JavaScript dão a mesma
 * hora em todos.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { horaDoPedido, horaDoPedidoSql } = require('../lib/hora-do-pedido');
const motor = require('../lib/relatorios/motor');
const relatoriosVendas = require('../lib/relatorios-vendas');
const painel = require('../lib/painel-pessoal-vendas');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

console.log('\n--- 1. a regra ---');
check('a hora do campo', horaDoPedido('14:32') === '14:32' && horaDoPedido(' 09:05 ') === '09:05');
check('  com segundos, só hora e minuto', horaDoPedido('14:32:10') === '14:32');
check("  '00:00' é sem hora (o Viper sem hora)", horaDoPedido('00:00') === '');
check('  vazio, nulo e texto torto também',
  ['', null, undefined, '24:00', '9:05', 'abc', '12:60'].every((v) => horaDoPedido(v) === ''));
const sql = horaDoPedidoSql('q');
check('o SQL lê o campo do alias pedido, com o mesmo formato e sem o 00:00',
  /q\.registration_time/.test(sql) && sql.includes("'^([01][0-9]|2[0-3]):[0-5][0-9]$'") && sql.includes("<> '00:00'") && !/o\.registration_time/.test(sql));

console.log('\n--- 2. o relatório Pedidos ---');
const registro = (code, date, registrationTime) => ({
  id: `ord-${code}`, code, type: 'order', date, registrationTime, status: 'pedido-faturado',
  items: [{ productId: 'p1', name: 'Bicicleta', quantity: 1, unitPrice: 100 }]
});
const [l1] = relatoriosVendas.linhasDoRegistro(registro(10, '2026-11-06', '14:32'));
const [l2] = relatoriosVendas.linhasDoRegistro(registro(11, '2026-11-06', '00:00'));
check('a linha leva a hora, e o 00:00 do Viper vira vazio', l1.hora === '14:32' && l2.hora === '');
const ordem = relatoriosVendas.ordenar([
  ...relatoriosVendas.linhasDoRegistro(registro(1, '2026-11-06', '09:00')),
  ...relatoriosVendas.linhasDoRegistro(registro(2, '2026-11-06', '17:45')),
  ...relatoriosVendas.linhasDoRegistro(registro(3, '2026-11-05', '18:00'))
], 'data', 'desc').map((l) => l.pedidoCodigo);
check('  no mesmo dia, a mais tarde primeiro', ordem.join(',') === '2,1,3', ordem.join(','));
const csv = relatoriosVendas.COLUNAS_CSV.map(([rotulo]) => rotulo);
check('  Excel, PDF e CSV com a coluna Hora logo depois da Data', csv[0] === 'Data' && csv[1] === 'Hora');
const telaDoRelatorio = ler('public/modules/reports/subs/relatorios.js');
check('  a tela mostra "dd/mm/aaaa hh:mm"', /function relDataHora\(linha\)/.test(telaDoRelatorio)
  && (telaDoRelatorio.match(/relDataHora\(linha\)\)/g) || []).length === 2 && /rotulo: 'Data\/Hora'/.test(telaDoRelatorio));

console.log('\n--- 3. os relatórios em que cada linha é um pedido ---');
const COM_HORA = { vendas: ['pedidos-faturados', 'itens-dos-pedidos', 'lucratividade-por-pedido', 'orcamentos', 'consistencia-dos-valores'], fiscal: ['pedidos-x-nfe'] };
(async () => {
  for (const [grupo, chaves] of Object.entries(COM_HORA)) {
    const defs = require(`../lib/relatorios/${grupo}`);
    for (const chave of chaves) {
      const def = defs.find((d) => d.key === chave);
      const campos = def.colunas.map((c) => c.campo);
      const consultas = [];
      const falso = async (texto) => {
        consultas.push(texto);
        return /as hora/.test(texto)
          ? [{ pedido: 7, codigo: 7, data: '2026-11-06', hora: '14:32', status: 'pedido-faturado', valor: 10, total: 10, lancado: 0, gravado: 1, calculado: 0, soma_itens: 0, itens_gravado: 0 }]
          : [];
      };
      const saida = await motor.executar(def, motor.normalizarFiltros(def, {}), { sql: falso, data: { companies: [] }, vendedores: null });
      const daConsulta = consultas.find((t) => /as hora/.test(t)) || '';
      check(`${def.titulo}: coluna Hora logo depois da Data`, campos.indexOf('hora') === campos.indexOf('data') + 1 && saida.colunas.some((c) => c.campo === 'hora'));
      check('  a consulta lê a hora do pedido e ordena por ela no dia',
        /registration_time/.test(daConsulta) && (/order by [oq]\.date, hora, [oq]\.code/.test(daConsulta) || chave === 'consistencia-dos-valores'));
      check('  e a linha sai com a hora', saida.linhas.length === 0 || saida.linhas.every((l) => l.hora === '14:32'), saida.linhas.length);
    }
  }
  const consistencia = require('../lib/relatorios/vendas').find((d) => d.key === 'consistencia-dos-valores');
  const saidaFin = await motor.executar(consistencia, motor.normalizarFiltros(consistencia, { conferir: 'financeiro' }),
    { sql: async (t) => (/as hora/.test(t) ? [{ pedido: 7, data: '2026-11-06', hora: '08:10', status: 'pedido-faturado', total: 10, lancado: 0, lancamentos: 0 }] : []), data: { companies: [] }, vendedores: null });
  check('Consistência "Pedido x financeiro" também', saidaFin.colunas.some((c) => c.campo === 'hora') && saidaFin.linhas[0] && saidaFin.linhas[0].hora === '08:10');

  console.log('\n--- 4. a lista de Vendas e os painéis ---');
  const servidor = ler('server.js');
  check('o serializer manda a hora pronta', /hora: horaDoPedido\(record\.registrationTime\),/.test(servidor));
  check('  a ordem por Data é data + hora', /date: \(r\) => `\$\{String\(r\.date \|\| ''\)\} \$\{horaDoPedido\(r\.registrationTime\)\}`,/.test(servidor));
  const carregadores = ler('lib/db/vendas-compras.js');
  check('  os carregadores da lista e dos painéis leem registration_time',
    /const COLUNAS_DE_AGREGADO = '[^']*registration_time'/.test(carregadores) && /client_status, registration_time, '/.test(carregadores)
    && /'registration_time'\n\]\.join/.test(ler('lib/relatorios-cargas.js')));
  const app = ler('public/app.js');
  check('  a coluna da lista se chama Data/Hora e mostra a hora',
    /chave: 'date', rotulo: 'Data\/Hora', ordenavel: true, valor: \(r, f\) => f\.data\(r\.date\) \+ \(r\.hora \?/.test(app));
  check('  Minhas Vendas e o Painel do Vendedor também',
    /salesFormatDate\(v\.data\)\}\$\{v\.hora \?/.test(app) && /salesFormatDate\(o\.date\)\}\$\{o\.hora \?/.test(app)
    && /hora: o\.hora \|\| ''/.test(servidor));
  const linha = painel.linhaDoPedido({ id: 'x', code: 5, date: '2026-11-06', hora: '10:15', status: 'pedido-faturado', type: 'order', amount: 1 });
  const ordemPainel = painel.ordenar([{ pedido: 1, data: '2026-11-06', hora: '09:00' }, { pedido: 2, data: '2026-11-06', hora: '16:00' }]).map((l) => l.pedido);
  check('  Minhas Vendas: a hora na linha e a mais tarde primeiro', linha.hora === '10:15' && ordemPainel.join(',') === '2,1', ordemPainel.join(','));

  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
