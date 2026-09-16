const { banco, createId, assertNoError } = require('./client');
// Consulta crua so para a sequence do codigo: nextval nao passa pelo
// construtor de consultas. Ver getNextSalesCode.
const { consultar } = require('./conexao');

// O PRIMEIRO NÚMERO DA NUMERAÇÃO PRÓPRIA (fase CG).
//
// Abaixo de 16000 é histórico importado do ViperERP — 14.942 documentos, de 1 a
// 15.525. Quem manda no número é a sequence `sales_code_seq`, e a migração da
// fase CG fixa este mesmo piso nela; a constante existe para a QUEDA lá embaixo
// (banco sem a sequence) não contradizer o que a sequence diz. Dois lugares com
// o mesmo número é ruim, mas menos ruim do que uma queda que numera 15.526 e
// cruza a faixa do histórico.
const PRIMEIRO_NUMERO_DE_VENDA = 16000;

function mapSaleRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    date: row.date,
    customer: row.customer,
    productId: row.product_id,
    quantity: Number(row.quantity || 0),
    unitPrice: Number(row.unit_price || 0),
    total: Number(row.total || 0),
    status: row.status
  };
}

async function getSales() {
  const { data, error } = await banco.from('sales').select('*').order('date', { ascending: false });
  assertNoError(error, 'getSales');
  return (data || []).map(mapSaleRow);
}

async function createSale(payload) {
  const id = createId('sale');
  const row = {
    id,
    date: payload.date,
    customer: payload.customer,
    product_id: payload.productId,
    quantity: Number(payload.quantity || 0),
    unit_price: Number(payload.unitPrice || 0),
    total: Number(payload.total || 0),
    status: payload.status || 'faturado'
  };
  const { error } = await banco.from('sales').insert(row);
  assertNoError(error, 'createSale');
  return mapSaleRow(row);
}

function mapPurchaseRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    date: row.date,
    supplierId: row.supplier_id || '',
    supplier: row.supplier,
    productId: row.product_id,
    quantity: Number(row.quantity || 0),
    costPrice: Number(row.cost_price || 0),
    total: Number(row.total || 0),
    status: row.status
  };
}

async function getPurchases() {
  const { data, error } = await banco.from('purchases').select('*').order('date', { ascending: false });
  assertNoError(error, 'getPurchases');
  return (data || []).map(mapPurchaseRow);
}

async function getPurchaseById(id) {
  const { data, error } = await banco.from('purchases').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getPurchaseById');
  return mapPurchaseRow(data);
}

async function createPurchase(payload) {
  const id = payload.id || createId('purchase');
  const row = {
    id,
    date: payload.date,
    supplier_id: payload.supplierId || null,
    supplier: payload.supplier,
    product_id: payload.productId,
    quantity: Number(payload.quantity || 0),
    cost_price: Number(payload.costPrice || 0),
    total: Number(payload.total || 0),
    status: payload.status || 'pendente'
  };
  const { data, error } = await banco.from('purchases').insert(row).select().single();
  assertNoError(error, 'createPurchase');
  return mapPurchaseRow(data);
}

// PUT /api/purchases/:id hoje só muda status (pendente -> recebida/cancelada)
// — não existe edição dos demais campos da compra depois de criada. Update
// parcial (só grava as colunas presentes no payload) em vez de reconstruir a
// linha inteira, já que os outros usos previsíveis (corrigir fornecedor,
// por exemplo) também seriam parciais.
async function updatePurchase(id, payload) {
  const row = {};
  if (payload.status !== undefined) row.status = payload.status;
  if (payload.supplierId !== undefined) row.supplier_id = payload.supplierId || null;
  if (payload.supplier !== undefined) row.supplier = payload.supplier;
  if (payload.quantity !== undefined) row.quantity = Number(payload.quantity || 0);
  if (payload.costPrice !== undefined) row.cost_price = Number(payload.costPrice || 0);
  if (payload.total !== undefined) row.total = Number(payload.total || 0);
  const { data, error } = await banco.from('purchases').update(row).eq('id', id).select().single();
  assertNoError(error, 'updatePurchase');
  return mapPurchaseRow(data);
}

// Pedido/orçamento de verdade (múltiplos itens, cliente/empresa/vendedor/
// depósito vinculados a Cadastro, desconto, frete) — não o modelo antigo de
// item único que a tabela tinha na Fase A. "customer"/"amount" continuam
// sendo escritas (redundante com clientSupplierName/totalAmount) só pra
// satisfazer a constraint not null antiga sem precisar alterá-la.
function mapOrderQuoteRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    code: row.code,
    clientSupplierId: row.client_supplier_id || '',
    clientSupplierName: row.client_supplier_name || row.customer || '',
    companyId: row.company_id || '',
    sellerId: row.seller_id || '',
    depositId: row.deposit_id || '',
    date: row.date,
    dueDate: row.due_date || '',
    items: Array.isArray(row.items) ? row.items : [],
    // Fase AI — fichas dos anexos. O binário mora no Storage; aqui vem só nome,
    // tamanho, tipo, caminho e quem enviou.
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    discountAmount: Number(row.discount_amount || 0),
    discountPercent: Number(row.discount_percent || 0),
    freight: Number(row.freight || 0),
    itemsTotal: Number(row.items_total || 0),
    totalAmount: Number(row.total_amount ?? row.amount ?? 0),
    // Fase H — com `??` e não `||` no booleano: charge_freight_to_buyer false
    // é uma escolha do usuário, não "vazio". Se a coluna ainda não existe
    // (migração não aplicada), cai no padrão true.
    freightFixed: Boolean(row.freight_fixed),
    chargeFreightToBuyer: row.charge_freight_to_buyer ?? true,
    generalExpenses: Number(row.general_expenses || 0),
    assemblyFee: Number(row.assembly_fee || 0),
    servicesAmount: Number(row.services_amount || 0),
    sellerCommissionPercent: Number(row.seller_commission_percent || 0),
    agentCommissionPercent: Number(row.agent_commission_percent || 0),
    discountTotal: Number(row.discount_total || 0),
    sellerCommission: Number(row.seller_commission || 0),
    agentCommission: Number(row.agent_commission || 0),
    totalWeight: Number(row.total_weight || 0),
    // Fase I — "Informações Gerais". Mesma lógica de ausência de coluna: se a
    // migração não rodou, `row.x` é undefined e cai no padrão vazio/zero.
    registrationTime: row.registration_time || '',
    clientStatus: row.client_status || '',
    clientContact: row.client_contact || '',
    customerPoCode: row.customer_po_code || '',
    recipientEmail: row.recipient_email || '',
    billingRecipientEmail: row.billing_recipient_email || '',
    commercialRecipientEmail: row.commercial_recipient_email || '',
    approvalDate: row.approval_date || '',
    relatedOrderCode: Number(row.related_order_code || 0),
    revisionNumber: Number(row.revision_number || 0),
    generateServiceOrder: Boolean(row.generate_service_order),
    updatedByName: row.updated_by_name || '',
    // Fase J — cabeçalho da aba Dados.
    saleOrigin: row.sale_origin || 'Venda Direta',
    category: row.category || '',
    priceTable: row.price_table || '',
    // Fase K — abas Pagamentos, Entrega e Termos. Os objetos vêm como jsonb;
    // o servidor normaliza campo a campo antes de mandar para a tela.
    paymentInfo: row.payment_info || {},
    payments: Array.isArray(row.payments) ? row.payments : [],
    delivery: row.delivery || {},
    salesTerms: row.sales_terms || '',
    note: row.note || '',
    status: row.status,
    stockApplied: Boolean(row.stock_applied),
    financeApplied: Boolean(row.finance_applied),
    nfeId: row.nfe_id || '',
    // Fase AV: faturar exige documento fiscal. Quando a nota sai depois
    // (contingencia, SEFAZ fora), a dispensa fica registrada — com motivo,
    // autor e data. Ver o cabecalho da migracao fase-av.
    dispensaDocumentoFiscal: Boolean(row.dispensa_documento_fiscal),
    dispensaMotivo: row.dispensa_motivo || '',
    dispensaPor: row.dispensa_por || '',
    dispensaPorNome: row.dispensa_por_nome || '',
    dispensaEm: row.dispensa_em || null,
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * As colunas da fase AV (dispensa de documento fiscal).
 *
 * SO EXISTEM EM `orders`. A migracao fase-av so fez `alter table if exists
 * orders` — e nao por descuido: dispensar documento fiscal e' ato de FATURAR, e
 * orcamento nao fatura. A tabela `quotes` nao tem, nem deve ter, essas colunas.
 *
 * `dispensa_por/_em` sao gravados pelo servidor no instante da dispensa, e nao
 * vem da tela: quem dispensou e quando sao fatos, nao campos de formulario.
 */
function buildFaseAVRow(payload) {
  return {
    dispensa_documento_fiscal: Boolean(payload.dispensaDocumentoFiscal),
    dispensa_motivo: String(payload.dispensaMotivo || '').trim(),
    dispensa_por: payload.dispensaPor || null,
    dispensa_por_nome: payload.dispensaPorNome || '',
    dispensa_em: payload.dispensaEm || null
  };
}

function buildOrderQuoteRow(type, payload) {
  return {
    type,
    code: payload.code || null,
    client_supplier_id: payload.clientSupplierId || null,
    client_supplier_name: payload.clientSupplierName || '',
    company_id: payload.companyId || null,
    seller_id: payload.sellerId || null,
    deposit_id: payload.depositId || null,
    date: payload.date,
    due_date: payload.dueDate || null,
    items: payload.items || [],
    discount_amount: Number(payload.discountAmount || 0),
    discount_percent: Number(payload.discountPercent || 0),
    freight: Number(payload.freight || 0),
    items_total: Number(payload.itemsTotal || 0),
    total_amount: Number(payload.totalAmount || 0),
    note: payload.note || '',
    status: payload.status,
    stock_applied: Boolean(payload.stockApplied),
    created_by: payload.createdBy || null,
    created_by_name: payload.createdByName || '',
    updated_at: new Date().toISOString(),
    // colunas antigas (Fase A), mantidas só por compatibilidade/constraint:
    customer: payload.clientSupplierName || payload.customer || '-',
    amount: Number(payload.totalAmount || 0),
    ...buildFaseHRow(payload),
    ...buildFaseIRow(payload),
    ...buildFaseJRow(payload),
    ...buildFaseKRow(payload),
    ...buildFaseORow(payload),
    // O vínculo com a NF-e existe só em `orders`: orçamento não tem nota, e a
    // fase P nunca criou `nfe_id` em `quotes`. Mandar assim mesmo fazia TODO
    // salvamento de orçamento errar por coluna inexistente e voltar pelo
    // caminho de degradação — uma ida a mais ao banco por orçamento, e um
    // aviso no log mandando rodar uma migração que já estava aplicada.
    //
    // A FASE AV REPETIU ESSE ERRO, E PIOR. As cinco colunas dispensa_* estavam
    // no topo deste objeto, sem guarda, e `quotes` também não as tem. O
    // resultado não foi degradação: era 400 em TODO salvamento de orçamento —
    //
    //   createQuote: column "dispensa_documento_fiscal" of relation "quotes"
    //   does not exist
    //
    // O módulo de Orçamentos ficou inteiro fora do ar, e a suíte continuou
    // verde porque nenhum teste chamava createQuote (só buildOrderQuoteRow em
    // memória, que monta o objeto sem tocar no banco). A lição estava escrita
    // três linhas acima e não foi aplicada; agora as duas fases usam a MESMA
    // guarda, e scripts/test-sales-record-fields.js compara as chaves geradas
    // com as colunas reais de cada tabela.
    ...(type === 'order' ? buildFasePRow(payload) : {}),
    ...(type === 'order' ? buildFaseAVRow(payload) : {}),
    ...buildFaseAIRow(payload)
  };
}

// Colunas da Fase H do schema.sql. Ficam separadas porque, se a migração ainda
// não tiver sido rodada no Supabase, elas são removidas e a gravação segue com
// o resto — ver withColunasNovasFallback.
const COLUNAS_FASE_H = [
  'freight_fixed', 'charge_freight_to_buyer', 'general_expenses', 'assembly_fee',
  'services_amount', 'seller_commission_percent', 'agent_commission_percent',
  'discount_total', 'seller_commission', 'agent_commission', 'total_weight'
];

function buildFaseHRow(payload) {
  return {
    freight_fixed: Boolean(payload.freightFixed),
    charge_freight_to_buyer: payload.chargeFreightToBuyer !== false,
    general_expenses: Number(payload.generalExpenses || 0),
    assembly_fee: Number(payload.assemblyFee || 0),
    services_amount: Number(payload.servicesAmount || 0),
    seller_commission_percent: Number(payload.sellerCommissionPercent || 0),
    agent_commission_percent: Number(payload.agentCommissionPercent || 0),
    discount_total: Number(payload.discountTotal || 0),
    seller_commission: Number(payload.sellerCommission || 0),
    agent_commission: Number(payload.agentCommission || 0),
    total_weight: Number(payload.totalWeight || 0)
  };
}

// Colunas da Fase I do schema.sql — a seção "Informações Gerais" do formulário.
// Separadas pelo mesmo motivo das da Fase H (ver acima).
const COLUNAS_FASE_I = [
  'registration_time', 'client_status', 'client_contact', 'customer_po_code',
  'recipient_email', 'billing_recipient_email', 'commercial_recipient_email',
  'approval_date', 'related_order_code', 'revision_number',
  'generate_service_order', 'updated_by_name'
];

function buildFaseIRow(payload) {
  return {
    registration_time: payload.registrationTime || '',
    client_status: payload.clientStatus || '',
    client_contact: payload.clientContact || '',
    customer_po_code: payload.customerPoCode || '',
    recipient_email: payload.recipientEmail || '',
    billing_recipient_email: payload.billingRecipientEmail || '',
    commercial_recipient_email: payload.commercialRecipientEmail || '',
    // Coluna `date`: string vazia quebraria o cast no Postgres, então vira null.
    approval_date: payload.approvalDate || null,
    related_order_code: Number(payload.relatedOrderCode || 0),
    revision_number: Number(payload.revisionNumber || 0),
    generate_service_order: Boolean(payload.generateServiceOrder),
    updated_by_name: payload.updatedByName || ''
  };
}

// Colunas da Fase J do schema.sql — o cabeçalho da aba "Dados" do formulário.
const COLUNAS_FASE_J = ['sale_origin', 'category', 'price_table'];

function buildFaseJRow(payload) {
  return {
    sale_origin: payload.saleOrigin || 'Venda Direta',
    category: payload.category || '',
    price_table: payload.priceTable || ''
  };
}

// Colunas da Fase K do schema.sql — abas Pagamentos, Entrega e Termos.
const COLUNAS_FASE_K = ['payment_info', 'payments', 'delivery', 'sales_terms'];

// Fase O — marca se o pedido já gerou as contas a receber. Irmã de
// stock_applied: é ela que impede faturar duas vezes gerar cobrança dobrada.
const COLUNAS_FASE_O = ['finance_applied'];

// Fase P — qual NF-e saiu deste pedido (vínculo gravado nos dois sentidos).
const COLUNAS_FASE_AI = ['attachments'];

const COLUNAS_FASE_P = ['nfe_id'];

function buildFaseAIRow(payload) {
  return { attachments: payload.attachments || [] };
}

function buildFasePRow(payload) {
  return { nfe_id: payload.nfeId || null };
}

function buildFaseORow(payload) {
  return { finance_applied: Boolean(payload.financeApplied) };
}

function buildFaseKRow(payload) {
  return {
    payment_info: payload.paymentInfo || {},
    payments: payload.payments || [],
    delivery: payload.delivery || {},
    sales_terms: payload.salesTerms || ''
  };
}

// Da migração mais nova para a mais antiga. Na falha por coluna inexistente,
// tira UMA fase por vez: quem já rodou a Fase H não perde os campos dela só
// porque ainda não rodou a Fase I.
const FASES_OPCIONAIS = [
  { nome: 'Fase AI', colunas: COLUNAS_FASE_AI, perda: 'A lista de arquivos anexados (o arquivo em si continua no Storage, mas o pedido esquece que ele existe)' },
  { nome: 'Fase P', colunas: COLUNAS_FASE_P, perda: 'O vínculo entre o pedido e a NF-e emitida' },
  { nome: 'Fase O', colunas: COLUNAS_FASE_O, perda: 'A marca de que o pedido já gerou contas a receber' },
  { nome: 'Fase K', colunas: COLUNAS_FASE_K, perda: 'As abas Pagamentos, Entrega e Termos e Condições' },
  { nome: 'Fase J', colunas: COLUNAS_FASE_J, perda: 'Origem da venda, categoria e tabela de preços' },
  { nome: 'Fase I', colunas: COLUNAS_FASE_I, perda: 'Os campos de "Informações Gerais" (datas, contatos e e-mails)' },
  { nome: 'Fase H', colunas: COLUNAS_FASE_H, perda: 'Descontos combinados, frete, despesas e comissões' }
];
const fasesAvisadas = new Set();

// Se a migração ainda não foi aplicada, o PostgREST responde PGRST204/42703
// ("column not found"). Em vez de derrubar a gravação inteira — o usuário
// perderia o pedido que acabou de digitar — repete sem as colunas novas e
// avisa uma vez no log. Assim que o SQL for rodado, volta ao normal sozinho,
// sem precisar reiniciar.
function ehErroDeColunaInexistente(error) {
  if (!error) return false;
  return error.code === 'PGRST204'
    || error.code === '42703'
    || /column .* does not exist|Could not find the '.*' column/i.test(error.message || '');
}

// O PostgREST DIZ qual coluna faltou:
//   "Could not find the 'nfe_id' column of 'quotes' in the schema cache"
//   'column "nfe_id" of relation "quotes" does not exist'
// Aproveitar o nome é a diferença entre tirar a fase certa e sacrificar as
// outras junto.
function colunaDoErro(error) {
  const m = String((error && error.message) || '').match(/'([a-z_0-9]+)' column|column "([a-z_0-9]+)"/i);
  return m ? (m[1] || m[2]) : '';
}

// Se a migração ainda não foi aplicada, repete sem as colunas daquela fase em
// vez de derrubar a gravação inteira — o usuário perderia o pedido que acabou
// de digitar.
//
// Tira a fase DONA da coluna que o erro citou. A versão anterior tirava da
// mais nova para a mais velha até parar de dar erro, e isso tem um efeito
// colateral silencioso: `quotes` não tem `nfe_id` (a fase P foi só para
// `orders`), então TODO orçamento batia no erro e a primeira fase da lista era
// descartada junto — nada avisava, o orçamento salvava, e o dado daquela fase
// simplesmente não estava lá ao reabrir.
//
// Sem conseguir identificar a coluna, volta a tirar uma fase por vez: é pior,
// mas ainda melhor do que perder a gravação.
async function withColunasNovasFallback(row, executar, contexto) {
  let resultado = await executar(row);
  const reduzido = { ...row };
  const jaTiradas = new Set();

  const avisar = (fase) => {
    if (fasesAvisadas.has(fase.nome + contexto)) return;
    fasesAvisadas.add(fase.nome + contexto);
    console.warn(
      `[${contexto}] Colunas da ${fase.nome} ausentes no Supabase — gravando sem elas.\n` +
      `  ${fase.perda} NÃO serão persistidos até a migração ser aplicada.\n` +
      `  Rode o bloco "${fase.nome}" de banco/schema.sql no SQL Editor do Supabase.`
    );
  };

  // O limite é o número de fases: cada volta tira uma, então não há como
  // girar para sempre nem repetir a mesma.
  for (let volta = 0; volta < FASES_OPCIONAIS.length; volta += 1) {
    if (!ehErroDeColunaInexistente(resultado.error)) break;
    const coluna = colunaDoErro(resultado.error);
    const alvo = (coluna && FASES_OPCIONAIS.find((f) => f.colunas.includes(coluna) && !jaTiradas.has(f.nome)))
      || FASES_OPCIONAIS.find((f) => !jaTiradas.has(f.nome));
    if (!alvo) break;
    jaTiradas.add(alvo.nome);
    avisar(alvo);
    alvo.colunas.forEach((c) => delete reduzido[c]);
    resultado = await executar(reduzido);
  }
  return resultado;
}

async function getOrders() {
  const { data, error } = await banco.from('orders').select('*').order('code', { ascending: false });
  assertNoError(error, 'getOrders');
  return (data || []).map(mapOrderQuoteRow);
}

async function getOrderById(id) {
  const { data, error } = await banco.from('orders').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getOrderById');
  return mapOrderQuoteRow(data);
}

async function createOrder(payload) {
  const id = payload.id || createId('ord');
  const row = { id, ...buildOrderQuoteRow('order', payload), created_at: payload.createdAt || new Date().toISOString() };
  const { data, error } = await withColunasNovasFallback(row, (r) => banco.from('orders').insert(r).select().single(), 'createOrder');
  assertNoError(error, 'createOrder');
  return mapOrderQuoteRow(data);
}

async function updateOrder(id, payload) {
  const row = buildOrderQuoteRow('order', payload);
  const { data, error } = await withColunasNovasFallback(row, (r) => banco.from('orders').update(r).eq('id', id).select().single(), 'updateOrder');
  assertNoError(error, 'updateOrder');
  return mapOrderQuoteRow(data);
}

async function deleteOrder(id) {
  const { error } = await banco.from('orders').delete().eq('id', id);
  assertNoError(error, 'deleteOrder');
}

async function getQuotes() {
  const { data, error } = await banco.from('quotes').select('*').order('code', { ascending: false });
  assertNoError(error, 'getQuotes');
  return (data || []).map(mapOrderQuoteRow);
}

async function getQuoteById(id) {
  const { data, error } = await banco.from('quotes').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getQuoteById');
  return mapOrderQuoteRow(data);
}

async function createQuote(payload) {
  const id = payload.id || createId('qte');
  const row = { id, ...buildOrderQuoteRow('quote', payload), created_at: payload.createdAt || new Date().toISOString() };
  const { data, error } = await withColunasNovasFallback(row, (r) => banco.from('quotes').insert(r).select().single(), 'createQuote');
  assertNoError(error, 'createQuote');
  return mapOrderQuoteRow(data);
}

async function updateQuote(id, payload) {
  const row = buildOrderQuoteRow('quote', payload);
  const { data, error } = await withColunasNovasFallback(row, (r) => banco.from('quotes').update(r).eq('id', id).select().single(), 'updateQuote');
  assertNoError(error, 'updateQuote');
  return mapOrderQuoteRow(data);
}

async function deleteQuote(id) {
  const { error } = await banco.from('quotes').delete().eq('id', id);
  assertNoError(error, 'deleteQuote');
}

// O NUMERO DO PEDIDO E DO ORCAMENTO.
//
// Pedido e orcamento COMPARTILHAM a numeracao: o mesmo documento troca de tipo
// ao ser aprovado ou rebaixado, e mudar de numero junto faria o cliente receber
// duas referencias para a mesma venda.
//
// Este comentario descrevia um contador no arquivo local (data.nextSalesCode) e
// um max+1 sobre as duas tabelas. Nenhum dos dois vale mais: a fase BR trocou
// por uma sequence, e a fase CI ensinou a sequence a se recuperar quando uma
// importacao grava codigos por fora. Deixar o texto antigo aqui e' pior do que
// nao ter comentario — quem for corrigir um bug de numeracao comeca lendo isto.
async function getNextSalesCode() {
  // FASE BR: SEQUENCE, e nao max+1.
  //
  // O max+1 lia orders e quotes e somava um. Entre o SELECT e o INSERT ha uma
  // janela: duas requisicoes simultaneas — duas pessoas salvando, ou o mesmo
  // botao clicado duas vezes — liam o mesmo maior e gravavam o MESMO numero.
  // Nao ha unique em orders.code nem em quotes.code, entao o banco aceitava os
  // dois: a lista mostrava dois documentos com o mesmo numero e o cliente
  // recebia duas notas citando "Pedido 1042".
  //
  // nextval e' atomico. Mesmo desenho de purchase_orders_code_seq (fase AQ) e
  // stock_movements_code_seq (fase AP).
  //
  // O max+1 fica como QUEDA: banco sem a migracao da fase BR continua
  // gravando, com a janela de antes, em vez de nao gravar nada.
  try {
    const { rows } = await consultar("select nextval('sales_code_seq')::int as code");
    const code = rows[0].code;

    // A SEQUENCE PODE FICAR ATRAS DOS DADOS, E FICOU (fase CI).
    //
    // nextval resolve duas requisicoes simultaneas, mas nao sabe de nada que
    // entre na tabela SEM passar por aqui. A importacao do historico do
    // ViperERP gravou 14.942 documentos com os codigos 1 a 15.525 direto em
    // orders/quotes, e a sequence continuou no 1. Medido depois dela:
    //
    //     sequence ..................... 1
    //     maior codigo em orders ....... 15.525
    //     nextval devolveria ........... 1
    //     e o pedido 1 existe .......... LUIS ANTONIO DOS SANTOS, 11/06/2024
    //
    // Nao ha unique em orders.code nem em quotes.code, entao o banco aceitaria
    // o duplicado em silencio — exatamente o estrago que a fase BR descreveu:
    // a lista mostrando dois documentos com o mesmo numero, a busca por numero
    // devolvendo dois, e o cliente recebendo duas notas que citam o mesmo
    // pedido. A migracao da fase BR faz o setval, mas ela roda ANTES de
    // qualquer importacao: consertar so' no banco de hoje deixaria o proximo
    // arquivo de historico cair no mesmo buraco.
    //
    // Entao a garantia passa a ser aqui, onde o numero e' entregue: se o codigo
    // que saiu JA EXISTE, a sequence salta para depois do maior de orders e
    // quotes (elas compartilham a numeracao) e o numero e' tirado de novo.
    //
    // O custo e' uma consulta indexada a mais por documento criado (idx_orders_code
    // e idx_quotes_code existem), e o reparo acontece no maximo uma vez depois
    // de cada importacao. Criar venda nao e' caminho quente — e o preco de a
    // numeracao nao mentir e' baixo demais para discutir.
    const { rows: colisao } = await consultar(
      'select 1 from orders where code = $1 union all select 1 from quotes where code = $1 limit 1',
      [code]
    );
    if (!colisao.length) return code;

    // O PISO ENTRA AQUI TAMBÉM (fase CG), e antes não entrava.
    //
    // O terceiro argumento do greatest era `code` — o número que acabou de
    // colidir. Ele nunca fez diferença: um código que colidiu EXISTE numa das
    // duas tabelas, logo é sempre menor ou igual ao maior delas, e o greatest
    // já o descartava. O efeito real era outro, e silencioso: num banco cujos
    // dados param no histórico do ViperERP (1 a 15.525), o reparo devolvia
    // 15.526 — dentro da faixa que a fase CG existe para separar.
    //
    // Com PRIMEIRO_NUMERO_DE_VENDA - 1 o reparo diz o mesmo que a sequence, a
    // migração e a queda. Não pode rebaixar nada: continua sendo um greatest.
    const { rows: reparo } = await consultar(`
      select setval('sales_code_seq', greatest(
        coalesce((select max(code) from orders), 0),
        coalesce((select max(code) from quotes), 0),
        $1::int
      ), true) as ajustada, nextval('sales_code_seq')::int as code`, [PRIMEIRO_NUMERO_DE_VENDA - 1]);
    console.error(`[vendas] sales_code_seq estava atras dos dados (devolveu ${code}, que ja existe). `
      + `Saltou para ${reparo[0].ajustada} e o codigo deste documento e' ${reparo[0].code}.`);
    return reparo[0].code;
  } catch (erro) {
    if (!/sales_code_seq/i.test(erro.message || '')) throw erro;
    console.error('[vendas] sales_code_seq nao existe — rode banco/migrations/fase-br-sequence-do-codigo-de-venda.sql');
    const [{ data: lastOrder }, { data: lastQuote }] = await Promise.all([
      banco.from('orders').select('code').order('code', { ascending: false }).limit(1).maybeSingle(),
      banco.from('quotes').select('code').order('code', { ascending: false }).limit(1).maybeSingle()
    ]);
    // O piso era 1000, de quando a numeração começava ali. Desde a fase CG é
    // PRIMEIRO_NUMERO_DE_VENDA — ver a constante no topo.
    const maior = Math.max(Number(lastOrder?.code) || 0, Number(lastQuote?.code) || 0, PRIMEIRO_NUMERO_DE_VENDA - 1);
    return maior + 1;
  }
}

function mapImportLogRow(row) {
  if (!row) return null;
  return { id: row.id, type: row.type, source: row.source, count: row.count, createdAt: row.created_at };
}

async function getImportLogs() {
  const { data, error } = await banco.from('import_logs').select('*').order('created_at', { ascending: false });
  assertNoError(error, 'getImportLogs');
  return (data || []).map(mapImportLogRow);
}

async function addImportLog(payload) {
  const row = { id: createId('import'), type: payload.type, source: payload.source || 'manual', count: payload.count || 0, created_at: new Date().toISOString() };
  const { error } = await banco.from('import_logs').insert(row);
  assertNoError(error, 'addImportLog');
  return mapImportLogRow(row);
}

module.exports = {
  getSales, createSale,
  getPurchases, getPurchaseById, createPurchase, updatePurchase,
  getOrders, getOrderById, createOrder, updateOrder, deleteOrder,
  getQuotes, getQuoteById, createQuote, updateQuote, deleteQuote,
  getNextSalesCode,
  getImportLogs, addImportLog,
  // Exportados para teste (scripts/test-sales-record-fields.js): são as peças
  // puras que decidem se um campo do formulário sobrevive ao salvar/reabrir.
  buildOrderQuoteRow, mapOrderQuoteRow, withColunasNovasFallback, FASES_OPCIONAIS,
  // Também para teste: é ele que decide QUAL fase é descartada quando falta
  // coluna, e errar aqui joga fora dado de uma fase que estava aplicada.
  colunaDoErro
};
