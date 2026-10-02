#!/usr/bin/env node
/**
 * NT 2026.002 v1.10 — NF-e de saída não referencia NFC-e (modelo 65) nem
 * CF-e SAT (59), salvo complementar ou devolução. Em produção desde
 * 05/10/2026; antes disso a SEFAZ aceitava, e o sistema também aceita.
 */
const { validarOperacao } = require('../lib/operacaoFiscal');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};

// Chave: cUF(2) AAMM(4) CNPJ(14) MODELO(2) série/número/código/DV (22).
const chave = (modelo) => `42261043792899000135${modelo}${'1'.repeat(22)}`;
const item = [{ quantidade: 1, valorUnitario: 10 }];
const erroNt = (erros) => erros.some((e) => /NT 2026\.002/.test(e));

const vendaRefNfce = (data, extra = {}) => validarOperacao({
  tipoOperacao: 'VENDA', finalidade: 1, itens: item, referencias: [{ chave: chave('65') }], tipoDocumento: 1, dataEmissao: data, ...extra
});

check('a partir de 05/10/2026, venda referenciando NFC-e é recusada', erroNt(vendaRefNfce('2026-10-05')));
check('  e a mensagem diz o caminho (cancelar a NFC-e)', vendaRefNfce('2026-10-05').some((e) => /Cancele a NFC-e/.test(e)));
check('  CF-e SAT (59) também', erroNt(validarOperacao({ tipoOperacao: 'VENDA', finalidade: 1, itens: item, referencias: [chave('59')], tipoDocumento: 1, dataEmissao: '2026-11-01' })));
check('antes de 05/10/2026 ainda passa', !erroNt(vendaRefNfce('2026-10-04')));
check('referência a NF-e (55) continua permitida', !erroNt(validarOperacao({ tipoOperacao: 'VENDA', finalidade: 1, itens: item, referencias: [{ chave: chave('55') }], tipoDocumento: 1, dataEmissao: '2026-10-10' })));
check('devolução (finalidade 4) pode referenciar NFC-e',
  !erroNt(validarOperacao({ tipoOperacao: 'DEVOLUCAO', finalidade: 4, itens: item, referencias: [{ chave: chave('65') }], tipoDocumento: 1, dataEmissao: '2026-10-10' })));
check('complementar (finalidade 2) também',
  !erroNt(validarOperacao({ tipoOperacao: 'COMPLEMENTO_ICMS', finalidade: 2, itens: [{ quantidade: 0, valorUnitario: 0, escritural: true }], referencias: [{ chave: chave('65') }], tipoDocumento: 1, dataEmissao: '2026-10-10', valorIcmsComplementar: 5 })));
check('nota de ENTRADA (tpNF 0) não é alcançada', !erroNt(vendaRefNfce('2026-10-10', { tipoDocumento: 0 })));

console.log(falhas ? `\n===== ${falhas} CHECK(S) FALHARAM =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
