/**
 * O EXTRATO OFX DO ITAÚ COMO PADRÃO (23/11/2026).
 *
 * Pedido do usuário: "verifique o motivo de eu não estar conseguindo fazer a
 * verificação completa desse arquivo OFX, nas conciliações, não estou
 * conseguindo encontrar 100% dos títulos! verifique corrija e deixe como padrão
 * o formato dele!" (Extrato-Itau-Plus-23-11-26, 284 lançamentos.)
 *
 * O que o arquivo tem e o sistema lia errado:
 *   1. CHARSET:1252 no cabeçalho, acentos em UTF-8: "ARAÚJO" virava
 *      "ARAÃšJO" e o nome do cliente não casava;
 *   2. FITID = data + POSIÇÃO no dia (20261123005): baixado de novo, o mesmo
 *      número é outro lançamento, e o novo era descartado como "já existia";
 *   3. o "Ver" do arquivo mostrava só o que entrou naquela vez, e a
 *      conciliação automática da importação só olhava as novas.
 *
 * Tudo com dados fictícios.
 *
 *   node scripts/test-ofx-itau.js
 */
const fs = require('fs');
const path = require('path');
const ofx = require('../public/modules/shared/ofx');
const E = require('../lib/extrato-bancario');

let falhas = 0;
const check = (nome, cond, extra = '') => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${extra ? `  (${extra})` : ''}`);
  if (!cond) falhas++;
};
const ler = (arquivo) => fs.readFileSync(path.join(__dirname, '..', arquivo), 'utf8');

// O cabeçalho do Itaú, como veio.
const CABECALHO = 'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n';
function extratoItau(lancamentos) {
  const corpo = lancamentos.map(([dia, seq, valor, memo]) => `<STMTTRN>\n<TRNTYPE>${valor < 0 ? 'DEBIT' : 'CREDIT'}\n<DTPOSTED>${dia}100000[-03:EST]\n<TRNAMT>${valor.toFixed(2)}\n<FITID>${dia}${String(seq).padStart(3, '0')}\n<CHECKNUM>${dia}${String(seq).padStart(3, '0')}\n<MEMO>${memo}\n</STMTTRN>`).join('\n');
  return `${CABECALHO}<OFX>\n<BANKMSGSRSV1>\n<STMTTRNRS>\n<STMTRS>\n<CURDEF>BRL\n<BANKACCTFROM>\n<BANKID>0341\n<ACCTID>1234567890\n<ACCTTYPE>CHECKING\n</BANKACCTFROM>\n<BANKTRANLIST>\n<DTSTART>20261101100000[-03:EST]\n<DTEND>20261123100000[-03:EST]\n${corpo}\n</BANKTRANLIST>\n</STMTRS>\n</STMTTRNRS>\n</BANKMSGSRSV1>\n</OFX>`;
}

console.log('--- 1. acentos: UTF-8 com cabeçalho 1252 ---');
const MARTA = 'PIX RECEBIDO MARTA D07/11 MARTA DE ARAÚJO SILVA 777.777.777-77';
const doItau = Buffer.from(extratoItau([['20261109', 1, 1000, MARTA]]), 'utf8');
const lido = ofx.lerOfx(ofx.decodificar(new Uint8Array(doItau)));
check('o nome sai com o acento certo (ARAÚJO), apesar do CHARSET:1252', lido.transacoes[0].description === MARTA, lido.transacoes[0].description);
const em1252 = Buffer.from(extratoItau([['20261109', 1, 1000, 'PIX RECEBIDO JOSE ARAÚJO']]), 'latin1');
check('arquivo que é 1252 mesmo continua certo', ofx.lerOfx(ofx.decodificar(new Uint8Array(em1252))).transacoes[0].description === 'PIX RECEBIDO JOSE ARAÚJO');
const semCabecalho1252 = Buffer.concat([Buffer.from('<OFX><STMTTRN><DTPOSTED>20261109<TRNAMT>-5.00<FITID>x<MEMO>TARIFA S', 'latin1'), Buffer.from([0xC9]), Buffer.from('RIE</STMTTRN></OFX>', 'latin1')]);
check('sem cabeçalho e não-UTF-8: lê como 1252', ofx.lerOfx(ofx.decodificar(new Uint8Array(semCabecalho1252))).transacoes[0].description === 'TARIFA SÉRIE');
check('o acento que já entrou quebrado é consertado', ofx.consertarAcentos('MARTA DE ARAÃšJO') === 'MARTA DE ARAÚJO'
  && ofx.consertarAcentos('MARIA Ã‚NGELA PERÃ‰S') === 'MARIA ÂNGELA PERÉS');
check('nome com Ã de verdade fica como está (JOÃO, TAINÃ SILVA)', ofx.consertarAcentos('JOÃO') === 'JOÃO' && ofx.consertarAcentos('TAINÃ SILVA') === 'TAINÃ SILVA');

console.log('\n--- 2. já está no extrato? (FITID do Itaú é a posição no dia) ---');
const linha = (dia, seq, valor, memo) => ({ date: `${dia.slice(0, 4)}-${dia.slice(4, 6)}-${dia.slice(6)}`, amount: Math.abs(valor), type: valor < 0 ? 'saida' : 'entrada', description: memo, fitid: `${dia}${String(seq).padStart(3, '0')}` });
// Baixado ao meio-dia: três lançamentos em 23/11.
const MEIO_DIA = [
  linha('20261123', 1, 2850, 'PIX QR CODE RECEBIDO ANA SOUZ23/11 ANA SOUZA 111.111.111-11'),
  linha('20261123', 2, 3790, 'PIX QR CODE RECEBIDO BRUNO LI23/11 BRUNO LIMA 222.222.222-22'),
  linha('20261123', 3, 5000, 'PIX RECEBIDO CARLA M23/11 CARLA MOTA 333.333.333-33')
];
// Baixado à tarde: o banco numerou de novo, e entraram dois lançamentos no meio.
const TARDE = [
  linha('20261123', 1, 2850, 'PIX QR CODE RECEBIDO ANA SOUZ23/11 ANA SOUZA 111.111.111-11'),
  linha('20261123', 2, 1200, 'PIX QR CODE RECEBIDO DANIEL R23/11 DANIEL ROCHA 444.444.444-44'),
  linha('20261123', 3, 3790, 'PIX QR CODE RECEBIDO BRUNO LI23/11 BRUNO LIMA 222.222.222-22'),
  linha('20261123', 4, 5000, 'PIX RECEBIDO CARLA M23/11 CARLA MOTA 333.333.333-33'),
  linha('20261123', 5, 950, 'PIX QR CODE RECEBIDO EVA PIRE23/11 EVA PIRES 555.555.555-55')
];
const gravadas = MEIO_DIA.map((l, i) => ({ id: `tx${i + 1}`, source: 'ofx', providerTransactionId: l.fitid, ...l }));

// Como era: só o FITID decidia.
const fitidsAntigos = new Set(gravadas.map((t) => t.providerTransactionId));
const antes = TARDE.filter((l) => !fitidsAntigos.has(l.fitid));
check('COMO ERA: o lançamento novo do meio (DANIEL) era descartado e a CARLA duplicava',
  !antes.some((l) => /DANIEL/.test(l.description)) && antes.some((l) => /CARLA/.test(l.description)), antes.map((l) => l.description.split(' ').slice(-2, -1)[0]).join(', '));

const casadas = E.casarComExistentes(TARDE, gravadas);
const novas = TARDE.filter((l, i) => !casadas[i]);
check('AGORA: entram só DANIEL e EVA; ANA, BRUNO e CARLA são as que já estavam',
  novas.length === 2 && novas.every((l) => /DANIEL|EVA/.test(l.description))
  && casadas[0].id === 'tx1' && casadas[2].id === 'tx2' && casadas[3].id === 'tx3', novas.map((l) => l.fitid).join(', '));
check('reimportar o mesmo arquivo não duplica nada', E.casarComExistentes(MEIO_DIA, gravadas).every(Boolean));

const PIX = 'PIX QR CODE RECEBIDO FABIO NU23/11 FABIO NUNES 666.666.666-66';
const doisIguais = [linha('20261123', 6, 100, PIX), linha('20261123', 7, 100, PIX)];
const umJaEstava = [{ id: 'f1', source: 'ofx', providerTransactionId: '20261123006', ...doisIguais[0] }];
const doisCasados = E.casarComExistentes(doisIguais, umJaEstava);
check('dois PIX iguais no mesmo dia: o que já estava responde por um, o outro entra', doisCasados[0] && doisCasados[0].id === 'f1' && doisCasados[1] === null);
check('dois PIX iguais num extrato vazio: entram os dois', E.casarComExistentes(doisIguais, []).every((c) => c === null));

const quebrada = [{ id: 'z1', source: 'ofx', providerTransactionId: 'outro', date: '2026-11-09', amount: 1000, type: 'entrada', description: 'PIX RECEBIDO MARTA D07/11 MARTA DE ARAÃšJO SILVA 777.777.777-77' }];
check('a que entrou com o acento quebrado é reconhecida pelo conteúdo', E.casarComExistentes([linha('20261109', 1, 1000, MARTA)], quebrada)[0] === quebrada[0]);
const textoMudou = [{ id: 'm1', source: 'ofx', providerTransactionId: '20261110003', date: '2026-11-10', amount: 80.94, type: 'saida', description: 'BOLETO PAGO SEGURADORA EXEMPLO' }];
check('o banco mudou o texto: o FITID com a mesma data e valor ainda reconhece',
  E.casarComExistentes([linha('20261110', 3, -80.94, 'BOLETO PAGO SEGURADORA EXEMPLO SA 11.222.333/0001-81')], textoMudou)[0] === textoMudou[0]);
check('o FITID não reconhece se o valor é outro', E.casarComExistentes([linha('20261110', 3, -99.99, 'OUTRA COISA')], textoMudou)[0] === null);

console.log('\n--- 3. o arquivo inteiro ---');
const extrato = [
  { id: 'a', source: 'ofx', importacaoId: 'imp-manha', arquivo: 'manha.ofx', createdAt: '2026-11-23T12:00:00Z', date: '2026-11-23', status: 'conciliado',
    tambemNosArquivos: [{ id: 'imp-tarde', arquivo: 'tarde.ofx', em: '2026-11-23T18:00:00Z', por: 'Fulano' }] },
  { id: 'b', source: 'ofx', importacaoId: 'imp-manha', arquivo: 'manha.ofx', createdAt: '2026-11-23T12:00:00Z', date: '2026-11-23', status: 'nao_conciliado',
    tambemNosArquivos: [{ id: 'imp-tarde', arquivo: 'tarde.ofx', em: '2026-11-23T18:00:00Z', por: 'Fulano' }] },
  { id: 'c', source: 'ofx', importacaoId: 'imp-tarde', arquivo: 'tarde.ofx', createdAt: '2026-11-23T18:00:00Z', date: '2026-11-23', status: 'nao_conciliado' }
];
const { lista, estaNoArquivo } = E.importacoesDoExtrato(extrato);
const tarde = lista.find((g) => g.id === 'imp-tarde');
const manha = lista.find((g) => g.id === 'imp-manha');
check('o arquivo da tarde conta as 3 (2 que já estavam + 1 nova)', tarde && tarde.total === 3 && tarde.conciliado === 1 && tarde.naoConciliado === 2, JSON.stringify(tarde));
check('o da manhã continua com as 2 dele', manha && manha.total === 2);
check('"Ver" o arquivo da tarde mostra as 3', extrato.filter((tx) => estaNoArquivo(tx, 'imp-tarde')).length === 3);
const soLigado = E.importacoesDoExtrato(extrato.slice(0, 2)).lista.find((g) => g.id === 'imp-tarde');
check('arquivo que só trouxe o que já existia aparece, com nome e data', soLigado && soLigado.arquivo === 'tarde.ofx' && soLigado.total === 2 && soLigado.importadoPor === 'Fulano');

console.log('\n--- 4. servidor e tela ---');
const servidor = ler('server.js');
const rota = servidor.slice(servidor.indexOf("pathname === '/api/finance/bank-transactions/import' && req.method === 'POST'"), servidor.indexOf("pathname === '/api/finance/bank-transactions/conciliar-automatico'"));
check('o OFX usa casarComExistentes, só com as movimentações da mesma conta',
  /const daConta = \(data\.bankTransactions \|\| \[\]\)\.filter\(\(tx\) => tx\.bankAccountId === bankAccountId\);\s*const casadas = extratoBancario\.casarComExistentes\(/.test(rota));
check('a que já estava fica ligada ao arquivo novo e tem o acento consertado',
  /existente\.tambemNosArquivos = \[\.\.\.ligacoes, \{ id: importacaoId, arquivo, em: agora, por: user\.name \|\| '' \}\]/.test(rota)
  && /leitorOfx\.consertarAcentos\(existente\.description\) === tx\.description/.test(rota));
check('a conciliação automática da importação olha o arquivo inteiro', /const doArquivo = new Set\(\[/.test(rota) && /conciliarAutomaticamente\(user, \(tx\) => doArquivo\.has\(tx\.id\)\)/.test(rota));
check('a resposta diz o total do arquivo, as já conciliadas e os motivos', /noArquivo: rows\.length/.test(rota) && /jaConciliadas,/.test(rota) && /motivos: Object\.entries/.test(rota)
  && /importacaoId: created\.length \|\| jaNoExtrato\.length \? importacaoId : ''/.test(rota));
check('o CSV continua com a regra de antes', /\} else \{\s*candidatas\.forEach\(\(\{ tx, fitid \}\) => \{\s*const chave = chaveDaTransacao\(tx\);/.test(rota));
const busca = servidor.slice(servidor.indexOf('function findBankTransactionMatches('), servidor.indexOf('function buildOpenFinanceSyncDeps('));
check('janela "Conciliar": quem pagou (nome ou CPF/CNPJ na descrição) vem no topo',
  /conciliacaoAutomatica\.fornecedorBate\(\{ texto: txTexto, documentos: txDocumentos, nome: entryName, documento: entryDocument \}\)/.test(busca)
  && /grupo: c\.amountDiff < 0\.01 \? \(c\.quemPagou \? 0 : 2\) : \(c\.quemPagou \? 1 : 3\)/.test(busca)
  && /\.sort\(\(a, b\) => \(a\.grupo - b\.grupo\) \|\| \(a\.amountDiff - b\.amountDiff\) \|\| \(a\.daysDiff - b\.daysDiff\)\)/.test(busca));
const tela = ler('public/modules/finance/subs/extrato_open_finance.js');
check('a tela diz quantos há no arquivo e por que o resto não achou título',
  /\$\{result\.noArquivo\} lançamento\(s\) no arquivo: /.test(tela) && /Sem título achado: \$\{porque\}/.test(tela));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
