/**
 * O RELATÓRIO PERSONALIZADO — o usuário monta, o sistema consulta.
 *
 * O Personalizado do Viper: escolhe-se a FONTE (Lançamentos, Vendas, Itens de
 * Vendas...), as colunas, os filtros e a ordem, e salva-se com um nome. O que
 * fica gravado (tabela relatorio_personalizado, fase DQ) é só a escolha:
 *
 *   { fonte: 'itens-vendas',
 *     colunas: ['pedido', 'data', 'produto', 'quantidade'],
 *     filtros: [{ campo: 'situacao', operador: 'diferente', valor: 'Pedido Cancelado' }],
 *     ordem: [{ campo: 'data', direcao: 'desc' }] }
 *
 * A CONSULTA NASCE AQUI, e de uma lista fechada. Cada campo de cada fonte tem
 * a sua expressão SQL escrita neste arquivo; do relatório salvo só se usam os
 * NOMES dos campos (que precisam existir na fonte), os operadores (de uma lista
 * fixa) e os valores (que vão como parâmetro, nunca no texto da consulta).
 * Nada que o usuário digita vira SQL.
 *
 * AS PORTAS SÃO AS DO CATÁLOGO: cada fonte pertence a um módulo (Lançamentos
 * pede Financeiro, Vendas pede Vendas...), e as fontes que leem pedido aplicam
 * o escopo de vendas — o vendedor comum só vê os próprios pedidos, monte o
 * relatório que montar.
 *
 * Puro: não conhece banco nem HTTP, como o motor.
 */

const salesStatus = require('../../public/modules/shared/sales_status');
const { nomeDaFilialSql, SALDO_DO_RAZAO, nomeDoDepositoSql } = require('./comum');
const motor = require('./motor');

const FUSO = 'America/Sao_Paulo';
const LIMITE_DE_LINHAS = 50000;
const MAXIMO = { colunas: 40, filtros: 20, ordem: 5, nome: 120, valor: 200 };

const literal = (texto) => `'${String(texto).replace(/'/g, "''")}'`;

/** CASE que troca o valor gravado pelo rótulo da tela. */
const rotulos = (expr, mapa) => `(case ${expr} ${Object.entries(mapa).map(([v, r]) => `when ${literal(v)} then ${literal(r)}`).join(' ')} else coalesce(${expr}::text, '') end)`;

const SITUACAO_DO_PEDIDO = rotulos('o.status', Object.fromEntries(salesStatus.CATALOGO.map((s) => [s.value, s.label])));
const SITUACAO_DO_LANCAMENTO = rotulos('e.status', { paid: 'Quitado', pending: 'Pendente', pendente: 'Pendente', parcial: 'Parcial', cancelado: 'Cancelado', cancelled: 'Cancelado', canceled: 'Cancelado' });
const SITUACAO_DA_NFE = rotulos('n.status', {
  RASCUNHO: 'Rascunho', PROCESSANDO: 'Processando', AUTORIZADO: 'Autorizada', ERRO: 'Erro',
  CANCELADO: 'Cancelada', DENEGADO: 'Denegada', INUTILIZADO: 'Inutilizada'
});
const ORIGEM_DO_MOVIMENTO = rotulos('m.origin', {
  'saldo-inicial': 'Saldo inicial', 'entrada-nfe': 'Entrada de NF-e', 'ordem-de-compra': 'Ordem de compra',
  purchase: 'Compra', order: 'Pedido', producao: 'Produção', contagem: 'Contagem', transferencia: 'Transferência'
});

/** Número de dentro do jsonb do item; texto torto vira zero, não erro. */
const numeroDoItem = (chave) => `(case when (it->>'${chave}') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (it->>'${chave}')::numeric else 0 end)`;
const QTD = numeroDoItem('quantity');
const TOTAL_ITEM = numeroDoItem('total');
const simNao = (expr) => `(case when ${expr} then 'Sim' else 'Não' end)`;

/**
 * Um campo: `campo` é o nome que o relatório salvo usa; `expr`, a expressão
 * SQL; `padrao`, se entra nas colunas de um relatório novo; `semTotal`, para
 * número que não se soma (código, número de pedido).
 */
const c = (campo, rotulo, tipo, expr, extra = {}) => ({ campo, rotulo, tipo, expr, ...extra });

const CLIENTE_DO_PEDIDO = "coalesce(cli.name, o.client_supplier_name, o.customer, '')";

const FONTES = [
  {
    key: 'lancamentos',
    titulo: 'Lançamentos',
    modulo: 'finance',
    from: `financial_entries e
      left join (select entry_id, sum(amount) as pago, max(date) as ultima from financial_payments group by entry_id) pg on pg.entry_id = e.id
      left join financial_categories cat on cat.id = e.category_id
      left join cost_centers cc on cc.id = e.cost_center_id
      left join bank_accounts ba on ba.id = e.bank_account_id`,
    campoData: 'vencimento',
    ordemPadrao: 'e.due_date, e.code',
    campos: [
      c('codigo', 'Código', 'codigo', 'e.code', { padrao: true }),
      c('tipo', 'Tipo', 'texto', rotulos('e.type', { RECEITA: 'Receita', DESPESA: 'Despesa', TRANSFERENCIA: 'Transferência' }), { padrao: true }),
      c('data', 'Data do lançamento', 'data', 'e.date'),
      c('vencimento', 'Vencimento', 'data', 'e.due_date', { padrao: true }),
      c('baixa', 'Data da última baixa', 'data', 'pg.ultima'),
      c('pessoa', 'Cliente/Fornecedor', 'texto', "coalesce(e.client_supplier_name, '')", { padrao: true }),
      c('descricao', 'Descrição', 'texto', "coalesce(e.description, '')", { padrao: true }),
      c('documento', 'Documento', 'texto', "coalesce(e.document, '')"),
      c('categoria', 'Categoria', 'texto', "coalesce(cat.name, '')"),
      c('centroDeCusto', 'Centro de custo', 'texto', "coalesce(cc.name, '')"),
      c('conta', 'Conta', 'texto', "coalesce(ba.name, '')"),
      c('valor', 'Valor', 'moeda', 'coalesce(e.amount, 0)', { padrao: true }),
      c('pago', 'Valor pago', 'moeda', 'coalesce(pg.pago, 0)', { padrao: true }),
      c('emAberto', 'Em aberto', 'moeda', "(case when e.status in ('pending', 'pendente', 'parcial') then greatest(e.amount - coalesce(pg.pago, 0), 0) else 0 end)"),
      c('situacao', 'Situação', 'texto', SITUACAO_DO_LANCAMENTO, { padrao: true }),
      c('credenciadora', 'Credenciadora', 'texto', "coalesce(e.card_acquirer_name, '')"),
      c('bandeira', 'Bandeira', 'texto', "coalesce(e.card_brand, '')"),
      c('taxa', 'Taxa do cartão', 'moeda', 'coalesce(e.fee_amount, 0)'),
      c('lancadoPor', 'Lançado por', 'texto', "coalesce(e.created_by_name, '')"),
      c('observacao', 'Observação', 'texto', "coalesce(e.note, '')")
    ]
  },
  {
    key: 'vendas',
    titulo: 'Vendas',
    modulo: 'sales',
    from: `orders o
      left join people cli on cli.id = o.client_supplier_id
      left join people ven on ven.id = o.seller_id`,
    vendedorSql: 'o.seller_id',
    campoData: 'data',
    ordemPadrao: 'o.date, o.code',
    campos: [
      c('pedido', 'Pedido', 'codigo', 'o.code', { padrao: true }),
      c('data', 'Data', 'data', 'o.date', { padrao: true }),
      c('situacao', 'Situação', 'texto', SITUACAO_DO_PEDIDO, { padrao: true }),
      c('cliente', 'Cliente', 'texto', CLIENTE_DO_PEDIDO, { padrao: true }),
      c('documentoCliente', 'CPF/CNPJ do cliente', 'texto', "coalesce(cli.document, '')"),
      c('cidade', 'Cidade', 'texto', "coalesce(cli.city, '')"),
      c('uf', 'UF', 'texto', "coalesce(cli.state, '')"),
      c('bairro', 'Bairro', 'texto', "coalesce(cli.extra->>'neighborhood', '')"),
      c('vendedor', 'Vendedor', 'texto', "coalesce(ven.name, '')", { padrao: true }),
      c('categoria', 'Categoria da venda', 'texto', "coalesce(o.category, '')"),
      c('filial', 'Filial', 'texto', nomeDaFilialSql('o')),
      c('origem', 'Origem da venda', 'texto', "coalesce(o.sale_origin, '')"),
      c('itens', 'Total dos itens', 'moeda', 'coalesce(o.items_total, 0)'),
      c('desconto', 'Desconto', 'moeda', 'coalesce(o.discount_total, 0)'),
      c('frete', 'Frete', 'moeda', 'coalesce(o.freight, 0)'),
      c('despesas', 'Outras despesas', 'moeda', 'coalesce(o.general_expenses, 0)'),
      c('montagem', 'Montagem', 'moeda', 'coalesce(o.assembly_fee, 0)'),
      c('total', 'Valor total', 'moeda', 'coalesce(o.total_amount, o.amount, 0)', { padrao: true }),
      c('temNfe', 'Tem NF-e', 'texto', simNao("coalesce(o.nfe_id, '') <> ''")),
      c('aprovacao', 'Data de aprovação', 'data', 'o.approval_date'),
      c('pedidoDoCliente', 'Pedido do cliente', 'texto', "coalesce(o.customer_po_code, '')"),
      c('observacao', 'Observação', 'texto', "coalesce(o.note, '')")
    ]
  },
  {
    key: 'itens-vendas',
    titulo: 'Itens de Vendas',
    modulo: 'sales',
    from: `orders o
      cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) it
      left join products pr on pr.id = it->>'productId'
      left join people cli on cli.id = o.client_supplier_id
      left join people ven on ven.id = o.seller_id`,
    vendedorSql: 'o.seller_id',
    campoData: 'data',
    ordemPadrao: 'o.date, o.code',
    campos: [
      c('pedido', 'Pedido', 'codigo', 'o.code', { padrao: true }),
      c('data', 'Data', 'data', 'o.date', { padrao: true }),
      c('situacao', 'Situação', 'texto', SITUACAO_DO_PEDIDO),
      c('cliente', 'Cliente', 'texto', CLIENTE_DO_PEDIDO),
      c('vendedor', 'Vendedor', 'texto', "coalesce(ven.name, '')"),
      c('filial', 'Filial', 'texto', nomeDaFilialSql('o')),
      c('sku', 'SKU', 'texto', "coalesce(pr.sku, it->>'sku', '')", { padrao: true }),
      c('produto', 'Produto', 'texto', "coalesce(pr.name, it->>'name', '')", { padrao: true }),
      c('ncm', 'NCM', 'texto', "coalesce(btrim(pr.ncm), '')"),
      c('quantidade', 'Quantidade', 'quantidade', QTD, { padrao: true }),
      c('unitario', 'Valor unitário', 'moeda', numeroDoItem('unitPrice'), { padrao: true, semTotal: true }),
      c('total', 'Valor total', 'moeda', TOTAL_ITEM, { padrao: true }),
      c('custoUnitario', 'Custo atual (unitário)', 'moeda', 'coalesce(pr.cost_price, 0)', { semTotal: true }),
      c('custoTotal', 'Custo atual (total)', 'moeda', `${QTD} * coalesce(pr.cost_price, 0)`),
      c('estoque', 'Saldo em estoque', 'quantidade', 'coalesce(pr.stock_quantity, 0)', { semTotal: true })
    ]
  },
  {
    key: 'notas-entrada',
    titulo: 'Notas de Entrada',
    modulo: 'purchases',
    from: 'nfe_entrada e',
    campoData: 'emissao',
    ordemPadrao: 'e.data_emissao, e.numero',
    campos: [
      c('numero', 'Número', 'texto', "coalesce(e.numero, '')", { padrao: true }),
      c('serie', 'Série', 'texto', "coalesce(e.serie, '')"),
      c('chave', 'Chave de acesso', 'texto', "coalesce(e.chave, '')"),
      c('emissao', 'Emissão', 'data', 'e.data_emissao', { padrao: true }),
      c('fornecedor', 'Fornecedor', 'texto', "coalesce(e.emitente_nome, '')", { padrao: true }),
      c('cnpj', 'CNPJ', 'texto', "coalesce(e.emitente_documento, '')"),
      c('natureza', 'Natureza', 'texto', "coalesce(e.natureza_operacao, '')"),
      c('valorProdutos', 'Valor dos produtos', 'moeda', 'coalesce(e.valor_produtos, 0)'),
      c('valorTotal', 'Valor total', 'moeda', 'coalesce(e.valor_total, 0)', { padrao: true }),
      c('situacao', 'Situação', 'texto', rotulos('e.status', { LANCADA: 'Lançada', REVISAR: 'A revisar' }), { padrao: true }),
      c('estoque', 'Movimentou estoque', 'texto', simNao('e.movimentou_estoque')),
      c('financeiro', 'Gerou financeiro', 'texto', simNao('e.gerou_financeiro')),
      c('lancadaPor', 'Lançada por', 'texto', "coalesce(e.criado_por_nome, '')")
    ]
  },
  {
    key: 'itens-notas-entrada',
    titulo: 'Itens das Notas de Entrada',
    modulo: 'purchases',
    from: `nfe_entrada_item it
      join nfe_entrada e on e.id = it.entrada_id
      left join products p on p.id = it.product_id`,
    campoData: 'emissao',
    ordemPadrao: 'e.data_emissao, e.numero, it.numero',
    campos: [
      c('nota', 'Nota', 'texto', "concat_ws('/', nullif(e.numero, ''), nullif(e.serie, ''))", { padrao: true }),
      c('emissao', 'Emissão', 'data', 'e.data_emissao', { padrao: true }),
      c('fornecedor', 'Fornecedor', 'texto', "coalesce(e.emitente_nome, '')", { padrao: true }),
      c('item', 'Item', 'inteiro', 'it.numero', { semTotal: true }),
      c('codigoFornecedor', 'Código no fornecedor', 'texto', "coalesce(it.codigo_fornecedor, '')"),
      c('descricao', 'Descrição', 'texto', "coalesce(it.descricao, '')", { padrao: true }),
      c('sku', 'SKU vinculado', 'texto', "coalesce(p.sku, '')"),
      c('produto', 'Produto vinculado', 'texto', "coalesce(p.name, '')"),
      c('ncm', 'NCM', 'texto', "coalesce(it.ncm, '')"),
      c('cfop', 'CFOP', 'texto', "coalesce(it.cfop, '')"),
      c('unidade', 'Unidade', 'texto', "coalesce(it.unidade, '')"),
      c('quantidade', 'Quantidade', 'quantidade', 'coalesce(it.quantidade, 0)', { padrao: true }),
      c('valorUnitario', 'Valor unitário', 'moeda', 'coalesce(it.valor_unitario, 0)', { semTotal: true }),
      c('total', 'Valor total', 'moeda', 'coalesce(it.valor_total, 0)', { padrao: true }),
      c('ean', 'EAN', 'texto', "coalesce(it.ean, '')")
    ]
  },
  {
    key: 'notas-saida',
    titulo: 'Notas de Saída (NF-e e NFC-e)',
    modulo: 'fiscal',
    from: `nfe n
      left join estabelecimento es on es.id = n.estabelecimento_id
      left join orders o on o.id = n.order_id`,
    campoData: 'emissao',
    ordemPadrao: 'coalesce(n.data_emissao, n.criado_em), n.numero',
    campos: [
      c('modelo', 'Modelo', 'texto', "(case when n.modelo = 65 then 'NFC-e' else 'NF-e' end)", { padrao: true }),
      c('numero', 'Número', 'codigo', 'n.numero::int', { padrao: true }),
      c('serie', 'Série', 'codigo', 'n.serie::int'),
      c('emissao', 'Emissão', 'data', `(coalesce(n.data_emissao, n.criado_em) at time zone '${FUSO}')::date`, { padrao: true }),
      c('estabelecimento', 'Estabelecimento', 'texto', "coalesce(nullif(btrim(es.nome_fantasia), ''), es.razao_social, '')"),
      c('destinatario', 'Destinatário', 'texto', "coalesce(n.destinatario_nome, '')", { padrao: true }),
      c('documento', 'CPF/CNPJ', 'texto', "coalesce(n.destinatario_documento, '')"),
      c('natureza', 'Natureza', 'texto', "coalesce(n.natureza_operacao, '')"),
      c('situacao', 'Situação', 'texto', SITUACAO_DA_NFE, { padrao: true }),
      c('valor', 'Valor', 'moeda', 'coalesce(n.valor_total, 0)', { padrao: true }),
      c('pedido', 'Pedido', 'codigo', 'o.code'),
      c('chave', 'Chave de acesso', 'texto', "coalesce(n.chave_acesso, '')"),
      c('protocolo', 'Protocolo', 'texto', "coalesce(n.protocolo, '')"),
      c('mensagem', 'Mensagem da SEFAZ', 'texto', "coalesce(n.mensagem_sefaz, '')")
    ]
  },
  {
    key: 'pessoas',
    titulo: 'Pessoas',
    modulo: 'cadastros',
    from: 'people pe',
    campoData: 'cadastro',
    ordemPadrao: 'pe.name',
    campos: [
      c('codigo', 'Código', 'texto', "coalesce(pe.code, '')"),
      c('nome', 'Nome', 'texto', "coalesce(pe.name, '')", { padrao: true }),
      c('fantasia', 'Nome fantasia', 'texto', "coalesce(pe.trade_name, '')"),
      c('tipoPessoa', 'Pessoa', 'texto', "(case when length(regexp_replace(coalesce(pe.document, ''), '[^0-9]', '', 'g')) = 14 then 'Jurídica' else 'Física' end)"),
      c('documento', 'CPF/CNPJ', 'texto', "coalesce(pe.document, '')", { padrao: true }),
      c('email', 'E-mail', 'texto', "coalesce(pe.email, '')", { padrao: true }),
      c('telefone', 'Telefone', 'texto', "coalesce(pe.phone, '')", { padrao: true }),
      c('celular', 'Celular', 'texto', "coalesce(pe.extra->>'mobilePhone', '')"),
      c('whatsapp', 'WhatsApp', 'texto', "coalesce(pe.extra->>'whatsapp', '')"),
      c('endereco', 'Endereço', 'texto', "concat_ws(', ', nullif(btrim(pe.extra->>'street'), ''), nullif(btrim(pe.extra->>'streetNumber'), ''))"),
      c('bairro', 'Bairro', 'texto', "coalesce(pe.extra->>'neighborhood', '')"),
      c('cidade', 'Cidade', 'texto', "coalesce(pe.city, '')", { padrao: true }),
      c('uf', 'UF', 'texto', "coalesce(pe.state, '')"),
      c('cep', 'CEP', 'texto', "coalesce(pe.zip_code, '')"),
      c('papeis', 'Papéis', 'texto', "coalesce((select string_agg(r, ', ') from jsonb_array_elements_text(case when jsonb_typeof(pe.extra->'roles') = 'array' then pe.extra->'roles' else '[]'::jsonb end) r), '')"),
      c('grupo', 'Grupo', 'texto', "coalesce(pe.extra->>'group', '')"),
      c('inscricaoEstadual', 'Inscrição estadual', 'texto', "coalesce(pe.extra->>'stateRegistration', '')"),
      c('situacao', 'Situação', 'texto', "coalesce(pe.status, '')"),
      c('cadastro', 'Data do cadastro', 'data', `(pe.created_at at time zone '${FUSO}')::date`)
    ]
  },
  {
    key: 'movimentos-estoque',
    titulo: 'Entradas e Saídas de Estoque',
    modulo: 'stock',
    from: `stock_movements m
      left join products p on p.id = m.product_id
      left join deposits d on d.id = m.deposit_id`,
    campoData: 'data',
    ordemPadrao: 'm.date, m.created_at',
    campos: [
      c('data', 'Data', 'data', 'm.date', { padrao: true }),
      c('codigo', 'Código', 'texto', "coalesce(m.code, '')"),
      c('tipo', 'Tipo', 'texto', "(case when m.type = 'saida' then 'Saída' else 'Entrada' end)", { padrao: true }),
      c('sku', 'SKU', 'texto', "coalesce(p.sku, '')", { padrao: true }),
      c('produto', 'Produto', 'texto', "coalesce(p.name, nullif(m.product_name, ''), '')", { padrao: true }),
      c('deposito', 'Depósito', 'texto', nomeDoDepositoSql('d', 'm.deposit_id'), { padrao: true }),
      c('quantidade', 'Quantidade', 'quantidade', 'coalesce(m.quantity, 0)', { padrao: true }),
      c('quantidadeComSinal', 'Quantidade (saída negativa)', 'quantidade', SALDO_DO_RAZAO),
      c('custoUnitario', 'Custo unitário', 'moeda', 'coalesce(m.unit_cost, 0)', { semTotal: true }),
      c('valor', 'Valor (quantidade × custo)', 'moeda', 'coalesce(m.quantity, 0) * coalesce(m.unit_cost, 0)'),
      c('origem', 'Origem', 'texto', `(case when coalesce(m.transfer_id, '') <> '' then 'Transferência' else ${ORIGEM_DO_MOVIMENTO} end)`),
      c('documento', 'Documento', 'texto', "coalesce(m.document, '')"),
      c('observacao', 'Observação', 'texto', "coalesce(nullif(m.motivo, ''), m.note, '')"),
      c('usuario', 'Usuário', 'texto', "coalesce(m.created_by_name, '')")
    ]
  }
];

const OPERADORES = {
  igual: 'é igual a',
  diferente: 'é diferente de',
  contem: 'contém',
  naoContem: 'não contém',
  comeca: 'começa com',
  maior: 'maior que',
  maiorIgual: 'maior ou igual a',
  menor: 'menor que',
  menorIgual: 'menor ou igual a',
  entre: 'entre',
  vazio: 'está vazio',
  preenchido: 'está preenchido'
};
const OPERADORES_DE_TEXTO = ['igual', 'diferente', 'contem', 'naoContem', 'comeca', 'vazio', 'preenchido'];
const OPERADORES_DE_ORDEM = ['igual', 'diferente', 'maior', 'maiorIgual', 'menor', 'menorIgual', 'entre', 'vazio', 'preenchido'];
const SEM_VALOR = new Set(['vazio', 'preenchido']);

const operadoresDoTipo = (tipo) => (tipo === 'texto' ? OPERADORES_DE_TEXTO : OPERADORES_DE_ORDEM);

function fonte(chave) {
  return FONTES.find((f) => f.key === chave) || null;
}

function campoDa(f, nome) {
  return f.campos.find((c2) => c2.campo === nome) || null;
}

/** O que a tela precisa para montar o editor — sem nenhuma expressão SQL. */
function fontesVisiveis(podeVerModulo) {
  return FONTES.filter((f) => podeVerModulo(f.modulo)).map((f) => ({
    key: f.key,
    titulo: f.titulo,
    temPeriodo: Boolean(f.campoData),
    campos: f.campos.map(({ campo, rotulo, tipo, padrao }) => ({ campo, rotulo, tipo, padrao: Boolean(padrao), operadores: operadoresDoTipo(tipo) }))
  }));
}

function erro(mensagem) {
  const e = new Error(mensagem);
  e.status = 400;
  return e;
}

/** Valor do filtro conferido pelo tipo do campo; null quando não serve. */
function valorDoTipo(tipo, bruto) {
  const s = String(bruto ?? '').trim();
  if (!s) return null;
  if (tipo === 'data') return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
  if (tipo === 'texto') return s.slice(0, MAXIMO.valor);
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Confere e LIMPA a definição que veio da tela. Devolve só o que pode ser
 * gravado: campo que não existe na fonte, operador fora da lista ou valor que
 * não serve ao tipo é recusado com a mensagem do que está errado — não
 * descartado em silêncio, senão o relatório salvo filtraria menos do que a
 * pessoa pediu.
 */
function validarDefinicao(bruto = {}) {
  const nome = String(bruto.nome || '').trim();
  if (!nome) throw erro('Dê um nome ao relatório.');
  if (nome.length > MAXIMO.nome) throw erro(`O nome pode ter até ${MAXIMO.nome} caracteres.`);
  const f = fonte(bruto.fonte);
  if (!f) throw erro('Escolha a fonte de dados.');

  const colunas = [...new Set((Array.isArray(bruto.colunas) ? bruto.colunas : []).map(String))];
  if (!colunas.length) throw erro('Escolha ao menos uma coluna.');
  if (colunas.length > MAXIMO.colunas) throw erro(`São até ${MAXIMO.colunas} colunas.`);
  for (const nomeDoCampo of colunas) if (!campoDa(f, nomeDoCampo)) throw erro(`A coluna "${nomeDoCampo}" não existe em ${f.titulo}.`);

  const filtrosBrutos = Array.isArray(bruto.filtros) ? bruto.filtros : [];
  if (filtrosBrutos.length > MAXIMO.filtros) throw erro(`São até ${MAXIMO.filtros} filtros.`);
  const filtros = filtrosBrutos.map((fl) => {
    const campo = campoDa(f, String((fl && fl.campo) || ''));
    if (!campo) throw erro(`O filtro usa um campo que não existe em ${f.titulo}.`);
    const operador = String(fl.operador || '');
    if (!operadoresDoTipo(campo.tipo).includes(operador)) throw erro(`O operador do filtro de "${campo.rotulo}" não serve para esse campo.`);
    if (SEM_VALOR.has(operador)) return { campo: campo.campo, operador };
    const valor = valorDoTipo(campo.tipo, fl.valor);
    if (valor === null) throw erro(`Preencha um valor válido no filtro de "${campo.rotulo}".`);
    if (operador !== 'entre') return { campo: campo.campo, operador, valor };
    const valor2 = valorDoTipo(campo.tipo, fl.valor2);
    if (valor2 === null) throw erro(`Preencha os dois valores do filtro "entre" de "${campo.rotulo}".`);
    return { campo: campo.campo, operador, valor, valor2 };
  });

  const ordemBruta = Array.isArray(bruto.ordem) ? bruto.ordem : [];
  if (ordemBruta.length > MAXIMO.ordem) throw erro(`São até ${MAXIMO.ordem} critérios de ordem.`);
  const ordem = ordemBruta.map((o) => {
    const campo = campoDa(f, String((o && o.campo) || ''));
    if (!campo) throw erro(`A ordem usa um campo que não existe em ${f.titulo}.`);
    return { campo: campo.campo, direcao: o.direcao === 'desc' ? 'desc' : 'asc' };
  });

  return { nome, fonte: f.key, colunas, filtros, ordem, compartilhado: bruto.compartilhado !== false };
}

/** Escapa curinga do ILIKE: quem procura "10%" procura o texto "10%". */
const semCuringa = (s) => String(s).replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * A consulta de uma definição JÁ VALIDADA. `de`/`ate` recortam o campo de
 * data da fonte; `vendedores` é o escopo de vendas (null = todos).
 */
function montarConsulta(def, { de = '', ate = '', vendedores = null } = {}) {
  const f = fonte(def.fonte);
  if (!f) throw erro('Fonte de dados desconhecida.');
  const parametros = [];
  const p = (valor) => { parametros.push(valor); return `$${parametros.length}`; };
  const cast = (tipo) => (tipo === 'data' ? '::date' : (tipo === 'texto' ? '' : '::numeric'));

  const colunas = def.colunas.map((nome) => campoDa(f, nome)).filter(Boolean);
  const select = colunas.map((col, i) => `${col.expr} as c${i}`).join(',\n         ');

  const onde = [];
  if (f.vendedorSql && vendedores !== null && vendedores !== undefined) onde.push(`${f.vendedorSql} = any(${p(vendedores)}::text[])`);
  const campoData = f.campoData && campoDa(f, f.campoData);
  if (campoData && de) onde.push(`${campoData.expr} >= ${p(de)}::date`);
  if (campoData && ate) onde.push(`${campoData.expr} <= ${p(ate)}::date`);

  for (const fl of def.filtros || []) {
    const campo = campoDa(f, fl.campo);
    const e = campo.expr;
    const t = cast(campo.tipo);
    const texto = campo.tipo === 'texto';
    switch (fl.operador) {
      case 'igual': onde.push(texto ? `lower(${e}) = lower(${p(fl.valor)})` : `${e} = ${p(fl.valor)}${t}`); break;
      case 'diferente': onde.push(texto ? `lower(${e}) <> lower(${p(fl.valor)})` : `${e} is distinct from ${p(fl.valor)}${t}`); break;
      case 'contem': onde.push(`${e} ilike ${p(`%${semCuringa(fl.valor)}%`)}`); break;
      case 'naoContem': onde.push(`${e} not ilike ${p(`%${semCuringa(fl.valor)}%`)}`); break;
      case 'comeca': onde.push(`${e} ilike ${p(`${semCuringa(fl.valor)}%`)}`); break;
      case 'maior': onde.push(`${e} > ${p(fl.valor)}${t}`); break;
      case 'maiorIgual': onde.push(`${e} >= ${p(fl.valor)}${t}`); break;
      case 'menor': onde.push(`${e} < ${p(fl.valor)}${t}`); break;
      case 'menorIgual': onde.push(`${e} <= ${p(fl.valor)}${t}`); break;
      case 'entre': onde.push(`${e} between ${p(fl.valor)}${t} and ${p(fl.valor2)}${t}`); break;
      case 'vazio': onde.push(texto ? `coalesce(${e}, '') = ''` : `${e} is null`); break;
      case 'preenchido': onde.push(texto ? `coalesce(${e}, '') <> ''` : `${e} is not null`); break;
      default: throw erro('Operador desconhecido.');
    }
  }

  const ordem = (def.ordem || []).length
    ? def.ordem.map((o) => `${campoDa(f, o.campo).expr} ${o.direcao === 'desc' ? 'desc' : 'asc'} nulls last`).join(', ')
    : f.ordemPadrao;

  const texto = `select ${select}
    from ${f.from}
   ${onde.length ? `where ${onde.join('\n     and ')}` : ''}
   order by ${ordem}
   limit ${LIMITE_DE_LINHAS + 1}`;
  return { texto, parametros, colunas };
}

/**
 * Roda a definição e devolve o MESMO formato do catálogo (motor.executar):
 * a tela e o CSV do catálogo servem sem mudança, e o total segue a mesma
 * regra (soma dinheiro e quantidade; código e percentual, não).
 */
async function executar(def, { sql, de = '', ate = '', vendedores = null, id = '', agora } = {}) {
  const { texto, parametros, colunas } = montarConsulta(def, { de, ate, vendedores });
  const brutas = await sql(texto, parametros);
  const limitado = brutas.length > LIMITE_DE_LINHAS;
  const linhas = brutas.slice(0, LIMITE_DE_LINHAS).map((b) => {
    const linha = {};
    colunas.forEach((col, i) => {
      const v = b[`c${i}`];
      linha[col.campo] = motor.TIPOS_NUMERICOS.has(col.tipo) && v !== null && v !== undefined ? Number(v) : v;
    });
    return linha;
  });
  const filtros = motor.normalizarFiltros({ filtros: ['periodo'] }, { de, ate }, agora);
  const resultado = await motor.executar({
    key: `personalizado-${id || 'novo'}`,
    grupo: 'personalizado',
    titulo: def.nome,
    totais: 'numericas',
    colunas: colunas.map(({ campo, rotulo, tipo, semTotal }) => ({ campo, rotulo, tipo, ...(semTotal ? { semTotal: true } : {}) })),
    executar: async () => linhas
  }, filtros);
  return { ...resultado, limitado, limiteDeLinhas: LIMITE_DE_LINHAS };
}

module.exports = {
  FONTES, OPERADORES, LIMITE_DE_LINHAS, fonte, fontesVisiveis, validarDefinicao, montarConsulta, executar
};
