/**
 * A PLANILHA DE LANÇAMENTOS / CONTAS A PAGAR / CONTAS A RECEBER (16/10/2026).
 *
 * Pedido do usuário: "formatar o excel que vem diretamente das contas a pagar
 * e receber ... sem precisar mexer nele, gostaria que ele viesse pronto,
 * apenas para impressão". Era um CSV de colunas fixas (lib/relatorios-csv.js):
 * abria cru, com o Código na frente e a Conta bancária no meio, diferente da
 * tela.
 *
 * Agora é o que a tela mostra: as MESMAS colunas, na MESMA ordem (as que a
 * pessoa deixou visíveis em "Colunas"), com os mesmos textos — descrição
 * resumida, documento sem o código, empresa pelo nome — e pronto para
 * imprimir: deitado, na largura da folha, com o nome da tela no alto de cada
 * página e "Emitido em ... · Página X de Y" no pé. Quem monta o arquivo é
 * lib/xlsx.js.
 */
'use strict';

const { criarPlanilha } = require('./xlsx');
const Descricao = require('../public/modules/shared/descricao_lancamento');
const Codigo = require('../public/modules/shared/lancamento_codigo');

// Os da tela (FINANCE_DESCRICAO_LIMITE e financeStatusBadge em lancamentos.js).
const LIMITE_DA_DESCRICAO = 60;
const SITUACAO = {
  pendente: 'Pendente', vencido: 'Vencido', parcial: 'Parcial',
  pago: 'Pago', recebido: 'Recebido', cancelado: 'Cancelado'
};
const TIPO = { receita: 'Receita', despesa: 'Despesa', transferencia: 'Transferência', outro: 'Outro' };

const semTraco = (v) => {
  const texto = String(v ?? '').trim();
  return texto === '-' ? '' : texto;
};
function cnpj(doc) {
  const d = String(doc || '').replace(/\D/g, '');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (d.length === 8) return d.replace(/(\d{2})(\d{3})(\d{3})/, '$1.$2.$3');
  return d;
}

// Chave = a da coluna na tela (FINANCE_LISTA_COLUNAS), para a planilha seguir
// a escolha de colunas da pessoa. `hoje` chega em `ctx` (AAAA-MM-DD, Brasília).
const COLUNAS = {
  bankAccount: { titulo: 'Conta bancária', largura: 18, de: (e) => semTraco(e.bankAccountName) },
  date: { titulo: 'Data', tipo: 'data', largura: 11, de: (e) => e.date },
  dueDate: { titulo: 'Vencimento', tipo: 'data', largura: 11, de: (e) => e.dueDate },
  empresa: { titulo: 'Empresa', largura: 26, de: (e) => semTraco(e.empresaNome) || cnpj(e.empresaCnpj) },
  type: { titulo: 'Tipo', largura: 11, de: (e) => TIPO[e.type] || semTraco(e.type) },
  category: { titulo: 'Categoria', largura: 22, de: (e) => semTraco(e.categoryName) },
  clienteFornecedor: { titulo: 'Cliente/Fornecedor', largura: 30, de: (e) => semTraco(e.clienteFornecedor) },
  description: {
    titulo: 'Descrição',
    largura: 42,
    de: (e) => {
      const inteira = String(e.description || '').trim();
      return inteira ? Descricao.cortar(Descricao.resumir(inteira), LIMITE_DA_DESCRICAO) : '';
    }
  },
  amountPrevisto: { titulo: 'Valor previsto', tipo: 'moeda', largura: 15, somar: true, de: (e) => Number(e.amountPrevisto || 0) },
  amountRealizado: { titulo: 'Valor realizado', tipo: 'moeda', largura: 15, somar: true, de: (e) => Number(e.amountRealizado || 0) },
  emAberto: {
    titulo: 'Em aberto', tipo: 'moeda', largura: 15, somar: true,
    de: (e) => {
      if (e.emAberto != null) return Number(e.emAberto);
      if (['cancelado', 'pago', 'recebido'].includes(e.status)) return 0;
      return Math.max(0, Math.round((Number(e.amountPrevisto || 0) - Number(e.amountRealizado || 0)) * 100) / 100);
    }
  },
  status: {
    titulo: 'Situação',
    largura: 14,
    de: (e, ctx) => (e.status === 'parcial' && e.dueDate && String(e.dueDate) < ctx.hoje
      ? 'Parcial vencido'
      : SITUACAO[e.status] || semTraco(e.status))
  },
  document: { titulo: 'Documento', largura: 16, de: (e) => semTraco(Codigo.referencia(e.code, e.document)) },
  costCenter: { titulo: 'Centro de custo', largura: 18, de: (e) => semTraco(e.costCenterName) },
  paymentMethod: { titulo: 'Forma de pagamento', largura: 18, de: (e) => semTraco(e.paymentMethodName) },
  createdByName: { titulo: 'Lançado por', largura: 18, de: (e) => semTraco(e.createdByName) },
  codigo: { titulo: 'Código', largura: 10, de: (e) => semTraco(e.codigo) }
};

// As da tela para quem não escolheu (FINANCE_COLUNAS_PADRAO), na ordem dela.
const PADRAO = ['bankAccount', 'date', 'dueDate', 'empresa', 'type', 'category', 'clienteFornecedor', 'description',
  'amountPrevisto', 'amountRealizado', 'status', 'document', 'paymentMethod'];

// O título de cada tela (o do alto de cada página impressa e o do arquivo).
const TELAS = {
  lancamentos: 'Lançamentos',
  contas_a_pagar: 'Contas a Pagar',
  contas_a_receber: 'Contas a Receber'
};

/** As colunas pedidas, só as conhecidas e sem repetir; nenhuma = as da tela. */
function colunasPedidas(texto) {
  const pedidas = [...new Set(String(texto || '').split(',').map((c) => c.trim()).filter((c) => COLUNAS[c]))];
  return pedidas.length ? pedidas : PADRAO.slice();
}

/**
 * lancamentos: como a lista da tela os recebe (serializeFinanceEntry +
 * empresaNome/empresaCnpj). colunas: chaves de COLUNAS, na ordem da tela.
 */
function abaDosLancamentos({ lancamentos = [], colunas = PADRAO, tela = 'lancamentos', hoje, emitidoEm = '' }) {
  const ctx = { hoje: String(hoje || new Date().toISOString().slice(0, 10)) };
  const usadas = colunas.filter((c) => COLUNAS[c]).map((c) => COLUNAS[c]);
  // hasOwnProperty: "constructor" não pode virar título.
  const titulo = Object.prototype.hasOwnProperty.call(TELAS, tela) ? TELAS[tela] : TELAS.lancamentos;
  return {
    nome: titulo,
    colunas: usadas,
    linhas: lancamentos.map((e) => usadas.map((c) => c.de(e, ctx))),
    total: `Total (${lancamentos.length} ${lancamentos.length === 1 ? 'lançamento' : 'lançamentos'})`,
    impressao: {
      titulo,
      rodapeEsquerda: emitidoEm ? `Emitido em ${emitidoEm}` : '',
      paginas: true
    }
  };
}

function planilhaDosLancamentos(dados) {
  return criarPlanilha([abaDosLancamentos(dados)]);
}

module.exports = { abaDosLancamentos, planilhaDosLancamentos, colunasPedidas, COLUNAS, PADRAO, TELAS };
