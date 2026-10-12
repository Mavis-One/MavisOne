#!/usr/bin/env node
// CONCILIAÇÃO BANCÁRIA: NOME NO MENU E EXTRATO OFX (12/10/2026).
//
// Pedido do usuário: achar a conciliação (estava como "Extrato Open Finance")
// e importar o arquivo OFX do banco, além do CSV. O leitor (shared/ofx.js)
// roda de verdade aqui sobre um extrato no formato que os bancos exportam:
// OFX 1.x (SGML, tags sem fechamento), Windows-1252, com acento.
'use strict';
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');
const { lerOfx, decodificar } = require('../public/modules/shared/ofx');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');
const ler = (a) => fs.readFileSync(path.join(RAIZ, a), 'utf8');

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0756<BRANCHID>3069<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001<DTEND>20261012
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005120000[-3:BRT]<TRNAMT>2500.00<FITID>A1<MEMO>PIX RECEBIDO JOÃO
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005120000[-3:BRT]<TRNAMT>2500.00<FITID>A2<MEMO>PIX RECEBIDO JOÃO
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006<TRNAMT>-25,50<FITID>A3<NAME>TARIFA BANCÁRIA
<STMTTRN><TRNTYPE>OTHER<DTPOSTED>20261007<TRNAMT>0.00<FITID>A4<MEMO>LANCAMENTO ZERADO
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

console.log('\n--- 1. OFX 1.x (SGML, Windows-1252) ---');
const bytes1252 = Buffer.from(OFX_SGML, 'latin1');
const texto = decodificar(bytes1252);
check('acento do Windows-1252 decodificado', /JOÃO/.test(texto) && /BANCÁRIA/.test(texto));
const r = lerOfx(texto);
check('conta lida', r.conta.banco === '0756' && r.conta.numero === '12345-6', JSON.stringify(r.conta));
check('3 lançamentos (o zerado fica fora)', r.transacoes.length === 3 && r.ignoradas.length === 1, `${r.transacoes.length} / ${r.ignoradas.length}`);
check('crédito = entrada, com data ISO', r.transacoes[0].type === 'entrada' && r.transacoes[0].date === '2026-10-05' && r.transacoes[0].amount === 2500);
check('dois PIX iguais no mesmo dia, FITIDs diferentes', r.transacoes[0].fitid === 'A1' && r.transacoes[1].fitid === 'A2');
check('débito = saída, valor sem sinal, vírgula decimal', r.transacoes[2].type === 'saida' && r.transacoes[2].amount === 25.5);
check('sem MEMO usa NAME', r.transacoes[2].description === 'TARIFA BANCÁRIA');

console.log('\n--- 2. OFX 2.x (XML, UTF-8) ---');
const xml = `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200" VERSION="211"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>341</BANKID><ACCTID>9988</ACCTID></BANKACCTFROM>
<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261010</DTPOSTED><TRNAMT>-1234.56</TRNAMT><FITID>X9</FITID><MEMO>BOLETO FORNECEDOR &amp; CIA</MEMO></STMTTRN></BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
const r2 = lerOfx(decodificar(Buffer.from(xml, 'utf8')));
check('XML: fechamento das tags e entidade &amp;', r2.transacoes.length === 1 && r2.transacoes[0].description === 'BOLETO FORNECEDOR & CIA' && r2.transacoes[0].amount === 1234.56 && r2.transacoes[0].fitid === 'X9');
let recusa = '';
try { lerOfx('data,descricao,valor\n2026-10-01,x,1'); } catch (e) { recusa = e.message; }
check('arquivo que não é OFX: recusa com motivo', /não parece um extrato OFX/.test(recusa));

console.log('\n--- 3. servidor: FITID ---');
const server = semComentarios(ler('server.js'));
check('origem OFX grava o FITID e marca a fonte', /if \(fitid\) tx\.providerTransactionId = fitid;/.test(server) && /origemOfx \? 'ofx' : 'csv'/.test(server));
check('reimportar o OFX não duplica (pelo FITID)', /comFitid\.has\(chaveDoFitid\(bankAccountId, fitid\)\)/.test(server));
check('  e o OFX não soma com o mesmo lançamento vindo de CSV', /\|\| semFitid\.has\(chave\)/.test(server));
check('CSV continua pela chave de sempre', /: todas\.has\(chave\);/.test(server));

console.log('\n--- 4. tela ---');
const app = ler('public/app.js');
const tela = semComentarios(ler('public/modules/finance/subs/extrato_open_finance.js'));
check('menu: "Conciliação Bancária" (a chave antiga fica)', /\{ key: 'extrato_open_finance', label: 'Conciliação Bancária'/.test(app));
check('título da tela', /<h3>Conciliação Bancária<\/h3>/.test(tela));
check('janela aceita arquivo OFX ou CSV', /accept="\.ofx,\.OFX,\.csv,\.CSV,\.txt"/.test(tela) && /Importar extrato \(OFX\/CSV\)/.test(tela));
check('o OFX é lido no navegador e vai como linhas, com origem "ofx"', /window\.MavisOfx\.lerOfx\(texto\)/.test(tela) && /rows: linhasDoOfx, origem: 'ofx'/.test(tela));
const html = ler('public/index.html');
check('script do leitor carregado', html.includes('/modules/shared/ofx.js'));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
