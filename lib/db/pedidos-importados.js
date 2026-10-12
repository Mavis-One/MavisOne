/**
 * PEDIDOS E ORÇAMENTOS DO VIPER — gravar como histórico (12/10/2026).
 *
 * Quem monta os documentos a partir da "Listagem de Vendas" é
 * lib/importacao-pedidos-viper.js (puro). Aqui chegam pela rota
 * POST /api/sales/importacao/viper, em lotes, e tudo é conferido de novo.
 *
 * O MESMO CONTRATO da importação de 11/09/2026 (commit 21f4236): histórico não
 * vira conta a receber nem movimenta estoque — a mercadoria já saiu no Viper.
 * As bandeiras stock_applied/finance_applied seguem o que aquela importação
 * gravou (faturado = true/true, o resto false/false), para que mexer depois
 * num pedido importado não tente aplicar de novo o que já foi aplicado lá.
 *
 * O NÚMERO É A PARTE DELICADA. Desde a fase CG, 16.000 em diante é numeração do
 * MavisONE — mas o Viper continuou e numerou outubro de 16.060 a 16.327, e já
 * há pedidos lançados aqui em produção. Não existe unique em orders.code nem em
 * quotes.code: gravar por cima seria dois documentos com o mesmo número, em
 * silêncio. Então:
 *   - número livre ........................ grava;
 *   - número deste mesmo pedido do Viper .. "já existia" (reimportar é seguro);
 *   - número de OUTRO documento ........... CONFLITO: não grava, e volta na
 *                                           lista para o usuário decidir.
 * Depois de gravar, a sequence salta para depois do maior número, para o
 * próximo pedido do MavisONE não cair na faixa do Viper (setembro ainda vem).
 */
const { consultar } = require('./conexao');
const vendasCompras = require('./vendas-compras');
const { EMPRESAS_DA_LISTAGEM } = require('../importacao-nfe-viper');
const { SUFIXO_DA_EMPRESA, MAIOR_NUMERO_ACEITO } = require('../importacao-pedidos-viper');

const MAX_POR_LOTE = 500;
const STATUS = { pedido: ['pedido', 'pedido-faturado', 'pedido-cancelado'], orcamento: ['orcamento'] };
const texto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// "28.807.155 SAMUEL RODRIGUES ELOI" (MEI) e "SAMUEL RODRIGUES ELOI" são a mesma pessoa.
const nomeChave = (v) => texto(v, 200).replace(/^[\d.\-/\s]+/, '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();

function motivoDaRecusa(d) {
  if (!d || typeof d !== 'object') return 'documento vazio';
  if (!STATUS[d.tipo]) return 'tipo inválido';
  if (!Number.isInteger(d.codigo) || d.codigo < 1 || d.codigo > MAX_CODIGO()) return 'número fora da faixa';
  if (!STATUS[d.tipo].includes(d.status)) return 'status inválido';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.data || ''))) return 'data inválida';
  if (typeof d.total !== 'number' || !Number.isFinite(d.total)) return 'total inválido';
  if (!(d.empresa in SUFIXO_DA_EMPRESA)) return 'empresa fora do MavisONE';
  return null;
}
function MAX_CODIGO() { return MAIOR_NUMERO_ACEITO; }

/** Pessoas do cadastro por nome: só quando o nome aponta para UMA pessoa. */
async function indicesDePessoas() {
  const { rows: pessoas } = await consultar('select id, name from people');
  const { rows: vendedores } = await consultar("select distinct seller_id from orders where coalesce(seller_id, '') <> ''");
  const ehVendedor = new Set(vendedores.map((r) => r.seller_id));
  const indice = (lista) => {
    const m = new Map();
    for (const p of lista) {
      const k = nomeChave(p.name);
      if (!k) continue;
      m.set(k, m.has(k) ? null : p.id); // nome repetido = ambíguo, não liga
    }
    return m;
  };
  return { clientes: indice(pessoas), vendedores: indice(pessoas.filter((p) => ehVendedor.has(p.id))) };
}

async function existente(codigo) {
  const { rows } = await consultar(
    `select 'pedido' as tabela, note, client_supplier_name as cliente, date::text as data from orders where code = $1
     union all
     select 'orçamento', note, client_supplier_name, date::text from quotes where code = $1 limit 1`,
    [codigo]
  );
  return rows[0] || null;
}

/** A NF-e importada do mesmo estabelecimento e número, ainda sem pedido. */
async function ligarNota(d, orderId) {
  const cnpj = EMPRESAS_DA_LISTAGEM[d.empresa];
  if (!cnpj || !d.nota || !d.nota.numero) return false;
  const { rows } = await consultar(
    `select f.id from fiscal_documentos f
       join estabelecimento e on e.id = f.estabelecimento_id
      where f.origem = 'IMPORTACAO' and f.emissao_propria and f.sentido = 'SAIDA'
        and regexp_replace(e.cnpj, '\\D', '', 'g') = $1 and f.numero = $2 and f.order_id is null`,
    [cnpj, String(d.nota.numero)]
  );
  if (rows.length !== 1) return false;
  await consultar('update fiscal_documentos set order_id = $2, atualizado_em = now() where id = $1 and order_id is null', [rows[0].id, orderId]);
  return true;
}

async function gravarPedidos(documentos, { usuario, simular = false } = {}) {
  if (!Array.isArray(documentos)) throw Object.assign(new Error('Envie a lista de documentos.'), { status: 400 });
  if (documentos.length > MAX_POR_LOTE) throw Object.assign(new Error(`No máximo ${MAX_POR_LOTE} documentos por lote.`), { status: 400 });
  const r = { criados: 0, existentes: 0, conflitos: [], recusados: [], notasLigadas: 0, clientesLigados: 0, vendedoresLigados: 0, simulado: Boolean(simular) };
  const pessoas = await indicesDePessoas();
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  for (const d of documentos) {
    const recusa = motivoDaRecusa(d);
    if (recusa) { r.recusados.push({ codigo: d && d.codigo, motivo: recusa }); continue; }
    const ja = await existente(d.codigo);
    if (ja) {
      const doViper = /Importado do ViperERP/.test(ja.note || '') && new RegExp(`nº ${d.codigo}\\b`).test(ja.note || '');
      if (doViper) r.existentes += 1;
      else r.conflitos.push({ codigo: d.codigo, viper: { tipo: d.tipo, cliente: d.cliente, data: d.data, total: d.total }, mavisone: { tabela: ja.tabela, cliente: ja.cliente, data: ja.data } });
      continue;
    }
    if (simular) { r.criados += 1; continue; }

    const clienteId = pessoas.clientes.get(nomeChave(d.cliente)) || null;
    const vendedorId = pessoas.vendedores.get(nomeChave(d.vendedor)) || null;
    const nota = d.nota ? `NF nº ${texto(d.nota.numero, 12)}${d.nota.situacao ? ` (${texto(d.nota.situacao, 20)})` : ''} | ` : '';
    const payload = {
      code: d.codigo,
      date: d.data,
      createdAt: `${d.data}T12:00:00-03:00`,
      clientSupplierId: clienteId,
      clientSupplierName: texto(d.cliente, 120),
      sellerId: vendedorId,
      totalAmount: d.total,
      itemsTotal: d.total,
      items: [],
      status: d.status,
      category: texto(d.categoria, 120),
      note: `Importado do ViperERP em ${hoje} — ${d.tipo === 'orcamento' ? 'orçamento' : 'pedido'} nº ${d.codigo} | Empresa: ${texto(d.empresa, 80)}`
        + ` | Vendedor (Viper): ${texto(d.vendedor, 80) || '-'} | ${nota}Listagem de Vendas: sem itens.`,
      // Histórico: a mercadoria já saiu e a conta já foi cobrada no Viper.
      stockApplied: d.status === 'pedido-faturado',
      financeApplied: d.status === 'pedido-faturado',
      createdBy: usuario && usuario.id,
      createdByName: (usuario && usuario.name) || 'Importação Viper'
    };
    const criado = d.tipo === 'orcamento' ? await vendasCompras.createQuote(payload) : await vendasCompras.createOrder(payload);
    r.criados += 1;
    if (clienteId) r.clientesLigados += 1;
    if (vendedorId) r.vendedoresLigados += 1;
    if (d.tipo === 'pedido' && await ligarNota(d, criado.id)) r.notasLigadas += 1;
  }

  // A numeração do MavisONE salta para depois do maior número (orders e quotes
  // dividem a sequence). greatest: nunca rebaixa. Falhar aqui não desfaz nada:
  // o alocador ainda se corrige sozinho na primeira colisão.
  if (!simular && r.criados) {
    try {
      await consultar(`select setval('sales_code_seq', greatest(
        (select last_value from sales_code_seq),
        coalesce((select max(code) from orders where code <= $1), 0),
        coalesce((select max(code) from quotes where code <= $1), 0)
      ), true)`, [MAIOR_NUMERO_ACEITO]);
    } catch (erro) { /* sem a sequence (fase BR), o alocador usa max+1 */ }
  }
  return r;
}

module.exports = { gravarPedidos, motivoDaRecusa, nomeChave, MAX_POR_LOTE };
