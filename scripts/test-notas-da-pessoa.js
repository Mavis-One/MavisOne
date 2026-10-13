#!/usr/bin/env node
/**
 * A ABA NOTAS FISCAIS NO CADASTRO DA PESSOA (13/10/2026).
 *
 * Pedido do usuário: no cadastro de pessoas e empresas, as NF-e e NFC-e
 * emitidas naquele CPF/CNPJ, com botão de imprimir. Sem banco e sem
 * navegador: o filtro do servidor roda isolado, o resto é conferido pelo
 * fonte. Na tela de verdade (banco local): 21 notas do ISAAC RODRIGUES, e o
 * Imprimir abriu a nota sem enviar o formulário.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const servidor = ler('server.js');
const app = ler('public/app.js');

console.log('--- 1. o filtro por documento ---');
const fonte = (servidor.match(/function filterNfes[\s\S]*?\n\}/) || [''])[0];
check('filterNfes existe', fonte.length > 0);
// eslint-disable-next-line no-new-func
const filterNfes = new Function('sanitizeDigits', 'normalizeNfeStatus', `${fonte}; return filterNfes;`)(
  (v) => String(v || '').replace(/\D/g, ''), (s) => s);
const notas = [
  { id: 'a', clientDocument: '043.988.848-40', number: '1' },
  { id: 'b', clientDocument: '04398884840', number: '2' },
  { id: 'c', clientDocument: '104398884840', number: '3' },
  { id: 'd', clientDocument: '', number: '4' }
];
const q = (p) => new URLSearchParams(p);
const achou = filterNfes({}, q({ documento: '043.988.848-40' }), notas).map((n) => n.id).join(',');
check('acha com e sem máscara', achou === 'a,b', achou);
check('  e não o documento que só CONTÉM o pedido', !achou.includes('c'));
check('  nem a nota sem documento', !achou.includes('d'));
check('sem documento, a lista continua inteira', filterNfes({}, q({}), notas).length === 4);

console.log('\n--- 2. a aba no cadastro ---');
check('a aba só aparece na edição e com CPF/CNPJ',
  /\$\{isEditMode && sanitizeDigits\(peopleDraft\.document \|\| ''\) \? `<button type="button" class="cadastro-tab" data-tab="notas"/.test(app));
check('  com o painel dela', /data-tab-panel="notas" hidden>\s*<div id="peopleNotasFiscais"><\/div>/.test(app));
check('  e a lista só é buscada quando a aba abre', /if \(target === 'notas'\) carregarNotasDaPessoa\(\);/.test(app));
check('o módulo está na página, depois de nfe_emitidas.js (que tem o nfePrint)',
  /nfe_emitidas\.js"><\/script>[\s\S]{0,200}notas_da_pessoa\.js"><\/script>/.test(ler('public/index.html')));

console.log('\n--- 3. a lista e a impressão ---');
const modulo = ler('public/modules/shared/notas_da_pessoa.js');
check('pede a MESMA lista de NF-e Emitidas, filtrada pelo documento', /\/api\/finance\/nfe\?documento=\$\{encodeURIComponent\(documento\)\}/.test(modulo));
check('imprime pelo MESMO nfePrint da lista', /await nfePrint\(await notaParaImprimir\(nfe, api\), 'completo'\)/.test(modulo));
check('o botão é type="button" (dentro do formulário, não envia o cadastro)', /<button type="button" class="secondary finance-pill-sm" data-nota-imprimir/.test(modulo));

const janela = {};
vm.runInNewContext(modulo, { window: janela });
const { notaParaImprimir } = janela.MavisNotasDaPessoa;
(async () => {
  const pedidas = [];
  const api = async (rota) => { pedidas.push(rota); return { nfe: { items: [{ description: 'X' }] } }; };
  const fiscal = await notaParaImprimir({ id: 'f1', origem: 'fiscal', temDanfe: true }, api);
  check('nota da SEFAZ vai direto (a DANFE vem da rota fiscal)', fiscal.id === 'f1' && pedidas.length === 0);
  const importada = await notaParaImprimir({ id: 'i 1', origem: 'importada' }, api);
  check('importada busca os itens na rota dela', pedidas[0] === '/api/finance/nfe/importada/i%201' && importada.items.length === 1 && importada.origem === 'importada');
  const manual = await notaParaImprimir({ id: 'm1', origem: 'financeiro' }, api);
  check('manual busca na rota do Financeiro', pedidas[1] === '/api/finance/nfe/m1' && manual.origem === 'financeiro');

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHOU', e); process.exit(1); });
