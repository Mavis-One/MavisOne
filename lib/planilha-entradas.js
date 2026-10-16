/**
 * A PLANILHA DAS NOTAS DE ENTRADA (16/10/2026). Pedido do usuário: "em notas
 * de entrada, preciso que você faça um botão para baixar uma planilha já
 * formatada".
 *
 * Duas abas: "Notas de entrada" (uma linha por nota) e "Itens" (uma por item,
 * com o produto do MavisONE a que foi vinculado). Quem monta o arquivo é
 * lib/xlsx.js; aqui só se decide o que vai em cada coluna.
 *
 * VALORES SÓ PARA ADMINISTRADOR: em Compras o valor pago é o custo (ver
 * lib/custo-oculto.js), e a tela já esconde as colunas de valor de quem não é.
 * A planilha segue a tela: sem `comValores`, as colunas marcadas `valor` saem
 * — a coluna inteira, e não um zero que pareceria dado.
 */
'use strict';

const { criarPlanilha } = require('./xlsx');

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
function documento(valor) {
  const d = soDigitos(valor);
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return d;
}
const simNao = (v) => (v ? 'Sim' : 'Não');
const numeroDaNota = (v) => (/^\d+$/.test(String(v || '').trim()) ? Number(v) : String(v || ''));

// Os mesmos rótulos da tela de entrada (ORIGEM_DO_VINCULO em entrada_nfe.js).
const VINCULO = {
  historico: 'já vinculado antes',
  gtin: 'código de barras',
  codigo: 'código igual ao SKU',
  descricao: 'só pela descrição',
  manual: 'escolhido por você'
};

const COLUNAS_NOTAS = [
  { titulo: 'Nota', tipo: 'inteiro', largura: 10, de: (e) => numeroDaNota(e.numero) },
  { titulo: 'Série', largura: 7, de: (e) => e.serie },
  { titulo: 'Emissão', tipo: 'data', largura: 12, de: (e) => e.data_emissao },
  { titulo: 'Lançada em', tipo: 'dataHora', largura: 17, de: (e) => e.criado_em },
  { titulo: 'Fornecedor', largura: 40, de: (e) => e.emitente_nome },
  { titulo: 'CNPJ/CPF do fornecedor', largura: 21, de: (e) => documento(e.emitente_documento) },
  { titulo: 'IE do fornecedor', largura: 15, de: (e) => e.emitente_ie },
  { titulo: 'Recebida por', largura: 30, de: (e, ctx) => ctx.filialDe(e.destinatario_documento) },
  { titulo: 'CNPJ que recebeu', largura: 21, de: (e) => documento(e.destinatario_documento) },
  { titulo: 'Natureza da operação', largura: 32, de: (e) => e.natureza_operacao },
  { titulo: 'Itens', tipo: 'inteiro', largura: 7, somar: true, de: (e, ctx) => (ctx.itensPorEntrada.get(e.id) || []).length },
  { titulo: 'Valor dos produtos', tipo: 'moeda', largura: 17, somar: true, valor: true, de: (e) => Number(e.valor_produtos || 0) },
  { titulo: 'Valor total', tipo: 'moeda', largura: 17, somar: true, valor: true, de: (e) => Number(e.valor_total || 0) },
  { titulo: 'Situação', largura: 11, de: (e) => (String(e.status || 'LANCADA') === 'LANCADA' ? 'Lançada' : 'A revisar') },
  { titulo: 'Movimentou estoque', largura: 12, de: (e) => simNao(e.movimentou_estoque) },
  { titulo: 'Gerou financeiro', largura: 12, de: (e) => simNao(e.gerou_financeiro) },
  { titulo: 'Lançada por', largura: 24, de: (e) => e.criado_por_nome },
  // Texto, sempre: como número, os 44 dígitos virariam 3,52E+43.
  { titulo: 'Chave de acesso', largura: 48, de: (e) => soDigitos(e.chave) }
];

const COLUNAS_ITENS = [
  { titulo: 'Nota', tipo: 'inteiro', largura: 10, de: (i, ctx) => numeroDaNota(ctx.entradaDe(i).numero) },
  { titulo: 'Série', largura: 7, de: (i, ctx) => ctx.entradaDe(i).serie },
  { titulo: 'Emissão', tipo: 'data', largura: 12, de: (i, ctx) => ctx.entradaDe(i).data_emissao },
  { titulo: 'Fornecedor', largura: 36, de: (i, ctx) => ctx.entradaDe(i).emitente_nome },
  { titulo: 'Item', tipo: 'inteiro', largura: 6, de: (i) => Number(i.numero || 0) },
  { titulo: 'Código no fornecedor', largura: 17, de: (i) => i.codigo_fornecedor },
  { titulo: 'Código de barras (EAN)', largura: 17, de: (i) => i.ean },
  { titulo: 'Descrição na nota', largura: 45, de: (i) => i.descricao },
  { titulo: 'NCM', largura: 11, de: (i) => i.ncm },
  { titulo: 'CFOP', largura: 7, de: (i) => i.cfop },
  { titulo: 'Unidade', largura: 8, de: (i) => i.unidade },
  { titulo: 'Quantidade', tipo: 'decimal', largura: 12, de: (i) => Number(i.quantidade || 0) },
  { titulo: 'Valor unitário', tipo: 'moedaUnitaria', largura: 16, valor: true, de: (i) => Number(i.valor_unitario || 0) },
  { titulo: 'Valor total', tipo: 'moeda', largura: 16, somar: true, valor: true, de: (i) => Number(i.valor_total || 0) },
  { titulo: 'Código no MavisONE', largura: 14, de: (i) => i.produto_sku },
  { titulo: 'Produto no MavisONE', largura: 40, de: (i) => i.produto_nome },
  { titulo: 'Vínculo', largura: 19, de: (i) => VINCULO[i.vinculo_origem] || i.vinculo_origem },
  { titulo: 'Movimentou estoque', largura: 12, de: (i) => simNao(i.movimentou_estoque) }
];

/**
 * entradas: linhas de nfe_entrada; itens: de nfe_entrada_item com produto_sku e
 * produto_nome; estabelecimentos: { cnpj, nomeFantasia, razaoSocial }.
 * Devolve as abas para criarPlanilha (exportado para os testes).
 */
function abasDasEntradas({ entradas = [], itens = [], estabelecimentos = [], comValores = false }) {
  const porId = new Map(entradas.map((e) => [e.id, e]));
  const itensPorEntrada = new Map();
  itens.forEach((i) => {
    if (!porId.has(i.entrada_id)) return;
    if (!itensPorEntrada.has(i.entrada_id)) itensPorEntrada.set(i.entrada_id, []);
    itensPorEntrada.get(i.entrada_id).push(i);
  });
  const filiais = new Map(estabelecimentos.map((e) => [soDigitos(e.cnpj), e.nomeFantasia || e.razaoSocial || '']));
  const ctx = {
    itensPorEntrada,
    entradaDe: (i) => porId.get(i.entrada_id) || {},
    filialDe: (doc) => filiais.get(soDigitos(doc)) || ''
  };
  const visiveis = (colunas) => colunas.filter((c) => comValores || !c.valor);
  const colunasNotas = visiveis(COLUNAS_NOTAS);
  const colunasItens = visiveis(COLUNAS_ITENS);
  // Os itens na ordem das notas, e cada nota na ordem dos itens dela.
  const itensEmOrdem = entradas.flatMap((e) => (itensPorEntrada.get(e.id) || [])
    .slice().sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0)));
  return [
    {
      nome: 'Notas de entrada',
      colunas: colunasNotas,
      linhas: entradas.map((e) => colunasNotas.map((c) => c.de(e, ctx))),
      total: 'Total'
    },
    {
      nome: 'Itens',
      colunas: colunasItens,
      linhas: itensEmOrdem.map((i) => colunasItens.map((c) => c.de(i, ctx))),
      total: 'Total'
    }
  ];
}

function planilhaDasEntradas(dados) {
  return criarPlanilha(abasDasEntradas(dados));
}

module.exports = { abasDasEntradas, planilhaDasEntradas, COLUNAS_NOTAS, COLUNAS_ITENS };
