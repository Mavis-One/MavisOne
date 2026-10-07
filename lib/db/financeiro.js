const { banco, createId, assertNoError } = require('./client');
// Fase AY: o campo Documento comeca com o numero do lancamento (LF0042). O
// mesmo arquivo que o navegador carrega — tela e banco nao podem discordar
// sobre onde termina o numero e comeca a referencia externa.
const lancamentoCodigo = require('../../public/modules/shared/lancamento_codigo');
const { consultar } = require('./conexao');

// ----------------------------------------------------------------------------
// Lançamentos financeiros
// ----------------------------------------------------------------------------
function mapFinancialEntryRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    // Fase AT: o numero proprio do lancamento (LF0001). Nulo nos que a
    // migracao ainda nao alcancou — ver public/modules/shared/lancamento_codigo.js,
    // que devolve string vazia nesse caso em vez de inventar "LF0000".
    code: row.code == null ? null : Number(row.code),
    type: row.type,
    date: row.date,
    dueDate: row.due_date,
    amount: Number(row.amount || 0),
    description: row.description,
    document: row.document || '',
    note: row.note || '',
    category: row.category_id || '',
    costCenter: row.cost_center_id || '',
    bankAccountId: row.bank_account_id || '',
    targetBankAccountId: row.target_bank_account_id || '',
    // Fase CD -- de qual estabelecimento e' o lancamento. Vazio nos anteriores
    // a' fase, e vazio quer dizer "nao informado": a regra de contas por
    // estabelecimento nao julga o que existe antes dela.
    estabelecimentoId: row.estabelecimento_id || '',
    clientSupplierId: row.client_supplier_id || '',
    clientSupplierName: row.client_supplier_name || '',
    referenceId: row.reference_id || '',
    nfeId: row.nfe_id || '',
    status: row.status,
    // Fase AX: por que este lancamento foi cancelado, por quem e quando. Nulos
    // nos cancelados de antes da fase — a tela diz "motivo nao registrado" em
    // vez de inventar um.
    cancelReason: row.cancel_reason || '',
    cancelledAt: row.cancelled_at || null,
    cancelledByName: row.cancelled_by_name || '',
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    // O CARTAO E A TAXA (fase BX). Nulos nos titulos anteriores a fase e em
    // tudo que nao e cartao — nulo e "nao se aplica", e zero seria "taxa zero
    // contratada", que e outra afirmacao. A tela distingue as duas.
    cardAcquirerId: row.card_acquirer_id || '',
    cardAcquirerName: row.card_acquirer_name || '',
    cardBrand: row.card_brand || '',
    cardAuthorization: row.card_authorization || '',
    feePercent: row.fee_percent == null ? null : Number(row.fee_percent),
    feeAmount: row.fee_amount == null ? null : Number(row.fee_amount),
    // O que cai na conta de verdade. `amount` continua sendo o bruto da venda.
    netAmount: row.net_amount == null ? null : Number(row.net_amount),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getFinancialEntries() {
  const { data, error } = await banco.from('financial_entries').select('*').order('date', { ascending: false });
  assertNoError(error, 'getFinancialEntries');
  return (data || []).map(mapFinancialEntryRow);
}

/** QUANTOS lançamentos existem — sem trazer nenhum. Ver contarOrders. */
async function contarFinancialEntries() {
  const { count, error } = await banco.from('financial_entries').select('*', { count: 'exact', head: true });
  assertNoError(error, 'contarFinancialEntries');
  return count || 0;
}

async function getFinancialEntryById(id) {
  const { data, error } = await banco.from('financial_entries').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getFinancialEntryById');
  return mapFinancialEntryRow(data);
}

// ----------------------------------------------------------------------------
// LER SÓ O QUE A ROTA USA (fase DS — desempenho do Financeiro)
//
// `getFinancialEntries` + `getAllFinancialPayments` são 27.362 + 25.709 linhas
// (medido em 06/10/2026). No Postgres elas custam 66 + 18 ms; no Node, 400 a
// 700 ms — quase tudo dentro do driver transformando linha em objeto (`paraIso`
// das datas com hora, decodificação de texto, coletor de lixo). E isso era pago
// a CADA requisição do Financeiro, inclusive nas que usam um lançamento só ou
// nenhum, no único processo do servidor: enquanto uma tela abria, ninguém mais
// era atendido.
//
// As funções abaixo leem pelo índice o que cada rota precisa. Todas passam pelo
// MESMO `mapFinancialEntryRow`/`mapPaymentRow` e pelos mesmos parsers de tipo
// (lib/db/conexao.js): o objeto que sai é o mesmo que sairia da leitura inteira.
// Nenhuma guarda nada em memória — cada chamada vai ao banco, e dado velho de
// financeiro seria bug.
// ----------------------------------------------------------------------------

/**
 * Os ids que podem ir ao banco. O Postgres não guarda o byte NUL em texto e
 * RECUSA um parâmetro que o contenha ("invalid byte sequence for encoding
 * UTF8: 0x00") — a rota viraria 500. Um id com NUL nunca casaria com linha
 * nenhuma (nenhuma coluna tem esse byte), então tirá-lo da lista dá a mesma
 * resposta do `find` em JS de antes: não achou, 404.
 */
function idsParaOBanco(ids) {
  return [...new Set((ids || []).filter((id) => id && !String(id).includes('\u0000')))];
}

/** Os lançamentos destes ids (a PK resolve). A ordem NÃO é garantida: quem chama reordena. */
async function getFinancialEntriesByIds(ids) {
  const lista = idsParaOBanco(ids);
  if (!lista.length) return [];
  const { data, error } = await banco.from('financial_entries').select('*').in('id', lista);
  assertNoError(error, 'getFinancialEntriesByIds');
  return (data || []).map(mapFinancialEntryRow);
}

/**
 * As baixas de alguns lançamentos (idx_financial_payments_entry_id), na ordem de
 * `getAllFinancialPayments`: `created_at` crescente.
 *
 * O `id` no desempate é novo, e de propósito: duas baixas com o mesmo
 * `created_at` saíam numa ordem que o Postgres escolhia a cada leitura (o sort
 * da tabela inteira vai para disco, em paralelo). A ordem continua sendo uma
 * das que já podiam sair — só deixa de mudar de uma requisição para a outra.
 */
async function getFinancialPaymentsByEntries(entryIds) {
  const lista = idsParaOBanco(entryIds);
  if (!lista.length) return [];
  const { data, error } = await banco.from('financial_payments').select('*')
    .in('entry_id', lista)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  assertNoError(error, 'getFinancialPaymentsByEntries');
  return (data || []).map(mapPaymentRow);
}

/**
 * As parcelas das NF-e MANUAIS (idx_financial_entries_nfe_id), na ordem de
 * `getFinancialEntries` (`date` decrescente). Desempate por `id` pelo mesmo
 * motivo de `getFinancialPaymentsByEntries`: as parcelas de uma nota têm todas a
 * mesma `date` (a da nota), e a ordem entre elas mudava a cada leitura.
 */
async function getFinancialEntriesByNfe(nfeIds) {
  const lista = idsParaOBanco(nfeIds);
  if (!lista.length) return [];
  const { data, error } = await banco.from('financial_entries').select('*')
    .in('nfe_id', lista)
    .order('date', { ascending: false })
    .order('id', { ascending: false });
  assertNoError(error, 'getFinancialEntriesByNfe');
  return (data || []).map(mapFinancialEntryRow);
}

/**
 * Os títulos que a conciliação pode sugerir: pendentes e parciais.
 *
 * `findBankTransactionMatches` (server.js) descarta tudo que não é
 * `String(status).toLowerCase()` em {pending, parcial} ANTES de qualquer conta;
 * aqui o mesmo corte vai para o banco. `lower(status collate "C")` só dobra
 * A–Z, e é a tradução exata: no JavaScript, o único caractere não-ASCII cuja
 * minúscula é ASCII é o sinal de Kelvin (vira "k"), e nenhuma das duas palavras
 * tem "k". Com a collation padrão do banco (en_US) `lower('İ')` viraria "i" e
 * casaria onde o JS não casa — por isso o `collate "C"`.
 *
 * A ordem é a de `getFinancialEntries` (`date` decrescente), com o `id` no
 * desempate: a conciliação ordena os candidatos por diferença de valor e de
 * dias com um sort ESTÁVEL, então, num empate, quem vem antes na entrada vem
 * antes na sugestão. Hoje os títulos do mesmo dia chegavam numa ordem que mudava
 * a cada leitura; agora é sempre a mesma.
 */
async function getLancamentosEmAberto() {
  const { rows } = await consultar(
    `select * from financial_entries
      where lower(status collate "C") in ('pending', 'parcial')
      order by date desc, id desc`
  );
  return rows.map(mapFinancialEntryRow);
}

/**
 * O que o resumo do dashboard do Financeiro lê de cada lançamento — e só isso.
 *
 * `buildFinanceDashboardSummary` (server.js) soma e lista a partir de dez
 * campos: id, data, vencimento, tipo, situação, valor, descrição e os três que
 * dão nome à contraparte. Não lê baixa nenhuma, nem as datas com hora (que são o
 * que mais custa ao driver). Trazer só estas colunas e rodar a MESMA função dá
 * o mesmo resumo, número por número.
 *
 * NÃO é um agregado no banco, de propósito: somar no Postgres daria o mesmo
 * valor em centavos, mas a soma em ponto flutuante feita em outra ordem pode
 * mudar o último bit — e soma de dinheiro aqui só muda quando a regra muda.
 *
 * A ordem é `date` decrescente com `id` no desempate. É uma das ordens que a
 * leitura inteira já podia devolver (o desempate dela mudava a cada chamada), e
 * é a que decide a sequência das somas e a dos itens de mesmo dia nas listas
 * "próximos vencimentos" — que agora param de trocar de lugar entre uma
 * atualização e a seguinte.
 */
async function getFinancialEntriesParaResumo() {
  const { rows } = await consultar(
    `select id, date, due_date, type, status, amount, description,
            client_supplier_id, client_supplier_name, reference_id
       from financial_entries
      order by date desc, id desc`
  );
  return rows.map(mapFinancialEntryRow);
}

/**
 * OS FILTROS DA LISTA DE LANÇAMENTOS QUE O BANCO RESOLVE SOZINHO.
 *
 * São os de `filterFinanceEntries` (server.js) que comparam um campo cru com o
 * valor pedido — igualdade, intervalo de data, intervalo de valor. Cada um é a
 * tradução literal da linha de lá; se aquela função mudar um destes filtros,
 * este também muda (e scripts/test-lista-de-lancamentos.js acusa a divergência
 * comparando as duas listas inteiras).
 *
 *   igualdade   aplicada só quando o parâmetro não é vazio, como lá (`if (x)`).
 *               `row.x || ''` do map nunca é igual a um parâmetro não vazio
 *               quando a coluna é nula, e `coluna = $1` também não.
 *
 *   datas       comparação de TEXTO, byte a byte (`collate "C"`): é a mesma
 *               comparação de string do JS, porque o parser de `date` do driver
 *               devolve exatamente `date::text`. Assim `dateFrom=2026-3-1` ou
 *               `abc` dão o mesmo resultado de hoje.
 *
 *   valores     `Number(entry.amount || 0) >= Number(amountMin)`. O número pedido
 *               é calculado AQUI, no JS, e vai como float8; numeric -> float8 e
 *               `Number(texto)` arredondam para o mesmo double. NaN pedido
 *               (`amountMin=abc`) não casa com nada lá (toda comparação com NaN
 *               é falsa) — e aqui vira `false`, porque no Postgres NaN é MAIOR
 *               que tudo e `<= 'NaN'` seria verdadeiro. NaN gravado vira 0, como
 *               o `|| 0` do map.
 *
 * FICAM DE FORA, e vão para o JS: `search`, `type` e `status`. Os três dependem
 * de funções com regra (`resolveFinanceCounterparty`, `classifyFinanceEntry`,
 * `financeEntryStatusLabel`); traduzi-las para SQL criaria uma segunda cópia da
 * regra para manter igual à primeira. Quem chama traz as colunas que essas
 * funções leem e roda as funções de verdade.
 */
const LISTA_IGUALDADE = [
  ['clientSupplierId', 'client_supplier_id'],
  ['category', 'category_id'],
  ['costCenter', 'cost_center_id'],
  ['bankAccountId', 'bank_account_id']
];
const LISTA_VALOR = `(case when amount = 'NaN'::numeric then 0 else amount end)::float8`;

function montarFiltroDaLista(query) {
  const onde = [];
  const valores = [];
  const p = (valor) => { valores.push(valor); return `$${valores.length}`; };
  // O byte NUL não pode ir ao banco (ver idsParaOBanco). Na igualdade, nenhuma
  // coluna o contém: `===` nunca casa, e o filtro vira `false` — lista vazia,
  // como antes.
  LISTA_IGUALDADE.forEach(([parametro, coluna]) => {
    const valor = query.get(parametro);
    if (!valor) return;
    onde.push(valor.includes('\u0000') ? 'false' : `${coluna} = ${p(valor)}`);
  });
  // Nas datas, a comparação de texto do JS com um parâmetro que tem NUL é
  // reescrita SEM ele, com o mesmo resultado. Seja `t0` o que vem antes do
  // primeiro NUL; a data `s` nunca tem NUL, e NUL é o menor caractere:
  //   s >= t  <=>  s > t0   (s igual a t0 é prefixo de t, logo menor;
  //                          s mais longo que t0 e começando por ele é maior)
  //   s <= t  <=>  s <= t0  (s nunca é igual a t, então é o contrário do acima)
  const comparaData = (expressao, comparador, texto) => {
    const nul = texto.indexOf('\u0000');
    if (nul < 0) return `${expressao} ${comparador} ${p(texto)}`;
    return `${expressao} ${comparador === '>=' ? '>' : '<='} ${p(texto.slice(0, nul))}`;
  };
  const dateFrom = query.get('dateFrom');
  const dateTo = query.get('dateTo');
  if (dateFrom) onde.push(comparaData('(date::text collate "C")', '>=', dateFrom));
  if (dateTo) onde.push(comparaData('(date::text collate "C")', '<=', dateTo));
  // `dueDate || date` do JS: due_date é NOT NULL hoje, o coalesce é para o dia
  // em que deixar de ser.
  const dueFrom = query.get('dueFrom');
  const dueTo = query.get('dueTo');
  if (dueFrom) onde.push(comparaData('(coalesce(due_date, date)::text collate "C")', '>=', dueFrom));
  if (dueTo) onde.push(comparaData('(coalesce(due_date, date)::text collate "C")', '<=', dueTo));
  const amountMin = query.get('amountMin');
  const amountMax = query.get('amountMax');
  [[amountMin, '>='], [amountMax, '<=']].forEach(([texto, comparador]) => {
    if (!texto) return;
    const numero = Number(texto);
    onde.push(Number.isNaN(numero) ? 'false' : `${LISTA_VALOR} ${comparador} ${p(numero)}::float8`);
  });
  return { onde: onde.length ? ` where ${onde.join(' and ')}` : '', valores };
}

/**
 * Os lançamentos que passam nos filtros de banco, só com as colunas de que a
 * lista precisa para decidir QUAIS mostrar (fase DS).
 *
 * Sempre `id` e `date` — é por eles que a lista ordena. Mais `type`/`status`/
 * `due_date` quando a tela filtra por tipo ou situação, e as colunas do nome da
 * contraparte quando há busca. Os objetos saem do mesmo `mapFinancialEntryRow`:
 * os campos que não vieram ficam com o valor padrão do map, e ninguém os lê —
 * quem desenha a página relê os escolhidos por id, inteiros.
 *
 * A ordem do banco (`date desc, id collate "C" desc`) é a da tela na prática,
 * mas quem GARANTE a ordem é o sort do JS feito depois, com o comparador da
 * rota: `collate "C"` e `localeCompare` divergem em ids com maiúscula ou
 * pontuação. Entrada já quase ordenada só deixa aquele sort barato.
 */
async function getLancamentosDaLista(query) {
  const busca = String(query.get('search') || '').trim();
  const comRotulo = Boolean(query.get('type') || query.get('status'));
  const colunas = ['id', 'date'];
  if (comRotulo || busca) colunas.push('type');
  if (comRotulo) colunas.push('status', 'due_date');
  if (busca) colunas.push('description', 'client_supplier_id', 'client_supplier_name', 'reference_id');
  const { onde, valores } = montarFiltroDaLista(query);
  const { rows } = await consultar(
    `select ${colunas.join(', ')} from financial_entries${onde} order by date desc, id collate "C" desc`,
    valores
  );
  return rows.map(mapFinancialEntryRow);
}

/**
 * O proximo numero do lancamento, da sequence do banco (fase AT).
 *
 * Nao e max(code)+1 lido aqui: isso reusa numero depois de uma exclusao e gera
 * o mesmo duas vezes quando dois lancamentos nascem ao mesmo tempo. Numero de
 * documento repetido e pior do que numero nenhum — dois papeis diferentes
 * dizendo ser o mesmo.
 */
async function proximoCodigoDeLancamento() {
  const { rows } = await consultar("select nextval('financial_entries_code_seq')::int as code");
  return rows[0].code;
}

async function createFinancialEntry(payload) {
  const id = payload.id || createId('fin');
  const now = new Date().toISOString();
  // O NUMERO SAI DA SEQUENCE ANTES DA LINHA, e nao dentro do objeto: o campo
  // Documento precisa dele para nascer com o prefixo (fase AY), e `code:` sendo
  // um await no meio do literal deixaria o valor indisponivel duas linhas
  // abaixo.
  const code = await proximoCodigoDeLancamento();
  const row = {
    id,
    code,
    type: payload.type,
    date: payload.date,
    due_date: payload.dueDate || payload.date,
    amount: Number(payload.amount || 0),
    description: payload.description,
    // Fase AY: "LF0042 · 000000123". O documento externo que a origem passou
    // continua inteiro depois do numero — e' por ele que a conferencia liga a
    // conta a pagar a nota do fornecedor.
    document: lancamentoCodigo.documento(code, payload.document || ''),
    note: payload.note || '',
    category_id: payload.category || null,
    cost_center_id: payload.costCenter || null,
    bank_account_id: payload.bankAccountId || null,
    target_bank_account_id: payload.targetBankAccountId || null,
    estabelecimento_id: payload.estabelecimentoId || null,
    client_supplier_id: payload.clientSupplierId || null,
    client_supplier_name: payload.clientSupplierName || '',
    reference_id: payload.referenceId || '',
    nfe_id: payload.nfeId || null,
    status: payload.status || 'pending',
    created_by: payload.createdBy || null,
    created_by_name: payload.createdByName || '',
    // Fase BX. `?? null` e nao `|| null`: taxa 0 e um valor (forma sem taxa
    // contratada), e `|| null` a transformaria em "nao se aplica".
    card_acquirer_id: payload.cardAcquirerId || null,
    card_acquirer_name: payload.cardAcquirerName || null,
    card_brand: payload.cardBrand || null,
    card_authorization: payload.cardAuthorization || null,
    fee_percent: payload.feePercent ?? null,
    fee_amount: payload.feeAmount ?? null,
    net_amount: payload.netAmount ?? null,
    created_at: now,
    updated_at: now
  };
  const { error } = await banco.from('financial_entries').insert(row);
  // Parcela apontando para NF-e que não existe na tabela `nfes`. Desde a Fase N
  // a nota é gravada ANTES das parcelas, então isto não deveria acontecer no
  // fluxo normal — se acontecer, é sinal de nota criada fora do fluxo (ou de
  // uma parcela antiga, da época em que a NF-e vivia no db.json).
  //
  // Falha alto, e não em silêncio: gravar a parcela sem o vínculo faria o
  // cancelamento da NF-e deixar as parcelas vivas — problema pior, e calado.
  if (error && (error.code === '23503' || /foreign key/i.test(error.message || '')) && /nfe_id/.test(error.message || '')) {
    const err = new Error(
      `A parcela aponta para a NF-e "${row.nfe_id}", que não está no banco. ` +
      'Se a migração banco/migrations/fase-n-nfe-no-supabase.sql ainda não foi rodada, rode-a; ' +
      'caso contrário, a nota foi criada fora do fluxo de emissão.'
    );
    err.status = 500;
    throw err;
  }
  assertNoError(error, 'createFinancialEntry');
  return getFinancialEntryById(id);
}

async function updateFinancialEntry(id, payload) {
  const row = { updated_at: new Date().toISOString() };
  if (payload.description !== undefined) row.description = payload.description;
  if (payload.amount !== undefined) row.amount = Number(payload.amount || 0);
  if (payload.date !== undefined) row.date = payload.date;
  if (payload.dueDate !== undefined) row.due_date = payload.dueDate;
  if (payload.document !== undefined) row.document = payload.document;
  if (payload.note !== undefined) row.note = payload.note;
  if (payload.category !== undefined) row.category_id = payload.category || null;
  if (payload.costCenter !== undefined) row.cost_center_id = payload.costCenter || null;
  if (payload.bankAccountId !== undefined) row.bank_account_id = payload.bankAccountId || null;
  if (payload.targetBankAccountId !== undefined) row.target_bank_account_id = payload.targetBankAccountId || null;
  if (payload.estabelecimentoId !== undefined) row.estabelecimento_id = payload.estabelecimentoId || null;
  if (payload.clientSupplierId !== undefined) row.client_supplier_id = payload.clientSupplierId || null;
  if (payload.clientSupplierName !== undefined) row.client_supplier_name = payload.clientSupplierName;
  if (payload.status !== undefined) row.status = payload.status;
  if (payload.cancelReason !== undefined) row.cancel_reason = payload.cancelReason || null;
  if (payload.cancelledAt !== undefined) row.cancelled_at = payload.cancelledAt || null;
  if (payload.cancelledByName !== undefined) row.cancelled_by_name = payload.cancelledByName || null;
  const { error } = await banco.from('financial_entries').update(row).eq('id', id);
  assertNoError(error, 'updateFinancialEntry');
  return getFinancialEntryById(id);
}

// ----------------------------------------------------------------------------
// Baixas (pagamentos)
// ----------------------------------------------------------------------------
function mapPaymentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    entryId: row.entry_id,
    origem: row.origem || 'manual',
    amount: Number(row.amount || 0),
    date: row.date,
    bankAccountId: row.bank_account_id || '',
    interest: Number(row.interest || 0),
    fine: Number(row.fine || 0),
    discount: Number(row.discount || 0),
    note: row.note || '',
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at
  };
}

// Todas as baixas de uma vez. O Financeiro filtra as baixas por lançamento em
// memória ao montar a lista; buscar por lançamento seria uma consulta por linha.
async function getAllFinancialPayments() {
  const { data, error } = await banco.from('financial_payments').select('*').order('created_at', { ascending: true });
  assertNoError(error, 'getAllFinancialPayments');
  return (data || []).map(mapPaymentRow);
}

async function getFinancialPaymentsByEntry(entryId) {
  const { data, error } = await banco.from('financial_payments').select('*').eq('entry_id', entryId).order('created_at', { ascending: true });
  assertNoError(error, 'getFinancialPaymentsByEntry');
  return (data || []).map(mapPaymentRow);
}

async function createFinancialPayment(payload) {
  const row = {
    id: createId('pay'),
    entry_id: payload.entryId,
    amount: Number(payload.amount || 0),
    date: payload.date,
    bank_account_id: payload.bankAccountId || null,
    // Fase AU: 'automatica' = nasceu com o faturamento de uma venda a vista, e
    // sai junto se o pedido for cancelado. 'manual' = alguem deu baixa, e fica.
    // Ver o cabecalho da migracao fase-au.
    origem: payload.origem === 'automatica' ? 'automatica' : 'manual',
    interest: Number(payload.interest || 0),
    fine: Number(payload.fine || 0),
    discount: Number(payload.discount || 0),
    note: payload.note || '',
    created_by: payload.createdBy || null,
    created_by_name: payload.createdByName || '',
    created_at: new Date().toISOString()
  };
  const { error } = await banco.from('financial_payments').insert(row);
  assertNoError(error, 'createFinancialPayment');
  return mapPaymentRow(row);
}

async function deleteFinancialPayment(id) {
  const { error } = await banco.from('financial_payments').delete().eq('id', id);
  assertNoError(error, 'deleteFinancialPayment');
}

// ----------------------------------------------------------------------------
// Plano de contas / centro de custo / contas bancárias
// ----------------------------------------------------------------------------
function mapNamedRow(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

async function getFinancialCategories() {
  const { data, error } = await banco.from('financial_categories').select('*').order('name', { ascending: true });
  assertNoError(error, 'getFinancialCategories');
  return (data || []).map((row) => ({ ...mapNamedRow(row), type: row.type }));
}

async function createFinancialCategory(payload) {
  const row = { id: createId('cat'), name: payload.name, type: payload.type || 'ambos', created_at: new Date().toISOString() };
  const { error } = await banco.from('financial_categories').insert(row);
  assertNoError(error, 'createFinancialCategory');
  return { ...mapNamedRow(row), type: row.type };
}

async function getCostCenters() {
  const { data, error } = await banco.from('cost_centers').select('*').order('name', { ascending: true });
  assertNoError(error, 'getCostCenters');
  return (data || []).map(mapNamedRow);
}

async function createCostCenter(payload) {
  const row = { id: createId('cc'), name: payload.name, created_at: new Date().toISOString() };
  const { error } = await banco.from('cost_centers').insert(row);
  assertNoError(error, 'createCostCenter');
  return mapNamedRow(row);
}

// Colunas provider/connectionId/etc. (Fase E — Open Finance) ficam vazias pra
// conta manual, que é o único fluxo que existe até uma conexão de verdade
// existir — ver lib/openfinance/.
function mapBankAccountRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    bank: row.bank || '',
    agency: row.agency || '',
    number: row.number || '',
    createdAt: row.created_at,
    estabelecimentoId: row.estabelecimento_id || '',
    connectionId: row.connection_id || '',
    provider: row.provider || '',
    providerAccountId: row.provider_account_id || '',
    accountType: row.account_type || '',
    // Fase BA: os campos do CADASTRO. O formulario chama o tipo de `type` e o
    // uso de `status`; aqui os dois nomes ja estao tomados pela CONEXAO Open
    // Finance (accountType e' o mesmo campo, `status` nao e' — ver a migracao).
    type: row.account_type || 'corrente',
    bankCode: row.bank_code || '',
    agencyDigit: row.agency_digit || '',
    numberDigit: row.number_digit || '',
    holder: row.holder || '',
    document: row.holder_document || '',
    pixKey: row.pix_key || '',
    initialBalance: Number(row.initial_balance || 0),
    notes: row.notes || '',
    ativo: row.ativo !== false,
    // O que a tela de cadastro mostra na coluna Status. `ativo` e' a coluna;
    // esta e' a palavra que a tela ja sabe pintar.
    cadastroStatus: row.ativo === false ? 'inativo' : 'ativo',
    currency: row.currency || 'BRL',
    currentBalance: row.current_balance === null || row.current_balance === undefined ? null : Number(row.current_balance),
    availableBalance: row.available_balance === null || row.available_balance === undefined ? null : Number(row.available_balance),
    status: row.status || '',
    lastSyncAt: row.last_sync_at || ''
  };
}

async function getBankAccounts() {
  const { data, error } = await banco.from('bank_accounts').select('*').order('name', { ascending: true });
  assertNoError(error, 'getBankAccounts');
  return (data || []).map(mapBankAccountRow);
}

async function getBankAccountById(id) {
  const { data, error } = await banco.from('bank_accounts').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getBankAccountById');
  return mapBankAccountRow(data);
}

async function createBankAccount(payload) {
  const row = {
    id: createId('bank'),
    name: payload.name,
    bank: payload.bank || '',
    agency: payload.agency || '',
    number: payload.number || '',
    created_at: new Date().toISOString()
  };
  if (payload.estabelecimentoId) row.estabelecimento_id = payload.estabelecimentoId;
  if (payload.connectionId) row.connection_id = payload.connectionId;
  if (payload.provider) row.provider = payload.provider;
  if (payload.providerAccountId) row.provider_account_id = payload.providerAccountId;
  // Fase BA: `type` e' como o formulario de cadastro chama o tipo da conta, e
  // `accountType` e' como a sincronizacao Open Finance chama o MESMO campo. Os
  // dois caem na mesma coluna — duas colunas de tipo seriam duas respostas para
  // a mesma pergunta.
  const tipo = payload.accountType || payload.type;
  if (tipo) row.account_type = tipo;
  if (payload.currency) row.currency = payload.currency;
  if (payload.status) row.status = payload.status;
  if (payload.bankCode !== undefined) row.bank_code = payload.bankCode || '';
  if (payload.agencyDigit !== undefined) row.agency_digit = payload.agencyDigit || '';
  if (payload.numberDigit !== undefined) row.number_digit = payload.numberDigit || '';
  if (payload.holder !== undefined) row.holder = payload.holder || '';
  if (payload.document !== undefined) row.holder_document = payload.document || '';
  if (payload.pixKey !== undefined) row.pix_key = payload.pixKey || '';
  if (payload.initialBalance !== undefined) row.initial_balance = Number(payload.initialBalance || 0);
  if (payload.notes !== undefined) row.notes = payload.notes || '';
  if (payload.ativo !== undefined) row.ativo = payload.ativo !== false;
  const { error } = await banco.from('bank_accounts').insert(row);
  assertNoError(error, 'createBankAccount');
  return getBankAccountById(row.id);
}

/**
 * Atualiza a conta. Dois chamadores, e os campos que cada um manda nao se
 * cruzam:
 *
 *   a sincronizacao Open Finance -> saldo, status da conexao, ultima sincronia
 *   a tela de cadastro           -> nome, banco, agencia, titular, PIX...
 *
 * Cada campo so e' tocado quando vem definido, entao a sincronizacao continua
 * sem poder pisar no que a pessoa digitou — que era a garantia do comentario
 * antigo ("nunca mexe em name/bank/agency/number"), agora obtida por `!==
 * undefined` em vez de por omissao.
 */
async function updateBankAccount(id, payload) {
  const row = {};
  // Fase CD: o dono da conta. `!== undefined` como os demais — a
  // sincronizacao Open Finance nao manda este campo e nao pode apaga-lo.
  if (payload.estabelecimentoId !== undefined) {
    row.estabelecimento_id = String(payload.estabelecimentoId || '').trim() || null;
  }
  if (payload.currentBalance !== undefined) row.current_balance = payload.currentBalance === null ? null : Number(payload.currentBalance);
  if (payload.availableBalance !== undefined) row.available_balance = payload.availableBalance === null ? null : Number(payload.availableBalance);
  if (payload.status !== undefined) row.status = payload.status || null;
  if (payload.lastSyncAt !== undefined) row.last_sync_at = payload.lastSyncAt;
  // Fase BA: os campos do cadastro.
  if (payload.name !== undefined) row.name = payload.name;
  if (payload.bank !== undefined) row.bank = payload.bank || '';
  if (payload.agency !== undefined) row.agency = payload.agency || '';
  if (payload.number !== undefined) row.number = payload.number || '';
  const tipo = payload.accountType !== undefined ? payload.accountType : payload.type;
  if (tipo !== undefined) row.account_type = tipo || null;
  if (payload.bankCode !== undefined) row.bank_code = payload.bankCode || '';
  if (payload.agencyDigit !== undefined) row.agency_digit = payload.agencyDigit || '';
  if (payload.numberDigit !== undefined) row.number_digit = payload.numberDigit || '';
  if (payload.holder !== undefined) row.holder = payload.holder || '';
  if (payload.document !== undefined) row.holder_document = payload.document || '';
  if (payload.pixKey !== undefined) row.pix_key = payload.pixKey || '';
  if (payload.initialBalance !== undefined) row.initial_balance = Number(payload.initialBalance || 0);
  if (payload.notes !== undefined) row.notes = payload.notes || '';
  if (payload.ativo !== undefined) row.ativo = payload.ativo !== false;
  const { error } = await banco.from('bank_accounts').update(row).eq('id', id);
  assertNoError(error, 'updateBankAccount');
  return getBankAccountById(id);
}

/**
 * Exclui a conta. O servidor confere ANTES se ela esta em uso (lancamento,
 * baixa, transacao importada) — aqui so se apaga.
 *
 * As FKs de financial_entries/financial_payments/bank_transactions sao a ultima
 * linha de defesa: se a checagem do servidor deixar passar, o banco recusa em
 * vez de deixar lancamento apontando para conta que nao existe.
 */
async function deleteBankAccount(id) {
  const { error } = await banco.from('bank_accounts').delete().eq('id', id);
  assertNoError(error, 'deleteBankAccount');
  return true;
}

// ----------------------------------------------------------------------------
// Extrato Open Finance / Conciliação
// ----------------------------------------------------------------------------
function mapBankTransactionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    bankAccountId: row.bank_account_id || '',
    date: row.date,
    description: row.description,
    amount: Number(row.amount || 0),
    type: row.type,
    status: row.status,
    matchedEntryId: row.matched_entry_id || '',
    matchedPaymentId: row.matched_payment_id || '',
    source: row.source || 'manual',
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at,
    provider: row.provider || '',
    providerTransactionId: row.provider_transaction_id || '',
    processingDate: row.processing_date || '',
    direction: row.direction || '',
    category: row.category || '',
    subcategory: row.subcategory || '',
    merchantName: row.merchant_name || '',
    merchantDocument: row.merchant_document || '',
    counterpartyName: row.counterparty_name || '',
    counterpartyDocument: row.counterparty_document || '',
    paymentMethod: row.payment_method || '',
    pixKey: row.pix_key || '',
    pixEndToEndId: row.pix_end_to_end_id || '',
    pixType: row.pix_type || '',
    documentNumber: row.document_number || '',
    originalData: row.original_data || null
  };
}

async function getBankTransactions() {
  const { data, error } = await banco.from('bank_transactions').select('*').order('date', { ascending: false });
  assertNoError(error, 'getBankTransactions');
  return (data || []).map(mapBankTransactionRow);
}

async function getBankTransactionById(id) {
  const { data, error } = await banco.from('bank_transactions').select('*').eq('id', id).maybeSingle();
  assertNoError(error, 'getBankTransactionById');
  return mapBankTransactionRow(data);
}

async function createBankTransaction(payload) {
  const row = {
    id: createId('btx'),
    bank_account_id: payload.bankAccountId || null,
    date: payload.date,
    description: payload.description,
    amount: Math.abs(Number(payload.amount || 0)),
    type: payload.type === 'saida' ? 'saida' : 'entrada',
    status: 'nao_conciliado',
    matched_entry_id: null,
    matched_payment_id: null,
    source: payload.source || 'manual',
    created_by: payload.createdBy || null,
    created_by_name: payload.createdByName || '',
    created_at: new Date().toISOString()
  };
  // Campos só preenchidos por uma sincronização de verdade (Fase 3) — entrada
  // manual (Extrato/CSV) nunca passa isso, então o resto fica null por padrão.
  if (payload.provider) row.provider = payload.provider;
  if (payload.providerTransactionId) row.provider_transaction_id = payload.providerTransactionId;
  if (payload.processingDate) row.processing_date = payload.processingDate;
  if (payload.direction) row.direction = payload.direction;
  if (payload.category) row.category = payload.category;
  if (payload.subcategory) row.subcategory = payload.subcategory;
  if (payload.merchantName) row.merchant_name = payload.merchantName;
  if (payload.merchantDocument) row.merchant_document = payload.merchantDocument;
  if (payload.counterpartyName) row.counterparty_name = payload.counterpartyName;
  if (payload.counterpartyDocument) row.counterparty_document = payload.counterpartyDocument;
  if (payload.paymentMethod) row.payment_method = payload.paymentMethod;
  if (payload.pixKey) row.pix_key = payload.pixKey;
  if (payload.pixEndToEndId) row.pix_end_to_end_id = payload.pixEndToEndId;
  if (payload.pixType) row.pix_type = payload.pixType;
  if (payload.documentNumber) row.document_number = payload.documentNumber;
  if (payload.originalData) row.original_data = payload.originalData;
  const { error } = await banco.from('bank_transactions').insert(row);
  assertNoError(error, 'createBankTransaction');
  return mapBankTransactionRow(row);
}

async function updateBankTransaction(id, payload) {
  const row = {};
  if (payload.status !== undefined) row.status = payload.status;
  if (payload.matchedEntryId !== undefined) row.matched_entry_id = payload.matchedEntryId || null;
  if (payload.matchedPaymentId !== undefined) row.matched_payment_id = payload.matchedPaymentId || null;
  const { error } = await banco.from('bank_transactions').update(row).eq('id', id);
  assertNoError(error, 'updateBankTransaction');
  return getBankTransactionById(id);
}

// ----------------------------------------------------------------------------
// NF-e MANUAL — o registro passou a morar em `fiscal_documentos` (fase DK)
//
// AS QUATRO FUNCOES SAO REEXPORTADAS, e nao reescritas aqui. `nfes` e
// `nfe_items` foram removidas do banco: o registro manual virou uma linha de
// `fiscal_documentos` com `origem = MANUAL`, e os itens ganharam o imposto
// por tributo que `nfe_items` nunca teve (9 colunas, nenhuma de imposto).
//
// O CONTRATO E O MESMO, conferido campo a campo: `getNfes()` devolve objetos
// com as mesmas chaves, e a tela "NF-e Emitidas", a emissao manual e o
// cancelamento nao mudaram uma linha.
//
// E DUAS COISAS QUE ESTAVAM ERRADAS AQUI SAIRAM COM O BLOCO:
//
//   1. A ACAO COMPENSATORIA. `createNfe` gravava a nota, gravava os itens, e
//      se os itens falhassem APAGAVA a nota. Duas coisas erradas: apagar
//      documento fiscal e o que este projeto nao faz por principio, e a
//      propria compensacao podia falhar, deixando nota sem item. O comentario
//      que estava aqui ja dizia que a transacao de verdade passou a ser
//      possivel desde a saida do Supabase e que a compensacao continuava "por
//      nao ter sido reescrita, nao por impedimento". Foi reescrita: agora e um
//      BEGIN/COMMIT so, em fiscal-documentos.js.
//
//   2. `status` ACEITAVA QUALQUER TEXTO. A importacao de planilha gravava
//      "emitida", que nao esta no vocabulario de tela nenhuma e aparecia como
//      rotulo cru. Agora status fora do catalogo e recusado com mensagem.
// ----------------------------------------------------------------------------
const fiscalDocumentos = require('./fiscal-documentos');

const { getNfes, getNfeById, createNfe, updateNfe } = fiscalDocumentos;

/**
 * OS LANÇAMENTOS QUE APONTAM PARA ESTES DOCUMENTOS — e só eles (fase DS).
 *
 * Para quem grava um pedido: o efeito financeiro do faturamento (e do
 * desfaturamento) só olha os lançamentos cujo `reference_id` é o pedido, e
 * carregava os 27.362 para filtrar em memória. Ver syncFinanceDataDosPedidos,
 * em server.js. Usa o índice `financial_entries(reference_id)`.
 *
 * Mesmo mapper e mesma ordem de `getFinancialEntries` (data decrescente), com
 * o id desempatando — duas parcelas na mesma data saíam na ordem que o Postgres
 * achasse.
 */
async function getFinancialEntriesPorReferencia(referencias) {
  const lista = Array.isArray(referencias) ? referencias.filter(Boolean) : [];
  if (!lista.length) return [];
  const { data, error } = await banco.from('financial_entries').select('*').in('reference_id', lista)
    .order('date', { ascending: false }).order('id', { ascending: true });
  assertNoError(error, 'getFinancialEntriesPorReferencia');
  return (data || []).map(mapFinancialEntryRow);
}

/**
 * As baixas destes lançamentos (fase DS) — o par de getFinancialEntriesPorReferencia.
 * Mesma ordem de `getAllFinancialPayments` (criação crescente), id desempatando.
 */
async function getFinancialPaymentsDosLancamentos(entryIds) {
  const lista = Array.isArray(entryIds) ? entryIds.filter(Boolean) : [];
  if (!lista.length) return [];
  const { data, error } = await banco.from('financial_payments').select('*').in('entry_id', lista)
    .order('created_at', { ascending: true }).order('id', { ascending: true });
  assertNoError(error, 'getFinancialPaymentsDosLancamentos');
  return (data || []).map(mapPaymentRow);
}

module.exports = {
  contarFinancialEntries,
  // O mapper, para os recortes do Início (lib/db/painel-inicio.js) devolverem
  // o lançamento com a MESMA forma.
  mapFinancialEntryRow,
  getFinancialEntries, getFinancialEntryById, createFinancialEntry, updateFinancialEntry,
  // Fase DS: leituras do que cada rota usa, no lugar das tabelas inteiras.
  getFinancialEntriesByIds, getFinancialPaymentsByEntries, getFinancialEntriesByNfe,
  getLancamentosEmAberto, getFinancialEntriesParaResumo, getLancamentosDaLista, montarFiltroDaLista,
  getAllFinancialPayments, getFinancialPaymentsByEntry, createFinancialPayment, deleteFinancialPayment,
  // Fase DS — o recorte de quem grava um pedido. Ver syncFinanceDataDosPedidos.
  getFinancialEntriesPorReferencia, getFinancialPaymentsDosLancamentos,
  getFinancialCategories, createFinancialCategory,
  getCostCenters, createCostCenter,
  getBankAccounts, getBankAccountById, createBankAccount, updateBankAccount,
  deleteBankAccount,
  getBankTransactions, getBankTransactionById, createBankTransaction, updateBankTransaction,
  getNfes, getNfeById, createNfe, updateNfe
};
