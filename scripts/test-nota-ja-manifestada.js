#!/usr/bin/env node
/**
 * NOTAS CONTRA CNPJ: A NOTA JÁ MANIFESTADA PASSA A CONSTAR COMO TAL (16/10/2026).
 * Pedido do usuário: "quando uma nota fiscal já for manifestada e for tentado
 * manifestar novamente, preciso que o status dela atualize para nota já
 * manifestada".
 *
 * O caso que sobrava (o de 15/10 já cobria a consulta antes de mandar): a
 * manifestação feita no Viper ou no portal, que a consulta pela Focus não
 * mostra. A SEFAZ recusa por duplicidade (573) — ela já tem ESTE evento —, e a
 * nota continuava "sem manifestação", com o botão Manifestar de volta. Agora o
 * evento é registrado na nota (autor "SEFAZ (nota já manifestada)"), a lista
 * escreve "já manifestada na SEFAZ" e o aviso é de atenção, não de erro.
 *
 * Provado com a Focus simulada (nada foi à SEFAZ; nota restaurada depois): pela
 * tela, Manifestar → Confirmação → aviso "Esta nota já estava manifestada na
 * SEFAZ como 'Confirmação da operação'. A situação dela foi atualizada aqui.",
 * janela fechada, linha "210200 - Confirmação da operação · já manifestada na
 * SEFAZ" sem o botão Manifestar; a segunda tentativa foi recusada na consulta,
 * sem mandar evento.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const RAIZ = path.join(__dirname, '..');
const dfe = semComentarios(fs.readFileSync(path.join(RAIZ, 'lib/db/dfe.js'), 'utf8'));
const server = semComentarios(fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8'));
const rota = server.slice(server.indexOf("pathname.endsWith('/manifestar') && req.method === 'POST'"), server.indexOf("'Erro ao manifestar'"));

console.log('\n--- o registro ---');
check('o evento que a SEFAZ já tem vira a manifestação da nota', /async function registrarJaManifestada\(id, codigo, codigoAtual\) \{\s*const valor = VALOR_DO_CODIGO\[String\(codigo \|\| ''\)\];\s*if \(!valor\) return false;\s*return registrarManifestacaoDaSefaz\(id, valor, codigoAtual, ORIGEM_JA_MANIFESTADA\);/.test(dfe));
check('  com o autor "SEFAZ (nota já manifestada)"', dfe.includes("const ORIGEM_JA_MANIFESTADA = 'SEFAZ (nota já manifestada)';"));
check('  pela mesma regra de peso (não rebaixa definitiva para ciência)', /registrarManifestacaoDaSefaz\(id, textoDaFocus, codigoAtual, origem = /.test(dfe) && /PESO_DA_MANIFESTACAO\[valor\] \|\| 0\) < \(PESO_DA_MANIFESTACAO\[atual\]/.test(dfe));

console.log('\n--- a rota ---');
check('na duplicidade (573), registra e relê a nota', /if \(duplicidade\) \{\s*await dfeDb\.registrarJaManifestada\(id, evento\.codigo, depois && depois\.manifestacaoCodigo\);\s*depois = await dfeDb\.obterDocumento\(id\);/.test(rota));
check('  e diz que a situação foi atualizada', /Esta nota já estava manifestada na SEFAZ\$\{[\s\S]{0,160}A situação dela foi atualizada aqui\./.test(rota));
check('a resposta marca jaManifestada (duplicidade e definitiva na consulta)', /jaManifestada: duplicidade,/.test(rota) && /documento: atual,\s*jaManifestada: true/.test(rota));

console.log('\n--- a tela ---');
const tela = semComentarios(fs.readFileSync(path.join(RAIZ, 'public/modules/fiscal/subs/notas_contra_cnpj.js'), 'utf8'));
check('"já manifestada na SEFAZ" na coluna da manifestação', /const manifestadaNaSefaz = \(doc\) => \/\^SEFAZ\\b\/\.test/.test(tela) && /já manifestada na SEFAZ/.test(tela));
check('o aviso é de atenção, não de erro', /const jaManifestada = Boolean\(erro\.dados && erro\.dados\.jaManifestada\);\s*showToast\(erro\.message \|\| 'Erro ao manifestar\.', jaManifestada \? 'warning' : 'error'/.test(tela));
check('e a lista recarrega depois (a nota aparece manifestada)', /finally \{\s*tela\.ocupado = false;\s*await carregar\(\);/.test(tela));
const app = semComentarios(fs.readFileSync(path.join(RAIZ, 'public/app.js'), 'utf8'));
check('o erro da API leva o corpo e o status', /const erro = new Error\(data\.error \|\| 'Erro inesperado'\);\s*erro\.status = response\.status;\s*erro\.dados = data;\s*throw erro;/.test(app));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
