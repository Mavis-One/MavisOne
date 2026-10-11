/**
 * NF-e IMPORTADAS DO SISTEMA ANTERIOR — gravar e listar (fase DX, 11/10/2026).
 *
 * Quem monta os documentos a partir das planilhas é lib/importacao-nfe-viper.js
 * (puro). Aqui chegam pela rota POST /api/fiscal/importacao/nfe, em lotes, e
 * por isso tudo é CONFERIDO de novo: a rota é uma porta, e o que passa por ela
 * vira documento fiscal.
 *
 * O QUE A IMPORTAÇÃO NÃO FAZ, de propósito: não gera conta a receber, não
 * mexe em estoque, não fala com a SEFAZ e não cria pedido. É registro do que
 * aconteceu em outro sistema. A origem 'IMPORTACAO' é o que separa isso de
 * 'MANUAL' (que gera parcelas) — ver a migração fase-dx-nfe-importadas.sql.
 *
 * REIMPORTAR É SEGURO: documento com a mesma chave, ou com a mesma referência
 * de importação, conta como "já existia" e não é gravado de novo.
 */
const { consultar, emTransacao } = require('./conexao');
const fiscalDocumentos = require('./fiscal-documentos');

const SITUACOES = ['REGULAR', 'CANCELADO'];
const TRIBUTOS = ['ICMS', 'ICMS_ST', 'IPI', 'PIS', 'COFINS'];
const MAX_POR_LOTE = 500;

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const texto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const numeroOk = (v) => v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v));

/** Confere um documento vindo da rota. Devolve o motivo da recusa, ou null. */
function motivoDaRecusa(d) {
  if (!d || typeof d !== 'object') return 'documento vazio';
  if (!texto(d.numero, 20) || !/^\d+$/.test(texto(d.numero, 20))) return 'número ausente ou não numérico';
  if (!['SAIDA', 'ENTRADA'].includes(d.sentido)) return 'sentido inválido';
  if (typeof d.emissaoPropria !== 'boolean') return 'emissão própria não informada';
  if (!SITUACOES.includes(d.situacao)) return 'situação inválida';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.dataEmissao || ''))) return 'data de emissão inválida';
  if (d.chaveAcesso && !/^\d{44}$/.test(String(d.chaveAcesso))) return 'chave de acesso inválida';
  if (soDigitos(d.estabelecimentoCnpj).length !== 14) return 'CNPJ do estabelecimento inválido';
  if (!texto(d.ref, 200)) return 'referência de importação ausente';
  const valores = d.valores || {};
  if (!Object.values(valores).every(numeroOk)) return 'valor não numérico';
  const itens = Array.isArray(d.itens) ? d.itens : [];
  if (itens.length > 990) return 'mais de 990 itens';
  for (const item of itens) {
    if (!numeroOk(item.quantidade) || !numeroOk(item.valorUnitario) || !numeroOk(item.valorTotal)) return 'item com valor não numérico';
    for (const t of item.tributos || []) {
      if (!TRIBUTOS.includes(t.tributo)) return `tributo não aceito: ${t.tributo}`;
      if (!numeroOk(t.valor)) return 'tributo com valor não numérico';
    }
  }
  return null;
}

async function estabelecimentosPorCnpj() {
  const { rows } = await consultar(
    "select id, empresa_id, regexp_replace(cnpj, '\\D', '', 'g') as cnpj from estabelecimento"
  );
  return new Map(rows.map((r) => [r.cnpj, r]));
}

/**
 * O participante do documento. Se o CPF/CNPJ é de alguém do cadastro, é ELE
 * (código e nome do cadastro): assim o 0150 de um mês que mistura nota
 * importada e nota emitida aqui não traz a mesma pessoa duas vezes. Sem
 * cadastro, um código próprio 'VIPER-...', e o nome do retrato que já existir —
 * a mesma pessoa escrita de dois jeitos em duas notas abriria um retrato novo
 * a cada nota.
 */
async function participanteDe(cliente, empresaId, p, cacheCadastro) {
  const documento = soDigitos(p && p.documento);
  const nome = texto(p && p.nome, 120);
  if (documento.length === 11 || documento.length === 14) {
    if (!cacheCadastro.has(documento)) {
      const { rows } = await cliente.query(
        "select * from people where regexp_replace(coalesce(document, ''), '\\D', '', 'g') = $1 order by code nulls last limit 1",
        [documento]
      );
      cacheCadastro.set(documento, rows[0] || null);
    }
    const pessoa = cacheCadastro.get(documento);
    if (pessoa && (pessoa.code || pessoa.id)) {
      // A ficha INTEIRA, no formato de mapPersonRow (lib/db/cadastros.js): o
      // endereço, o município (IBGE) e a IE moram no `extra`, e o registro 0150
      // do SPED precisa deles — sem eles, o mês importado acusa "participante
      // sem código de município".
      return {
        ...(pessoa.extra || {}),
        id: pessoa.id, code: pessoa.code || pessoa.id, name: pessoa.name || nome, document: documento,
        city: pessoa.city, state: pessoa.state, zipCode: pessoa.zip_code
      };
    }
  }
  const base = documento || nome.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!base) return {};
  const codigo = ('VIPER-' + base).slice(0, 60);
  const { rows } = await cliente.query(
    `select nome from fiscal_participantes
      where coalesce(empresa_id::text, '') = coalesce($1::text, '') and codigo = $2 and vigencia_fim is null`,
    [empresaId, codigo]
  );
  return { code: codigo, name: rows.length ? rows[0].nome : (nome || codigo), document: documento };
}

/**
 * Grava um lote. Devolve { criados, existentes, recusados: [{ ref, numero, motivo }] }.
 * Cada documento na SUA transação: um documento ruim não derruba os bons.
 */
async function gravarLote(documentos, { lote, usuario } = {}) {
  if (!Array.isArray(documentos)) throw Object.assign(new Error('Envie a lista de documentos.'), { status: 400 });
  if (documentos.length > MAX_POR_LOTE) throw Object.assign(new Error(`No máximo ${MAX_POR_LOTE} documentos por lote.`), { status: 400 });
  const nomeDoLote = texto(lote, 60) || 'importacao';
  const estabelecimentos = await estabelecimentosPorCnpj();
  const cacheCadastro = new Map();
  const resultado = { criados: 0, existentes: 0, recusados: [] };

  for (const d of documentos) {
    const recusa = motivoDaRecusa(d);
    const ref = texto(d && d.ref, 200);
    if (recusa) { resultado.recusados.push({ ref, numero: d && d.numero, motivo: recusa }); continue; }
    const estab = estabelecimentos.get(soDigitos(d.estabelecimentoCnpj));
    if (!estab) {
      resultado.recusados.push({ ref, numero: d.numero, motivo: `estabelecimento ${d.estabelecimentoCnpj} não cadastrado` });
      continue;
    }

    const { rows: ja } = await consultar(
      d.chaveAcesso
        ? 'select 1 from fiscal_documentos where chave_acesso = $1 limit 1'
        : "select 1 from fiscal_documentos where origem = 'IMPORTACAO' and importacao_ref = $1 limit 1",
      [d.chaveAcesso || ref]
    );
    if (ja.length) { resultado.existentes += 1; continue; }

    const itens = (d.itens || []).map((item) => ({
      numero: item.numero,
      codigoItem: texto(item.codigoItem, 60),
      descricao: texto(item.descricao, 120),
      quantidade: item.quantidade,
      unidade: texto(item.unidade, 6) || null,
      valorUnitario: item.valorUnitario,
      valorTotal: item.valorTotal,
      valorDesconto: item.valorDesconto,
      cfop: soDigitos(item.cfop).slice(0, 4) || null,
      ncm: soDigitos(item.ncm).slice(0, 8) || null,
      origem: item.origem,
      // Nota histórica: o item não move estoque aqui — moveu lá, no Viper.
      indicadorMovimentoFisico: true,
      tributos: (item.tributos || []).map((t) => ({ tributo: t.tributo, cst: texto(t.cst, 3) || null, valor: t.valor }))
    }));
    const v = d.valores || {};
    try {
      await emTransacao(async (cliente) => {
        const participante = await participanteDe(cliente, estab.empresa_id, d.participante, cacheCadastro);
        const id = await fiscalDocumentos.criarDocumento({
          empresaId: estab.empresa_id,
          estabelecimentoId: estab.id,
          origem: 'IMPORTACAO',
          sentido: d.sentido,
          emissaoPropria: d.emissaoPropria,
          modelo: /^\d{2}$/.test(String(d.modelo || '')) ? d.modelo : '55',
          serie: texto(d.serie, 3) || null,
          numero: texto(d.numero, 20),
          chaveAcesso: d.chaveAcesso || null,
          dataEmissao: d.dataEmissao,
          dataMovimento: d.dataEmissao,
          situacao: d.situacao,
          participante,
          valorTotal: v.valorTotal ?? 0,
          valorProdutos: v.valorProdutos ?? v.valorTotal ?? 0,
          valorDesconto: v.valorDesconto, valorFrete: v.valorFrete,
          valorIcms: v.valorIcms, valorIcmsSt: v.valorIcmsSt, valorIpi: v.valorIpi,
          valorPis: v.valorPis, valorCofins: v.valorCofins,
          criadoPor: usuario && usuario.id, criadoPorNome: usuario && usuario.name
        }, itens, { cliente });
        await cliente.query(
          `update fiscal_documentos
              set escriturar = $2, protocolo = $3, importacao_lote = $4, importacao_ref = $5
            where id = $1`,
          // NUNCA escriturável (fase DY, decisão do usuário em 11/10/2026): a
          // importada é histórico — os SPEDs daqueles meses saíram do Viper. O
          // banco também trava (fiscal_documentos_importada_nao_escritura_check).
          [id, false, texto(d.protocolo, 20) || null, nomeDoLote, ref]
        );
      });
      resultado.criados += 1;
    } catch (erro) {
      // A trava de numeração (nota sem chave já gravada por outro caminho).
      if (/idx_fiscal_documentos_(numeracao|chave)|duplicate key/i.test(erro.message || '')) {
        resultado.existentes += 1;
      } else {
        resultado.recusados.push({ ref, numero: d.numero, motivo: String(erro.message || erro).slice(0, 200) });
      }
    }
  }
  return resultado;
}

/**
 * As importadas EMITIDAS POR NÓS, para a lista NF-e Emitidas — no formato de
 * fiscalNfeParaLista (server.js). As de terceiro (compras) não são "emitidas".
 */
async function listarEmitidasParaLista() {
  const { rows } = await consultar(
    `select d.id, d.numero, d.serie, d.modelo, d.data_emissao, d.situacao, d.chave_acesso, d.valor_total,
            d.protocolo, d.sentido, d.estabelecimento_id, p.nome as p_nome, p.documento as p_documento
       from fiscal_documentos d
       left join fiscal_participantes p on p.id = d.participante_id
      where d.origem = 'IMPORTACAO' and d.emissao_propria`
  );
  return rows.map((r) => ({
    id: r.id,
    origem: 'importada',
    modelo: Number(r.modelo || 55),
    number: r.numero || '',
    series: r.serie || '',
    // DATE volta como texto 'AAAA-MM-DD' (lib/db/conexao.js).
    date: String(r.data_emissao || '').slice(0, 10),
    status: r.situacao === 'CANCELADO' ? 'cancelada' : 'autorizada',
    statusFiscal: r.situacao,
    key: r.chave_acesso || '',
    amount: Number(r.valor_total || 0),
    customer: r.p_nome || '',
    clientDocument: r.p_documento || '',
    protocolo: r.protocolo || '',
    sentido: r.sentido,
    estabelecimentoId: r.estabelecimento_id,
    financialEntries: [],
    items: []
  }));
}

/** Uma importada, com itens, no formato do modal da lista (comoNfe). */
async function obterParaTela(id) {
  const doc = await fiscalDocumentos.getDocumentoById(id);
  if (!doc || doc.origem !== 'IMPORTACAO') return null;
  return { ...fiscalDocumentos.comoNfe(doc), origem: 'importada', key: doc.chaveAcesso || '' };
}

module.exports = { gravarLote, listarEmitidasParaLista, obterParaTela, motivoDaRecusa, participanteDe, MAX_POR_LOTE };
