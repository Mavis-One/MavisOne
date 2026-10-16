#!/usr/bin/env node
/**
 * A LISTA DE LANÇAMENTOS DE PONTA A PONTA (fase EI) — contra o servidor no ar.
 *
 *   PORT=3999 npm start                        (num terminal)
 *   node scripts/test-lote-de-lancamentos.js   (noutro)
 *
 * Fora do `npm test`, como os outros e2e: precisa do servidor de pé. Sem ele,
 * avisa e sai SEM falhar.
 *
 * O QUE ELE PROVA, pela API de verdade (rota, permissão, banco):
 *   1. a busca acha pelo código (LF0042) e pelo valor ("123,45");
 *   2. a ordem por coluna e as abas de situação (contagens sem a própria aba);
 *   3. os totais do filtro, antes e depois de baixar e cancelar;
 *   4. o lote: baixa pelo saldo, recusa o que já foi baixado, cancela só com
 *      motivo, e devolve o motivo de CADA ignorado;
 *   5. a exportação: o filtro inteiro, na ordem da tela, e só os selecionados.
 *
 * UM USUÁRIO SÓ DO TESTE. O login é sessão única por usuário: entrar como o
 * admin de verdade derrubaria a sessão de quem estiver usando o sistema. O
 * teste cria um usuário descartável e apaga no fim ele, as sessões dele, os
 * lançamentos e as baixas que criou. A trilha de auditoria fica — ninguém a
 * edita, nem o teste.
 */
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const { consultar, fecharPool } = require('../lib/db/conexao');
const auth = require('../lib/db/auth');

const PORTA = Number(process.env.PORTA_TESTE) || 3999;
let token = '';
let falhas = 0;
const ok = (n, c, d) => { console.log(`  ${c ? 'OK ' : 'XX '} ${n}${d !== undefined ? ' -> ' + d : ''}`); if (!c) falhas++; };

function pedir(metodo, caminho, corpo) {
  return new Promise((resolve) => {
    const dados = corpo ? JSON.stringify(corpo) : null;
    const req = http.request({
      host: 'localhost', port: PORTA, path: caminho, method: metodo,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-auth-token': token } : {}),
        ...(dados ? { 'Content-Length': Buffer.byteLength(dados) } : {})
      }
    }, (res) => {
      // Os bytes, e não texto: a planilha .xlsx é binária (16/10/2026).
      const pedacos = [];
      res.on('data', (d) => { pedacos.push(d); });
      res.on('end', () => {
        const bytes = Buffer.concat(pedacos);
        const b = bytes.toString('utf8');
        let json = null;
        try { json = JSON.parse(b); } catch (_) { /* CSV, planilha ou HTML */ }
        resolve({
          status: res.statusCode, json, corpo: b, bytes, tipo: res.headers['content-type'] || '', disposicao: res.headers['content-disposition'] || '',
          repetida: res.headers['x-gravacao-repetida'] === '1'
        });
      });
    });
    req.on('error', (erro) => resolve({ status: 0, erro }));
    if (dados) req.write(dados);
    req.end();
  });
}

const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const lixo = { usuario: null, lancamentos: [] };

(async () => {
  const carimbo = Date.now();
  const marca = `TESTE LOTE ${carimbo}`;
  const senha = crypto.randomBytes(12).toString('hex');
  const usuario = await auth.createUser({
    username: `teste-lote-${carimbo}`, password: senha, name: 'Teste do lote (apagar)',
    role: 'admin', allowedModules: ['dashboard', 'finance']
  });
  lixo.usuario = usuario.id;

  const login = await pedir('POST', '/api/login', { username: `teste-lote-${carimbo}`, password: senha });
  if (login.status === 0) {
    console.log(`  (servidor fora do ar na porta ${PORTA}: teste pulado — suba com PORT=${PORTA} npm start)`);
    return;
  }
  ok('autenticado com o usuário do teste', login.status === 200 && Boolean(login.json && login.json.token), login.status);
  token = (login.json && login.json.token) || '';
  if (!token) return;

  console.log('\n--- 0. o cenário: três despesas que vencem hoje ---');
  const hoje = hojeLocal();
  const criar = async (letra, amount) => {
    const r = await pedir('POST', '/api/finance/entries', {
      type: 'DESPESA', description: `${marca} ${letra}`, amount, date: hoje, dueDate: hoje
    });
    const entry = r.json && r.json.entry;
    if (entry) lixo.lancamentos.push(entry.id);
    return entry;
  };
  const A = await criar('A', 123.45);
  const B = await criar('B', 50);
  const C = await criar('C', 75.1);
  ok('três lançamentos criados', Boolean(A && B && C && A.codigo), A && A.codigo);
  if (!(A && B && C)) return;

  const listar = async (params) => (await pedir('GET', `/api/finance/entries?${new URLSearchParams({ limit: '100', ...params })}`)).json || {};

  console.log('\n--- 1. a busca: texto, código e valor ---');
  const porTexto = await listar({ search: marca });
  ok('pelo texto, os três', porTexto.total === 3, porTexto.total);
  const porCodigo = await listar({ search: A.codigo });
  ok(`pelo código ${A.codigo}, só ele`, porCodigo.total === 1 && porCodigo.entries[0].id === A.id, porCodigo.total);
  const porCodigoCurto = await listar({ search: `lf${A.code}` });
  ok('  e escrito sem os zeros ("lf" + número)', porCodigoCurto.entries.some((e) => e.id === A.id));
  const porValor = await listar({ search: '123,45', type: 'despesa', dueFrom: hoje, dueTo: hoje });
  ok('pelo valor "123,45", acha o de R$ 123,45', porValor.entries.some((e) => e.id === A.id), porValor.total);
  ok('  e nenhum de outro valor sem o texto', porValor.entries.every((e) => Math.round(e.amountPrevisto * 100) === 12345
    || /123,45/.test(`${e.description} ${e.document} ${e.codigo}`)));

  console.log('\n--- 2. ordem e abas ---');
  const ordem = async (sort, dir) => (await listar({ search: marca, sort, dir })).entries.map((e) => e.description.slice(-1)).join('');
  ok('valor crescente: B (50), C (75,10), A (123,45)', (await ordem('amount', 'asc')) === 'BCA');
  ok('valor decrescente: A, C, B', (await ordem('amount', 'desc')) === 'ACB');
  ok('descrição A-Z', (await ordem('description', 'asc')) === 'ABC');
  ok('código decrescente: o último criado primeiro', (await ordem('codigo', 'desc')) === 'CBA');
  const ordemInvalida = await pedir('GET', `/api/finance/entries?search=${encodeURIComponent(marca)}&sort=constructor`);
  ok('ordem desconhecida não derruba a rota', ordemInvalida.status === 200 && ordemInvalida.json.total === 3, ordemInvalida.status);
  const abaPaga = await listar({ search: marca, status: 'pago,recebido' });
  ok('aba "Pagos e recebidos": nenhum ainda', abaPaga.total === 0, abaPaga.total);
  ok('  mas as abas contam sem a própria situação: 3 a vencer', abaPaga.resumo && abaPaga.resumo.situacoes.pendente
    && abaPaga.resumo.situacoes.pendente.quantidade === 3, JSON.stringify(abaPaga.resumo && abaPaga.resumo.situacoes));
  const emAberto = await listar({ search: marca, status: 'pendente,vencido,parcial' });
  ok('aba "Em aberto": os três', emAberto.total === 3, emAberto.total);
  ok('  totais: R$ 248,55 de despesas e R$ 248,55 a pagar', emAberto.resumo.totais.despesas === 248.55 && emAberto.resumo.totais.aPagar === 248.55,
    JSON.stringify(emAberto.resumo.totais));

  console.log('\n--- 3. o lote: baixar ---');
  const previa = await pedir('POST', '/api/finance/entries/lote', { acao: 'baixar', ids: [A.id, B.id], previa: true });
  const itensDaPrevia = (previa.json && previa.json.itens) || [];
  ok('a prévia diz o que seria baixado, sem gravar', previa.status === 200 && itensDaPrevia.length === 2
    && itensDaPrevia.find((i) => i.id === A.id).valor === 123.45 && itensDaPrevia.every((i) => !i.motivo), JSON.stringify(itensDaPrevia.map((i) => i.valor)));
  const aAinda = (await pedir('GET', `/api/finance/entries/${encodeURIComponent(A.id)}`)).json.entry;
  ok('  e A continua sem baixa depois da prévia', aAinda.payments.length === 0 && aAinda.rawStatus === 'pending');
  const baixa = await pedir('POST', '/api/finance/entries/lote', { acao: 'baixar', ids: [A.id, B.id], date: hoje });
  ok('baixar A e B: 2 processados', baixa.status === 200 && baixa.json.processados.length === 2, baixa.json && baixa.json.resumo);
  const aDepois = (await pedir('GET', `/api/finance/entries/${encodeURIComponent(A.id)}`)).json.entry;
  ok('A ficou pago, pelo saldo inteiro', aDepois.rawStatus === 'paid' && aDepois.payments.length === 1 && aDepois.payments[0].amount === 123.45,
    `${aDepois.rawStatus} · ${aDepois.payments.map((p) => p.amount).join()}`);
  ok('  com a data escolhida e a nota do lote', aDepois.payments[0].date === hoje && aDepois.payments[0].note === 'Baixa em lote');
  const deNovo = await pedir('POST', '/api/finance/entries/lote', { acao: 'baixar', ids: [A.id] });
  ok('baixar A de novo: ignorado, com o motivo', deNovo.json.processados.length === 0 && deNovo.json.ignorados[0].motivo === 'Já está baixado.',
    deNovo.json.ignorados[0] && deNovo.json.ignorados[0].motivo);
  ok('  e o ignorado vem com o código', deNovo.json.ignorados[0].codigo === A.codigo);

  console.log('\n--- 4. o lote: cancelar ---');
  const semMotivo = await pedir('POST', '/api/finance/entries/lote', { acao: 'cancelar', ids: [C.id], motivo: 'curto' });
  ok('cancelar sem motivo de 10 caracteres: recusado inteiro', semMotivo.status === 400, semMotivo.status);
  const motivo = `Teste do lote ${carimbo}, pode apagar`;
  const cancela = await pedir('POST', '/api/finance/entries/lote', { acao: 'cancelar', ids: [A.id, C.id], motivo });
  ok('cancelar A e C: só C (A tem baixa)', cancela.json.processados.length === 1 && cancela.json.processados[0].id === C.id, cancela.json.resumo);
  ok('  e A volta com o motivo de estornar antes', /estorne/i.test((cancela.json.ignorados[0] || {}).motivo || ''), (cancela.json.ignorados[0] || {}).motivo);
  const cDepois = (await pedir('GET', `/api/finance/entries/${encodeURIComponent(C.id)}`)).json.entry;
  ok('C cancelado, com o motivo gravado', cDepois.rawStatus === 'cancelado' && cDepois.cancelReason === motivo);
  const depois = await listar({ search: marca });
  ok('abas depois: 2 pagos e 1 cancelado', depois.resumo.situacoes.pago && depois.resumo.situacoes.pago.quantidade === 2
    && depois.resumo.situacoes.cancelado && depois.resumo.situacoes.cancelado.quantidade === 1, JSON.stringify(depois.resumo.situacoes));
  ok('  totais: cancelado fora; nada a pagar', depois.resumo.totais.despesas === 173.45 && depois.resumo.totais.aPagar === 0,
    JSON.stringify(depois.resumo.totais));

  console.log('\n--- 4b. dois envios do mesmo lote AO MESMO TEMPO não baixam em dobro ---');
  // O cenário da revisão: o modal fechado no meio do envio e o lote mandado de
  // novo. Os dois pedidos chegam juntos; cada título tem de sair com UMA baixa.
  const D2 = await criar('D', 10);
  const E2 = await criar('E', 20);
  const F2 = await criar('F', 30);
  const juntos = await Promise.all([
    pedir('POST', '/api/finance/entries/lote', { acao: 'baixar', ids: [D2.id, E2.id, F2.id], date: hoje }),
    pedir('POST', '/api/finance/entries/lote', { acao: 'baixar', ids: [D2.id, E2.id, F2.id], date: hoje })
  ]);
  // Desde a guarda de gravação repetida (15/10/2026), o segundo envio idêntico
  // nem roda: recebe a CÓPIA da resposta do primeiro (X-Gravacao-Repetida).
  // Conta só o que rodou de verdade.
  const feitos = juntos.filter((r) => !r.repetida).reduce((s, r) => s + ((r.json && r.json.processados) || []).length, 0);
  const baixasDeCada = await Promise.all([D2, E2, F2].map(async (e) =>
    ((await pedir('GET', `/api/finance/entries/${encodeURIComponent(e.id)}`)).json.entry.payments || []).length));
  ok('cada título com exatamente UMA baixa', baixasDeCada.every((n) => n === 1), baixasDeCada.join(','));
  ok('  e os dois pedidos juntos processaram 3, não 6', feitos === 3, feitos);
  ok('  o segundo recebeu a resposta do primeiro, sem rodar de novo', juntos.filter((r) => r.repetida).length === 1);

  console.log('\n--- 5. o lote recusa o que não faz sentido ---');
  const recusas = [
    [{ acao: 'constructor', ids: [A.id] }, 'ação que não existe (nem herdada do Object)'],
    [{ acao: 'baixar', ids: [] }, 'sem ninguém selecionado'],
    [{ acao: 'baixar', ids: Array.from({ length: 201 }, (_, i) => `x${i}`) }, 'mais de 200'],
    [{ acao: 'baixar', ids: [B.id], date: 'ontem' }, 'data que não é data'],
    [{ acao: 'baixar', ids: [B.id], bankAccountId: 'conta-que-nao-existe' }, 'conta que não existe']
  ];
  for (const [corpo, nome] of recusas) {
    const r = await pedir('POST', '/api/finance/entries/lote', corpo);
    ok(`400 para ${nome}`, r.status === 400, `${r.status} ${(r.json && r.json.error) || ''}`);
  }

  console.log('\n--- 6. exportar: a planilha pronta para imprimir (16/10/2026) ---');
  const { lerXlsx } = require('../lib/xlsx-leitor');
  const xlsx = await pedir('GET', `/api/finance/entries/exportar?search=${encodeURIComponent(marca)}&sort=amount&dir=asc`);
  const abaXlsx = xlsx.status === 200 ? lerXlsx(xlsx.bytes)[0] : { nome: '', linhas: [] };
  ok('sem formato, vem a planilha .xlsx', xlsx.status === 200 && /spreadsheetml/.test(xlsx.tipo) && /\.xlsx"/.test(xlsx.disposicao), `${xlsx.status} ${xlsx.tipo}`);
  ok('  com as colunas da tela, na ordem dela', (abaXlsx.linhas[0] || []).join('|')
    === 'Conta bancária|Data|Vencimento|Empresa|Tipo|Categoria|Cliente/Fornecedor|Descrição|Valor previsto|Valor realizado|Situação|Documento|Forma de pagamento',
  (abaXlsx.linhas[0] || []).join('|'));
  ok('  os seis do filtro, na ordem da tela, e a linha de total', abaXlsx.linhas.length === 8
    && String(abaXlsx.linhas[1][7]).includes(`${marca} D`) && /^Total \(6 lançamentos\)/.test(abaXlsx.linhas[7][0]), `${abaXlsx.linhas.length} linhas`);
  const doPagar = await pedir('GET', `/api/finance/entries/exportar?search=${encodeURIComponent(marca)}&tela=contas_a_pagar&colunas=description,amountPrevisto,nao-existe`);
  const abaPagar = doPagar.status === 200 ? lerXlsx(doPagar.bytes)[0] : { nome: '', linhas: [[]] };
  ok('  a tela dá o nome da aba (e do arquivo), e só as colunas pedidas e conhecidas', abaPagar.nome === 'Contas a Pagar'
    && abaPagar.linhas[0].join('|') === 'Descrição|Valor previsto' && /contas-a-pagar-/.test(doPagar.disposicao), `${abaPagar.nome} · ${abaPagar.linhas[0].join('|')}`);
  const xlsxSel = await pedir('GET', `/api/finance/entries/exportar?ids=${encodeURIComponent([A.id, B.id].join(','))}`);
  ok('  só os selecionados', xlsxSel.status === 200 && lerXlsx(xlsxSel.bytes)[0].linhas.length === 4);

  console.log('\n--- 6b. o CSV de dados continua, com ?formato=csv ---');
  const csv = await pedir('GET', `/api/finance/entries/exportar?search=${encodeURIComponent(marca)}&sort=amount&dir=asc&formato=csv`);
  const linhas = csv.corpo.replace(/^﻿/, '').trim().split('\r\n');
  ok('o filtro inteiro, em CSV (os seis do teste)', csv.status === 200 && /text\/csv/.test(csv.tipo) && linhas.length === 7, `${csv.status} · ${linhas.length} linhas`);
  ok('  com BOM (acentos no Excel) e o cabeçalho em português', csv.corpo.startsWith('﻿') && /^Código;Data;Vencimento;Descrição/.test(linhas[0]));
  ok('  na ordem da tela (valor crescente: D, de R$ 10, primeiro)', linhas[1].includes(`${marca} D`) && /;10,00;/.test(linhas[1]), linhas[1]);
  ok('  e o em aberto do pago é zero', /;10,00;10,00;0,00;Pago;/.test(linhas[1]), linhas[1]);
  ok('  com a descrição inteira, não o resumo', linhas.slice(1).every((l) => l.includes(marca)));
  const csvSel = await pedir('GET', `/api/finance/entries/exportar?ids=${encodeURIComponent([A.id, B.id].join(','))}&formato=csv`);
  ok('só os selecionados', csvSel.status === 200 && csvSel.corpo.trim().split('\r\n').length === 3);
  const csvDemais = await pedir('GET', `/api/finance/entries/exportar?ids=${Array.from({ length: 201 }, (_, i) => `x${i}`).join(',')}`);
  ok('mais de 200 selecionados: recusado, com o caminho', csvDemais.status === 400 && /filtro/.test((csvDemais.json && csvDemais.json.error) || ''));
})()
  .catch((e) => { console.error(e); falhas++; })
  .finally(async () => {
    console.log('\n--- limpeza ---');
    try {
      if (lixo.lancamentos.length) {
        await consultar('delete from financial_payments where entry_id = any($1)', [lixo.lancamentos]);
        await consultar('delete from financial_entries where id = any($1)', [lixo.lancamentos]);
      }
      if (lixo.usuario) {
        await consultar('delete from sessoes where user_id = $1', [lixo.usuario]).catch(() => {});
        await auth.deleteUser(lixo.usuario);
      }
      ok('cenário e usuário do teste removidos', true);
    } catch (erro) {
      ok('limpeza', false, erro.message);
    }
    console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
    await fecharPool();
    process.exit(falhas ? 1 : 0);
  });
