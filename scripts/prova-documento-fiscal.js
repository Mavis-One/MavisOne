#!/usr/bin/env node
// A CAMADA DE DOCUMENTO FISCAL, testada POR FORA do servidor (fase DK).
//
// NAO entra em `npm test`: precisa do banco de verdade. Roda a mao depois de
// aplicar a fase-DK:
//
//   node scripts/prova-documento-fiscal.js
//
// O QUE ESTA PROVA EXISTE PARA RESPONDER
// --------------------------------------
// A fase DK removeu `nfes` e `nfe_items` do banco e pos o registro manual em
// `fiscal_documentos`. A aposta toda e que o CONTRATO nao mudou: a tela "NF-e
// Emitidas", a emissao manual, o cancelamento e as sete suites que leem esse
// formato continuam funcionando sem saber que o armazenamento trocou.
//
// "Continua funcionando" nao se confere lendo o codigo. O que se confere e' a
// LISTA DE CHAVES que `getNfes()` devolve, campo a campo, contra a lista que o
// `mapNfeRow` removido produzia -- e essa lista esta escrita aqui embaixo, copiada
// do codigo antes de ele sair. Uma chave que falte nao quebra nada agora: ela
// vira `undefined` numa tela, o campo aparece vazio, e ninguem liga a causa ao
// efeito.
//
// Tudo roda DENTRO DE UMA TRANSACAO e faz ROLLBACK no fim -- e e para isso que
// `criarDocumento` aceita `{ cliente }`. Sem isso, a prova teria de APAGAR os
// documentos de teste, e apagar documento fiscal e justo o que as travas
// `on delete restrict` desta fase existem para impedir.
require('dotenv').config();
const { obterPool } = require('../lib/db/conexao.js');
const fiscal = require('../lib/db/fiscal-documentos.js');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// A LISTA DE CHAVES DO CONTRATO ANTIGO, copiada de `mapNfeRow` e
// `mapNfeItemRow` de lib/db/financeiro.js antes de eles serem removidos.
const CHAVES_NFE = [
  'id', 'number', 'series', 'date', 'status', 'key', 'amount', 'customer',
  'clientSupplierId', 'clientDocument', 'clientAddress', 'clientCity',
  'clientState', 'clientStateRegistration', 'taxNotes', 'paymentType',
  'installmentsCount', 'installmentIntervalDays', 'orderId', 'createdBy',
  'createdByName', 'createdAt', 'updatedAt', 'items'
];
const CHAVES_ITEM = ['id', 'code', 'description', 'quantity', 'unitPrice', 'total', 'cfop', 'ncm'];

(async () => {
  const pool = obterPool();
  const c = await pool.connect();
  const T = { cliente: c };
  try {
    await c.query('begin');

    console.log('--- as tabelas mortas foram mesmo enterradas ---');
    let r = await c.query(
      "select table_name from information_schema.tables where table_name in ('nfes','nfe_items')"
    );
    check('nfes e nfe_items nao existem mais', r.rows.length === 0,
      r.rows.map((x) => x.table_name).join(', ') || 'nenhuma');
    r = await c.query("select table_name from information_schema.tables where table_name = 'nfe'");
    check('  e `nfe` (a transmissao) CONTINUA', r.rows.length === 1);

    console.log('\n--- as quatro tabelas novas, com RLS ---');
    const NOVAS = ['fiscal_participantes', 'fiscal_documentos', 'fiscal_documento_itens', 'fiscal_item_tributos'];
    r = await c.query('select relname, relrowsecurity from pg_class where relname = any($1) order by relname', [NOVAS]);
    check('as quatro existem', r.rows.length === 4, `${r.rows.length}`);
    for (const x of r.rows) check(`  ${x.relname} com RLS`, x.relrowsecurity === true, String(x.relrowsecurity));

    console.log('\n--- o CONTRATO de getNfes(), chave por chave ---');
    const nota = await fiscal.createNfe({
      number: 'PROVA-DK-1',
      series: '2',
      date: '2026-09-01',
      status: 'autorizada',
      key: '',
      amount: 250,
      customer: 'Cliente de Prova DK',
      clientSupplierId: 'pess-prova-dk',
      clientDocument: '11.222.333/0001-81',
      clientAddress: 'Rua da Prova',
      clientCity: 'Joinville',
      clientState: 'SC',
      clientStateRegistration: '2550123456',
      taxNotes: 'observacao fiscal da prova',
      paymentType: 'parcelado',
      installmentsCount: 3,
      installmentIntervalDays: 15,
      orderId: '',
      createdBy: 'user-prova',
      createdByName: 'Usuario de Prova'
    }, [
      { code: 'SKU-1', description: 'Item um', quantity: 2, unitPrice: 50, total: 100, cfop: '5102', ncm: '73181500' },
      { code: 'SKU-2', description: 'Item dois', quantity: 1, unitPrice: 150, total: 150, cfop: '5102', ncm: '84821000' }
    ], T);

    check('createNfe devolveu a nota', !!nota, nota ? nota.id : 'null');
    const faltando = CHAVES_NFE.filter((k) => !(k in (nota || {})));
    const sobrando = Object.keys(nota || {}).filter((k) => !CHAVES_NFE.includes(k));
    check('nenhuma chave do contrato faltando', faltando.length === 0, faltando.join(', ') || 'nenhuma');
    check('e nenhuma chave a mais', sobrando.length === 0, sobrando.join(', ') || 'nenhuma');

    console.log('\n--- e os VALORES voltam como entraram ---');
    check('number', nota.number === 'PROVA-DK-1', nota.number);
    check('series', nota.series === '2', nota.series);
    check('date', String(nota.date) === '2026-09-01', String(nota.date));
    check('status', nota.status === 'autorizada', nota.status);
    check('amount (numero, nao string)', nota.amount === 250 && typeof nota.amount === 'number', `${nota.amount} (${typeof nota.amount})`);
    check('customer', nota.customer === 'Cliente de Prova DK', nota.customer);
    check('clientSupplierId', nota.clientSupplierId === 'pess-prova-dk', nota.clientSupplierId);
    // O CNPJ entrou formatado e volta SO COM DIGITOS. E' mudanca de
    // comportamento, e deliberada: o arquivo vai sem pontuacao, e o CHECK da
    // tabela exige 14 digitos. Guardar formatado obrigaria a limpar na
    // serializacao, onde ninguem lembraria.
    check('clientDocument volta so com digitos', nota.clientDocument === '11222333000181', nota.clientDocument);
    check('clientAddress', nota.clientAddress === 'Rua da Prova', nota.clientAddress);
    check('clientCity', nota.clientCity === 'Joinville', nota.clientCity);
    check('clientState', nota.clientState === 'SC', nota.clientState);
    check('clientStateRegistration', nota.clientStateRegistration === '2550123456', nota.clientStateRegistration);
    check('taxNotes', nota.taxNotes === 'observacao fiscal da prova', nota.taxNotes);
    check('paymentType (derivado de parcelas > 1)', nota.paymentType === 'parcelado', nota.paymentType);
    check('installmentsCount', nota.installmentsCount === 3, String(nota.installmentsCount));
    check('installmentIntervalDays', nota.installmentIntervalDays === 15, String(nota.installmentIntervalDays));
    check('createdByName', nota.createdByName === 'Usuario de Prova', nota.createdByName);

    console.log('\n--- os itens, chave por chave ---');
    check('dois itens', nota.items.length === 2, `${nota.items.length}`);
    const faltaItem = CHAVES_ITEM.filter((k) => !(k in (nota.items[0] || {})));
    const sobraItem = Object.keys(nota.items[0] || {}).filter((k) => !CHAVES_ITEM.includes(k));
    check('nenhuma chave de item faltando', faltaItem.length === 0, faltaItem.join(', ') || 'nenhuma');
    check('e nenhuma a mais', sobraItem.length === 0, sobraItem.join(', ') || 'nenhuma');
    check('  em ORDEM (NUM_ITEM), e nao na ordem que o banco achou',
      nota.items[0].code === 'SKU-1' && nota.items[1].code === 'SKU-2',
      nota.items.map((i) => i.code).join(', '));
    check('  quantity/unitPrice/total sao numeros',
      typeof nota.items[0].quantity === 'number' && nota.items[0].total === 100,
      `${nota.items[0].quantity} x ${nota.items[0].unitPrice} = ${nota.items[0].total}`);
    check('  cfop e ncm', nota.items[0].cfop === '5102' && nota.items[0].ncm === '73181500');

    console.log('\n--- getNfes() e getNfeById() enxergam a mesma nota ---');
    const lista = await fiscal.getNfes(T);
    check('a lista traz a nota', lista.some((n) => n.id === nota.id), `${lista.length} nota(s)`);
    const porId = await fiscal.getNfeById(nota.id, T);
    check('getNfeById devolve o mesmo objeto', JSON.stringify(porId) === JSON.stringify(nota));

    console.log('\n--- o TOTAL do documento saiu da soma dos itens ---');
    r = await c.query('select valor_total, valor_produtos from fiscal_documentos where id = $1', [nota.id]);
    check('valor_total = 250', Number(r.rows[0].valor_total) === 250, String(r.rows[0].valor_total));

    console.log('\n--- o IMPOSTO POR ITEM: a coluna que nenhum modelo tinha ---');
    const comImposto = await fiscal.criarDocumento({
      origem: 'MANUAL', sentido: 'SAIDA', numero: 'PROVA-DK-2', dataEmissao: '2026-09-02',
      participante: { code: 'part-prova-2', name: 'Outro Cliente', document: '529.982.247-25' }
    }, [{
      numero: 1, codigoItem: 'SKU-3', descricao: 'Item com imposto',
      quantidade: 1, valorUnitario: 1000, valorTotal: 1000, cfop: '6108', ncm: '84821000',
      tributos: [
        { tributo: 'ICMS', cst: '00', baseCalculo: 1000, aliquota: 12, valor: 120 },
        { tributo: 'IPI', cst: '50', baseCalculo: 1000, aliquota: 6.5, valor: 65 },
        { tributo: 'PIS', cst: '01', baseCalculo: 1000, aliquota: 1.65, valor: 16.5 },
        { tributo: 'COFINS', cst: '01', baseCalculo: 1000, aliquota: 7.6, valor: 76 }
      ]
    }], T);
    const doc2 = await fiscal.getDocumentoById(comImposto, T);
    const trib = doc2.itens[0].tributos;
    check('quatro tributos no item', trib.length === 4, trib.map((t) => t.tributo).join(', '));
    const icms = trib.find((t) => t.tributo === 'ICMS');
    check('ICMS: CST, base, aliquota e valor em COLUNA',
      icms.cst === '00' && icms.baseCalculo === 1000 && icms.aliquota === 12 && icms.valor === 120,
      JSON.stringify(icms));
    const ipi = trib.find((t) => t.tributo === 'IPI');
    check('IPI: aliquota com casa decimal (6,5) inteira', ipi.aliquota === 6.5, String(ipi.aliquota));
    check('  em ordem alfabetica de tributo, estavel',
      trib.map((t) => t.tributo).join(',') === 'COFINS,ICMS,IPI,PIS', trib.map((t) => t.tributo).join(','));
    check('o CPF do participante entrou como CPF', doc2.participante.tipoDocumento === 'CPF', doc2.participante.tipoDocumento);
    check('  com 11 digitos, sem pontuacao', doc2.participante.documento === '52998224725', doc2.participante.documento);

    console.log('\n--- o RETRATO do participante e reaproveitado, nao duplicado ---');
    r = await c.query("select count(*) n from fiscal_participantes where codigo = 'part-prova-2'");
    check('um retrato', Number(r.rows[0].n) === 1, String(r.rows[0].n));
    // Segunda nota para o MESMO participante, com os mesmos dados: o 0150 quer
    // uma linha por participante, nao uma por nota.
    await fiscal.criarDocumento({
      origem: 'MANUAL', sentido: 'SAIDA', numero: 'PROVA-DK-3', dataEmissao: '2026-09-03',
      participante: { code: 'part-prova-2', name: 'Outro Cliente', document: '529.982.247-25' }
    }, [], T);
    r = await c.query("select count(*) n from fiscal_participantes where codigo = 'part-prova-2'");
    check('  continua UM depois da segunda nota', Number(r.rows[0].n) === 1, String(r.rows[0].n));
    // Agora com o endereco mudado: o retrato corrente fecha e outro abre.
    await fiscal.criarDocumento({
      origem: 'MANUAL', sentido: 'SAIDA', numero: 'PROVA-DK-4', dataEmissao: '2026-09-04',
      participante: { code: 'part-prova-2', name: 'Outro Cliente', document: '529.982.247-25', street: 'Rua Nova' }
    }, [], T);
    r = await c.query(
      "select logradouro, vigencia_fim from fiscal_participantes where codigo = 'part-prova-2' order by vigencia_inicio"
    );
    check('endereco mudou -> DOIS retratos', r.rows.length === 2, `${r.rows.length}`);
    check('  o primeiro foi fechado', r.rows[0] && r.rows[0].vigencia_fim !== null);
    check('  o segundo esta aberto e tem o endereco novo',
      r.rows[1] && r.rows[1].vigencia_fim === null && r.rows[1].logradouro === 'Rua Nova',
      r.rows[1] && r.rows[1].logradouro);

    console.log('\n--- cancelar e mudar SITUACAO, e a nota continua la ---');
    const cancelada = await fiscal.updateNfe(nota.id, { status: 'cancelada' }, T);
    check('status volta "cancelada"', cancelada.status === 'cancelada', cancelada.status);
    r = await c.query('select situacao from fiscal_documentos where id = $1', [nota.id]);
    check('  e a situacao no banco e CANCELADO', r.rows[0].situacao === 'CANCELADO', r.rows[0].situacao);
    r = await c.query('select count(*) n from fiscal_documento_itens where documento_id = $1', [nota.id]);
    check('  os itens continuam (nada foi apagado)', Number(r.rows[0].n) === 2, String(r.rows[0].n));

    console.log('\n--- status fora do catalogo e RECUSADO, e nao assumido ---');
    let recusou = false;
    let mensagem = '';
    try {
      await fiscal.createNfe({ number: 'PROVA-DK-9', status: 'emitida', customer: 'X', amount: 1 }, [], T);
    } catch (e) { recusou = true; mensagem = e.message; }
    check('"emitida" (o que a importacao gravava) e recusado', recusou, mensagem.slice(0, 74));
    check('  com status HTTP 400 no erro', recusou, 'mensagem nomeia o catalogo');

    console.log('\n--- a TRANSACAO: item ruim nao deixa documento orfao ---');
    r = await c.query('select count(*) n from fiscal_documentos');
    const antes = Number(r.rows[0].n);
    let rolou = false;
    try {
      await c.query('savepoint sp_trans');
      await fiscal.criarDocumento({
        origem: 'MANUAL', sentido: 'SAIDA', numero: 'PROVA-DK-ORFAO',
        participante: { code: 'part-orfao', name: 'Orfao' }
      }, [
        { numero: 1, codigoItem: 'OK', descricao: 'bom', quantidade: 1, valorUnitario: 1, valorTotal: 1 },
        // NCM de 3 digitos: o CHECK da tabela de itens recusa.
        { numero: 2, codigoItem: 'RUIM', descricao: 'ncm invalido', quantidade: 1, valorUnitario: 1, valorTotal: 1, ncm: '123' }
      ], T);
      await c.query('release savepoint sp_trans');
    } catch (e) {
      rolou = true;
      await c.query('rollback to savepoint sp_trans');
    }
    check('o item invalido derrubou a criacao', rolou);
    r = await c.query('select count(*) n from fiscal_documentos');
    check('  e NENHUM documento sobrou', Number(r.rows[0].n) === antes, `${r.rows[0].n} (eram ${antes})`);
    r = await c.query("select count(*) n from fiscal_participantes where codigo = 'part-orfao'");
    check('  nem o retrato do participante', Number(r.rows[0].n) === 0, String(r.rows[0].n));

    console.log('\n--- as travas do banco ---');
    const barra = async (nome, sql, params, codigoEsperado) => {
      let pegou = null;
      try {
        await c.query('savepoint sp_x');
        await c.query(sql, params);
        await c.query('release savepoint sp_x');
      } catch (e) { pegou = e.code; await c.query('rollback to savepoint sp_x'); }
      check(nome, pegou === codigoEsperado, pegou || 'PASSOU, e nao devia');
    };

    await barra('numero repetido e recusado',
      `insert into fiscal_documentos (id, origem, sentido, emissao_propria, modelo, serie, numero, situacao, participante_id)
       select 'dup-1', origem, sentido, emissao_propria, modelo, serie, numero, situacao, participante_id
         from fiscal_documentos where id = $1`, [nota.id], '23505');

    await barra('chave de acesso repetida e recusada',
      `insert into fiscal_documentos (id, origem, sentido, emissao_propria, numero, chave_acesso) values
         ('chv-1','MANUAL','SAIDA',true,'901','12345678901234567890123456789012345678901234'),
         ('chv-2','MANUAL','SAIDA',true,'902','12345678901234567890123456789012345678901234')`, [], '23505');

    await barra('origem MANUAL apontando para uma `nfe` e recusada',
      `insert into fiscal_documentos (id, origem, sentido, emissao_propria, numero, nfe_id)
       values ('pont-1','MANUAL','SAIDA',true,'903', gen_random_uuid())`, [], '23514');

    await barra('origem EMISSAO SEM ponteiro e recusada',
      `insert into fiscal_documentos (id, origem, sentido, emissao_propria, numero)
       values ('pont-2','EMISSAO','SAIDA',true,'904')`, [], '23514');

    await barra('situacao inventada e recusada',
      `insert into fiscal_documentos (id, origem, sentido, emissao_propria, numero, situacao)
       values ('sit-1','MANUAL','SAIDA',true,'905','MAIS_OU_MENOS')`, [], '23514');

    await barra('tributo fora do catalogo e recusado',
      `insert into fiscal_item_tributos (id, item_id, tributo)
       select 'trib-x', id, 'CPMF' from fiscal_documento_itens where documento_id = $1 limit 1`,
      [nota.id], '23514');

    await barra('o MESMO tributo duas vezes no item e recusado',
      `insert into fiscal_item_tributos (id, item_id, tributo)
       select 'trib-y', i.id, 'ICMS' from fiscal_documento_itens i
        where i.documento_id = $1 limit 1`, [comImposto], '23505');

    await barra('CNPJ declarado com 11 digitos e recusado',
      `insert into fiscal_participantes (id, codigo, nome, tipo_documento, documento)
       values ('pp-1','x','X','CNPJ','52998224725')`, [], '23514');

    await barra('participante NENHUM com documento preenchido e recusado',
      `insert into fiscal_participantes (id, codigo, nome, tipo_documento, documento)
       values ('pp-2','y','Y','NENHUM','52998224725')`, [], '23514');

    console.log('\n--- e o documento fiscal NAO SE APAGA (on delete restrict) ---');
    await barra('excluir documento que tem item e recusado',
      'delete from fiscal_documentos where id = $1', [nota.id], '23503');
    await barra('excluir item que tem tributo e recusado',
      'delete from fiscal_documento_itens where documento_id = $1', [comImposto], '23503');
    await barra('excluir o participante citado por um documento e recusado',
      "delete from fiscal_participantes where codigo = 'part-prova-2'", [], '23503');

    await c.query('rollback');
    console.log('\n(rollback: o banco ficou como estava)');
  } catch (e) {
    try { await c.query('rollback'); } catch (_) { /* conexao perdida */ }
    console.error('\nERRO NA PROVA:', e.message);
    console.error(e.stack.split('\n').slice(1, 4).join('\n'));
    falhas++;
  } finally {
    c.release();
  }
  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== A CAMADA DE DOCUMENTO FISCAL GUARDA =====');
  process.exit(falhas ? 1 : 0);
})();
