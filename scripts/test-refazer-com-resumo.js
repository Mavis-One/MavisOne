// O REFAZER COM A NOTA RECEBIDA SÓ NO RESUMO (21/10/2026, queixa do usuário,
// com o print das Notas de Entrada: "Esta nota já está manifestada, mas a SEFAZ
// ainda não entregou o XML completo dela (só o resumo)" — "verifique isso, pois
// a NF em questão está emitida desde o dia 10").
//
// A entrada lançada pelo ARQUIVO tinha o XML completo; a nota recebida da mesma
// chave (Notas contra CNPJ) tinha só o resumo, porque a Focus não o entregou.
// O refazer apagava a entrada (e o XML com ela) e ia buscar o XML na nota
// recebida — que não tinha. Agora:
//   - a exclusão guarda o XML da entrada na nota recebida antes de apagar;
//   - o "Dar entrada" procura também numa entrada já lançada da mesma chave;
//   - a tela do refazer usa primeiro o XML que a exclusão devolveu.
//
// Provado na 3099 com uma nota recebida de teste só com o resumo: "Dar
// entrada" achou o XML pela entrada (6.172 caracteres); o refazer deixou a
// nota recebida com o XML; e pela tela o refazer abriu a conferência com os
// 2 itens. Dados de teste apagados.
const fs = require('fs');
const path = require('path');

const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas++;
};

const servidor = ler('server.js');
const excluir = servidor.slice(servidor.indexOf('async function excluirEntradaDeNfe('), servidor.indexOf('async function excluirEntradaDeNfe(') + 4000);
check('a exclusão guarda o XML da entrada na nota recebida que só tem o resumo',
  /if \(dfeId && xmlDaEntrada\.trim\(\)\.startsWith\('<'\) && !\(await dfeDb\.obterXml\(dfeId\)\.catch\(\(\) => null\)\)\) \{\s*await dfeDb\.guardarXml\(dfeId, xmlDaEntrada\)/.test(excluir));
check('  antes de apagar a entrada', excluir.indexOf('dfeDb.guardarXml(dfeId, xmlDaEntrada)') < excluir.indexOf('select 1 from fiscal_documentos where nfe_entrada_id'));
check('  e o XML no corpo continua só para quem vê valores', /const xml = devolverXml \? xmlDaEntrada : '';/.test(excluir));

const recebida = servidor.slice(servidor.indexOf('async function xmlDaNotaRecebida('), servidor.indexOf('async function xmlDaNotaRecebida(') + 3000);
check('o "Dar entrada" procura também numa entrada já lançada da mesma chave, antes da Focus',
  /select xml from nfe_entrada where chave = \$1 and coalesce\(xml, ''\) <> '' limit 1/.test(recebida)
  && recebida.indexOf('from nfe_entrada') < recebida.indexOf('distribuicaoDfe('));
check('a mensagem lembra que dá para enviar o arquivo', servidor.includes('Se você tem o arquivo XML'));

const tela = ler('public/modules/purchases/subs/entrada_nfe.js');
const refazer = tela.slice(tela.indexOf('async function excluirEntrada('), tela.indexOf('async function excluirEntrada(') + 2500);
check('a tela do refazer usa primeiro o XML que a exclusão devolveu, e liga de novo à nota recebida',
  /if \(refazer && r\.xml\) \{\s*await carregarEntradas\(\);\s*await analisarXml\(r\.xml\);\s*if \(r\.dfeId\) tela\.dfeId = r\.dfeId;\s*return;\s*\}/.test(refazer)
  && refazer.indexOf('analisarXml(r.xml)') < refazer.indexOf('state.entradaNfeDoDfe = { dfeId: r.dfeId'));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
