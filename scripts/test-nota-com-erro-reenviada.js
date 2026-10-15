#!/usr/bin/env node
/**
 * A NOTA COM ERRO É REENVIADA NO MESMO REGISTRO (15/10/2026). Pedido do
 * usuário: "referente aos erros, quero que você não duplique as NF, só mude o
 * status da mesma nota que está errônea".
 *
 * Provado no servidor local com a Focus simulada no próprio processo (nada saiu
 * da máquina): a 1ª emissão voltou 203 ("Emissor não habilitado") e abriu o
 * aviso com "Corrigir nota"; a correção abriu a emissão preenchida; a 2ª foi à
 * Focus com a MESMA referência e voltou autorizada. No banco, um registro só,
 * de ERRO para AUTORIZADO, e a auditoria nfe.reenviadaAposErro com o motivo da
 * recusa. Tudo o que o teste criou foi apagado.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => semComentarios(fs.readFileSync(path.join(__dirname, '..', p), 'utf8'));
const server = ler('server.js');
const fiscal = ler('lib/db/fiscal.js');
const tela = ler('public/modules/finance/subs/emitir_nfe_focus.js');

console.log('\n--- qual nota é reenviada ---');
const qual = server.slice(server.indexOf('async function notaComErroParaReenviar'), server.indexOf('async function emitirNfeFiscal'));
check('a do "Corrigir nota" (corrigeNfeId)', /const pedida = String\(\(body && body\.corrigeNfeId\) \|\| ''\)\.trim\(\);/.test(qual));
check('  e, se ela já não está em erro, recusa (não cria uma segunda nota da venda)', /if \(nfe && nfe\.status !== 'ERRO'\) \{[\s\S]{0,300}err\.status = 409;/.test(qual));
check('ou, do pedido, a com erro do mesmo pedido e modelo (NF-e e NFC-e)',
  /select id from nfe where order_id = \$1 and modelo = \$2 and status = 'ERRO' order by criado_em desc limit 1/.test(qual));

console.log('\n--- o mesmo registro, a mesma referência ---');
const emitir = server.slice(server.indexOf('async function emitirNfeFiscal'), server.indexOf('async function emitirNfceDoPedido'));
check('com a mesma empresa, vai a mesma referência', /const reaproveitaReferencia = Boolean\(notaComErro && notaComErro\.referencia\s*&& notaComErro\.estabelecimentoId === estabelecimento\.id\);/.test(emitir)
  && /let referenciaDoEnvio = reaproveitaReferencia \? notaComErro\.referencia : referencia;/.test(emitir));
check('o registro é reaberto, não criado', /if \(notaComErro\) \{\s*nfe = await fiscalDb\.reabrirNfeComErro\(notaComErro\.id, camposDoRegistro\);/.test(emitir)
  && /\} else \{\s*nfe = await fiscalDb\.createNfeRascunho\(camposDoRegistro\);/.test(emitir));
check('  e o motivo da recusa fica na auditoria', /action: 'nfe\.reenviadaAposErro'/.test(emitir) && /motivoAnterior: notaComErro\.mensagemSefaz/.test(emitir));
check('só reabre o que ainda está em erro (dois reenvios não pegam a mesma nota)', /\.eq\('id', id\)\.eq\('status', 'ERRO'\)\.select\(\);/.test(fiscal));
check('  limpando o que era da resposta anterior', /mensagem_sefaz: null,\s*resposta_focus: null,\s*chave_acesso: null,/.test(fiscal));
check('a Focus com a referência autorizada/em processamento: vale o que ela tem, nada é emitido de novo',
  /\['already_processed', 'pending_operation'\]\.includes\(codigoDaFocus\)/.test(emitir)
  && /resposta = nfce \? await client\.consultarNfce\(referenciaDoEnvio\) : await client\.consultarNfe\(referenciaDoEnvio\);/.test(emitir));
check('outra recusa da referência: uma nova, no mesmo registro', /referenciaDoEnvio = createId\('nfe'\);\s*await consultarBanco\('update nfe set referencia = \$2 where id = \$1', \[nfe\.id, referenciaDoEnvio\]\);/.test(emitir));

console.log('\n--- a tela ---');
check('a emissão diz qual nota está corrigindo', /if \(corrigindoNfe\) body\.corrigeNfeId = corrigindoNfe\.id;/.test(tela)
  && /corrigeNfeId: corrigindoNfe \? corrigindoNfe\.id : undefined/.test(tela));
check('  e o aviso não fala mais em nota nova', /Emitir reenvia esta mesma nota\./.test(tela) && !/Emitir sai como nota nova/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
