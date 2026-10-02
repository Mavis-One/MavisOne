#!/usr/bin/env node
// A ESCRITURAÇÃO DO SPED CONTRA O BANCO DE VERDADE (fase DL).
//
// NÃO entra em `npm test`: precisa do Postgres. Roda à mão:
//
//   node scripts/prova-sped-escrituracao.js
//
// Tudo numa transação desfeita no fim — nenhuma nota, entrada, configuração ou
// documento fiscal fica no banco. O cenário é o de setembro/2026 na MATRIZ:
//
//   - uma NF-e EMITIDA pela Focus, autorizada, com o XML em nfe_arquivos;
//   - uma NF-e emitida e CANCELADA, sem XML nenhum;
//   - uma nota de ENTRADA lançada por XML, com o item 1 vinculado a um produto.
//
// O que se prova: a sincronização escritura as três, não escritura de novo,
// segue o cancelamento, o saldo credor encadeia desde a competência inicial, e
// o arquivo que sai passa LIMPO pela conferência de SPED.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { obterPool } = require('../lib/db/conexao');
const sped = require('../lib/db/sped-escrituracao');
const g = require('../lib/sped-gerador');
const { conferirEfd } = require('../lib/sped-conferencia');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};

const MATRIZ = '43792899000135';
const XML = fs.readFileSync(path.join(__dirname, 'fixtures', 'nfe-entrada-exemplo.xml'), 'utf8');

// O XML de exemplo, com quem emite e quem recebe trocados, e chave nova.
function xmlCom({ emitente, destinatario, chave, numero, dhEmi }) {
  return XML
    .replace('<CNPJ>11222333000181</CNPJ>', `<CNPJ>${emitente}</CNPJ>`)
    .replace('<CNPJ>52998224725000</CNPJ>', destinatario.length === 11 ? `<CPF>${destinatario}</CPF>` : `<CNPJ>${destinatario}</CNPJ>`)
    .replace('Id="NFe42260811222333000181550010000123451123456780"', `Id="NFe${chave}"`)
    .replace('<nNF>12345</nNF>', `<nNF>${numero}</nNF>`)
    .replace('<dhEmi>2026-08-20T22:15:00-03:00</dhEmi>', `<dhEmi>${dhEmi}</dhEmi>`)
    .replace('<dhSaiEnt>2026-08-20T22:30:00-03:00</dhSaiEnt>', `<dhSaiEnt>${dhEmi}</dhSaiEnt>`);
}

(async () => {
  const pool = obterPool();
  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rows: [est] } = await c.query('select * from estabelecimento where cnpj = $1', [MATRIZ]);
    if (!est) throw new Error('a MATRIZ não está cadastrada neste banco');
    const { rows: [prod] } = await c.query(
      `select p.id, pf.sku from products p join produto_fiscal pf on pf.product_id = p.id and pf.vigencia_fim is null
        where upper(pf.unidade_comercial) = 'PC' limit 1`);

    console.log('\n--- o cenário ---');
    await c.query('update estabelecimento set perfil_sped = $2, indicador_atividade = 1 where id = $1', [est.id, 'B']);
    await c.query(
      `insert into sped_configuracao (estabelecimento_id, contador_nome, contador_cpf, contador_crc, contador_codigo_municipio,
         credito_icms_entradas, e116_codigo_receita, e116_dia_vencimento, competencia_inicial, saldo_credor_inicial)
       values ($1, 'CONTADOR DA PROVA', '11144477735', 'SC-000000/O', '4209102', 'DESTACADO', '144910014', 10, '2026-08', 100)
       on conflict (estabelecimento_id) do update set contador_nome = excluded.contador_nome, contador_cpf = excluded.contador_cpf,
         contador_crc = excluded.contador_crc, credito_icms_entradas = excluded.credito_icms_entradas,
         e116_codigo_receita = excluded.e116_codigo_receita, e116_dia_vencimento = excluded.e116_dia_vencimento,
         competencia_inicial = excluded.competencia_inicial, saldo_credor_inicial = excluded.saldo_credor_inicial`,
      [est.id]);

    // 1. NF-e emitida e autorizada, com XML.
    const chaveSaida = `4226094379289900013555001000099001${'1'.repeat(10)}`;
    const { rows: [nfeOk] } = await c.query(
      `insert into nfe (estabelecimento_id, referencia, modelo, serie, numero, chave_acesso, natureza_operacao, tipo_documento,
         finalidade_emissao, status, data_emissao, autorizado_em, valor_total)
       values ($1, 'prova-sped-1', 55, 1, 99001, $2, 'VENDA', 1, 1, 'AUTORIZADO', '2026-09-10T14:00:00-03:00', '2026-09-10T14:01:00-03:00', 612.5)
       returning *`, [est.id, chaveSaida]);
    const xmlSaida = xmlCom({ emitente: MATRIZ, destinatario: '12345678909', chave: chaveSaida, numero: '99001', dhEmi: '2026-09-10T14:00:00-03:00' });
    await c.query(`insert into nfe_arquivos (nfe_id, tipo, conteudo) values ($1, 'xml', $2)`, [nfeOk.id, Buffer.from(xmlSaida, 'utf8')]);

    // 2. NF-e emitida e cancelada, sem XML.
    await c.query(
      `insert into nfe (estabelecimento_id, referencia, modelo, serie, numero, chave_acesso, natureza_operacao, tipo_documento,
         finalidade_emissao, status, data_emissao)
       values ($1, 'prova-sped-2', 55, 1, 99002, $2, 'VENDA', 1, 1, 'CANCELADO', '2026-09-11T10:00:00-03:00')`,
      [est.id, `4226094379289900013555001000099002${'2'.repeat(10)}`]);

    // 3. Entrada por XML, item 1 vinculado.
    const chaveEntrada = `4226091122233300018155001000077001${'3'.repeat(10)}`;
    const xmlEntrada = xmlCom({ emitente: '11222333000181', destinatario: MATRIZ, chave: chaveEntrada, numero: '77001', dhEmi: '2026-09-14T09:00:00-03:00' });
    await c.query(
      `insert into nfe_entrada (id, chave, modelo, serie, numero, data_emissao, emitente_documento, emitente_nome,
         destinatario_documento, valor_produtos, valor_total, status, xml, criado_em)
       values ('ent-prova-sped', $1, '55', '1', '77001', '2026-09-14', '11222333000181', 'DISTRIBUIDORA MODELO',
         $2, 600, 612.5, 'LANCADA', $3, '2026-09-15T11:00:00-03:00')`, [chaveEntrada, MATRIZ, xmlEntrada]);
    await c.query(
      `insert into nfe_entrada_item (id, entrada_id, numero, descricao, quantidade, product_id)
       values ('eni-prova-1', 'ent-prova-sped', 1, 'PARAFUSO', 100, $1), ('eni-prova-2', 'ent-prova-sped', 2, 'CAIXA', 10, null)`,
      [prod ? prod.id : null]);
    console.log(`  matriz ${est.cnpj}, produto vinculado ${prod ? prod.sku : '(nenhum PC no cadastro)'}`);

    console.log('\n--- 1. a primeira geração escritura ---');
    const r1 = await sped.escriturarCompetencia({ estabelecimentoId: est.id, competencia: '2026-09', cliente: c });
    check('três notas escrituradas', r1.sincronia.escrituradas === 3, JSON.stringify(r1.sincronia));
    check('  nenhuma pendente', r1.sincronia.pendentes.length === 0, r1.sincronia.pendentes.join(' | '));
    const m = r1.montagem;
    check('sem impedimento', m.impedimentos.length === 0, m.impedimentos.map((i) => i.codigo + ': ' + i.titulo).join(' | ') || 'nenhum');
    const c100 = m.blocos.C.filter((r) => r.REG === 'C100');
    check('três C100: a autorizada, a cancelada e a entrada', c100.map((r) => `${r.NUM_DOC}/${r.COD_SIT}`).join(',') === '99001/00,99002/02,77001/00',
      c100.map((r) => `${r.NUM_DOC}/${r.COD_SIT}`).join(','));
    check('a entrada caiu em setembro pela data de ENTRADA (15/09), não de emissão', c100[2].DT_E_S === '15092026' && c100[2].DT_DOC === '14092026');
    const c170 = m.blocos.C.filter((r) => r.REG === 'C170');
    check('só a entrada tem C170 (2 itens), com CFOP de entrada', c170.length === 2 && c170.every((r) => r.CFOP === '1102'));
    if (prod) check('  o item vinculado sai com o SKU do cadastro', c170[0].COD_ITEM === prod.sku, c170[0].COD_ITEM);

    console.log('\n--- 2. o saldo encadeia desde a competência inicial ---');
    const e110 = m.blocos.E.find((r) => r.REG === 'E110');
    check('agosto (inicial, sem nota) começa com 100 e passa 100 para setembro', e110.VL_SLD_CREDOR_ANT === 100);
    check('setembro: débito 42,50 (a saída), crédito 42,50 (a entrada)', e110.VL_TOT_DEBITOS === 42.5 && e110.VL_TOT_CREDITOS === 42.5);
    check('  e o saldo credor de 100 segue para outubro', e110.VL_SLD_CREDOR_TRANSPORTAR === 100 && e110.VL_ICMS_RECOLHER === 0);
    const out = await sped.escriturarCompetencia({ estabelecimentoId: est.id, competencia: '2026-10', cliente: c });
    check('outubro recebe os 100 de setembro', out.montagem.apuracao.VL_SLD_CREDOR_ANT === 100);
    const jul = await sped.escriturarCompetencia({ estabelecimentoId: est.id, competencia: '2026-07', cliente: c });
    check('julho, antes da competência inicial, é recusado', jul.montagem.impedimentos.some((i) => i.codigo === 'ANTES_DO_INICIO'));

    console.log('\n--- 3. o arquivo, pela conferência ---');
    const arq = g.gerarEfd({ registro0000: m.registro0000, blocos: m.blocos });
    const conf = conferirEfd(g.paraLatin1(arq.texto).buffer, { nome: 'prova.txt' });
    check('a conferência não acha nada', conf.problemas.length === 0, conf.problemas.map((p) => p.codigo + ': ' + p.titulo).join(' | ') || 'limpo');
    check('  e o 0000 é da matriz, em setembro', conf.arquivo.cnpj === MATRIZ && conf.arquivo.competencia === '2026-09');

    console.log('\n--- 4. de novo, e depois do cancelamento ---');
    const r2 = await sped.escriturarCompetencia({ estabelecimentoId: est.id, competencia: '2026-09', cliente: c });
    check('a segunda geração não escritura nada de novo', r2.sincronia.escrituradas === 0 && r2.montagem.blocos.C.filter((r) => r.REG === 'C100').length === 3);
    await c.query(`update nfe set status = 'CANCELADO' where id = $1`, [nfeOk.id]);
    const r3 = await sped.escriturarCompetencia({ estabelecimentoId: est.id, competencia: '2026-09', cliente: c });
    check('cancelada na Focus -> o documento passa a CANCELADO', r3.sincronia.atualizadas === 1);
    const c100c = r3.montagem.blocos.C.filter((r) => r.REG === 'C100');
    check('  e o C100 dela sai com COD_SIT 02, sem valores', c100c[0].NUM_DOC === '99001' && c100c[0].COD_SIT === '02' && c100c[0].VL_DOC === undefined);
    check('  e o débito some da apuração', r3.montagem.apuracao.VL_TOT_DEBITOS === 0);

    console.log('\n--- 5. a nota sem XML fica pendente, e não é inventada ---');
    await c.query(
      `insert into nfe (estabelecimento_id, referencia, modelo, serie, numero, natureza_operacao, tipo_documento,
         finalidade_emissao, status, data_emissao)
       values ($1, 'prova-sped-3', 55, 1, 99003, 'VENDA', 1, 1, 'AUTORIZADO', '2026-09-20T10:00:00-03:00')`, [est.id]);
    const r4 = await sped.escriturarCompetencia({ estabelecimentoId: est.id, competencia: '2026-09', cliente: c });
    check('autorizada sem XML baixado é pendência, não documento', r4.sincronia.pendentes.some((p) => /99003/.test(p)), r4.sincronia.pendentes.join(' | '));
    check('  e a pendência IMPEDE a geração (o arquivo sairia sem ela)', r4.montagem.impedimentos.some((i) => i.codigo === 'NOTAS_PENDENTES'));

    console.log('\n--- 6. o arquivo gerado fica guardado (fase DM) ---');
    const buf = g.paraLatin1(arq.texto).buffer;
    const guardado = await sped.guardarArquivo({
      estabelecimentoId: est.id, competencia: '2026-09', retificadora: false, nome: 'prova.txt', buffer: buf,
      linhas: arq.linhas.length, montagem: m, avisos: m.avisos, usuario: { id: null, name: 'Prova' }
    }, { cliente: c });
    const listados = await sped.listarArquivos(est.id, { cliente: c });
    check('aparece na lista do estabelecimento, sem o conteúdo', listados[0].id === guardado.id && listados[0].conteudo === undefined);
    check('  com competência, notas e ICMS a recolher', listados[0].competencia === '2026-09' && listados[0].documentos === 3);
    const devolvido = await sped.obterArquivo(guardado.id, { cliente: c });
    check('e volta BYTE A BYTE igual ao gerado', Buffer.compare(devolvido.conteudo, buf) === 0 && devolvido.bytes === buf.length);
    check('  com o sha256 de quando foi gerado', devolvido.sha256 === require('crypto').createHash('sha256').update(buf).digest('hex'));
    const ret = await sped.escriturarCompetencia({ estabelecimentoId: est.id, competencia: '2026-10', retificadora: true, vencimentoGuia: '2026-11-12', cliente: c });
    check('retificadora e vencimento chegam à montagem', ret.montagem.registro0000.COD_FIN === '1');

    await c.query('rollback');
    console.log('\n(rollback: o banco ficou como estava)');
  } catch (e) {
    try { await c.query('rollback'); } catch (_) { /* conexão perdida */ }
    console.error('ERRO', e);
    falhas += 1;
  } finally {
    c.release();
    await pool.end();
  }
  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})();
