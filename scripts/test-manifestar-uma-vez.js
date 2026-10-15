#!/usr/bin/env node
/**
 * NOTA JÁ MANIFESTADA NÃO SE MANIFESTA DE NOVO, E QUEM DIZ É A SEFAZ
 * (15/10/2026). Pedido do usuário: "faça uma verificação em cima das notas já
 * existentes, uma nota já manifestada não pode ser manifestada novamente, essa
 * verificação é feita pelo próprio SEFAZ".
 *
 * Provado no servidor local com a Focus de produção (só consultas; nada foi
 * manifestado):
 *   A) nota confirmada, pedindo desconhecimento -> 409 "já foi manifestada na
 *      SEFAZ como Confirmação da operação";
 *   B) nota com ciência, pedindo ciência -> 409 "o próximo passo é a definitiva";
 *   C) nota com a ciência apagada SÓ aqui, pedindo ciência -> a rota consultou a
 *      SEFAZ, regravou a ciência ("SEFAZ (feita fora do MavisONE)") e recusou.
 * Na tela: nota com ciência mostra Manifestar e Dar entrada, e a janela só
 * oferece as definitivas; nota confirmada, só Dar entrada.
 *
 * E a recusa da SEFAZ (HTTP 200 com status "erro", 573 = duplicidade — doc da
 * Focus) não é mais gravada como manifestada.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const servidor = ler('server.js');
const ini = servidor.indexOf("pathname.endsWith('/manifestar') && req.method === 'POST'");
const rota = servidor.slice(ini, servidor.indexOf("pathname.endsWith('/xml') && req.method === 'GET'", ini));
const focus = ler('lib/focusnfe.js');
const tela = ler('public/modules/fiscal/subs/notas_contra_cnpj.js');

check('consulta a nota na SEFAZ (pela Focus) ANTES de mandar',
  rota.indexOf('const atual = await atualizarPelaSefaz();') > 0
  && rota.indexOf('const atual = await atualizarPelaSefaz();') < rota.indexOf('await cliente.manifestarNfe('));
check('  e grava aqui o que a SEFAZ já tem', /naSefaz && naSefaz\.manifestacao[\s\S]{0,120}registrarManifestacaoDaSefaz\(id, naSefaz\.manifestacao/.test(rota));
check('  pela consulta individual, sem o XML', /async function consultarRecebida\(\{ chave \}, credentials\)[\s\S]{0,400}`\/nfes_recebidas\/\$\{chaveLimpa\}\.json`/.test(focus)
  && focus.includes('consultarRecebida: (args) => consultarRecebida(args, creds)'));
check('definitiva (confirmação, desconhecimento, não realizada) não se repete',
  rota.includes("const FINAIS = ['210200', '210220', '210240'];") && /if \(FINAIS\.includes\(codigoAtual\)\) \{[\s\S]{0,300}\}, 409\);/.test(rota));
check('ciência de novo é duplicidade; depois da ciência, a definitiva passa',
  /if \(codigoAtual === '210210' && evento\.codigo === '210210'\)/.test(rota) && !rota.includes('if (documento.manifestacaoCodigo) {'));
check('recusa da SEFAZ (status "erro", HTTP 200) não vira manifestada',
  /const aceita = \['evento_registrado', 'aceita'\]\.includes/.test(rota)
  && rota.indexOf('if (!aceita) {') < rota.indexOf('dfeDb.registrarManifestacao(id, {'));
check('  e a duplicidade (573) atualiza a nota pela SEFAZ', /const duplicidade = String\(resposta && resposta\.status_sefaz \|\| ''\) === '573';\s*const depois = duplicidade \? await atualizarPelaSefaz\(\)/.test(rota));

check('tela: Manifestar só sem manifestação ou com ciência', tela.includes("const podeManifestar = (doc) => !doc.manifestacaoCodigo || doc.manifestacaoCodigo === SO_CIENCIA;"));
check('  com ciência, a janela não oferece ciência de novo', tela.includes('catalogo.CATALOGO.filter((m) => !(doc.manifestacaoCodigo === SO_CIENCIA && m.codigo === SO_CIENCIA))'));
check('  e a janela fecha quando a SEFAZ diz que já está manifestada', /if \(depois && !podeManifestar\(depois\)\) \{\s*tela\.manifestando = null;/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
