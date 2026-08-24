#!/usr/bin/env node
// A ENTRADA DE NF-e, provada CONTRA O BANCO DE VERDADE.
//
// NAO entra em `npm test`: escreve no Supabase. Roda a mao depois de aplicar a
// fase-AK, ou quando a camada de dados mudar de coluna:
//
//   node scripts/prova-entrada-nfe.js
//
// Existe porque a suite estatica de scripts/test-entrada-nfe.js le ARQUIVOS: ela
// confere que a migracao declara `chave ... unique` e que lib/db/entrada-nfe.js
// trata o codigo 23505. Nenhuma das duas coisas prova que a tabela no banco
// tenha a restricao, nem que os 22 nomes de coluna do INSERT existam la. Um
// `data_emissao` escrito `dataEmissao` passa verde na suite inteira e so falha
// na primeira nota que alguem lancar.
//
// O que so o banco responde:
//   - todas as colunas do INSERT existem (cabeca e item);
//   - a UNIQUE da chave barra a segunda tentativa, e vira a mensagem certa;
//   - o CHECK do status recusa valor fora de LANCADA/REVISAR;
//   - numeric(15,10) guarda o centavo quebrado do vUnCom sem arredondar;
//   - o jsonb do imposto e do resumo volta objeto, nao texto;
//   - o de-para reencontra o vinculo pelo codigo do fornecedor;
//   - o `on delete cascade` leva os itens junto.
//
// LIMPA O QUE ESCREVEU. A nota de prova nasce com chave propria (carimbada com
// a hora) e e apagada no fim -- pelo caminho que a migracao reservou para dado
// de teste direto no banco, o mesmo que o aplicativo nao tem.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { supabase } = require('../lib/db/client');
const entradaNfeDb = require('../lib/db/entrada-nfe');
const entradaNfe = require('../lib/entradaNfe');

let falhas = 0;
const check = (ok, titulo, detalhe) => {
  console.log(`  ${ok ? 'OK ' : 'XX '} ${titulo}${detalhe !== undefined ? ' -> ' + detalhe : ''}`);
  if (!ok) falhas++;
};

const XML = fs.readFileSync(path.join(__dirname, 'fixtures', 'nfe-entrada-exemplo.xml'), 'utf8');

// Chave carimbada com a hora: duas rodadas seguidas nao colidem entre si, e a
// UNIQUE continua sendo provada porque a MESMA chave e tentada duas vezes.
const carimbo = String(Date.now()).slice(-12);
const CHAVE = ('42260811222333000181550010000123451' + carimbo).slice(0, 32) + carimbo;

(async () => {
  const nota = entradaNfe.lerNotaDeEntrada(XML);
  check(nota.chave.length === 44, 'o XML de exemplo foi lido', `${nota.itens.length} itens, R$ ${nota.totais.nota}`);
  check(CHAVE.length === 44, 'a chave de prova tem 44 digitos', CHAVE);

  // Produto real: o item tem FK para products(id). Sem nenhum produto no banco,
  // os checks de vinculo sao PULADOS -- nao inventados.
  const { data: produtos } = await supabase.from('products').select('id, name').limit(1);
  const produto = (produtos || [])[0] || null;

  let entradaId = '';

  try {
    console.log('\n--- 1. o INSERT passa: as colunas do codigo existem no banco ---');
    // Este e o check que a suite estatica nao alcanca. Nome de coluna errado
    // estoura AQUI, e o PostgREST diz qual.
    const gravada = await entradaNfeDb.criarEntrada({
      entrada: {
        chave: CHAVE,
        modelo: nota.modelo,
        serie: nota.serie,
        numero: nota.numero,
        dataEmissao: nota.dataEmissao,
        naturezaOperacao: nota.naturezaOperacao,
        emitenteDocumento: nota.emitente.documento,
        emitenteNome: 'PROVA DA ENTRADA DE NFE',
        emitenteIe: nota.emitente.inscricaoEstadual,
        cadastroId: '',
        destinatarioDocumento: nota.destinatario ? nota.destinatario.documento : '',
        valorProdutos: nota.totais.produtos,
        valorTotal: nota.totais.nota,
        status: 'LANCADA',
        movimentouEstoque: false,
        gerouFinanceiro: false,
        xml: XML,
        resumo: nota,
        criadoPor: null,
        criadoPorNome: 'prova-entrada-nfe'
      },
      itens: nota.itens.map((item, i) => ({
        numero: item.numero,
        codigo: item.codigo,
        ean: item.ean,
        descricao: item.descricao,
        ncm: item.ncm,
        cfop: item.cfop,
        unidade: item.unidade,
        quantidade: item.quantidade,
        // Centavo quebrado de proposito no primeiro item: e o caso que
        // numeric(15,2) arredondaria e numeric(15,10) guarda.
        valorUnitario: i === 0 ? 2.4987654321 : item.valorUnitario,
        valorTotal: item.valorTotal,
        produtoId: i === 0 && produto ? produto.id : '',
        vinculoOrigem: i === 0 && produto ? 'gtin' : '',
        movimentouEstoque: false,
        imposto: { icms: item.icms, ipi: item.ipi, pis: item.pis, cofins: item.cofins }
      }))
    });
    entradaId = gravada.id;
    check(Boolean(entradaId), 'a nota de prova foi gravada', entradaId);
    check(gravada.itens.length === nota.itens.length, 'os itens entraram junto', `${gravada.itens.length} item(ns)`);

    console.log('\n--- 2. a UNIQUE da chave e do BANCO, nao da tela ---');
    // A defesa que nao depende de ninguem lembrar de conferir antes.
    let erroDuplicidade = null;
    try {
      await entradaNfeDb.criarEntrada({
        entrada: {
          chave: CHAVE, emitenteDocumento: nota.emitente.documento,
          emitenteNome: 'PROVA DUPLICADA', xml: XML, resumo: {}, criadoPorNome: 'prova'
        },
        itens: []
      });
    } catch (erro) {
      erroDuplicidade = erro;
    }
    check(Boolean(erroDuplicidade), 'a segunda gravacao da mesma chave foi recusada');
    check(/j[aá] foi lan[cç]ada/i.test(erroDuplicidade ? erroDuplicidade.message : ''),
      '  e a mensagem diz o motivo em portugues', erroDuplicidade ? erroDuplicidade.message : '(nenhum erro)');
    check(erroDuplicidade && erroDuplicidade.status === 409, '  com status 409, nao 500',
      erroDuplicidade ? String(erroDuplicidade.status) : '-');
    // A cabeca da duplicata nao pode ter ficado no banco.
    const { data: repetidas } = await supabase.from('nfe_entrada').select('id').eq('chave', CHAVE);
    check((repetidas || []).length === 1, '  e sobrou uma linha so com essa chave', String((repetidas || []).length));

    console.log('\n--- 3. o CHECK do status recusa valor inventado ---');
    const statusInvalido = await supabase.from('nfe_entrada')
      .update({ status: 'CONFERIDA' }).eq('id', entradaId).select('id');
    check(Boolean(statusInvalido.error), 'status fora de LANCADA/REVISAR e recusado',
      statusInvalido.error ? statusInvalido.error.message.slice(0, 90) : 'PASSOU (o check nao existe)');

    console.log('\n--- 4. o que voltou do banco e o que foi gravado ---');
    const lida = await entradaNfeDb.obterEntrada(entradaId);
    check(Number(lida.valorTotal) === Number(nota.totais.nota), 'o total da nota voltou igual',
      `${lida.valorTotal} vs ${nota.totais.nota}`);
    const primeiro = lida.itens.find((i) => i.numero === nota.itens[0].numero);
    // numeric(15,10): o vUnCom com mais de dois decimais e comum em nota de
    // fornecedor (embalagem fracionada). Em numeric(15,2) viraria 2.50 e o
    // custo do produto entraria errado.
    check(Math.abs(primeiro.valorUnitario - 2.4987654321) < 1e-9,
      'o valor unitario guardou os 10 decimais', String(primeiro.valorUnitario));
    check(primeiro.imposto && typeof primeiro.imposto === 'object' && !Array.isArray(primeiro.imposto),
      'o imposto do item voltou objeto (jsonb), nao texto', typeof primeiro.imposto);
    check(Boolean(lida.resumo && lida.resumo.chave), 'o resumo da nota voltou objeto com a nota inteira',
      lida.resumo ? `chave ${String(lida.resumo.chave).slice(0, 8)}...` : 'vazio');
    check(lida.itens[0].numero <= lida.itens[lida.itens.length - 1].numero,
      'os itens vieram na ordem do numero');

    console.log('\n--- 5. a listagem NAO carrega o XML ---');
    // 200 KB por nota vezes a lista inteira: e a diferenca entre abrir a tela e
    // esperar por ela.
    const lista = await entradaNfeDb.listarEntradas({ limite: 5 });
    const naLista = lista.find((e) => e.id === entradaId);
    check(Boolean(naLista), 'a nota de prova aparece na listagem');
    check(naLista && !('xml' in naLista) && !naLista.xml, '  e nenhuma linha traz a coluna xml');
    const comXml = await entradaNfeDb.obterXml(entradaId);
    check(Boolean(comXml && comXml.xml && comXml.xml.length > 100), '  o XML sai so por obterXml',
      comXml ? `${comXml.xml.length} bytes` : 'vazio');
    check(comXml && comXml.chave === CHAVE, '  com a chave que da nome ao arquivo baixado');

    console.log('\n--- 6. o de-para aprende com a nota lancada ---');
    if (!produto) {
      console.log('  -- pulado: nao ha nenhum produto cadastrado para vincular');
    } else {
      const vinculos = await entradaNfeDb.vinculosDoFornecedor(nota.emitente.documento);
      const codigo = nota.itens[0].codigo;
      check(vinculos[codigo] === produto.id, `o codigo ${codigo} do fornecedor reencontra o produto`,
        vinculos[codigo] || '(nada)');
      // Item sem product_id nao pode virar sugestao: sugerir null apagaria o
      // vinculo bom na proxima nota.
      const codigoSemVinculo = nota.itens[1] ? nota.itens[1].codigo : '';
      check(!codigoSemVinculo || !(codigoSemVinculo in vinculos),
        '  e o item sem vinculo nao entra no de-para', codigoSemVinculo || '(so um item)');
    }

    console.log('\n--- 7. a chave e a defesa contra lancar duas vezes ---');
    const achada = await entradaNfeDb.buscarPorChave(CHAVE);
    check(Boolean(achada && achada.id === entradaId), 'buscarPorChave encontra a nota ja lancada');
    check((await entradaNfeDb.buscarPorChave('123')) === null, '  e ignora chave com tamanho errado');
  } finally {
    console.log('\n--- 8. limpeza (e a prova do on delete cascade) ---');
    if (entradaId) {
      const { error } = await supabase.from('nfe_entrada').delete().eq('id', entradaId);
      check(!error, 'a nota de prova foi removida do banco', error ? error.message : entradaId);
      const { data: orfaos } = await supabase.from('nfe_entrada_item')
        .select('id').eq('entrada_id', entradaId);
      // Sem o cascade, os itens ficariam apontando para uma entrada que nao
      // existe -- e o proximo relatorio de credito somaria imposto fantasma.
      check((orfaos || []).length === 0, '  e os itens foram junto (on delete cascade)',
        `${(orfaos || []).length} orfao(s)`);
    } else {
      console.log('  -- nada gravado, nada a limpar');
    }
  }

  console.log(`\n===== ${falhas === 0 ? 'A ENTRADA DE NF-e ESTA DE PE NO BANCO' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})().catch((erro) => {
  console.error('\nXX  a prova parou no meio:', erro.message);
  console.error('    A nota de prova pode ter ficado no banco. Chave:', CHAVE);
  process.exit(1);
});
