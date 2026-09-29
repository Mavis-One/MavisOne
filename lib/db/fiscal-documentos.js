// A CAMADA DE DOCUMENTO FISCAL (fase DK).
//
// Uma morada só para "documento fiscal a escriturar", de qualquer origem, com o
// imposto por item em coluna consultável. Antes disto havia quatro tabelas de
// nota e nenhuma guardava CST, base, alíquota e valor por tributo: `nfe` punha
// os itens dentro de `payload_enviado` (jsonb), `nfe_items` tinha 9 colunas sem
// imposto nenhum, e `nfe_entrada_item` guardava em `imposto` (jsonb).
//
// ESTE ARQUIVO TEM DUAS METADES, e a separação é o ponto:
//
//   1. A API DA CAMADA NOVA — `criarDocumento`, `getDocumentos`,
//      `mudarSituacao`. Fala o vocabulário fiscal: origem, sentido, situação,
//      tributo por item.
//
//   2. O CONTRATO ANTIGO DE `nfes`, preservado inteiro — `getNfes`,
//      `getNfeById`, `createNfe`, `updateNfe`, com as mesmas chaves em cada
//      objeto devolvido. `nfes` foi removida do banco nesta fase, e a tela
//      "NF-e Emitidas", a emissão manual, o cancelamento e as sete suítes que
//      leem esse formato não sabem que algo mudou.
//
// A segunda metade existe porque UMA TROCA DE ARMAZENAMENTO NÃO DEVERIA EXIGIR
// UMA TROCA DE CONTRATO. Fazer as duas de uma vez transformaria uma migração
// verificável numa reescrita de tela — e o jeito de saber que a troca de
// armazenamento está certa é justamente a tela continuar igual.
const { createId } = require('./client');
const { consultar, emTransacao } = require('./conexao');

// ---------------------------------------------------------------------------
// QUEM EXECUTA A CONSULTA
// ---------------------------------------------------------------------------
//
// Todas as funções daqui aceitam `{ cliente }`: sem ele, cada consulta pega uma
// conexão do pool; com ele, todas rodam na transação que o chamador já abriu.
//
// É o mesmo idioma de `opcoes.tambemNaTransacao` em `commitStockMovements`, e
// existe pelo mesmo motivo. Quem já está numa transação NÃO pode pegar outra
// conexão: o que a segunda gravar não é desfeito pelo rollback da primeira, e
// o que a primeira gravou não é visível para a segunda. As duas metades desse
// problema produzem defeito — a primeira deixa lixo, a segunda lê o estado
// errado e decide em cima dele.
//
// Aqui isso importa desde já em dois lugares: a emissão pela Focus vai querer
// gravar o documento fiscal na MESMA transação que grava a nota, e a prova
// desta fase roda tudo numa transação para poder desfazer no fim.
const executorDe = (cliente) => (cliente
  ? (sql, params) => cliente.query(sql, params)
  : (sql, params) => consultar(sql, params));

// ---------------------------------------------------------------------------
// O VOCABULÁRIO, E A TRADUÇÃO ENTRE OS DOIS LADOS
// ---------------------------------------------------------------------------
//
// `fiscal_documentos.situacao` é o estado FISCAL do documento (o que o C100
// chama de COD_SIT). A tela fala outro vocabulário, o da TRANSMISSÃO —
// autorizada, processando, rejeitada, rascunho —, porque ela mostra também as
// notas que saíram pela Focus, de `nfe`.
//
// Os dois se cruzam em quatro estados, e só esses quatro o registro manual pode
// ter: quem digita uma nota que existe fora do sistema não tem "processando".
const SITUACAO_PARA_STATUS = {
  REGULAR: 'autorizada',
  EXTEMPORANEO: 'autorizada',
  CANCELADO: 'cancelada',
  CANCELADO_EXTEMPORANEO: 'cancelada',
  DENEGADO: 'denegada',
  INUTILIZADO: 'inutilizada',
  COMPLEMENTAR: 'autorizada',
  COMPLEMENTAR_EXTEMPORANEO: 'autorizada',
  REGIME_ESPECIAL: 'autorizada'
};

const STATUS_PARA_SITUACAO = {
  autorizada: 'REGULAR',
  cancelada: 'CANCELADO',
  denegada: 'DENEGADO',
  inutilizada: 'INUTILIZADO'
};

/**
 * O status da tela a partir da situação fiscal.
 *
 * Situação desconhecida cai em 'autorizada'? NÃO. Ela devolve o valor cru, que
 * a tela mostra como rótulo em minúscula — feio e visível. O contrário, mapear
 * o desconhecido para "autorizada", mostraria como autorizada uma nota que o
 * banco chama de outra coisa, e esse é exatamente o defeito que o vocabulário
 * de `nfe_emitidas.js` foi escrito para evitar.
 */
function statusDaSituacao(situacao) {
  return SITUACAO_PARA_STATUS[situacao] || String(situacao || '').toLowerCase();
}

/**
 * A situação fiscal a partir do status pedido — e ela RECUSA o que não conhece.
 *
 * POR QUE RECUSAR EM VEZ DE ASSUMIR REGULAR
 * -----------------------------------------
 * A importação de planilha chamava `createNfe` com `status: statusBruto ||
 * 'emitida'`, e "emitida" não está no vocabulário de tela nenhuma — a lista
 * mostrava o rótulo cru. Pior: uma planilha com a coluna status escrita à mão
 * ("Em aberto", "faturado") entrava do mesmo jeito.
 *
 * Assumindo REGULAR, uma linha de planilha que diz "cancelada" com erro de
 * digitação entraria como nota VÁLIDA e contaria na apuração. Recusar devolve a
 * decisão para quem tem a planilha na mão.
 */
function situacaoDoStatus(status) {
  const pedido = String(status || '').trim().toLowerCase();
  if (!pedido) return 'REGULAR';
  const situacao = STATUS_PARA_SITUACAO[pedido];
  if (!situacao) {
    const erro = new Error(
      `Situacao fiscal desconhecida: "${status}". O registro manual aceita ` +
      Object.keys(STATUS_PARA_SITUACAO).join(', ') + '.'
    );
    erro.status = 400;
    throw erro;
  }
  return situacao;
}

const soDigitos = (valor) => String(valor ?? '').replace(/\D/g, '');
const textoOuNulo = (valor) => {
  const texto = String(valor ?? '').trim();
  return texto === '' ? null : texto;
};
const numero = (valor) => Number(valor || 0);

/**
 * CNPJ, CPF ou nenhum — pelo TAMANHO, e não por um campo de tipo.
 *
 * `people.type` existe, mas descreve o cadastro (cliente, fornecedor,
 * transportadora), não o documento. E o CHECK da tabela exige que o par
 * (tipo_documento, documento) concorde: declarar CPF com 14 dígitos é recusado
 * pelo banco, o que é melhor que entrar errado.
 */
function tipoDoDocumento(documento) {
  const digitos = soDigitos(documento);
  if (digitos.length === 14) return { tipo: 'CNPJ', documento: digitos };
  if (digitos.length === 11) return { tipo: 'CPF', documento: digitos };
  return { tipo: 'NENHUM', documento: null };
}

// ---------------------------------------------------------------------------
// 1. A API DA CAMADA NOVA
// ---------------------------------------------------------------------------

/**
 * A empresa a que um documento pertence.
 *
 * Há 0 empresas cadastradas, então isto devolve `null` com frequência — e
 * `fiscal_documentos.empresa_id` é nulável justamente por isso. A alternativa
 * era recusar a criação da nota até alguém cadastrar a empresa, o que
 * quebraria a rota de NF-e manual que funciona hoje.
 *
 * Quando houver mais de uma, este palpite deixa de servir e quem chama passa a
 * informar. Por ora, uma empresa é o caso e zero é o caso.
 */
async function empresaPadrao({ cliente } = {}) {
  const { rows } = await executorDe(cliente)(
    'select id from empresa where ativo order by criado_em limit 1'
  );
  return rows.length ? rows[0].id : null;
}

/**
 * O RETRATO DO PARTICIPANTE, reaproveitado quando nada mudou.
 *
 * O registro 0150 quer UMA linha por participante no arquivo, não uma por nota.
 * Então: se o retrato corrente já diz o que este documento diria, o documento
 * aponta para ele. Se algum campo mudou, o corrente é fechado e um novo abre —
 * mesma vigência semiaberta da fase DJ, e pelo mesmo motivo.
 *
 * Roda DENTRO da transação de quem chama (recebe `cliente`): um retrato criado
 * e um documento que falhou depois deixaria participante órfão no 0150.
 */
async function retratoDoParticipante(cliente, { empresaId, participante }) {
  const codigo = textoOuNulo(participante && (participante.code || participante.id));
  if (!codigo) return null;

  const { tipo, documento } = tipoDoDocumento(participante.document || participante.clientDocument);
  const novo = {
    codigo,
    person_id: textoOuNulo(participante.id),
    nome: textoOuNulo(participante.name || participante.customer) || codigo,
    documento,
    tipo_documento: tipo,
    inscricao_estadual: textoOuNulo(participante.stateRegistration || participante.clientStateRegistration),
    inscricao_municipal: textoOuNulo(participante.municipalRegistration),
    inscricao_suframa: textoOuNulo(participante.suframaRegistration),
    codigo_pais: textoOuNulo(participante.countryCode),
    codigo_municipio: textoOuNulo(participante.ibgeCityCode),
    logradouro: textoOuNulo(participante.street || participante.clientAddress),
    numero: textoOuNulo(participante.streetNumber),
    complemento: textoOuNulo(participante.addressComplement),
    bairro: textoOuNulo(participante.neighborhood),
    cep: soDigitos(participante.zipCode) || null,
    municipio: textoOuNulo(participante.city || participante.clientCity),
    uf: textoOuNulo(participante.state || participante.clientState)
  };

  const CAMPOS = Object.keys(novo);
  const { rows } = await cliente.query(
    `select id, ${CAMPOS.join(', ')} from fiscal_participantes
      where coalesce(empresa_id::text, '') = coalesce($1::text, '')
        and codigo = $2 and vigencia_fim is null`,
    [empresaId, codigo]
  );

  if (rows.length) {
    const atual = rows[0];
    // `String(a ?? '')` dos dois lados: o banco devolve null e o objeto novo
    // também, mas um devolve null e o outro undefined quando a chave não veio.
    // Comparar cru acharia diferença onde não há e abriria um retrato por nota.
    const igual = CAMPOS.every((c) => String(atual[c] ?? '') === String(novo[c] ?? ''));
    if (igual) return atual.id;
    await cliente.query(
      'update fiscal_participantes set vigencia_fim = now() where id = $1',
      [atual.id]
    );
  }

  const id = createId('fiscpart');
  const colunas = ['id', 'empresa_id', ...CAMPOS];
  const valores = [id, empresaId, ...CAMPOS.map((c) => novo[c])];
  await cliente.query(
    `insert into fiscal_participantes (${colunas.join(', ')})
     values (${colunas.map((_, i) => '$' + (i + 1)).join(', ')})`,
    valores
  );
  return id;
}

/**
 * Cria um documento fiscal, seus itens e o imposto de cada item.
 *
 * TUDO NUMA TRANSAÇÃO, e é uma correção em relação ao que `createNfe` fazia.
 * A versão anterior gravava a nota, gravava os itens, e — se os itens falhassem
 * — APAGAVA a nota como compensação. Duas coisas erradas ali: apagar documento
 * fiscal é o que este projeto não faz por princípio, e a própria compensação
 * podia falhar, deixando nota sem item. O comentário dela já dizia que a
 * transação passou a ser possível desde a saída do Supabase e que a compensação
 * continuava "por não ter sido reescrita". Foi reescrita aqui.
 */
async function criarDocumento(payload, itens, opcoes = {}) {
  const empresaId = payload.empresaId !== undefined
    ? payload.empresaId
    : await empresaPadrao({ cliente: opcoes.cliente });
  const id = payload.id || createId('fiscdoc');

  // TUDO OU NADA, e "tudo" inclui o que o chamador ja gravou. Com
  // `opcoes.cliente`, este corpo roda na transacao dele: um documento e seus
  // itens nao podem existir sem a nota que os originou.
  const corpo = async (cliente) => {
    const participanteId = await retratoDoParticipante(cliente, {
      empresaId,
      participante: payload.participante || {}
    });

    const lista = Array.isArray(itens) ? itens : [];
    // Os totais do documento saem da SOMA DOS ITENS quando quem chama não os
    // informa. Duas fontes para o mesmo número é como o total da nota e a soma
    // dos itens passam a discordar sem ninguém notar.
    const somaItens = lista.reduce((soma, item) => soma + numero(item.valorTotal ?? item.total), 0);

    await cliente.query(
      `insert into fiscal_documentos (
         id, empresa_id, estabelecimento_id, origem, nfe_id, nfe_entrada_id,
         sentido, emissao_propria, modelo, serie, numero, chave_acesso,
         data_emissao, data_movimento, situacao, participante_id,
         valor_total, valor_produtos, valor_desconto, valor_frete, valor_seguro, valor_outras,
         valor_bc_icms, valor_icms, valor_bc_icms_st, valor_icms_st, valor_ipi, valor_pis, valor_cofins,
         indicador_pagamento, parcelas_quantidade, parcelas_intervalo_dias,
         observacao_fiscal, order_id, criado_por, criado_por_nome
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
         $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36
       )`,
      [
        id, empresaId, payload.estabelecimentoId || null, payload.origem,
        payload.nfeId || null, payload.nfeEntradaId || null,
        payload.sentido || 'SAIDA',
        payload.emissaoPropria === undefined ? true : !!payload.emissaoPropria,
        payload.modelo || '55', textoOuNulo(payload.serie), String(payload.numero),
        textoOuNulo(payload.chaveAcesso),
        payload.dataEmissao || null, payload.dataMovimento || null,
        payload.situacao || 'REGULAR', participanteId,
        payload.valorTotal !== undefined ? numero(payload.valorTotal) : somaItens,
        payload.valorProdutos !== undefined ? numero(payload.valorProdutos) : somaItens,
        numero(payload.valorDesconto), numero(payload.valorFrete),
        numero(payload.valorSeguro), numero(payload.valorOutras),
        numero(payload.valorBcIcms), numero(payload.valorIcms),
        numero(payload.valorBcIcmsSt), numero(payload.valorIcmsSt),
        numero(payload.valorIpi), numero(payload.valorPis), numero(payload.valorCofins),
        payload.indicadorPagamento === undefined || payload.indicadorPagamento === null
          ? null : Number(payload.indicadorPagamento),
        Math.max(1, Number(payload.parcelasQuantidade || 1)),
        Math.max(1, Number(payload.parcelasIntervaloDias || 30)),
        textoOuNulo(payload.observacaoFiscal), textoOuNulo(payload.orderId),
        textoOuNulo(payload.criadoPor), String(payload.criadoPorNome || '')
      ]
    );

    let posicao = 0;
    for (const item of lista) {
      posicao += 1;
      const itemId = createId('fiscitem');
      await cliente.query(
        `insert into fiscal_documento_itens (
           id, documento_id, numero, product_id, codigo_item, descricao,
           produto_fiscal_id, quantidade, unidade, valor_unitario, valor_total,
           valor_desconto, indicador_movimento_fisico, cfop, ncm, cest, origem
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          itemId, id, item.numero || posicao,
          textoOuNulo(item.productId), String(item.codigoItem ?? item.code ?? ''),
          String(item.descricao ?? item.description ?? ''),
          textoOuNulo(item.produtoFiscalId),
          numero(item.quantidade ?? item.quantity), textoOuNulo(item.unidade ?? item.unit),
          numero(item.valorUnitario ?? item.unitPrice),
          numero(item.valorTotal ?? item.total), numero(item.valorDesconto),
          item.indicadorMovimentoFisico === undefined ? true : !!item.indicadorMovimentoFisico,
          textoOuNulo(item.cfop), textoOuNulo(item.ncm), textoOuNulo(item.cest),
          item.origem === undefined || item.origem === null || item.origem === ''
            ? null : Number(item.origem)
        ]
      );

      // O IMPOSTO, uma linha por tributo. Lista vazia é o caso de hoje: o
      // registro manual não calcula imposto, e a emissão pela Focus ainda não
      // escreve aqui. A tabela existe para o dado ter onde cair quando cair —
      // e a fase DJ mostrou que histórico sem morada é histórico perdido.
      for (const tributo of item.tributos || []) {
        if (!tributo || !tributo.tributo) continue;
        await cliente.query(
          `insert into fiscal_item_tributos (
             id, item_id, tributo, cst, base_calculo, aliquota, valor,
             reducao_base, codigo_beneficio
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            createId('fisctrib'), itemId, tributo.tributo, textoOuNulo(tributo.cst),
            tributo.baseCalculo === undefined ? null : numero(tributo.baseCalculo),
            tributo.aliquota === undefined ? null : numero(tributo.aliquota),
            tributo.valor === undefined ? null : numero(tributo.valor),
            tributo.reducaoBase === undefined ? null : numero(tributo.reducaoBase),
            textoOuNulo(tributo.codigoBeneficio)
          ]
        );
      }
    }

    return id;
  };

  return opcoes.cliente ? corpo(opcoes.cliente) : emTransacao(corpo);
}

// As colunas do documento, nomeadas. `select *` aqui obrigaria o mapeamento a
// adivinhar, e uma coluna nova entraria no objeto sem ninguém decidir.
const COLUNAS_DOCUMENTO = `
  id, empresa_id, estabelecimento_id, origem, nfe_id, nfe_entrada_id,
  sentido, emissao_propria, modelo, serie, numero, chave_acesso,
  data_emissao, data_movimento, situacao, participante_id,
  valor_total, valor_produtos, valor_desconto, valor_frete, valor_seguro, valor_outras,
  valor_bc_icms, valor_icms, valor_bc_icms_st, valor_icms_st, valor_ipi, valor_pis, valor_cofins,
  indicador_pagamento, parcelas_quantidade, parcelas_intervalo_dias,
  observacao_fiscal, order_id, criado_por, criado_por_nome, criado_em, atualizado_em`;

/**
 * Os documentos, com itens e participante — em TRÊS consultas, não em 1+N.
 *
 * É a mesma lição que `getNfes()` já carregava no comentário: a versão anterior
 * dela chamava `getNfeById()` por linha. Aqui são os documentos, os itens de
 * todos eles, e os participantes de todos eles.
 */
async function getDocumentos({ origem, orderId, limite, cliente } = {}) {
  const filtros = [];
  const valores = [];
  if (origem) { valores.push(origem); filtros.push(`origem = $${valores.length}`); }
  if (orderId) { valores.push(orderId); filtros.push(`order_id = $${valores.length}`); }
  const onde = filtros.length ? 'where ' + filtros.join(' and ') : '';
  // `data_emissao desc nulls last` e depois `criado_em desc`: o registro manual
  // pode entrar sem data, e sem o desempate a ordem de duas notas do mesmo dia
  // seria a ordem em que o Postgres as achou — o empate indiferente que a fase
  // DE removeu da lista de Vendas.
  const { rows } = await executorDe(cliente)(
    `select ${COLUNAS_DOCUMENTO} from fiscal_documentos ${onde}
      order by data_emissao desc nulls last, criado_em desc, id desc
      ${limite ? 'limit ' + Number(limite) : ''}`,
    valores
  );
  if (!rows.length) return [];
  return montarDocumentos(rows, cliente);
}

async function getDocumentoById(id, { cliente } = {}) {
  const { rows } = await executorDe(cliente)(
    `select ${COLUNAS_DOCUMENTO} from fiscal_documentos where id = $1`, [id]
  );
  if (!rows.length) return null;
  const lista = await montarDocumentos(rows, cliente);
  return lista[0] || null;
}

async function montarDocumentos(rows, cliente) {
  const ids = rows.map((r) => r.id);
  const participantes = rows.map((r) => r.participante_id).filter(Boolean);
  const executar = executorDe(cliente);

  // TRES CONSULTAS, E NAO 1+N. E a mesma licao que o `getNfes()` removido ja
  // carregava no comentario: a versao anterior dele chamava `getNfeById()` por
  // linha da lista.
  //
  // EM PARALELO SO QUANDO VEM DO POOL, e a diferenca nao e estetica.
  //
  // A primeira versao daqui usava `Promise.all` nos dois casos, com este
  // comentario: "Promise.all com o mesmo cliente enfileira de todo jeito no
  // driver". ERRADO, e o proprio driver avisa:
  //
  //     DeprecationWarning: Calling client.query() when the client is already
  //     executing a query is deprecated and will be removed in pg@9.0
  //
  // Uma conexao atende uma consulta por vez. O `pg` hoje enfileira e emite esse
  // aviso; no pg@9 ele vai recusar. Entao com transacao as tres vao em fila, de
  // proposito, e sem transacao vao em onda.
  //
  // E a onda aqui vale pouco mesmo: a errata de 53a9c60 mediu que, com Postgres
  // local por socket, o custo nao e espera de rede — e o Node convertendo linha
  // em objeto, o que e CPU num event loop so. Duas consultas pesadas em paralelo
  // se enfileiram na CPU. O ganho e de ~20 ms, nao de metade do tempo.
  const consultaDeItens = () => executar(
    `select i.* from fiscal_documento_itens i where i.documento_id = any($1)
      order by i.documento_id, i.numero`, [ids]
  );
  const consultaDeTributos = () => executar(
    `select t.* from fiscal_item_tributos t
      join fiscal_documento_itens i on i.id = t.item_id
     where i.documento_id = any($1) order by t.item_id, t.tributo`, [ids]
  );
  const consultaDePessoas = () => (participantes.length
    ? executar('select * from fiscal_participantes where id = any($1)', [participantes])
    : Promise.resolve({ rows: [] }));

  let itens;
  let tributos;
  let pessoas;
  if (cliente) {
    itens = await consultaDeItens();
    tributos = await consultaDeTributos();
    pessoas = await consultaDePessoas();
  } else {
    [itens, tributos, pessoas] = await Promise.all([
      consultaDeItens(), consultaDeTributos(), consultaDePessoas()
    ]);
  }

  const tributosPorItem = new Map();
  for (const t of tributos.rows) {
    if (!tributosPorItem.has(t.item_id)) tributosPorItem.set(t.item_id, []);
    tributosPorItem.get(t.item_id).push(mapTributo(t));
  }
  const itensPorDoc = new Map();
  for (const i of itens.rows) {
    if (!itensPorDoc.has(i.documento_id)) itensPorDoc.set(i.documento_id, []);
    itensPorDoc.get(i.documento_id).push(mapItem(i, tributosPorItem.get(i.id) || []));
  }
  const pessoaPorId = new Map(pessoas.rows.map((p) => [p.id, mapParticipante(p)]));

  return rows.map((r) => mapDocumento(r, itensPorDoc.get(r.id) || [], pessoaPorId.get(r.participante_id) || null));
}

function mapDocumento(row, itens, participante) {
  return {
    id: row.id,
    empresaId: row.empresa_id || '',
    estabelecimentoId: row.estabelecimento_id || '',
    origem: row.origem,
    nfeId: row.nfe_id || '',
    nfeEntradaId: row.nfe_entrada_id || '',
    sentido: row.sentido,
    emissaoPropria: row.emissao_propria,
    modelo: row.modelo,
    serie: row.serie || '',
    numero: row.numero,
    chaveAcesso: row.chave_acesso || '',
    dataEmissao: row.data_emissao,
    dataMovimento: row.data_movimento,
    situacao: row.situacao,
    valorTotal: numero(row.valor_total),
    valorProdutos: numero(row.valor_produtos),
    valorDesconto: numero(row.valor_desconto),
    valorFrete: numero(row.valor_frete),
    valorSeguro: numero(row.valor_seguro),
    valorOutras: numero(row.valor_outras),
    valorBcIcms: numero(row.valor_bc_icms),
    valorIcms: numero(row.valor_icms),
    valorBcIcmsSt: numero(row.valor_bc_icms_st),
    valorIcmsSt: numero(row.valor_icms_st),
    valorIpi: numero(row.valor_ipi),
    valorPis: numero(row.valor_pis),
    valorCofins: numero(row.valor_cofins),
    indicadorPagamento: row.indicador_pagamento,
    parcelasQuantidade: row.parcelas_quantidade,
    parcelasIntervaloDias: row.parcelas_intervalo_dias,
    observacaoFiscal: row.observacao_fiscal || '',
    orderId: row.order_id || '',
    criadoPor: row.criado_por || '',
    criadoPorNome: row.criado_por_nome || '',
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
    participante,
    itens
  };
}

function mapItem(row, tributos) {
  return {
    id: row.id,
    numero: row.numero,
    productId: row.product_id || '',
    codigoItem: row.codigo_item || '',
    descricao: row.descricao,
    produtoFiscalId: row.produto_fiscal_id || '',
    quantidade: numero(row.quantidade),
    unidade: row.unidade || '',
    valorUnitario: numero(row.valor_unitario),
    valorTotal: numero(row.valor_total),
    valorDesconto: numero(row.valor_desconto),
    indicadorMovimentoFisico: row.indicador_movimento_fisico,
    cfop: row.cfop || '',
    ncm: row.ncm || '',
    cest: row.cest || '',
    origem: row.origem,
    tributos
  };
}

function mapTributo(row) {
  return {
    tributo: row.tributo,
    cst: row.cst || '',
    baseCalculo: row.base_calculo === null ? null : numero(row.base_calculo),
    aliquota: row.aliquota === null ? null : numero(row.aliquota),
    valor: row.valor === null ? null : numero(row.valor),
    reducaoBase: row.reducao_base === null ? null : numero(row.reducao_base),
    codigoBeneficio: row.codigo_beneficio || ''
  };
}

function mapParticipante(row) {
  return {
    id: row.id,
    codigo: row.codigo,
    personId: row.person_id || '',
    nome: row.nome,
    documento: row.documento || '',
    tipoDocumento: row.tipo_documento,
    inscricaoEstadual: row.inscricao_estadual || '',
    inscricaoMunicipal: row.inscricao_municipal || '',
    inscricaoSuframa: row.inscricao_suframa || '',
    codigoPais: row.codigo_pais || '',
    codigoMunicipio: row.codigo_municipio || '',
    logradouro: row.logradouro || '',
    numero: row.numero || '',
    complemento: row.complemento || '',
    bairro: row.bairro || '',
    cep: row.cep || '',
    municipio: row.municipio || '',
    uf: row.uf || '',
    vigenciaInicio: row.vigencia_inicio,
    vigenciaFim: row.vigencia_fim
  };
}

/**
 * Muda a SITUAÇÃO de um documento. Não apaga, não recria.
 *
 * É a única escrita que um documento já criado aceita, e é de propósito: o
 * cancelamento é mudança de situação, e a regra deste projeto é que documento
 * fiscal não se apaga. O `on delete restrict` das três tabelas filhas é a
 * tranca estrutural da mesma regra.
 */
async function mudarSituacao(id, situacao, { cliente } = {}) {
  const { rows } = await executorDe(cliente)(
    `update fiscal_documentos set situacao = $2, atualizado_em = now()
      where id = $1 returning id`,
    [id, situacao]
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// 2. O CONTRATO ANTIGO DE `nfes`, PRESERVADO
// ---------------------------------------------------------------------------
//
// As quatro funções abaixo devolvem exatamente as chaves que
// `lib/db/financeiro.js` devolvia quando lia `nfes` e `nfe_items`. Conferido
// campo a campo contra o `mapNfeRow`/`mapNfeItemRow` que existia lá.
//
// O QUE MUDOU DE COMPORTAMENTO, e é pouco:
//
//   `status` passa a sair do vocabulário de quatro estados do registro manual.
//   Antes, `createNfe` aceitava qualquer texto — a importação de planilha
//   gravava "emitida", que não está no vocabulário da tela e aparecia como
//   rótulo cru em minúscula. Agora status fora do catálogo é RECUSADO com
//   mensagem, em vez de entrar e virar problema de quem for ler.

/** O objeto que a tela e as sete suítes esperam. */
function comoNfe(doc) {
  const p = doc.participante || {};
  return {
    id: doc.id,
    number: doc.numero,
    series: doc.serie,
    date: doc.dataEmissao,
    status: statusDaSituacao(doc.situacao),
    key: doc.chaveAcesso,
    amount: doc.valorTotal,
    customer: p.nome || '',
    clientSupplierId: p.personId || '',
    clientDocument: p.documento || '',
    clientAddress: p.logradouro || '',
    clientCity: p.municipio || '',
    clientState: p.uf || '',
    clientStateRegistration: p.inscricaoEstadual || '',
    taxNotes: doc.observacaoFiscal,
    paymentType: doc.parcelasQuantidade > 1 ? 'parcelado' : 'avista',
    installmentsCount: doc.parcelasQuantidade,
    installmentIntervalDays: doc.parcelasIntervaloDias,
    orderId: doc.orderId,
    createdBy: doc.criadoPor,
    createdByName: doc.criadoPorNome,
    createdAt: doc.criadoEm,
    updatedAt: doc.atualizadoEm,
    items: (doc.itens || []).map((item) => ({
      id: item.id,
      code: item.codigoItem,
      description: item.descricao,
      quantity: item.quantidade,
      unitPrice: item.valorUnitario,
      total: item.valorTotal,
      cfop: item.cfop,
      ncm: item.ncm
    }))
  };
}

async function getNfes(opcoes = {}) {
  const docs = await getDocumentos({ origem: 'MANUAL', cliente: opcoes.cliente });
  return docs.map(comoNfe);
}

async function getNfeById(id, opcoes = {}) {
  const doc = await getDocumentoById(id, opcoes);
  if (!doc || doc.origem !== 'MANUAL') return null;
  return comoNfe(doc);
}

async function createNfe(payload, items, opcoes = {}) {
  const id = await criarDocumento({
    origem: 'MANUAL',
    sentido: 'SAIDA',
    emissaoPropria: true,
    modelo: '55',
    serie: payload.series || '1',
    numero: payload.number,
    chaveAcesso: payload.key,
    dataEmissao: payload.date,
    situacao: situacaoDoStatus(payload.status),
    // `paymentType` não vira coluna: ele é DERIVADO de parcelas > 1 na leitura.
    // Guardar os dois deixaria "avista com 3 parcelas" ser representável.
    parcelasQuantidade: payload.paymentType === 'parcelado'
      ? Math.max(2, Number(payload.installmentsCount || 2)) : 1,
    parcelasIntervaloDias: payload.installmentIntervalDays,
    // IND_PGTO do C100: 0 à vista, 1 a prazo. O registro manual sabe qual é.
    indicadorPagamento: payload.paymentType === 'parcelado' ? 1 : 0,
    valorTotal: payload.amount,
    valorProdutos: payload.amount,
    observacaoFiscal: payload.taxNotes,
    orderId: payload.orderId,
    criadoPor: payload.createdBy,
    criadoPorNome: payload.createdByName,
    participante: {
      id: payload.clientSupplierId,
      code: payload.clientSupplierId || payload.customer,
      name: payload.customer,
      document: payload.clientDocument,
      clientAddress: payload.clientAddress,
      clientCity: payload.clientCity,
      clientState: payload.clientState,
      clientStateRegistration: payload.clientStateRegistration
    }
  }, (items || []).map((item, i) => ({
    numero: i + 1,
    productId: item.productId,
    codigoItem: item.code,
    descricao: item.description,
    quantidade: item.quantity,
    valorUnitario: item.unitPrice,
    valorTotal: item.total,
    cfop: item.cfop,
    ncm: item.ncm
  })), opcoes);
  return getNfeById(id, opcoes);
}

async function updateNfe(id, payload, opcoes = {}) {
  if (payload.status !== undefined) {
    await mudarSituacao(id, situacaoDoStatus(payload.status), opcoes);
  }
  return getNfeById(id, opcoes);
}

module.exports = {
  // a camada nova
  criarDocumento,
  getDocumentos,
  getDocumentoById,
  mudarSituacao,
  retratoDoParticipante,
  empresaPadrao,
  statusDaSituacao,
  situacaoDoStatus,
  tipoDoDocumento,
  SITUACAO_PARA_STATUS,
  STATUS_PARA_SITUACAO,
  // o contrato antigo
  comoNfe,
  getNfes,
  getNfeById,
  createNfe,
  updateNfe
};
