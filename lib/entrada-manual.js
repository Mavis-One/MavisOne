/**
 * A NOTA DE ENTRADA DIGITADA À MÃO (14/10/2026).
 *
 * Pedido do usuário: um botão e uma tela dentro de Compras › Nota de Entrada
 * para lançar a NF-e sem o XML. A tela manda o que está na DANFE; aqui isso
 * vira uma nota NO MESMO FORMATO de lerNotaDeEntrada (lib/entradaNfe.js), e o
 * servidor a lança pelo MESMO caminho da nota com XML (montarConferencia e
 * lancarEntradaConferida): duplicidade, nota própria, estoque, custo, ordem
 * de compra e contas a pagar — um caminho só para o estoque entrar.
 *
 * A CHAVE DE ACESSO É OBRIGATÓRIA E CONFERIDA (dígito verificador). Ela está
 * impressa em toda DANFE, diz quem emitiu (CNPJ), o modelo, a série e o número,
 * e é ela que impede lançar a mesma nota duas vezes — inclusive se o XML
 * chegar depois pela SEFAZ.
 */
'use strict';

const soDigitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');
const dinheiro = (v) => Math.round(Number(v || 0) * 100) / 100;

/** Dígito verificador da chave (módulo 11, pesos 2 a 9 da direita para a esquerda). */
function digitoDaChave(chave43) {
  let peso = 2;
  let soma = 0;
  for (let i = chave43.length - 1; i >= 0; i -= 1) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** As partes da chave, ou um erro dizendo o que está errado nela. */
function lerChave(valor) {
  const chave = soDigitos(valor);
  if (chave.length !== 44) return { erro: 'A chave de acesso tem 44 dígitos (está na DANFE, acima do código de barras).' };
  if (digitoDaChave(chave.slice(0, 43)) !== Number(chave[43])) {
    return { erro: 'A chave de acesso não confere (dígito verificador). Confira os 44 números na DANFE.' };
  }
  return {
    chave,
    uf: chave.slice(0, 2),
    anoMes: chave.slice(2, 6),
    documentoEmitente: chave.slice(6, 20),
    modelo: chave.slice(20, 22),
    serie: String(Number(chave.slice(22, 25))),
    numero: String(Number(chave.slice(25, 34)))
  };
}

function erro(mensagem) {
  const e = new Error(mensagem);
  e.status = 400;
  return e;
}

/**
 * A nota no formato de lerNotaDeEntrada.
 *
 * `corpo`: { chave, dataEmissao, naturezaOperacao, itens: [{ produtoId,
 *   quantidade, valorUnitario }], frete, outrasDespesas, desconto,
 *   duplicatas: [{ vencimento, valor }] }
 * `fornecedor`: { name, document } do cadastro (quem emitiu).
 * `produtosPorId`: Map do catálogo.
 */
function montarNotaManual(corpo, { fornecedor, produtosPorId }) {
  const c = corpo || {};
  const partes = lerChave(c.chave);
  if (partes.erro) throw erro(partes.erro);
  if (partes.modelo !== '55') throw erro(`A chave é de modelo ${partes.modelo}; a entrada manual é para NF-e (modelo 55).`);
  const dataEmissao = String(c.dataEmissao || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataEmissao)) throw erro('Informe a data de emissão da nota.');
  if (!fornecedor) throw erro('Escolha o fornecedor.');
  if (soDigitos(fornecedor.document) && soDigitos(fornecedor.document).padStart(14, '0') !== partes.documentoEmitente) {
    throw erro(`A chave é de uma nota do CNPJ ${partes.documentoEmitente}, e o fornecedor escolhido tem outro documento.`);
  }

  const brutos = Array.isArray(c.itens) ? c.itens : [];
  if (!brutos.length) throw erro('Inclua ao menos um item.');
  const itens = brutos.map((bruto, i) => {
    const produto = produtosPorId.get(String(bruto.produtoId || ''));
    if (!produto) throw erro(`Item ${i + 1}: escolha o produto.`);
    const quantidade = Number(bruto.quantidade || 0);
    const valorUnitario = Number(bruto.valorUnitario || 0);
    if (!(quantidade > 0)) throw erro(`Item ${i + 1} (${produto.name}): a quantidade tem de ser maior que zero.`);
    if (valorUnitario < 0) throw erro(`Item ${i + 1} (${produto.name}): valor unitário negativo.`);
    return {
      numero: i + 1,
      codigo: produto.sku || '',
      ean: produto.ean || '',
      eanBruto: produto.ean || '',
      descricao: produto.name,
      ncm: produto.ncm || '',
      cest: produto.cest || '',
      cfop: '',
      unidade: produto.unidadeComercial || 'UN',
      quantidade,
      valorUnitario,
      valorTotal: dinheiro(quantidade * valorUnitario),
      desconto: 0, frete: 0, seguro: 0, outros: 0,
      unidadeTributavel: produto.unidadeTributavel || produto.unidadeComercial || 'UN',
      quantidadeTributavel: quantidade,
      compoeTotal: true,
      informacaoAdicional: '',
      // O produto escolhido vai junto: a conferência casa por ele, sem palpite.
      produtoIdEscolhido: produto.id,
      icms: {}, ipi: {}, pis: {}, cofins: {}, difal: {}
    };
  });

  const produtos = dinheiro(itens.reduce((s, it) => s + it.valorTotal, 0));
  const frete = dinheiro(c.frete);
  const outros = dinheiro(c.outrasDespesas);
  const desconto = dinheiro(c.desconto);
  if (frete < 0 || outros < 0 || desconto < 0) throw erro('Frete, outras despesas e desconto não podem ser negativos.');
  const total = dinheiro(produtos + frete + outros - desconto);
  if (total < 0) throw erro('O desconto é maior que a nota.');

  const duplicatas = (Array.isArray(c.duplicatas) ? c.duplicatas : [])
    .filter((d) => d && (d.vencimento || Number(d.valor)))
    .map((d, i) => ({
      numero: String(i + 1).padStart(3, '0'),
      vencimento: String(d.vencimento || dataEmissao).slice(0, 10),
      valor: dinheiro(d.valor)
    }));
  if (duplicatas.length) {
    const soma = dinheiro(duplicatas.reduce((s, d) => s + d.valor, 0));
    if (Math.round(soma * 100) !== Math.round(total * 100)) {
      throw erro(`As parcelas somam ${soma.toFixed(2).replace('.', ',')} e a nota dá ${total.toFixed(2).replace('.', ',')}: têm de fechar.`);
    }
  }

  return {
    chave: partes.chave,
    modelo: partes.modelo,
    serie: partes.serie,
    numero: partes.numero,
    dataEmissao,
    naturezaOperacao: String(c.naturezaOperacao || 'Compra').trim() || 'Compra',
    manual: true,
    emitente: {
      documento: partes.documentoEmitente,
      nome: fornecedor.name,
      inscricaoEstadual: fornecedor.stateRegistration || '',
      endereco: {}
    },
    destinatario: {},
    itens,
    totais: { produtos, frete, desconto, outros, nota: total },
    duplicatas,
    pagamentos: [],
    informacoesComplementares: ''
  };
}

module.exports = { lerChave, digitoDaChave, montarNotaManual };
