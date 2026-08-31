#!/usr/bin/env node
// A lista de NF-e passou a mostrar as duas origens.
//
// O QUE ISTO GUARDA
// -----------------
// Existiam duas NF-e no sistema que não se falavam: `nfes` (registro manual do
// Financeiro) e `nfe` (a nota transmitida à SEFAZ pela Focus). A tela "NF-e
// Emitidas" lia só a primeira — quem emitisse pela Focus não veria a nota no
// lugar onde qualquer pessoa vai procurar, e NADA acusava o erro.
//
// E um defeito latente que a unificação tornaria grave: normalizeNfeStatus
// devolvia 'autorizada' para qualquer status desconhecido. Uma nota fiscal com
// ERRO da SEFAZ apareceria na tela como autorizada, com botão de cancelar.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

const serverSrc = ler('server.js');
const telaSrc = ler('public/modules/finance/subs/nfe_emitidas.js');
const dbSrc = ler('lib/db/fiscal.js');
const migracao = ler('banco/migrations/fase-aa-nfe-lista-unificada.sql');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// Isola as funções puras do server.js — não dá para carregar o server inteiro
// (abre porta, exige env), mas estas não dependem de nada externo.
function carregar(nomes) {
  let corpo = '';
  for (const nome of nomes) {
    const marca = serverSrc.indexOf(`function ${nome}(`);
    // Fecha na primeira chave em coluna zero depois do início.
    const fim = serverSrc.indexOf('\n}\n', marca);
    corpo += serverSrc.slice(marca, fim + 3) + '\n';
  }
  const constMarca = serverSrc.indexOf('const NFE_STATUS_FISCAL = {');
  corpo = serverSrc.slice(constMarca, serverSrc.indexOf('\n};', constMarca) + 3) + '\n' + corpo;
  return new Function(`${corpo}\nreturn { ${nomes.join(', ')}, NFE_STATUS_FISCAL };`)();
}
const S = carregar(['normalizeNfeStatus', 'fiscalNfeParaLista']);

console.log('--- status desconhecido NUNCA vira "autorizada" ---');
// O default antigo fazia exatamente isso. Uma nota rejeitada pela SEFAZ com
// rótulo de autorizada é o pior desfecho possível: ninguém vai reemitir.
['', null, undefined, 'coisa_estranha', 'XPTO', '???'].forEach((entrada) => {
  const saida = S.normalizeNfeStatus(entrada);
  check(`"${entrada}" não vira autorizada`, saida !== 'autorizada', saida);
});

console.log('\n--- os dois vocabulários chegam ao mesmo lugar ---');
const MAPA = {
  // vindos da SEFAZ (maiúsculas)
  AUTORIZADO: 'autorizada', CANCELADO: 'cancelada', DENEGADO: 'denegada',
  ERRO: 'erro', RASCUNHO: 'rascunho', PROCESSANDO: 'processando', INUTILIZADO: 'inutilizada',
  // vindos do registro manual (minúsculas)
  emitida: 'autorizada', autorizada: 'autorizada', cancelada: 'cancelada',
  denegada: 'denegada', rejeitada: 'rejeitada', pendente: 'pendente'
};
Object.entries(MAPA).forEach(([entrada, esperado]) => {
  check(`${entrada} -> ${esperado}`, S.normalizeNfeStatus(entrada) === esperado, S.normalizeNfeStatus(entrada));
});
// Idempotência: a rota normaliza na montagem da lista e o filtro normaliza de
// novo. Se não fosse idempotente, filtrar por status perderia linhas.
Object.values(MAPA).forEach((normalizado) => {
  check(`  ${normalizado} normalizado duas vezes é o mesmo`, S.normalizeNfeStatus(normalizado) === normalizado);
});

console.log('\n--- a tela conhece todo status que o servidor produz ---');
// Um status sem entrada em NFE_STATUS_META apareceria cru na tela.
const produzidos = new Set(Object.values(MAPA));
const meta = telaSrc.slice(telaSrc.indexOf('const NFE_STATUS_META'), telaSrc.indexOf('function nfeStatusBadge'));
produzidos.forEach((st) => check(`  ${st} tem rótulo na tela`, new RegExp(`\\b${st}:`).test(meta)));

console.log('\n--- a nota fiscal vira uma linha da lista ---');
const fiscal = {
  id: 'uuid-1', numero: 168, serie: 1, dataEmissao: '2026-08-10T10:00:00-03:00',
  status: 'AUTORIZADO', chaveAcesso: '4'.repeat(44), valorTotal: 1250.5,
  destinatarioNome: 'Cliente Real Ltda', destinatarioDocumento: '12345678000199',
  orderId: 'ord-9', referencia: 'nfe_abc', urlXml: '/x.xml', urlDanfe: '/d.pdf'
};
const linha = S.fiscalNfeParaLista(fiscal);
check('marcada como origem fiscal', linha.origem === 'fiscal');
check('status traduzido', linha.status === 'autorizada', linha.status);
check('status bruto preservado para a ação de consulta', linha.statusFiscal === 'AUTORIZADO');
check('data só com o dia', linha.date === '2026-08-10', linha.date);
check('valor numérico', linha.amount === 1250.5);
check('chave de acesso', linha.key.length === 44);
// O nome REAL, não o que foi para a SEFAZ: em homologação o enviado é o texto
// fixo exigido por ela, e a lista mostraria a mesma frase em toda linha.
check('cliente é o nome real', linha.customer === 'Cliente Real Ltda');
check('vínculo com a venda preservado', linha.orderId === 'ord-9');
// A tela chama nfe.financialEntries.length sem checar existência.
check('financialEntries existe (a tela usa .length)', Array.isArray(linha.financialEntries));
check('items existe', Array.isArray(linha.items));

console.log('\n--- a rota mostra as duas origens ---');
const rota = serverSrc.slice(serverSrc.indexOf("pathname === '/api/finance/nfe' && req.method === 'GET'"));
const corpoRota = rota.slice(0, rota.indexOf("pathname === '/api/finance/nfe' && req.method === 'POST'"));
check('busca as notas fiscais', /fiscalDb\.getNfeRecords\(\)/.test(corpoRota));
check('converte para o formato da lista', /\.map\(fiscalNfeParaLista\)/.test(corpoRota));
check('mantém as manuais', /data\.nfes \|\| \[\]/.test(corpoRota));
check('marca a origem das manuais', /origem: 'financeiro'/.test(corpoRota));
// Se a tabela fiscal falhar (migração pendente), a tela não pode deixar de abrir.
check('degrada se a tabela fiscal falhar', /catch \(erroFiscal\)/.test(corpoRota));

console.log('\n--- o destinatário real é gravado na emissão ---');
// Sem isto a coluna existe e fica sempre vazia — e a lista não teria cliente.
check('nome do destinatário gravado', /destinatarioNome: destinatario\.nome/.test(serverSrc));
check('documento gravado só com dígitos', /destinatarioDocumento: String\(destinatario\.documento \|\| ''\)\.replace/.test(serverSrc));
check('pedido de origem gravado', /orderId: body\.orderId \|\| body\.saleId/.test(serverSrc));
check('a camada de banco persiste os três', /destinatario_nome: payload\.destinatarioNome/.test(dbSrc)
  && /destinatario_documento: payload\.destinatarioDocumento/.test(dbSrc)
  && /order_id: payload\.orderId/.test(dbSrc));
check('e os relê', /destinatarioNome: row\.destinatario_nome/.test(dbSrc));

console.log('\n--- a migração cria o que o código usa ---');
['destinatario_nome', 'destinatario_documento', 'order_id'].forEach((col) => {
  check(`coluna ${col}`, new RegExp(`add column if not exists ${col}`).test(migracao));
});
check('idempotente', (migracao.match(/if not exists/g) || []).length >= 5);
// Sem FK de propósito: documento fiscal não pode ser afetado pelo ciclo de
// vida do pedido — ele só se cancela, jamais se exclui.
check('order_id sem FK para pedidos', !/order_id text references/.test(migracao));
check('e a migração explica por quê', /Sem FK de propósito/.test(migracao));

console.log('\n--- a tela sabe distinguir as duas ---');
check('cancelar escolhe a rota pela origem', /const ehFiscal = nota \? nota\.origem === 'fiscal' : false/.test(telaSrc));
check('cancelamento fiscal exige justificativa', /justificativa/.test(telaSrc) && /15 caracteres/.test(telaSrc));
check('o modal fiscal lê os itens do payload enviado', /payload\.items \|\| \[\]/.test(telaSrc));
check('e usa o nome real, não o enviado à SEFAZ', /O nome REAL, não o que foi para a SEFAZ/.test(telaSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
