/**
 * Catálogo de OPERAÇÕES FISCAIS.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * ---------------------------
 * O sistema tratava "emitir uma nota" como sinônimo de "vender": a nota saía,
 * o estoque baixava, o financeiro nascia. Funciona enquanto toda nota for uma
 * venda — e para de funcionar na primeira que não é.
 *
 * Uma NF-e Complementar de ICMS não entrega mercadoria, não gera recebível e
 * não movimenta saldo: só destaca imposto que ficou faltando. Tratá-la como
 * venda produziria baixa de estoque de produto que não saiu e um recebível que
 * ninguém vai cobrar.
 *
 * Em vez de espalhar `if (finalidade === 2)` por todo o código de emissão, cada
 * operação declara aqui o que faz. Devolução, ajuste, remessa e complemento de
 * IPI entram depois como mais uma linha, não como mais um `if`.
 *
 * SEPARAÇÃO QUE ISTO IMPÕE (e que o sistema não tinha):
 *   valor comercial   ≠  valor fiscal
 *   emitir documento  ≠  movimentar estoque
 *   emitir documento  ≠  gerar financeiro
 */

const OPERACOES = {
  VENDA: {
    rotulo: 'Venda',
    finalidade: 1,
    movimentaEstoque: true,
    geraFinanceiro: true,
    exigeReferencia: false,
    permiteQuantidadeZero: false,
    permiteValorZero: false,
    exigeIcms: false,
    exigeProdutoEscritural: false
  },
  TRANSFERENCIA: {
    rotulo: 'Transferência',
    finalidade: 1,
    movimentaEstoque: true,
    // Transferir entre estabelecimentos próprios não é receita: a mercadoria
    // continua sendo da mesma empresa.
    geraFinanceiro: false,
    exigeReferencia: false,
    permiteQuantidadeZero: false,
    permiteValorZero: false,
    exigeIcms: false,
    exigeProdutoEscritural: false
  },
  REMESSA: {
    rotulo: 'Remessa',
    finalidade: 1,
    movimentaEstoque: true,
    geraFinanceiro: false,
    exigeReferencia: false,
    permiteQuantidadeZero: false,
    permiteValorZero: false,
    exigeIcms: false,
    exigeProdutoEscritural: false
  },
  RETORNO: {
    rotulo: 'Retorno',
    finalidade: 1,
    movimentaEstoque: true,
    geraFinanceiro: false,
    exigeReferencia: false,
    permiteQuantidadeZero: false,
    permiteValorZero: false,
    exigeIcms: false,
    exigeProdutoEscritural: false
  },
  DEVOLUCAO: {
    rotulo: 'Devolução',
    finalidade: 4,
    movimentaEstoque: true,
    geraFinanceiro: false,
    // Devolução refere a nota que está sendo devolvida.
    exigeReferencia: true,
    permiteQuantidadeZero: false,
    permiteValorZero: false,
    exigeIcms: false,
    exigeProdutoEscritural: false
  },
  BONIFICACAO: {
    rotulo: 'Bonificação',
    finalidade: 1,
    // Brinde sai do estoque, mas não vira recebível.
    movimentaEstoque: true,
    geraFinanceiro: false,
    exigeReferencia: false,
    permiteQuantidadeZero: false,
    permiteValorZero: true,
    exigeIcms: false,
    exigeProdutoEscritural: false
  },
  ENTRADA_IMPORTACAO: {
    rotulo: 'Entrada de importação',
    finalidade: 1,
    movimentaEstoque: true,
    geraFinanceiro: false,
    exigeReferencia: false,
    permiteQuantidadeZero: false,
    permiteValorZero: false,
    exigeIcms: false,
    exigeProdutoEscritural: false
  },

  // -------------------------------------------------------------------------
  COMPLEMENTO_ICMS: {
    rotulo: 'Complemento de ICMS',
    // finNFe 2 = complementar. É o que diz à SEFAZ que a nota acrescenta valor
    // a um documento que já existe, em vez de documentar uma operação nova.
    finalidade: 2,
    // As duas travas centrais desta operação. São absolutas: valem mesmo que o
    // produto usado diga o contrário.
    movimentaEstoque: false,
    geraFinanceiro: false,
    // Sem a chave da nota original a SEFAZ recusa — e a nota não teria sentido.
    exigeReferencia: true,
    // O complemento não corresponde a mercadoria: quantidade e valor ZERO são
    // o correto, não uma falha de preenchimento.
    permiteQuantidadeZero: true,
    permiteValorZero: true,
    // ...mas o imposto tem que existir. Complemento de ICMS com ICMS zero não
    // complementa nada.
    exigeIcms: true,
    // Item físico numa nota que não entrega nada seria a gambiarra de sempre.
    exigeProdutoEscritural: true
  }
};

function operacao(tipo) {
  return OPERACOES[String(tipo || '').toUpperCase()] || null;
}

/**
 * Regra de estoque. Uma só, para emissão de nota e para qualquer fluxo que
 * pergunte — duas implementações divergiriam e o saldo pararia de fechar.
 *
 * A operação MANDA no produto: numa nota complementar nem um produto marcado
 * como "movimenta estoque" pode movimentar, porque não houve saída física.
 */
function deveMovimentarEstoque({ tipoOperacao, produto } = {}) {
  const op = operacao(tipoOperacao);
  if (op && op.movimentaEstoque === false) return false;
  if (produto && produto.movimentaEstoque === false) return false;
  return true;
}

/**
 * Regra financeira. Mesmo raciocínio: o ICMS complementar é valor FISCAL, não
 * valor comercial — virar recebível faria o faturamento contar duas vezes a
 * mesma venda.
 */
function deveGerarFinanceiro({ tipoOperacao, produto } = {}) {
  const op = operacao(tipoOperacao);
  if (op && op.geraFinanceiro === false) return false;
  if (produto && produto.geraFinanceiro === false) return false;
  return true;
}

function finalidadeDaOperacao(tipoOperacao, informada) {
  const op = operacao(tipoOperacao);
  if (op) return op.finalidade;
  return informada !== undefined && informada !== null ? Number(informada) : 1;
}

/**
 * Validação da operação, ANTES de montar o payload e de gravar rascunho.
 *
 * Devolve a lista de problemas em vez de lançar no primeiro: quem preenche uma
 * nota quer ver tudo o que falta de uma vez, não descobrir um erro por
 * tentativa.
 */
function validarOperacao({ tipoOperacao, finalidade, referencias = [], itens = [], valorIcmsComplementar } = {}) {
  const op = operacao(tipoOperacao);
  const erros = [];
  if (!op) {
    erros.push(`Tipo de operação desconhecido: ${tipoOperacao}.`);
    return erros;
  }

  if (Number(finalidade) !== op.finalidade) {
    erros.push(`${op.rotulo} exige finalidade de emissão ${op.finalidade}; veio ${finalidade}.`);
  }

  if (op.exigeReferencia) {
    const chaves = referencias.map((r) => String(r?.chaveAcesso || r?.chave || '').replace(/\D/g, ''));
    if (!chaves.some((c) => c.length === 44)) {
      erros.push('Informe a chave de acesso da NF-e original (44 dígitos).');
    }
  }

  if (op.exigeIcms && !(Number(valorIcmsComplementar) > 0)) {
    erros.push('Informe o valor do ICMS a complementar — ele é o motivo da nota.');
  }

  itens.forEach((item, i) => {
    const posicao = `Item ${i + 1}`;
    const quantidade = Number(item.quantidade || 0);
    const valor = Number(item.valorUnitario || 0);

    if (op.exigeProdutoEscritural && !item.escritural) {
      erros.push(`${posicao}: ${op.rotulo} exige produto escritural — não use mercadoria física.`);
    }
    // Negativo é sempre erro; zero depende da operação. É esta distinção que
    // permite manter a exigência de quantidade > 0 na venda comum.
    if (quantidade < 0) erros.push(`${posicao}: quantidade não pode ser negativa.`);
    if (valor < 0) erros.push(`${posicao}: valor unitário não pode ser negativo.`);
    if (!op.permiteQuantidadeZero && quantidade === 0) {
      erros.push(`${posicao}: quantidade deve ser maior que zero nesta operação.`);
    }
    if (!op.permiteValorZero && valor === 0) {
      erros.push(`${posicao}: valor unitário deve ser maior que zero nesta operação.`);
    }
  });

  if (!itens.length) erros.push('Adicione ao menos um item.');

  return erros;
}

// ICMS a partir de base e alíquota, com o arredondamento de 2 casas do
// documento fiscal. Number.EPSILON evita que 1000 * 17 / 100 caia em
// 169.99999999999997 e a nota saia com um centavo a menos.
function calcularIcms(base, aliquota) {
  const valor = (Number(base || 0) * Number(aliquota || 0)) / 100;
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

// CFOP 5.949 dentro do estado, 6.949 para fora — mas só como SUGESTÃO da tela.
// Quem decide de verdade é a regra fiscal cadastrada; fixar aqui ignoraria a
// parametrização e quebraria na primeira empresa com CFOP diferente.
function cfopSugeridoComplemento(dentroDoEstado) {
  return dentroDoEstado ? '5949' : '6949';
}

/**
 * Texto padrão das informações complementares da nota de complemento.
 *
 * Sem ele, a nota chega ao destinatário e ao fisco dizendo apenas "outra
 * saída de mercadoria" com R$ 0,00 de produto — ninguém consegue ligar ao
 * documento que ela complementa. É sugestão: o usuário edita.
 */
function textoComplementoIcms({ numero, serie, chave } = {}) {
  const partes = [];
  if (numero) partes.push(`Nº ${numero}`);
  if (serie) partes.push(`SÉRIE ${serie}`);
  if (chave) partes.push(`CHAVE DE ACESSO ${String(chave).replace(/\D/g, '')}`);
  const referencia = partes.length ? ` ${partes.join(', ')}` : '';
  return `NF-E COMPLEMENTAR DE ICMS REFERENTE À NF-E${referencia}. `
    + 'COMPLEMENTO DO VALOR DO ICMS NÃO DESTACADO NA NF-E ORIGINAL.';
}

module.exports = {
  OPERACOES,
  operacao,
  deveMovimentarEstoque,
  deveGerarFinanceiro,
  finalidadeDaOperacao,
  validarOperacao,
  calcularIcms,
  cfopSugeridoComplemento,
  textoComplementoIcms
};
