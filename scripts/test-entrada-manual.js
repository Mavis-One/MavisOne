#!/usr/bin/env node
/**
 * A NOTA DE ENTRADA DIGITADA À MÃO (14/10/2026).
 *
 * Pedido do usuário: botão e tela dentro de Compras › Notas de Entrada para
 * lançar a NF-e sem XML. Provado no navegador e pela API (servidor local):
 * chave de teste válida -> fornecedor achado pelo CNPJ; 2 × R$ 40 + frete R$ 10
 * -> nota LANCADA de R$ 90, estoque +2, custo 40, conta a pagar de R$ 90; a
 * mesma chave de novo -> 409 "já foi lançada"; o XML dela -> 404 explicando.
 * Tudo desfeito depois (produto de volta a saldo 0 e custo 36,99).
 * As 529 chaves reais do banco passaram no dígito verificador.
 */
const fs = require('fs');
const path = require('path');
const M = require('../lib/entrada-manual');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

console.log('--- 1. a chave de acesso ---');
const real = M.lerChave('3526 1005 8246 3100 0149 5500 2000 2917 3313 5316 5012');
check('chave real (com espaços) é lida', !real.erro && real.documentoEmitente === '05824631000149' && real.serie === '2' && real.numero === '291733', JSON.stringify(real));
check('um dígito trocado é recusado', /não confere/.test(M.lerChave('35261005824631000149550020002917331353165013').erro || ''));
check('menos de 44 dígitos é recusado', /44 dígitos/.test(M.lerChave('123').erro || ''));

console.log('\n--- 2. a nota montada ---');
const base = '4226105381283100012455001000999999112345678';
const chave = base + M.digitoDaChave(base);
const produto = { id: 'p1', name: 'SENSOR 2', sku: '11845', ncm: '85365090', unidadeComercial: 'UN' };
const produtosPorId = new Map([['p1', produto]]);
const fornecedor = { name: 'SAL INFINITY BY BLUMENAU LTDA', document: '53.812.831/0001-24' };
const corpo = { chave, dataEmissao: '2026-10-14', itens: [{ produtoId: 'p1', quantidade: 2, valorUnitario: 40 }], frete: 10 };
const nota = M.montarNotaManual(corpo, { fornecedor, produtosPorId });
check('totais: produtos 80, nota 90', nota.totais.produtos === 80 && nota.totais.nota === 90);
check('emitente, série e número saem da chave', nota.emitente.documento === '53812831000124' && nota.serie === '1' && nota.numero === '999999');
check('o item leva o produto escolhido', nota.itens[0].produtoIdEscolhido === 'p1' && nota.itens[0].valorTotal === 80);
const recusa = (c, extra) => { try { M.montarNotaManual({ ...corpo, ...c }, { fornecedor, produtosPorId, ...extra }); return ''; } catch (e) { return e.message; } };
check('fornecedor de outro CNPJ é recusado', /outro documento/.test(recusa({}, { fornecedor: { name: 'X', document: '11222333000181' } })));
check('sem data é recusado', /data de emissão/.test(recusa({ dataEmissao: '' })));
check('sem itens é recusado', /ao menos um item/.test(recusa({ itens: [] })));
check('parcelas que não fecham são recusadas', /têm de fechar/.test(recusa({ duplicatas: [{ vencimento: '2026-11-14', valor: 50 }] })));
check('  e as que fecham passam', recusa({ duplicatas: [{ vencimento: '2026-11-14', valor: 45 }, { vencimento: '2026-12-14', valor: 45 }] }) === '');

console.log('\n--- 3. o mesmo caminho da nota com XML ---');
const servidor = ler('server.js');
check('uma função só lança as duas', servidor.includes('async function lancarEntradaConferida(res, { conferencia, data, produtos, body, user, xml }) {')
  && servidor.includes('return await lancarEntradaConferida(res, { conferencia, data, produtos, body, user, xml: body.xml });')
  && servidor.includes("return await lancarEntradaConferida(res, { conferencia, data, produtos, body: corpo, user, xml: '' });"));
check('a manual passa pela mesma conferência (duplicidade, nota própria)', servidor.includes('await conferirNotaDeEntrada(nota, { data, produtos: produtosDoCatalogo });'));
check('a consulta da chave vem antes da rota genérica por id',
  servidor.indexOf("pathname === '/api/purchases/entrada-nfe/manual/chave'") < servidor.indexOf("if (pathname.startsWith('/api/purchases/entrada-nfe/') && req.method === 'GET')"));
check('XML de nota manual: avisa que não há', servidor.includes('Esta nota foi lançada à mão, a partir da DANFE: não há XML dela no sistema.'));

console.log('\n--- 4. telas ---');
check('botão nas Notas de Entrada', ler('public/modules/purchases/subs/entrada_nfe.js').includes('id="entradaManual">Lançar nota sem XML</button>'));
check('tela própria, registrada e com nome', ler('public/index.html').includes('/modules/purchases/subs/entrada_nfe_manual.js')
  && ler('public/app.js').includes("? 'Nota de Entrada Manual'")
  && ler('public/modules/purchases/subs/entrada_nfe_manual.js').includes("api('/api/purchases/entrada-nfe/manual', {"));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
