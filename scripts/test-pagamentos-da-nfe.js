#!/usr/bin/env node
/**
 * O GRUPO `pag` DA NF-e DIZ COMO A VENDA FOI PAGA (fase BU).
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * A tela de emissão montava UMA linha de pagamento, com a forma vinda de um
 * select que nascia selecionado em "99 — Outros":
 *
 *     pagamentos: [{ forma: formData.get('formaPagamento') || '99', valor: grandTotal() }]
 *
 * O pedido já carregava suas linhas de pagamento até essa tela
 * (`state.nfeFromOrder.payments`) e ela nunca as lia. Uma venda de R$ 7.637,11
 * paga R$ 2.768,51 no cartão e R$ 4.868,60 em dinheiro ia para a SEFAZ assim:
 *
 *     antes   [{"forma_pagamento":"99","valor_pagamento":7637.11}]
 *     depois  [{"forma_pagamento":"03","valor_pagamento":2768.51},
 *              {"forma_pagamento":"01","valor_pagamento":4868.6}]
 *
 * O valor fechava nos dois casos — o que era falso é o MEIO de pagamento. É a
 * mesma família do valor bruto da nota (fase BQ): o documento fiscal contando
 * uma história diferente da venda.
 *
 * O ELO QUE FALTAVA. Existiam duas listas sem ponte entre elas: o catálogo
 * interno de formas (dinheiro, pix, cartao-credito…) que o pedido usa, e a
 * tabela tPag do montador do payload. O código tPag passou a morar no próprio
 * catálogo, junto de `quitaNaHora` e `recebivelDe` — quem acrescentar uma forma
 * nova acrescenta tudo o que ela significa num lugar só.
 *
 * E A SOMA TEM DE FECHAR. A SEFAZ confere vPag contra vNF. Enquanto o grupo era
 * uma linha pelo total, fechava por construção; com as linhas reais, passou a
 * ser possível divergir — pedido com desconto e pagamentos lançados pelo valor
 * cheio, por exemplo.
 *
 * O QUE ESTE TESTE NÃO COBRE: o grupo `card` (CNPJ da credenciadora, bandeira,
 * NSU, tpIntegra). Ele não existe ainda — depende do cadastro de adquirentes,
 * que é outra fase. Sem `card`, a SEFAZ não cobra os campos dele; foi
 * exatamente montá-lo pela metade que rendeu a rejeição 225 no ERP observado.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const formaPagamento = require('../public/modules/shared/forma_pagamento');
const { buildNfePayload, conferirPagamentosDaNota } = require('../lib/nfePayloadBuilder');

console.log('--- 1. o catálogo sabe o código tPag de cada forma ---');
check('toda forma tem tPag',
  formaPagamento.CATALOGO.every((f) => /^\d{2}$/.test(String(f.tPag || ''))),
  formaPagamento.CATALOGO.map((f) => `${f.value}=${f.tPag}`).join(' '));
// Os quatro que decidem o caso comum de balcão.
check('  dinheiro é 01', formaPagamento.codigoNfe('dinheiro') === '01');
check('  cartão de crédito é 03', formaPagamento.codigoNfe('cartao-credito') === '03');
check('  cartão de débito é 04', formaPagamento.codigoNfe('cartao-debito') === '04');
check('  PIX é 17', formaPagamento.codigoNfe('pix') === '17');
// Crediário é "Crédito Loja" (05): o crediário da própria loja, sem banco nem
// cartão no meio.
check('  crediário é 05 (Crédito Loja)', formaPagamento.codigoNfe('crediario') === '05');
// Forma desconhecida cai em 'outro' pela mesma queda de obter() — o mesmo
// comportamento conservador que `quitaNaHora` já tinha.
check('forma desconhecida cai em 99', formaPagamento.codigoNfe('nao-existe') === '99');

// Um código que o montador não conhece é reescrito para '99' em silêncio — o
// catálogo diria uma coisa e a nota sairia com outra.
const tabelaDoMontador = new Set(
  [...(/const FORMAS_PAGAMENTO = \{([\s\S]*?)\};/.exec(ler('lib/nfePayloadBuilder.js'))[1])
    .matchAll(/'(\d{2})':/g)].map((m) => m[1])
);
const semCodigo = formaPagamento.CATALOGO.filter((f) => !tabelaDoMontador.has(f.tPag));
check('todo tPag do catálogo existe na tabela do montador',
  semCodigo.length === 0,
  semCodigo.length ? 'FORA DA TABELA: ' + semCodigo.map((f) => f.value).join(', ') : `${tabelaDoMontador.size} códigos`);

console.log('--- 2. o caso real: cartão + dinheiro na mesma venda ---');

const cenario = (pagamentos) => buildNfePayload({
  estabelecimento: {
    cnpj: '12345678000199', razaoSocial: 'X', uf: 'SC', municipio: 'F',
    codigoMunicipio: '4205407', logradouro: 'R', numero: '1', bairro: 'C',
    cep: '88000000', inscricaoEstadual: 'ISENTO'
  },
  empresa: { crt: 1, regimeTributario: 'SIMPLES_NACIONAL' },
  destinatario: { nome: 'David Ramos', documento: '11122233344', uf: 'SC', contribuinte: false },
  itens: [{
    codigoProduto: 'P1', descricao: 'Bicicleta', ncm: '87120010',
    quantidade: 1, valorUnitario: 7637.11, regraFiscal: { cfop: '5102' }
  }],
  naturezaOperacao: 'Venda', ambiente: 'producao', pagamentos
});

const duasLinhas = cenario([
  { forma: formaPagamento.codigoNfe('cartao-credito'), valor: 2768.51 },
  { forma: formaPagamento.codigoNfe('dinheiro'), valor: 4868.60 }
]);
check('as duas linhas chegam ao payload', duasLinhas.formas_pagamento.length === 2);
check('  com os códigos certos',
  duasLinhas.formas_pagamento[0].forma_pagamento === '03'
  && duasLinhas.formas_pagamento[1].forma_pagamento === '01');
check('  e os valores certos',
  duasLinhas.formas_pagamento[0].valor_pagamento === 2768.51
  && duasLinhas.formas_pagamento[1].valor_pagamento === 4868.60);
check('a soma fecha com o total da nota', conferirPagamentosDaNota(duasLinhas) === '');

console.log('--- 3. a soma que não fecha é recusada antes de transmitir ---');
const naoFecha = cenario([{ forma: '03', valor: 2768.51 }, { forma: '01', valor: 4000 }]);
const recusa = conferirPagamentosDaNota(naoFecha);
check('divergência é recusada', Boolean(recusa));
// Dizer QUANTO falta: "não fecha" sem o número deixa a pessoa conferindo linha
// a linha para achar a diferença.
check('  dizendo quanto falta', /faltam 868\.60/.test(recusa), recusa.slice(0, 70) + '...');
const excede = cenario([{ forma: '03', valor: 5000 }, { forma: '01', valor: 3000 }]);
check('  e quanto excede, no outro sentido', /excedem 362\.89/.test(conferirPagamentosDaNota(excede)));
// UMA linha tambem e conferida: um pedido com um pagamento so, de valor
// errado, chegava rejeitado na SEFAZ enquanto o check pulava linha unica.
check('  inclusive quando ha uma linha so',
  Boolean(conferirPagamentosDaNota(cenario([{ forma: '03', valor: 8000 }]))));
// Um centavo é arredondamento — valor_pagamento arredonda linha a linha e
// valor_total de uma vez. Mesmo critério de parcelasDoPedido.
const umCentavo = cenario([{ forma: '03', valor: 2768.51 }, { forma: '01', valor: 4868.59 }]);
check('um centavo de arredondamento passa', conferirPagamentosDaNota(umCentavo) === '');
// A nota avulsa cai no fallback do montador, que monta a linha pelo PROPRIO
// total: fecha por construcao, e por isso conferi-la nao cria falso positivo.
check('o fallback da nota avulsa fecha sozinho', conferirPagamentosDaNota(cenario(null)) === '');
check('  e sem pagamento nenhum nao ha o que conferir',
  conferirPagamentosDaNota({ formas_pagamento: [], valor_total: 100 }) === '');

console.log('--- 4. onde as guardas ficam ---');
const src = ler('server.js');
const posConfere = src.indexOf('const pagamentosNaoFecham = conferirPagamentosDaNota(payload);');
const posRascunho = src.indexOf('let nfe = await fiscalDb.createNfeRascunho(');
check('a emissão confere ANTES de gravar o rascunho', posConfere > 0 && posRascunho > posConfere);

const appSrc = ler('public/app.js');
// A tradução acontece na tela de VENDAS porque é lá que meta.paymentMethods
// existe — a tela de emissão não carrega o cadastro de formas.
check('o pedido traduz methodId -> type -> tPag',
  /forma: window\.MavisFormaPagamento\.codigoNfe\(forma\?\.type\),/.test(appSrc));
check('  e só manda linha com valor', /\.filter\(\(linha\) => Number\(linha\.amount \|\| 0\) > 0\)/.test(appSrc));

const telaSrc = ler('public/modules/finance/subs/emitir_nfe_focus.js');
check('a emissão usa as linhas do pedido',
  /pagamentos: pagamentosDoPedido\.length\s*\n\s*\? pagamentosDoPedido\.map/.test(telaSrc));
// O select de forma única continua existindo para a nota AVULSA, que não tem
// pagamentos lançados em lugar nenhum.
check('  e mantém o select para a nota avulsa',
  /: \[\{ forma: formData\.get\('formaPagamento'\) \|\| '99', valor: grandTotal\(\) \}\],/.test(telaSrc));
check('a tela barra quando a soma não fecha',
  /if \(pagamentosDoPedido\.length && somaDosPagamentos\(\) !== grandTotal\(\)\)/.test(telaSrc));
check('  e mostra as linhas para conferência', /Pagamentos da venda/.test(telaSrc));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
