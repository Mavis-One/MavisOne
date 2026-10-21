// NF-e SEM PAGAMENTO (21/10/2026). Uma NF-e avulsa com "90 — Sem pagamento"
// voltou rejeitada: "Rejeicao: Informado indevidamente campo valor de
// pagamento" (Código SEFAZ 904). Com tPag 90 a SEFAZ exige vPag zerado, e o
// montador mandava o total da nota. Pedido do usuário no mesmo print: "quero
// poder emitir uma NF sem pagamento (sem ter que adicionar título)".
//
// Agora a forma 90 vai com valor 0, sem fatura e sem duplicatas, e a nota não
// grava condição de pagamento — não nasce conta a receber na autorização. Na
// tela, "90" tira a Condição, as parcelas e a cobrança.
//
// Provado na 3099 com a Focus simulada (o payload gravado em arquivo): a nota
// avulsa de R$ 100,00 saiu com formas_pagamento [{ 90, 0 }], sem duplicatas,
// "autorizada", com condicao_pagamento vazia e nenhum título. Nota de teste
// apagada do banco local depois.
const fs = require('fs');
const path = require('path');
const { buildNfePayload, conferirPagamentosDaNota, semPagamento } = require('../lib/nfePayloadBuilder');

const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + JSON.stringify(det) : ''}`);
  if (!cond) falhas++;
};

const cenario = (pagamentos, cobranca) => buildNfePayload({
  estabelecimento: {
    cnpj: '12345678000199', razaoSocial: 'X', uf: 'SC', municipio: 'F',
    codigoMunicipio: '4205407', logradouro: 'R', numero: '1', bairro: 'C',
    cep: '88000000', inscricaoEstadual: 'ISENTO'
  },
  empresa: { crt: 1, regimeTributario: 'SIMPLES_NACIONAL' },
  destinatario: { nome: 'Cliente', documento: '11122233344', uf: 'SC', contribuinte: false },
  itens: [{ codigoProduto: 'P1', descricao: 'Capa de muro', ncm: '68109100', quantidade: 1, valorUnitario: 100, regraFiscal: { cfop: '5102' } }],
  naturezaOperacao: 'Venda', ambiente: 'producao', pagamentos,
  ...(cobranca ? { cobranca } : {})
});

console.log('\n--- o montador ---');
const sem = cenario([{ forma: '90', valor: 100 }], { duplicatas: [{ vencimento: '2026-11-20', valor: 100 }] });
check('forma 90 vai com valor de pagamento 0 (rejeição 904)', JSON.stringify(sem.formas_pagamento) === JSON.stringify([{ forma_pagamento: '90', valor_pagamento: 0 }]), sem.formas_pagamento);
check('  sem fatura e sem duplicatas, mesmo que a tela mande', !sem.duplicatas && sem.valor_liquido_fatura === undefined);
check('  e o total da nota não muda', sem.valor_total === 100);
const com = cenario([{ forma: '01', valor: 100 }], { duplicatas: [{ vencimento: '2026-11-20', valor: 100 }] });
check('as outras formas seguem com o valor e a cobrança', com.formas_pagamento[0].valor_pagamento === 100 && Array.isArray(com.duplicatas) && com.duplicatas.length === 1);
check('a conferência da soma não cobra a nota sem pagamento', conferirPagamentosDaNota(sem) === '');
check('  mas recusa 90 misturado com outra forma',
  /não se mistura com outras formas/.test(conferirPagamentosDaNota({ valor_total: 100, formas_pagamento: [{ forma_pagamento: '90', valor_pagamento: 0 }, { forma_pagamento: '01', valor_pagamento: 100 }] })));
check('  e segue conferindo a soma das outras', /faltam 10\.00/.test(conferirPagamentosDaNota({ valor_total: 100, formas_pagamento: [{ forma_pagamento: '01', valor_pagamento: 90 }] })));
check('semPagamento: só quando todas as linhas são 90',
  semPagamento([{ forma: '90' }]) === true && semPagamento([{ forma: '90' }, { forma: '01' }]) === false && semPagamento([]) === false && semPagamento(undefined) === false);

console.log('\n--- o servidor ---');
const servidor = ler('server.js');
check('nota sem pagamento não grava condição (não nasce conta a receber)',
  /\|\| semPagamento\(body\.pagamentos\)\s*\? null\s*: condicaoPagamentoDoBody\(body\),/.test(servidor));

console.log('\n--- a tela ---');
const tela = ler('public/modules/finance/subs/emitir_nfe_focus.js');
check('"90" tira a condição e as parcelas', /function aplicarSemPagamento\(\) \{[\s\S]*?classList\.toggle\('hidden', sem\);[\s\S]*?toggle\('hidden', sem \|\|/.test(tela));
check('  e a cobrança: sem duplicatas sugeridas nem enviadas',
  /function duplicatasSugeridas\(\) \{\s*if \(notaSemPagamento\(\)\) return \[\];/.test(tela)
  && /function cobrancaDaNota\(\) \{\s*if \(notaSemPagamento\(\)\) return null;/.test(tela)
  && tela.includes('Nota sem pagamento: vai sem valor de pagamento e sem cobrança, e não gera contas a receber.'));
check('  ao trocar a forma e ao recuperar a nota em edição',
  /\[name="formaPagamento"\]'\)\?\.addEventListener\('change', aplicarSemPagamento\);/.test(tela)
  && /\/\/ A forma de pagamento salva pode ser "90 — Sem pagamento"\.\s*aplicarSemPagamento\(\);/.test(tela));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
