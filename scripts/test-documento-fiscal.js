#!/usr/bin/env node
// A CAMADA DE DOCUMENTO FISCAL: o contrato e as travas (fase DK).
//
// O QUE ESTE TESTE EXISTE PARA PEGAR
// ----------------------------------
// A fase DK removeu `nfes` e `nfe_items` do banco e pos o registro manual em
// `fiscal_documentos`. A aposta toda foi que O CONTRATO NAO MUDA: `getNfes()`
// continua devolvendo objetos com as mesmas 24 chaves, e a tela "NF-e
// Emitidas", a emissao manual e o cancelamento continuam sem saber de nada.
//
// Uma chave que desapareca desse objeto NAO QUEBRA NADA que se veja. Ela vira
// `undefined`, o campo aparece vazio na tela, e ninguem liga a causa ao efeito
// — e o dano chega ao dia em que alguem precisar do valor. E o mesmo tipo de
// defeito que a fase DJ documenta em `numero_fci`.
//
// Entao a lista de chaves esta escrita aqui, copiada do `mapNfeRow` de
// lib/db/financeiro.js ANTES de ele ser removido, e o teste monta um documento
// sintetico e cobra as chaves uma por uma. Sem banco: `comoNfe` e' funcao pura.
//
// E O SEGUNDO ASSUNTO: OS TRES CAMINHOS QUE INVENTAVAM NUMERO DE NOTA.
// Antes desta fase, os tres caminhos que gravavam documento fiscal fabricavam o
// numero quando ele nao vinha, cada um de um jeito:
//
//     importacao de planilha .... createId('nfe-num')
//     rota de venda tipo NF-e .... createId('nfe-num')
//     emissao manual ............. String(Date.now()).slice(-8)
//
// Numero de nota nao se deduz: e atribuido pelo emitente e entra na chave de
// acesso. Os tres viraram recusa, e este teste cobra que continuem recusa.
//
// O QUE ESTE TESTE NAO ALCANCA
// ----------------------------
// As travas do banco (numero repetido, chave repetida, origem x ponteiro,
// `on delete restrict`) e a transacao. Isso e
// `scripts/prova-documento-fiscal.js`, que precisa do banco.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const fiscal = require('../lib/db/fiscal-documentos.js');
const sql = ler('banco/migrations/fase-dk-documento-fiscal.sql');
const semComentario = sql.replace(/--[^\n]*/g, '');
const servidor = ler('server.js');

// ---------------------------------------------------------------------------
console.log('--- o CONTRATO de `nfes`, preservado chave por chave ---');

// Copiado de mapNfeRow / mapNfeItemRow de lib/db/financeiro.js antes de saírem.
const CHAVES_NFE = [
  'id', 'number', 'series', 'date', 'status', 'key', 'amount', 'customer',
  'clientSupplierId', 'clientDocument', 'clientAddress', 'clientCity',
  'clientState', 'clientStateRegistration', 'taxNotes', 'paymentType',
  'installmentsCount', 'installmentIntervalDays', 'orderId', 'createdBy',
  'createdByName', 'createdAt', 'updatedAt', 'items'
];
const CHAVES_ITEM = ['id', 'code', 'description', 'quantity', 'unitPrice', 'total', 'cfop', 'ncm'];

// Um documento sintético com TODO campo preenchido. Preenchido de propósito:
// `comoNfe` usa `|| ''` em vários campos, e um documento vazio não distinguiria
// "a chave não existe" de "a chave existe e o valor é vazio".
const docSintetico = {
  id: 'doc-1', numero: '123', serie: '1', dataEmissao: '2026-09-01',
  situacao: 'REGULAR', chaveAcesso: 'x'.repeat(44), valorTotal: 10,
  observacaoFiscal: 'obs', parcelasQuantidade: 2, parcelasIntervaloDias: 30,
  orderId: 'ord-1', criadoPor: 'u1', criadoPorNome: 'U',
  criadoEm: 'a', atualizadoEm: 'b',
  participante: {
    nome: 'Cliente', personId: 'p1', documento: '11222333000181',
    logradouro: 'Rua', municipio: 'Joinville', uf: 'SC', inscricaoEstadual: 'ie'
  },
  itens: [{
    id: 'i1', codigoItem: 'SKU', descricao: 'Item', quantidade: 1,
    valorUnitario: 10, valorTotal: 10, cfop: '5102', ncm: '73181500'
  }]
};

const comoNfe = fiscal.comoNfe(docSintetico);
const faltando = CHAVES_NFE.filter((k) => !(k in comoNfe));
const sobrando = Object.keys(comoNfe).filter((k) => !CHAVES_NFE.includes(k));
check('nenhuma das 24 chaves do contrato faltando', faltando.length === 0, faltando.join(', ') || 'nenhuma');
check('e nenhuma chave a mais', sobrando.length === 0, sobrando.join(', ') || 'nenhuma');
check('  sao 24', CHAVES_NFE.length === 24, String(CHAVES_NFE.length));

const item = comoNfe.items[0];
const faltaItem = CHAVES_ITEM.filter((k) => !(k in item));
const sobraItem = Object.keys(item).filter((k) => !CHAVES_ITEM.includes(k));
check('nenhuma das 8 chaves de item faltando', faltaItem.length === 0, faltaItem.join(', ') || 'nenhuma');
check('e nenhuma a mais', sobraItem.length === 0, sobraItem.join(', ') || 'nenhuma');

// Nenhuma chave pode sair `undefined`: o contrato antigo usava `|| ''` em quase
// todo campo texto, e `undefined` numa template string escreve "undefined".
const indefinidas = CHAVES_NFE.filter((k) => comoNfe[k] === undefined);
check('e nenhuma volta undefined', indefinidas.length === 0, indefinidas.join(', ') || 'nenhuma');

// O `customer` vem do NOME DO PARTICIPANTE, e não de uma coluna do documento.
// Se alguém trocar a origem, a lista de NF-e fica com a coluna Cliente vazia.
check('customer sai do nome do participante', comoNfe.customer === 'Cliente', comoNfe.customer);
check('clientDocument sai do documento do participante', comoNfe.clientDocument === '11222333000181');
// `paymentType` é DERIVADO de parcelas > 1, e não guardado: guardar os dois
// deixaria "avista com 3 parcelas" ser representável.
check('paymentType e derivado de parcelas > 1', comoNfe.paymentType === 'parcelado', comoNfe.paymentType);
check('  e avista quando e uma parcela',
  fiscal.comoNfe({ ...docSintetico, parcelasQuantidade: 1 }).paymentType === 'avista');

// ---------------------------------------------------------------------------
console.log('\n--- o vocabulario de situacao x status vai e volta ---');

for (const status of Object.keys(fiscal.STATUS_PARA_SITUACAO)) {
  const volta = fiscal.statusDaSituacao(fiscal.situacaoDoStatus(status));
  check(`  ${status} -> ${fiscal.situacaoDoStatus(status)} -> ${volta}`, volta === status);
}
check('vazio vira REGULAR (o padrao de quem nao informa)', fiscal.situacaoDoStatus('') === 'REGULAR');
check('  e REGULAR volta como "autorizada"', fiscal.statusDaSituacao('REGULAR') === 'autorizada');

// A situação que a tela não conhece volta CRUA, e não como "autorizada".
// Mapear o desconhecido para autorizada mostraria como autorizada uma nota que
// o banco chama de outra coisa.
check('situacao desconhecida volta crua, e nao como autorizada',
  fiscal.statusDaSituacao('SEI_LA') === 'sei_la', fiscal.statusDaSituacao('SEI_LA'));

// Toda situação do CHECK da tabela tem tradução: uma que falte apareceria na
// tela como rótulo em maiúscula e sublinhado.
const doCheck = (semComentario.match(/situacao in \(([\s\S]*?)\)/) || [, ''])[1]
  .split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
const semTraducao = doCheck.filter((s) => !fiscal.SITUACAO_PARA_STATUS[s]);
check('toda situacao do CHECK tem traducao para a tela',
  doCheck.length > 5 && semTraducao.length === 0,
  semTraducao.join(', ') || `${doCheck.length} situacoes`);

let recusou = false;
try { fiscal.situacaoDoStatus('emitida'); } catch (e) { recusou = e.status === 400; }
check('"emitida" (o que a importacao gravava) e RECUSADO com 400', recusou);

console.log('\n--- o tipo do documento sai do TAMANHO ---');
check('14 digitos = CNPJ', fiscal.tipoDoDocumento('11.222.333/0001-81').tipo === 'CNPJ');
check('11 digitos = CPF', fiscal.tipoDoDocumento('529.982.247-25').tipo === 'CPF');
check('nada = NENHUM, com documento nulo',
  fiscal.tipoDoDocumento('').tipo === 'NENHUM' && fiscal.tipoDoDocumento('').documento === null);
check('  e o documento volta so com digitos',
  fiscal.tipoDoDocumento('11.222.333/0001-81').documento === '11222333000181');

// ---------------------------------------------------------------------------
console.log('\n--- NENHUM caminho inventa numero de nota (a decisao de 29/09) ---');

// As ocorrências em COMENTÁRIO ficam, e devem ficar: elas são o registro de
// que o número era inventado, e é isso que explica por que a rota hoje recusa.
// A contagem também é feita sobre o fonte sem comentário — contá-la no fonte
// cheio imprimiria "4 ocorrências" ao lado de um check verde.
const servidorSemComentario = servidor.replace(/\/\/[^\n]*/g, '');
check('createId("nfe-num") nao aparece mais em codigo nenhum',
  !/createId\('nfe-num'\)/.test(servidorSemComentario),
  (servidorSemComentario.match(/createId\('nfe-num'\)/g) || []).length + ' em codigo, '
  + (servidor.match(/createId\('nfe-num'\)/g) || []).length + ' contando os comentarios que explicam');
check('String(Date.now()).slice(-8) nao e mais numero de nota',
  !/number: String\(Date\.now\(\)\)/.test(servidor));
// Três recusas: a da importação (por linha) e as duas de rota (400 na hora).
const recusas = (servidor.match(/Documento fiscal não se (cria|importa) sem o número/g) || []).length;
check('as tres recusas estao escritas', recusas === 3, `${recusas} de 3`);
check('a importacao devolve `recusadas` na resposta',
  /recusadas,\s*\n\s*recusadasCount: recusadas\.length/.test(servidor));
check('  e conta no log de importacao o que ENTROU',
  /addImportLog\(\{ type, source: body\.source \|\| 'manual', count: created\.length \}\)/.test(servidor));
check('  e uma linha ruim nao derruba as outras (catch por linha)',
  /recusadas\.push\(\{ linha: numeroDaLinha, motivo \}\)/.test(servidor));
check('a tela mostra as recusas em vez de recarregar',
  /linha\(s\) não importada\(s\)/.test(ler('public/app.js')));

// ---------------------------------------------------------------------------
console.log('\n--- ninguem mais fala com as tabelas mortas ---');

const FONTES = ['server.js', 'lib/db/financeiro.js', 'lib/db/fiscal-documentos.js', 'lib/db/dfe.js'];
for (const rel of FONTES) {
  const fonte = ler(rel).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const usos = (fonte.match(/from\('nfes'\)|from\('nfe_items'\)|from nfes\b|from nfe_items\b/g) || []);
  check(`  ${rel}`, usos.length === 0, usos.join(', ') || 'nenhuma referencia');
}
check('a migracao derruba as duas, na ordem (filha antes da mae)',
  semComentario.indexOf('drop table if exists nfe_items') < semComentario.indexOf('drop table if exists nfes')
  && /drop table if exists nfes/.test(semComentario));
check('  e sem `cascade`, que derrubaria o que ele nao conhece',
  !/drop table[^;]*cascade/i.test(semComentario));

// ---------------------------------------------------------------------------
console.log('\n--- as travas que o schema promete ---');

for (const tabela of ['fiscal_participantes', 'fiscal_documentos', 'fiscal_documento_itens', 'fiscal_item_tributos']) {
  check(`  RLS em ${tabela}`,
    new RegExp(`alter table if exists ${tabela} enable row level security`).test(semComentario));
}
// `on delete restrict` é a tranca ESTRUTURAL de "documento fiscal não se
// apaga": com cascade, um delete no documento levaria itens e imposto embora.
check('itens e tributos usam `on delete restrict`, e nao cascade',
  /references fiscal_documentos\(id\) on delete restrict/.test(semComentario) &&
  /references fiscal_documento_itens\(id\) on delete restrict/.test(semComentario) &&
  !/references fiscal_documento(s|_itens)\(id\) on delete cascade/.test(semComentario));
// COBRA O `add constraint`, E NAO O NOME.
//
// A primeira versao deste check era `/fiscal_documentos_ponteiro_check/`, e uma
// mutacao passou por ela: tirar o `add constraint` deixa o `drop constraint if
// exists` para tras, e o nome continua no arquivo. O teste lia o nome e dava
// verde sobre uma migracao que nao cria constraint nenhuma.
//
// Sem este CHECK, um documento com origem MANUAL apontando para uma `nfe` seria
// aceito — e a mesma nota estaria escriturada duas vezes, uma pela transmissao
// e outra pelo registro manual, sem nada denunciando.
check('origem e ponteiro tem de concordar (CHECK, e nao convencao)',
  /add constraint fiscal_documentos_ponteiro_check[\s\S]{0,400}?origem = 'EMISSAO'/.test(semComentario));
check('  e o CHECK cobre as quatro origens',
  ['EMISSAO', 'ENTRADA_XML', 'MANUAL', 'DFE'].every((o) => {
    const bloco = (semComentario.match(/add constraint fiscal_documentos_ponteiro_check[\s\S]{0,600}?\);/) || [''])[0];
    return bloco.includes(`'${o}'`);
  }));
check('chave de acesso e unica, por indice parcial',
  /unique index[^;]*fiscal_documentos \(chave_acesso\) where chave_acesso is not null/.test(semComentario));
// `coalesce` no empresa_id: em índice único, NULL não colide com NULL, e há 0
// empresas cadastradas — a trava não travaria nada justamente agora.
check('a trava de numeracao usa coalesce no empresa_id nulo',
  /idx_fiscal_documentos_numeracao[\s\S]{0,200}coalesce\(empresa_id::text/.test(semComentario));
check('um tributo aparece uma vez por item',
  /unique index[^;]*fiscal_item_tributos \(item_id, tributo\)/.test(semComentario));
check('o par (tipo_documento, documento) tem de concordar',
  /fiscal_participantes_documento_check/.test(semComentario) &&
  /\[0-9\]\{11\}/.test(semComentario) && /\[0-9\]\{14\}/.test(semComentario));

// ---------------------------------------------------------------------------
console.log('\n--- e a camada aceita rodar dentro de uma transacao ---');

const modulo = ler('lib/db/fiscal-documentos.js');
// Sem isto, a emissão pela Focus não pode gravar o documento fiscal na mesma
// transação da nota, e a prova desta fase não poderia desfazer o que escreveu.
check('criarDocumento aceita { cliente }', /async function criarDocumento\(payload, itens, opcoes = \{\}\)/.test(modulo));
check('  e usa a transacao do chamador quando ela existe',
  /return opcoes\.cliente \? corpo\(opcoes\.cliente\) : emTransacao\(corpo\)/.test(modulo));
// Uma conexão atende uma consulta por vez: `Promise.all` no mesmo cliente é
// deprecado no pg e sai no pg@9.
check('com transacao, as leituras vao em FILA (pg@9 recusa o paralelo)',
  /if \(cliente\) \{\s*\n\s*itens = await consultaDeItens\(\)/.test(modulo));
check('nenhuma funcao chama consultar() direto, furando a transacao',
  !/await consultar\(/.test(modulo));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
