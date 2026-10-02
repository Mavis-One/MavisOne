// A ESCRITURAÇÃO DO SPED, LADO DO BANCO (fase DL).
//
// Três trabalhos, e só estes:
//
//   1. ESCRITURAR — pôr em `fiscal_documentos` cada nota que o SPED tem de
//      conter e ainda não está lá: a NF-e autorizada pela Focus (do XML que
//      `nfe_arquivos` guardou) e a nota de entrada (do XML em `nfe_entrada`).
//      Idempotente: rodar duas vezes não escritura duas vezes (o índice único
//      em nfe_id/nfe_entrada_id garante, e a consulta evita bater nele).
//
//   2. LER — o cadastro, a configuração e os documentos do mês, no formato que
//      lib/sped-montagem.js recebe.
//
//   3. ENCADEAR O SALDO — o saldo credor de um mês é o do anterior, desde a
//      competência inicial configurada. Recalculado a cada geração, não
//      guardado (ver o cabeçalho da fase DL).
//
// O que decide registro e campo NÃO está aqui: está em lib/sped-montagem.js,
// que é puro e testado sem banco.

const crypto = require('crypto');
const { consultar, emTransacao } = require('./conexao');
const { createId } = require('./client');
const fiscalDocumentos = require('./fiscal-documentos');
const { documentoDoXml } = require('../sped-documento');
const { montarEscrituracao, janela } = require('../sped-montagem');

const so = (v) => String(v ?? '').replace(/\D/g, '');
const FUSO = 'America/Sao_Paulo';

// QUEM EXECUTA A CONSULTA — o mesmo idioma de lib/db/fiscal-documentos.js. Com
// `cliente`, tudo roda na transação de quem chamou (a prova roda numa e desfaz
// no fim); sem ele, cada consulta pega uma conexão do pool.
const executorDe = (cliente) => (cliente ? (sql, params) => cliente.query(sql, params) : consultar);

// ---------------------------------------------------------------------------
// CONFIGURAÇÃO
// ---------------------------------------------------------------------------

const CAMPOS_CONFIG = [
  'contador_nome', 'contador_cpf', 'contador_crc', 'contador_cnpj', 'contador_cep', 'contador_endereco',
  'contador_numero', 'contador_complemento', 'contador_bairro', 'contador_telefone', 'contador_email',
  'contador_codigo_municipio', 'credito_icms_entradas', 'e116_codigo_receita', 'e116_dia_vencimento',
  'indicadores_1010', 'competencia_inicial', 'saldo_credor_inicial', 'bloco_k_obrigatorio'
];
// Campos guardados só com dígitos: o arquivo vai sem máscara, e guardar
// formatado obrigaria a limpar na serialização, onde ninguém lembraria.
const SO_DIGITOS = new Set(['contador_cpf', 'contador_cnpj', 'contador_cep', 'contador_telefone', 'contador_codigo_municipio']);

async function obterEstabelecimento(estabelecimentoId, cliente) {
  const { rows } = await executorDe(cliente)('select * from estabelecimento where id = $1', [estabelecimentoId]);
  return rows[0] || null;
}

async function obterConfiguracao(estabelecimentoId, { cliente } = {}) {
  const est = await obterEstabelecimento(estabelecimentoId, cliente);
  if (!est) return null;
  const { rows } = await executorDe(cliente)('select * from sped_configuracao where estabelecimento_id = $1', [estabelecimentoId]);
  const cfg = rows[0] || { estabelecimento_id: estabelecimentoId, indicadores_1010: {}, bloco_k_obrigatorio: false };
  return {
    ...cfg,
    saldo_credor_inicial: cfg.saldo_credor_inicial === null || cfg.saldo_credor_inicial === undefined ? null : Number(cfg.saldo_credor_inicial),
    // Perfil e atividade moram no estabelecimento desde a fase DJ; a tela os
    // edita junto com o resto, então eles vêm junto.
    perfil_sped: est.perfil_sped ? String(est.perfil_sped).trim() : null,
    indicador_atividade: est.indicador_atividade
  };
}

/**
 * O QUE FALTA nos dados do SPED, em palavras. Mora aqui (e não na tela) porque
 * quem não é administrador não recebe a configuração — só esta lista — e
 * precisa saber por que o SPED não sai.
 */
function oQueFalta(cfg) {
  const f = [];
  if (!cfg) return ['tudo'];
  if (!cfg.perfil_sped) f.push('perfil');
  if (cfg.indicador_atividade === null || cfg.indicador_atividade === undefined) f.push('atividade');
  if (!cfg.contador_nome || !(cfg.contador_cpf || cfg.contador_cnpj) || !cfg.contador_crc) f.push('contador');
  if (!cfg.credito_icms_entradas) f.push('crédito das entradas');
  if (!cfg.e116_codigo_receita) f.push('código de receita');
  if (!cfg.competencia_inicial || cfg.saldo_credor_inicial === null || cfg.saldo_credor_inicial === undefined) f.push('início e saldo');
  return f;
}

function erro400(msg) {
  return Object.assign(new Error(msg), { status: 400 });
}

/**
 * Grava a configuração. Valida o que o banco não valida e que, errado, faria
 * o arquivo sair errado sem ninguém notar.
 */
async function salvarConfiguracao(estabelecimentoId, dados, usuario = {}) {
  const est = await obterEstabelecimento(estabelecimentoId);
  if (!est) throw Object.assign(new Error('Estabelecimento não encontrado.'), { status: 404 });

  const v = {};
  for (const campo of CAMPOS_CONFIG) {
    if (!(campo in dados)) continue;
    let valor = dados[campo];
    if (typeof valor === 'string') valor = valor.trim();
    if (valor === '') valor = null;
    if (SO_DIGITOS.has(campo) && valor !== null) valor = so(valor) || null;
    v[campo] = valor;
  }
  if ('contador_cpf' in v && v.contador_cpf && v.contador_cpf.length !== 11) throw erro400('O CPF do contador tem 11 dígitos.');
  if ('contador_cnpj' in v && v.contador_cnpj && v.contador_cnpj.length !== 14) throw erro400('O CNPJ do escritório tem 14 dígitos.');
  if ('contador_codigo_municipio' in v && v.contador_codigo_municipio && v.contador_codigo_municipio.length !== 7) throw erro400('O código IBGE do município tem 7 dígitos.');
  if ('credito_icms_entradas' in v && v.credito_icms_entradas !== null && !['DESTACADO', 'NENHUM'].includes(v.credito_icms_entradas)) throw erro400('Crédito das entradas: DESTACADO ou NENHUM.');
  if ('e116_dia_vencimento' in v && v.e116_dia_vencimento !== null) {
    const d = Number(v.e116_dia_vencimento);
    if (!Number.isInteger(d) || d < 1 || d > 31) throw erro400('O dia de vencimento vai de 1 a 31.');
    v.e116_dia_vencimento = d;
  }
  if ('competencia_inicial' in v && v.competencia_inicial !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v.competencia_inicial)) throw erro400('Competência inicial no formato aaaa-mm.');
  if ('saldo_credor_inicial' in v && v.saldo_credor_inicial !== null) {
    const s = Number(String(v.saldo_credor_inicial).replace(',', '.'));
    if (!Number.isFinite(s) || s < 0) throw erro400('O saldo credor inicial é um valor maior ou igual a zero.');
    v.saldo_credor_inicial = Math.round(s * 100) / 100;
  }
  if ('indicadores_1010' in v) {
    const ind = v.indicadores_1010 && typeof v.indicadores_1010 === 'object' ? v.indicadores_1010 : {};
    v.indicadores_1010 = JSON.stringify(Object.fromEntries(Object.entries(ind).map(([k, x]) => [k, x === 'S' ? 'S' : 'N'])));
  }
  if ('bloco_k_obrigatorio' in v) v.bloco_k_obrigatorio = v.bloco_k_obrigatorio === true || v.bloco_k_obrigatorio === 'true';

  await emTransacao(async (cliente) => {
    const colunas = Object.keys(v);
    await cliente.query(
      `insert into sped_configuracao (estabelecimento_id, ${[...colunas, 'atualizado_em', 'atualizado_por', 'atualizado_por_nome'].join(', ')})
       values ($1, ${colunas.map((_, i) => `$${i + 2}`).join(', ')}${colunas.length ? ', ' : ''}now(), $${colunas.length + 2}, $${colunas.length + 3})
       on conflict (estabelecimento_id) do update set
         ${[...colunas.map((c) => `${c} = excluded.${c}`), 'atualizado_em = now()', 'atualizado_por = excluded.atualizado_por', 'atualizado_por_nome = excluded.atualizado_por_nome'].join(', ')}`,
      [estabelecimentoId, ...colunas.map((c) => v[c]), usuario.id || null, usuario.name || '']
    );
    if ('perfil_sped' in dados) {
      const p = String(dados.perfil_sped || '').trim().toUpperCase() || null;
      if (p !== null && !['A', 'B', 'C'].includes(p)) throw erro400('Perfil: A, B ou C.');
      await cliente.query('update estabelecimento set perfil_sped = $2 where id = $1', [estabelecimentoId, p]);
    }
    if ('indicador_atividade' in dados) {
      const a = dados.indicador_atividade === '' || dados.indicador_atividade === null ? null : Number(dados.indicador_atividade);
      if (a !== null && ![0, 1].includes(a)) throw erro400('Indicador de atividade: 0 (industrial) ou 1 (outros).');
      await cliente.query('update estabelecimento set indicador_atividade = $2 where id = $1', [estabelecimentoId, a]);
    }
  });
  return obterConfiguracao(estabelecimentoId);
}

// ---------------------------------------------------------------------------
// 1. ESCRITURAR
// ---------------------------------------------------------------------------

const SITUACAO_DA_NFE = { AUTORIZADO: 'REGULAR', CANCELADO: 'CANCELADO', DENEGADO: 'DENEGADO' };

async function xmlDaNfe(nfeId, cliente) {
  const { rows } = await executorDe(cliente)(
    `select conteudo from nfe_arquivos where nfe_id = $1 and tipo = 'xml' order by baixado_em desc limit 1`, [nfeId]
  );
  // bytea chega como texto "\x<hex>" (lib/db/conexao.js) — o mesmo desembrulho
  // de lib/db/fiscal.js. O XML da NF-e é UTF-8.
  return rows[0] && rows[0].conteudo
    ? Buffer.from(String(rows[0].conteudo).replace(/^\\x/, ''), 'hex').toString('utf8')
    : null;
}

/**
 * Uma NF-e emitida pela Focus -> documento fiscal.
 *
 * Devolve { situacao: 'escriturada' | 'ja_estava' | 'atualizada' | 'pendente', motivo }.
 * 'pendente' é a nota autorizada cujo XML ainda não foi baixado: ela NÃO pode
 * ser escriturada do `payload_enviado` (ver lib/sped-documento.js), e a tela
 * manda buscar o XML que falta em Fiscal › Arquivos Fiscais.
 */
async function escriturarNfeEmitida(nfe, estabelecimento, { cliente } = {}) {
  const q = executorDe(cliente);
  const situacao = SITUACAO_DA_NFE[String(nfe.status || '').toUpperCase()];
  if (!situacao) return { situacao: 'ignorada', motivo: `status ${nfe.status}` };

  const { rows: existentes } = await q('select id, situacao from fiscal_documentos where nfe_id = $1', [nfe.id]);
  if (existentes.length) {
    const atual = existentes[0];
    // Só o cancelamento muda uma nota já escriturada. Voltar de cancelada para
    // regular não existe.
    if (situacao !== 'REGULAR' && atual.situacao === 'REGULAR') {
      await fiscalDocumentos.mudarSituacao(atual.id, situacao, { cliente });
      return { situacao: 'atualizada', motivo: situacao };
    }
    return { situacao: 'ja_estava' };
  }

  const xml = await xmlDaNfe(nfe.id, cliente);
  if (!xml) {
    if (situacao === 'REGULAR') return { situacao: 'pendente', motivo: 'o XML autorizado ainda não foi baixado da Focus' };
    // Cancelada ou denegada SEM XML: o C100 dela é só a identificação (número,
    // série, chave), e isso a linha de `nfe` tem.
    await fiscalDocumentos.criarDocumento({
      origem: 'EMISSAO', nfeId: nfe.id, estabelecimentoId: estabelecimento.id,
      sentido: Number(nfe.tipo_documento) === 0 ? 'ENTRADA' : 'SAIDA', emissaoPropria: true,
      modelo: String(nfe.modelo || 55), serie: nfe.serie === null ? null : String(nfe.serie),
      numero: String(nfe.numero), chaveAcesso: so(nfe.chave_acesso) || null,
      dataEmissao: nfe.data_emissao ? new Date(nfe.data_emissao).toLocaleDateString('sv-SE', { timeZone: FUSO }) : null,
      situacao, valorTotal: 0, valorProdutos: 0, orderId: nfe.order_id || null, criadoPorNome: 'Escrituração do SPED'
    }, [], { cliente });
    return { situacao: 'escriturada' };
  }

  const doc = documentoDoXml(xml, { cnpjEstabelecimento: estabelecimento.cnpj });
  if (doc.nota.ambiente && doc.nota.ambiente !== '1') return { situacao: 'ignorada', motivo: 'nota de homologação' };
  await fiscalDocumentos.criarDocumento({
    ...doc.payload, situacao, origem: 'EMISSAO', nfeId: nfe.id, estabelecimentoId: estabelecimento.id,
    orderId: nfe.order_id || null, criadoPorNome: 'Escrituração do SPED'
  }, doc.itens, { cliente });
  return { situacao: 'escriturada', avisos: doc.avisos };
}

/** Uma nota de entrada -> documento fiscal. */
async function escriturarEntrada(entrada, estabelecimento, { cliente } = {}) {
  const q = executorDe(cliente);
  const { rows: existentes } = await q('select id from fiscal_documentos where nfe_entrada_id = $1', [entrada.id]);
  if (existentes.length) return { situacao: 'ja_estava' };
  if (!entrada.xml) return { situacao: 'pendente', motivo: 'a entrada não guardou o XML' };

  const { rows: itens } = await q('select numero, product_id from nfe_entrada_item where entrada_id = $1', [entrada.id]);
  const produtoPorItem = Object.fromEntries(itens.filter((i) => i.product_id).map((i) => [i.numero, i.product_id]));
  const dataEntrada = new Date(entrada.criado_em).toLocaleDateString('sv-SE', { timeZone: FUSO });
  // A conversão de CFOP da empresa (fase DN): sem linha para o CFOP, vale a
  // regra genérica de cfopDeEntrada.
  const { rows: conv } = await q('select cfop_origem, cfop_entrada from cfop_conversao_entrada where empresa_id = $1', [estabelecimento.empresa_id]);
  const conversoesCfop = Object.fromEntries(conv.map((r) => [String(r.cfop_origem).trim(), String(r.cfop_entrada).trim()]));
  const doc = documentoDoXml(entrada.xml, { cnpjEstabelecimento: estabelecimento.cnpj, dataEntrada, produtoPorItem, conversoesCfop });
  if (doc.nota.ambiente && doc.nota.ambiente !== '1') return { situacao: 'ignorada', motivo: 'nota de homologação' };
  await fiscalDocumentos.criarDocumento({
    ...doc.payload, origem: 'ENTRADA_XML', nfeEntradaId: entrada.id, estabelecimentoId: estabelecimento.id,
    criadoPor: entrada.criado_por || null, criadoPorNome: 'Escrituração do SPED'
  }, doc.itens, { cliente });
  return { situacao: 'escriturada', avisos: doc.avisos };
}

/**
 * Escritura tudo o que falta no período. É chamado antes de cada prévia e de
 * cada geração — e por isso a nota autorizada ontem aparece hoje mesmo que o
 * gancho da autorização tenha falhado.
 */
async function sincronizarPeriodo({ estabelecimento, ini, fim, cliente }) {
  const q = executorDe(cliente);
  const relatorio = { escrituradas: 0, atualizadas: 0, pendentes: [], avisos: [] };
  const anotar = (r, rotulo) => {
    if (r.situacao === 'escriturada') relatorio.escrituradas += 1;
    if (r.situacao === 'atualizada') relatorio.atualizadas += 1;
    if (r.situacao === 'pendente') relatorio.pendentes.push(`${rotulo}: ${r.motivo}`);
    for (const a of r.avisos || []) relatorio.avisos.push(a);
  };

  const { rows: notas } = await q(
    `select * from nfe
      where estabelecimento_id = $1
        and upper(status) in ('AUTORIZADO', 'CANCELADO', 'DENEGADO')
        and (data_emissao at time zone '${FUSO}')::date between $2 and $3
      order by numero`, [estabelecimento.id, ini, fim]
  );
  for (const nfe of notas) {
    try { anotar(await escriturarNfeEmitida(nfe, estabelecimento, { cliente }), `NF-e ${nfe.numero}`); }
    catch (e) { relatorio.pendentes.push(`NF-e ${nfe.numero}: ${e.message}`); }
  }

  const { rows: entradas } = await q(
    `select * from nfe_entrada
      where destinatario_documento = $1
        and upper(status) in ('LANCADA', 'REVISAR')
        and (criado_em at time zone '${FUSO}')::date between $2 and $3
      order by criado_em`, [so(estabelecimento.cnpj), ini, fim]
  );
  for (const ent of entradas) {
    try { anotar(await escriturarEntrada(ent, estabelecimento, { cliente }), `entrada ${ent.numero} de ${ent.emitente_nome}`); }
    catch (e) { relatorio.pendentes.push(`entrada ${ent.numero} de ${ent.emitente_nome}: ${e.message}`); }
  }
  return relatorio;
}

// ---------------------------------------------------------------------------
// 2. LER
// ---------------------------------------------------------------------------

/**
 * Os documentos do mês, no formato de montarEscrituracao.
 *
 * O MÊS DE CADA NOTA: a própria cai pela data de emissão (DT_DOC); a de
 * terceiro, pela data em que entrou (DT_E_S). É a regra do Guia, e é por isso
 * que uma nota do fornecedor emitida em 31/08 e recebida em 02/09 é de setembro.
 */
async function carregarDocumentos({ estabelecimentoId, ini, fim, cliente }) {
  const q = executorDe(cliente);
  const { rows: docs } = await q(
    `select d.*, p.codigo as p_codigo, p.nome as p_nome, p.documento as p_documento, p.tipo_documento as p_tipo,
            p.inscricao_estadual as p_ie, p.inscricao_suframa as p_suframa, p.codigo_pais as p_pais,
            p.codigo_municipio as p_mun, p.logradouro as p_end, p.numero as p_num, p.complemento as p_compl, p.bairro as p_bairro
       from fiscal_documentos d
       left join fiscal_participantes p on p.id = d.participante_id
      where d.estabelecimento_id = $1
        and (case when d.emissao_propria then d.data_emissao else coalesce(d.data_movimento, d.data_emissao) end) between $2 and $3`,
    [estabelecimentoId, ini, fim]
  );
  if (!docs.length) return [];
  const ids = docs.map((d) => d.id);
  const { rows: itens } = await q(
    `select i.*, pf.sku as pf_sku, pf.nome as pf_nome, pf.unidade_comercial as pf_unidade, pf.ncm as pf_ncm,
            pf.cest as pf_cest, pf.ean as pf_ean, pf.codigo_ex_tipi as pf_ex, pf.tipo_produto_fiscal as pf_tipo
       from fiscal_documento_itens i
       left join lateral (
         select * from produto_fiscal f
          where f.product_id = i.product_id and f.vigencia_inicio <= ($2::date + 1)
            and (f.vigencia_fim is null or f.vigencia_fim > ($2::date + 1))
          order by f.vigencia_inicio desc limit 1
       ) pf on true
      where i.documento_id = any($1) order by i.documento_id, i.numero`, [ids, fim]
  );
  const { rows: tributos } = await q(
    `select t.* from fiscal_item_tributos t join fiscal_documento_itens i on i.id = t.item_id where i.documento_id = any($1)`, [ids]
  );
  const tribPorItem = new Map();
  for (const t of tributos) {
    if (!tribPorItem.has(t.item_id)) tribPorItem.set(t.item_id, {});
    tribPorItem.get(t.item_id)[t.tributo] = {
      cst: t.cst, base: t.base_calculo === null ? 0 : Number(t.base_calculo), aliquota: t.aliquota === null ? 0 : Number(t.aliquota),
      valor: t.valor === null ? 0 : Number(t.valor), reducao: t.reducao_base === null ? 0 : Number(t.reducao_base)
    };
  }
  const itensPorDoc = new Map();
  for (const i of itens) {
    if (!itensPorDoc.has(i.documento_id)) itensPorDoc.set(i.documento_id, []);
    itensPorDoc.get(i.documento_id).push({
      numero: i.numero, codigoItem: i.codigo_item, descricao: i.descricao, quantidade: Number(i.quantidade),
      unidade: i.unidade, valorTotal: Number(i.valor_total), valorDesconto: Number(i.valor_desconto),
      valorFrete: Number(i.valor_frete || 0), valorSeguro: Number(i.valor_seguro || 0), valorOutras: Number(i.valor_outras || 0),
      indicadorMovimentoFisico: i.indicador_movimento_fisico, cfop: i.cfop, ncm: i.ncm, cest: i.cest, origem: i.origem,
      tributos: tribPorItem.get(i.id) || {},
      produto: i.pf_sku ? {
        codigo: i.pf_sku, descricao: i.pf_nome, unidade: i.pf_unidade, ncm: i.pf_ncm, cest: i.pf_cest,
        ean: i.pf_ean, exIpi: i.pf_ex, tipoItem: i.pf_tipo
      } : null
    });
  }
  // `date` chega como 'aaaa-mm-dd' (lib/db/conexao.js), sem fuso — e assim fica.
  const data = (d) => (d ? String(d).slice(0, 10) : null);
  return docs.map((d) => ({
    id: d.id, origem: d.origem, sentido: d.sentido, emissaoPropria: d.emissao_propria, modelo: d.modelo, serie: d.serie,
    numero: d.numero, chaveAcesso: d.chave_acesso, dataEmissao: data(d.data_emissao), dataMovimento: data(d.data_movimento),
    situacao: d.situacao, indicadorPagamento: d.indicador_pagamento, modalidadeFrete: d.modalidade_frete,
    valorTotal: Number(d.valor_total), valorProdutos: Number(d.valor_produtos), valorDesconto: Number(d.valor_desconto),
    valorFrete: Number(d.valor_frete), valorSeguro: Number(d.valor_seguro), valorOutras: Number(d.valor_outras),
    valorPis: Number(d.valor_pis), valorCofins: Number(d.valor_cofins), observacaoFiscal: d.observacao_fiscal,
    participante: d.p_codigo ? {
      codigo: d.p_codigo, nome: d.p_nome, documento: d.p_documento, tipoDocumento: d.p_tipo, inscricaoEstadual: d.p_ie,
      inscricaoSuframa: d.p_suframa, codigoPais: d.p_pais, codigoMunicipio: d.p_mun, logradouro: d.p_end,
      numero: d.p_num, complemento: d.p_compl, bairro: d.p_bairro
    } : null,
    itens: itensPorDoc.get(d.id) || []
  }));
}

async function carregarUnidades(empresaId, cliente) {
  const { rows } = await executorDe(cliente)(
    'select codigo, descricao from fiscal_unidades where empresa_id is not distinct from $1 or empresa_id is null', [empresaId]
  );
  return Object.fromEntries(rows.map((r) => [String(r.codigo).trim().toUpperCase(), r.descricao]));
}

// ---------------------------------------------------------------------------
// 3. O MÊS, COM O SALDO ENCADEADO
// ---------------------------------------------------------------------------

function mesAnterior(competencia) {
  const { ano, mes } = janela(competencia);
  return mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, '0')}`;
}

/**
 * A escrituração de uma competência: sincroniza, lê, encadeia o saldo e monta.
 *
 * O SALDO: na competência inicial é o configurado; em cada mês seguinte, o
 * VL_SLD_CREDOR_TRANSPORTAR do anterior, recalculado. Antes da competência
 * inicial não há saldo conhecido — e a montagem impede a geração.
 */
async function escriturarCompetencia({ estabelecimentoId, competencia, sincronizar = true, vencimentoGuia = null, retificadora = false, cliente }) {
  const est = await obterEstabelecimento(estabelecimentoId, cliente);
  if (!est) throw Object.assign(new Error('Estabelecimento não encontrado.'), { status: 404 });
  const cfg = await obterConfiguracao(estabelecimentoId, { cliente });
  const { rows: emp } = await executorDe(cliente)('select * from empresa where id = $1', [est.empresa_id]);
  const unidades = await carregarUnidades(est.empresa_id, cliente);

  const mes = async (comp, sinc) => {
    const j = janela(comp);
    const sincronia = sinc ? await sincronizarPeriodo({ estabelecimento: est, ini: j.ini, fim: j.fim, cliente }) : null;
    const documentos = await carregarDocumentos({ estabelecimentoId, ini: j.ini, fim: j.fim, cliente });
    return { documentos, sincronia };
  };

  let saldo = null;
  const inicial = cfg.competencia_inicial;
  if (inicial && cfg.saldo_credor_inicial !== null && competencia >= inicial) {
    saldo = cfg.saldo_credor_inicial;
    // Do mês inicial até o anterior a este, cada um passando o saldo adiante.
    // Doze meses de cadeia são doze leituras do banco; é o preço de não
    // congelar erro (ver o cabeçalho da fase DL).
    for (let c = inicial; c < competencia; c = proximoMes(c)) {
      const { documentos } = await mes(c, false);
      const m = montarEscrituracao({ competencia: c, estabelecimento: est, empresa: emp[0] || {}, configuracao: cfg, documentos, unidades, saldoCredorAnterior: saldo });
      saldo = m.apuracao.VL_SLD_CREDOR_TRANSPORTAR;
    }
  }

  const { documentos, sincronia } = await mes(competencia, sincronizar);
  const montagem = montarEscrituracao({
    competencia, estabelecimento: est, empresa: emp[0] || {}, configuracao: cfg, documentos, unidades, saldoCredorAnterior: saldo,
    vencimentoGuia, retificadora
  });
  // NOTA DO MÊS QUE NÃO PÔDE SER ESCRITURADA IMPEDE. Ela fica fora do arquivo,
  // e um SPED sem uma nota autorizada declara menos do que houve — não é um
  // arquivo incompleto, é uma declaração errada. (Até 01/10/2026 isto era só
  // aviso; corrigido na mesma fase que guardou os arquivos gerados.)
  if (sincronia && sincronia.pendentes.length) {
    montagem.impedimentos.push({
      codigo: 'NOTAS_PENDENTES',
      titulo: `${sincronia.pendentes.length} nota(s) do mês não puderam ser escrituradas`,
      detalhe: 'Elas ficariam fora do arquivo. Nota autorizada sem XML: busque o XML em Fiscal › Arquivos Fiscais e gere de novo.',
      itens: sincronia.pendentes.slice(0, 20)
    });
  }
  if (inicial && competencia < inicial) {
    montagem.impedimentos.push({
      codigo: 'ANTES_DO_INICIO', titulo: `A escrituração deste sistema começa em ${inicial}`,
      detalhe: 'Competências anteriores são do sistema anterior.'
    });
  }
  return { estabelecimento: est, configuracao: cfg, montagem, sincronia };
}

// ---------------------------------------------------------------------------
// 4. OS ARQUIVOS GERADOS (fase DM)
// ---------------------------------------------------------------------------

/** Guarda o arquivo como foi entregue. Devolve o registro, sem o conteúdo. */
async function guardarArquivo({ estabelecimentoId, competencia, retificadora, nome, buffer, linhas, montagem, avisos, usuario = {} }, { cliente } = {}) {
  const id = createId('sped');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  await executorDe(cliente)(
    `insert into sped_arquivos (id, estabelecimento_id, competencia, retificadora, nome_arquivo, conteudo, linhas, bytes,
       sha256, documentos, icms_recolher, resumo, gerado_por, gerado_por_nome)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [id, estabelecimentoId, competencia, !!retificadora, nome, buffer, linhas, buffer.length, sha256,
      montagem.resumo.documentos || 0, montagem.apuracao.VL_ICMS_RECOLHER || 0,
      JSON.stringify({ resumo: montagem.resumo, apuracao: montagem.apuracao, avisos: avisos || [] }),
      usuario.id || null, usuario.name || '']
  );
  return { id, sha256 };
}

const COLUNAS_ARQUIVO = `id, estabelecimento_id, competencia, retificadora, nome_arquivo, linhas, bytes, sha256,
  documentos, icms_recolher, resumo, gerado_por_nome, gerado_em`;

function mapArquivo(r) {
  return {
    id: r.id, estabelecimentoId: r.estabelecimento_id, competencia: String(r.competencia).trim(), retificadora: r.retificadora,
    nome: r.nome_arquivo, linhas: r.linhas, bytes: r.bytes, sha256: String(r.sha256).trim(), documentos: r.documentos,
    icmsRecolher: Number(r.icms_recolher), avisos: (r.resumo && r.resumo.avisos) || [], geradoPor: r.gerado_por_nome, geradoEm: r.gerado_em
  };
}

/** Os arquivos de um estabelecimento, do mais novo para o mais antigo. Sem o conteúdo. */
async function listarArquivos(estabelecimentoId, { limite = 60, cliente } = {}) {
  const { rows } = await executorDe(cliente)(
    `select ${COLUNAS_ARQUIVO} from sped_arquivos where estabelecimento_id = $1 order by gerado_em desc limit $2`,
    [estabelecimentoId, limite]
  );
  return rows.map(mapArquivo);
}

/** Um arquivo, COM o conteúdo (Buffer). */
async function obterArquivo(id, { cliente } = {}) {
  const { rows } = await executorDe(cliente)(`select ${COLUNAS_ARQUIVO}, conteudo from sped_arquivos where id = $1`, [id]);
  if (!rows.length) return null;
  return { ...mapArquivo(rows[0]), conteudo: Buffer.from(String(rows[0].conteudo).replace(/^\\x/, ''), 'hex') };
}

function proximoMes(competencia) {
  const { ano, mes } = janela(competencia);
  return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`;
}

module.exports = {
  obterConfiguracao,
  oQueFalta,
  salvarConfiguracao,
  escriturarNfeEmitida,
  escriturarEntrada,
  sincronizarPeriodo,
  carregarDocumentos,
  escriturarCompetencia,
  guardarArquivo,
  listarArquivos,
  obterArquivo,
  mesAnterior,
  proximoMes
};
