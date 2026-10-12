#!/usr/bin/env node
// NOTAS CONTRA O CNPJ — OS CAMINHOS DA FOCUS (12/10/2026).
//
// O defeito que isto guarda: a busca chamava GET /dfe?cnpj&nsu e a manifestação
// POST /manifesto — caminhos que NÃO EXISTEM na Focus. O GET dava 404, lido
// como "nenhum documento": a tela buscava e voltava vazia, com 1.063 notas só
// da matriz em GET /nfes_recebidas (conferido contra a produção, só leitura).
//
// Os caminhos, da documentação (doc.focusnfe.com.br/reference/...):
//   GET  /nfes_recebidas?cnpj=&versao=      (consultar_nfes_recebidas)
//   GET  /nfes_recebidas/{chave}.json       (consultar_nfe_recebida_individual)
//   GET  /nfes_recebidas/{chave}.xml        (consultar_nfe_recebida_individual_xml)
//   POST /nfes_recebidas/{chave}/manifesto  (manifestar_nfe_recebida)
//
// SEM REDE: o fetch é falso e registra cada chamada.
'use strict';
const focus = require('../lib/focusnfe');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const CREDS = { token: 't', ambiente: 'homologacao' };
const CNPJ = '43792899000135';
const chave = (n) => ('4226' + String(n).padStart(40, '0')).slice(0, 44);

let chamadas = [];
function fetchFalso(respostas) {
  chamadas = [];
  global.fetch = async (url, opcoes = {}) => {
    const caminho = String(url).replace(/^https:\/\/[^/]+/, '');
    chamadas.push({ metodo: opcoes.method || 'GET', caminho, corpo: opcoes.body ? JSON.parse(opcoes.body) : null });
    const r = respostas(caminho, chamadas.length);
    const corpo = typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo);
    const status = r.status || 200;
    return { ok: status < 400, status, text: async () => corpo, arrayBuffer: async () => Buffer.from(corpo) };
  };
}
const nota = (n, extra = {}) => ({ chave_nfe: chave(n), versao: n, nome_emitente: 'FORNECEDOR', documento_emitente: '11222333000181', valor_total: '99.90', data_emissao: '2026-10-01T10:00:00-03:00', situacao: 'autorizada', nfe_completa: false, ...extra });

(async () => {
  console.log('\n--- 1. a busca usa GET /nfes_recebidas e pagina por versão ---');
  fetchFalso((caminho, n) => ({ corpo: n === 1 ? Array.from({ length: 100 }, (_, i) => nota(i + 1)) : n === 2 ? Array.from({ length: 40 }, (_, i) => nota(101 + i)) : [] }));
  const r = await focus.distribuicaoDfe({ cnpj: CNPJ, modo: 'ultimo-nsu', nsu: 0 }, CREDS);
  check('o caminho é /v2/nfes_recebidas com cnpj e versao', chamadas[0].caminho === `/v2/nfes_recebidas?cnpj=${CNPJ}&versao=0`, chamadas[0].caminho);
  check('página cheia (100) pede a próxima a partir da maior versão', chamadas.length === 2 && chamadas[1].caminho.endsWith('versao=100'), chamadas.map((c) => c.caminho.replace(/.*versao=/, '')).join(','));
  check('todas as notas das páginas voltam', r.documentos.length === 140);
  check('a versão vira o "NSU" da nota', r.documentos[0].nsu === 1 && r.documentos[139].nsu === 140);
  check('maxNsu = a maior versão lida (página incompleta: acabou)', r.maxNsu === 140, r.maxNsu);
  check('emitente, valor e data saem dos nomes da Focus', r.documentos[0].emitenteNome === 'FORNECEDOR' && r.documentos[0].valorTotal === 99.9 && r.documentos[0].emitenteDocumento === '11222333000181');
  check('nunca mais o caminho antigo /dfe', !chamadas.some((c) => /\/dfe\b/.test(c.caminho)));

  // A lista é o HISTÓRICO: a mesma chave volta a cada versão (na matriz, 1.063
  // versões de 529 notas). Fica uma por nota, a mais recente.
  fetchFalso(() => ({ corpo: [nota(1), nota(2), { ...nota(3), chave_nfe: chave(1), nfe_completa: true, situacao: 'cancelada' }] }));
  const hist = await focus.distribuicaoDfe({ cnpj: CNPJ, modo: 'ultimo-nsu', nsu: 0 }, CREDS);
  check('mesma chave em várias versões = uma nota, a mais recente', hist.documentos.length === 2
    && hist.documentos.find((d) => d.chave === chave(1)).nsu === 3 && hist.documentos.find((d) => d.chave === chave(1)).bruto.situacao === 'cancelada');
  check('  e o ponteiro vai até a maior versão lida', hist.maxNsu === 3);

  fetchFalso(() => ({ status: 404, corpo: { mensagem: 'Nenhum documento' } }));
  const vazio = await focus.distribuicaoDfe({ cnpj: CNPJ, modo: 'ultimo-nsu', nsu: 4317 }, CREDS);
  check('nada novo (404) é lista vazia, e o ponteiro não volta', vazio.documentos.length === 0 && vazio.maxNsu === 4317);

  console.log('\n--- 2. a busca por chave e o XML ---');
  fetchFalso((caminho) => (caminho.endsWith('.json')
    ? { corpo: nota(7, { nfe_completa: true }) }
    : { corpo: '<?xml version="1.0"?><nfeProc>…</nfeProc>' }));
  const porChave = await focus.distribuicaoDfe({ cnpj: CNPJ, modo: 'chave', chave: chave(7) }, CREDS);
  check('consulta a nota em /v2/nfes_recebidas/{chave}.json', chamadas[0].caminho === `/v2/nfes_recebidas/${chave(7)}.json`, chamadas[0].caminho);
  check('nota completa: baixa o XML em /v2/nfes_recebidas/{chave}.xml', chamadas[1] && chamadas[1].caminho === `/v2/nfes_recebidas/${chave(7)}.xml`);
  check('  e o documento vira completo, com o XML', porChave.documentos[0].tipoDocumento === 'completo' && porChave.documentos[0].xml.startsWith('<?xml'));
  fetchFalso(() => ({ corpo: nota(8, { nfe_completa: false }) }));
  const resumo = await focus.distribuicaoDfe({ cnpj: CNPJ, modo: 'chave', chave: chave(8) }, CREDS);
  check('nota sem XML completo fica resumo, sem tentar baixar', resumo.documentos[0].tipoDocumento === 'resumo' && chamadas.length === 1);

  console.log('\n--- 3. a manifestação ---');
  fetchFalso(() => ({ corpo: { status: 'processado', status_sefaz: '135', protocolo: '1' } }));
  await focus.manifestarNfe({ chave: chave(9), codigo: '210210' }, CREDS);
  check('POST /v2/nfes_recebidas/{chave}/manifesto', chamadas[0].metodo === 'POST' && chamadas[0].caminho === `/v2/nfes_recebidas/${chave(9)}/manifesto`, chamadas[0].caminho);
  check('ciência (210210) vai como tipo "ciencia"', chamadas[0].corpo && chamadas[0].corpo.tipo === 'ciencia' && !('tipo_evento' in chamadas[0].corpo));
  const tipos = {};
  for (const codigo of ['210200', '210220', '210240']) {
    fetchFalso(() => ({ corpo: {} }));
    await focus.manifestarNfe({ chave: chave(9), codigo, justificativa: 'nao reconheco esta operacao' }, CREDS);
    tipos[codigo] = chamadas[0].corpo.tipo;
  }
  check('confirmação, desconhecimento e não realizada pelos nomes da Focus',
    tipos['210200'] === 'confirmacao' && tipos['210220'] === 'desconhecimento' && tipos['210240'] === 'nao_realizada', JSON.stringify(tipos));
  let recusou = false;
  try { await focus.manifestarNfe({ chave: chave(9), codigo: '999999' }, CREDS); } catch (e) { recusou = /desconhecido/.test(e.message); }
  check('evento desconhecido é recusado antes de ir à Focus', recusou);

  console.log('\n--- 4. o aviso automático (webhook) continua sem NSU ---');
  check('versao no aviso não vira NSU (a varredura é que grava)', focus.normalizarMdeAutomacao(nota(5)).documento.nsu === 0);

  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
