#!/usr/bin/env node
// Campos do Pedido/Orçamento: ida e volta entre o formulário e o banco.
//
// A falha que este teste existe para pegar é sempre a mesma: um campo novo
// aparece na tela, é digitado, some ao salvar (ou ao reabrir para editar) e o
// usuário só descobre depois. Acontece quando alguém acrescenta o campo no HTML
// e esquece de uma das três pontas — buildOrderQuoteRow (grava),
// mapOrderQuoteRow (lê) ou a lista de colunas da fase (fallback de migração).
//
// Não precisa de servidor nem de banco: só as funções puras do módulo.
require('dotenv').config();
const db = require('../lib/db/vendas-compras');

let falhas = 0;
const check = (nome, cond, det) => { console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det ? ' -> ' + det : ''}`); if (!cond) falhas++; };

// Um pedido com TODO campo do formulário preenchido com valor não-padrão: se
// algum deles não sobreviver à ida e volta, o valor padrão denuncia.
const pedido = {
  code: 1234,
  clientSupplierId: 'cli-1', clientSupplierName: 'ACME LTDA',
  companyId: 'emp-1', sellerId: 'vend-1', depositId: 'dep-1',
  date: '2026-08-06', dueDate: '2026-09-06',
  items: [{ productId: 'p1', name: 'Item A', sku: 'A1', quantity: 2, unitPrice: 500, total: 1000 }],
  status: 'pendente', note: 'observação',
  // Fase H — financeiro
  discountAmount: 50, discountPercent: 10, freight: 80, freightFixed: true,
  chargeFreightToBuyer: false, generalExpenses: 30, assemblyFee: 25,
  servicesAmount: 100, sellerCommissionPercent: 5, agentCommissionPercent: 3,
  itemsTotal: 1000, totalAmount: 1000, discountTotal: 150,
  sellerCommission: 47.5, agentCommission: 28.5, totalWeight: 12.5,
  // Fase I — Informações Gerais
  registrationTime: '14:35', clientStatus: 'Ativo', clientContact: '47997490867',
  customerPoCode: 'OC-9988', recipientEmail: 'destino@cliente.com',
  billingRecipientEmail: 'faturamento@cliente.com',
  commercialRecipientEmail: 'comercial@cliente.com',
  approvalDate: '2026-08-10', relatedOrderCode: 777, revisionNumber: 2,
  generateServiceOrder: true, updatedByName: 'Elisangela',
  // Fase J — cabeçalho da aba Dados
  saleOrigin: 'Televendas', category: 'Revenda', priceTable: 'Tabela B',
  // Fase K — abas Pagamentos, Entrega e Termos (objetos inteiros, em jsonb)
  paymentInfo: {
    accountPlan: 'REVENDA DE MERCADORIAS', paymentMethodId: 'fp-1', entryGroup: 'Grupo A',
    ignoreCreditLimit: true, nfeNumber: '4455', nfseNumber: '77', nfeBillingDate: '2026-08-07',
    printDocument: 'Boleto', billingDetails: 'Faturamento parcial', cardTransaction: 'TX-9090',
    paymentTerm: 'aprazo', cashbackAmount: 0
  },
  payments: [
    { methodId: 'fp-1', methodName: 'Boleto', dueDate: '2026-09-05', amount: 600, note: 'entrada' },
    { methodId: 'fp-2', methodName: 'PIX', dueDate: '2026-10-05', amount: 400, note: '' }
  ],
  delivery: {
    addressType: 'Outro Endereço', shippingMethod: 'Transportadora', carrierId: 'transp-1',
    trackingCode: 'BR123456789', shippingDate: '2026-08-08', showCteOptions: true,
    deliveryForecast: '2026-08-15', onlineDeliveryType: '', zipCode: '89000000',
    city: 'Blumenau', state: 'SC', district: 'Centro', street: 'Rua das Palmeiras',
    number: '100', complement: 'Sala 2', country: 'Brasil', cityCode: '4202404', stateCode: '42'
  },
  salesTerms: 'Garantia de 12 meses contra defeito de fabricação.'
};

console.log('\n--- ida e volta: nada se perde entre gravar e reabrir ---');
const row = db.buildOrderQuoteRow('order', pedido);
const lido = db.mapOrderQuoteRow(row);

// Comparados um a um (e não com deep-equal do objeto inteiro) para o teste
// apontar QUAL campo se perdeu, que é a informação útil quando quebra.
Object.keys(pedido)
  .filter((campo) => !['items', 'code'].includes(campo))
  .forEach((campo) => {
    check(campo, JSON.stringify(lido[campo]) === JSON.stringify(pedido[campo]),
      `gravou/leu ${JSON.stringify(lido[campo])}`);
  });
check('items sobrevivem', lido.items.length === 1 && lido.items[0].name === 'Item A');
check('code sobrevive', Number(lido.code) === 1234);

console.log('\n--- padrões de registro antigo (colunas ainda inexistentes) ---');
const vazio = db.mapOrderQuoteRow({ id: 'x', type: 'order', code: 1, status: 'pendente', date: '2026-01-01' });
check('origem da venda cai no padrão', vazio.saleOrigin === 'Venda Direta', vazio.saleOrigin);
check('cobrar frete do comprador cai em true', vazio.chargeFreightToBuyer === true);
check('categoria vazia não vira undefined', vazio.category === '');
check('data de aprovação vazia não vira undefined', vazio.approvalDate === '');
check('número da revisão vira 0', vazio.revisionNumber === 0);
check('aba Pagamentos vira objeto vazio, não undefined', JSON.stringify(vazio.paymentInfo) === '{}');
check('lista de pagamentos vira array vazio', Array.isArray(vazio.payments) && vazio.payments.length === 0);
check('aba Entrega vira objeto vazio', JSON.stringify(vazio.delivery) === '{}');
check('termos de venda viram string vazia', vazio.salesTerms === '');

console.log('\n--- data de aprovação vazia não pode ir como string para coluna date ---');
const semAprovacao = db.buildOrderQuoteRow('quote', { ...pedido, approvalDate: '' });
check('approval_date vazio vira null', semAprovacao.approval_date === null, String(semAprovacao.approval_date));
check('due_date vazio vira null', db.buildOrderQuoteRow('quote', { ...pedido, dueDate: '' }).due_date === null);

// A tela não lê o banco direto: lê serializeSalesRecord (server.js). Um campo
// que exista nas duas pontas do banco mas falte lá some do mesmo jeito ao
// reabrir o registro. Como server.js sobe um servidor ao ser importado, a
// checagem é no texto da função — grosseira de propósito, só confere que o
// nome do campo aparece na resposta.
console.log('\n--- a API repassa para a tela tudo que o banco devolve ---');
const fs = require('fs');
const path = require('path');
const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const inicio = servidor.indexOf('function serializeSalesRecord');
const corpoSerializer = servidor.slice(inicio, servidor.indexOf('\nfunction ', inicio + 10));
check('serializeSalesRecord encontrado em server.js', inicio > 0 && corpoSerializer.length > 200);

// Renomeados de propósito na resposta da API, e campos internos que a tela não usa.
const RENOMEADOS = { clientSupplierName: 'customer', totalAmount: 'amount' };
const INTERNOS = ['createdBy', 'stockApplied'];
Object.keys(lido)
  .filter((campo) => !INTERNOS.includes(campo))
  .forEach((campo) => {
    const esperado = RENOMEADOS[campo] || campo;
    // `campo:` ou `campo,` — a segunda forma cobre o atalho do JS (`items,`).
    check(`API repassa ${campo}`, new RegExp(`\\b${esperado}\\s*[:,]`).test(corpoSerializer));
  });

console.log('\n--- fallback de migração: só as fases que faltam são descartadas ---');
const erroColuna = { code: 'PGRST204', message: "Could not find the column" };

// Banco fictício: as duas migrações mais novas ainda não foram rodadas, as
// mais antigas sim. A gravação tem que perder só o que o banco não tem.
const nomesPendentes = db.FASES_OPCIONAIS.slice(0, 2).map((fase) => fase.nome);
const colunasAusentes = db.FASES_OPCIONAIS
  .filter((fase) => nomesPendentes.includes(fase.nome))
  .flatMap((fase) => fase.colunas);
const colunasAplicadas = db.FASES_OPCIONAIS
  .filter((fase) => !nomesPendentes.includes(fase.nome))
  .flatMap((fase) => fase.colunas);

(async () => {
  const tentativas = [];
  const resultado = await db.withColunasNovasFallback(row, async (r) => {
    tentativas.push(r);
    // O Postgres recusa a linha inteira enquanto sobrar UMA coluna inexistente.
    return colunasAusentes.some((coluna) => coluna in r) ? { error: erroColuna } : { data: r, error: null };
  }, 'teste');

  const ultimaTentativa = tentativas[tentativas.length - 1];
  check(`insistiu até gravar (${nomesPendentes.join(' e ')} pendentes)`, tentativas.length === nomesPendentes.length + 1, `${tentativas.length} tentativas`);
  check('descartou as colunas que o banco não tem', colunasAusentes.every((coluna) => !(coluna in ultimaTentativa)));
  check('MANTEVE as colunas das migrações já aplicadas', colunasAplicadas.every((coluna) => coluna in ultimaTentativa));
  check('gravação foi concluída', Boolean(resultado.data) && !resultado.error);

  // Banco sem nenhuma das migrações: desce fase a fase até gravar o essencial.
  const todas = [];
  await db.withColunasNovasFallback(row, async (r) => {
    todas.push(r);
    return todas.length <= db.FASES_OPCIONAIS.length ? { error: erroColuna } : { data: r, error: null };
  }, 'teste');
  const ultima = todas[todas.length - 1];
  check('esgotadas as fases, ainda grava o núcleo do pedido',
    ultima.total_amount === 1000 && ultima.client_supplier_name === 'ACME LTDA');
  check('nenhuma coluna opcional sobrou na última tentativa',
    db.FASES_OPCIONAIS.every((fase) => fase.colunas.every((coluna) => !(coluna in ultima))));

  console.log('\n--- item que chega só com o productId não é descartado calado ---');
  // normalizeSalesItems filtra por `item.name`, e quem integra manda só o id.
  // O item sumia e o pedido inteiro voltava com "Adicione ao menos um produto"
  // — mensagem que manda conferir o campo errado. O servidor tem o id: busca o
  // nome antes de filtrar, em vez de jogar a linha fora.
  const serverSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  check('existe o completador de nomes', /async function completarNomesDosItens/.test(serverSrc));
  check('ele só consulta o que falta', /if \(!item \|\| String\(item\.name \|\| ''\)\.trim\(\) \|\| !item\.productId\) return item;/.test(serverSrc));
  check('e não derruba o pedido se a busca falhar', /getProductById\(item\.productId\)\.catch\(\(\) => null\)/.test(serverSrc));
  // As DUAS pontas: criar e editar pedido passam pelo mesmo filtro.
  const usos = (serverSrc.match(/normalizeSalesItems\(await completarNomesDosItens\(body\.items\)\)/g) || []).length;
  check('as duas rotas de pedido usam o completador', usos === 2, `${usos} de 2`);
  check('nenhuma rota ficou com a chamada antiga', !/normalizeSalesItems\(body\.items\)/.test(serverSrc));
  // Lista vazia e lista toda recusada são problemas diferentes.
  check('a mensagem distingue "não mandou item" de "item inválido"', /function mensagemItensInvalidos/.test(serverSrc));
  check('e as duas rotas usam a mensagem certa',
    (serverSrc.match(/mensagemItensInvalidos\(body\.items\)/g) || []).length === 2);

  console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====\n' : `\n===== ${falhas} CHECK(S) FALHARAM =====\n`);
  process.exit(falhas === 0 ? 0 : 1);
})();
