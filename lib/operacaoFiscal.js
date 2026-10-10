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
    // A natureza (natOp) que a nota leva quando ninguém informa outra. Veio das
    // regras do sistema anterior (ERP VIP, 01/10/2026), que é o texto que a
    // SEFAZ já recebia desta empresa.
    natureza: 'VENDA DE MERCADORIA ADQUIRIDA OU RECEBIDA DE TERCEIROS',
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
    natureza: 'TRANSFERENCIA DE MERCADORIA',
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

// ---------------------------------------------------------------------------
// OPERAÇÕES EDITÁVEIS PELA TELA (10/10/2026, pedido do usuário)
//
// O que está escrito acima é o PADRÃO. Fiscal › Operações Fiscais grava
// alterações na tabela `operacao_fiscal_ajuste` (fase DW), e
// lib/db/operacoes-fiscais.js as aplica POR CIMA deste objeto com
// aplicarAjustes(). O OPERACOES continua sendo o único lugar que a emissão lê,
// e continua síncrono: quem pergunta deveMovimentarEstoque() não precisa ir ao
// banco a cada item.
//
// Só se edita o que já existe (a chave é contrato: `tipoOperacao` no pedido,
// na regra fiscal e na nota). Operação nova continua entrando por código.
//
// "Restaurar padrão" apaga a linha do ajuste e volta ao que está aqui.
// ---------------------------------------------------------------------------
const CAMPOS_BOOLEANOS = [
  'movimentaEstoque', 'geraFinanceiro', 'exigeReferencia', 'permiteQuantidadeZero',
  'permiteValorZero', 'exigeIcms', 'exigeProdutoEscritural'
];
const CAMPOS_EDITAVEIS = ['rotulo', 'natureza', 'finalidade', ...CAMPOS_BOOLEANOS];

// Cópia congelada do padrão, tirada ANTES de qualquer ajuste: é a ela que
// "restaurar" volta, e é contra ela que a tela mostra "alterada".
const PADRAO = Object.freeze(Object.fromEntries(
  Object.entries(OPERACOES).map(([chave, op]) => [chave, Object.freeze({ ...op })])
));

// natOp tem de 1 a 60 caracteres no leiaute da NF-e: texto maior a SEFAZ recusa.
const NATUREZA_MAX = 60;

/**
 * Confere um ajuste ANTES de gravar. Devolve a lista de problemas (vazia = ok).
 *
 * As travas são as combinações que a SEFAZ recusa ou que o sistema não
 * consegue cumprir — não são opinião sobre tributação, que é do contador:
 *   - finalidade 2 (complementar) e 4 (devolução) referenciam a nota original;
 *     sem a referência a SEFAZ recusa;
 *   - produto escritural não tem saldo físico: a operação que o exige não pode
 *     movimentar estoque.
 */
function validarAjuste(chave, campos = {}) {
  const erros = [];
  if (!PADRAO[chave]) return [`Operação desconhecida: ${chave}.`];
  const op = { ...PADRAO[chave], ...campos };
  const rotulo = String(op.rotulo || '').trim();
  if (!rotulo) erros.push('Informe o nome da operação.');
  if (rotulo.length > 60) erros.push('O nome da operação passa de 60 caracteres.');
  const natureza = String(op.natureza || '').trim();
  if (natureza.length > NATUREZA_MAX) erros.push(`A natureza da operação passa de ${NATUREZA_MAX} caracteres (limite da NF-e).`);
  if (![1, 2, 3, 4].includes(Number(op.finalidade))) erros.push('Finalidade inválida: use 1, 2, 3 ou 4.');
  if ([2, 4].includes(Number(op.finalidade)) && op.exigeReferencia !== true) {
    erros.push('Nota complementar ou de devolução precisa exigir a nota referenciada: sem ela a SEFAZ recusa.');
  }
  if (op.exigeProdutoEscritural === true && op.movimentaEstoque === true) {
    erros.push('Operação que exige produto escritural não pode movimentar estoque: produto escritural não tem saldo físico.');
  }
  return erros;
}

/** Normaliza o que veio da tela para os tipos que o catálogo usa. */
function normalizarAjuste(campos = {}) {
  const saida = {};
  if (campos.rotulo !== undefined) saida.rotulo = String(campos.rotulo || '').trim();
  if (campos.natureza !== undefined) saida.natureza = String(campos.natureza || '').trim().toUpperCase() || null;
  if (campos.finalidade !== undefined) saida.finalidade = Number(campos.finalidade);
  for (const c of CAMPOS_BOOLEANOS) if (campos[c] !== undefined) saida[c] = campos[c] === true || campos[c] === 'true';
  return saida;
}

/**
 * Põe o catálogo no padrão e aplica os ajustes por cima. Muda o OPERACOES no
 * lugar (não troca a referência), porque o resto do código o importou.
 * Ajuste de chave que não existe mais no código é ignorado.
 */
function aplicarAjustes(ajustes = []) {
  for (const [chave, op] of Object.entries(PADRAO)) OPERACOES[chave] = { ...op };
  for (const ajuste of ajustes) {
    if (!ajuste || !PADRAO[ajuste.chave]) continue;
    const campos = {};
    for (const c of CAMPOS_EDITAVEIS) {
      if (ajuste[c] !== undefined && ajuste[c] !== null) campos[c] = ajuste[c];
    }
    OPERACOES[ajuste.chave] = { ...PADRAO[ajuste.chave], ...campos };
  }
}

/** A operação difere do padrão do código? É o selo "alterada" da tela. */
function foiAlterada(chave) {
  const atual = OPERACOES[chave];
  const padrao = PADRAO[chave];
  if (!atual || !padrao) return false;
  return CAMPOS_EDITAVEIS.some((c) => (atual[c] ?? null) !== (padrao[c] ?? null));
}

function operacao(tipo) {
  return OPERACOES[String(tipo || '').toUpperCase()] || null;
}

/** A natureza da operação padrão da nota: a da operação, ou o rótulo dela. */
function naturezaDaOperacao(tipo) {
  const op = operacao(tipo);
  return op ? (op.natureza || op.rotulo) : 'Venda de mercadoria';
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
// NT 2026.002: a partir desta data, NF-e de saída não referencia estes modelos
// (65 NFC-e, 59 CF-e SAT), salvo finalidade complementar ou devolução.
const NT_2026_002_VIGENCIA = '2026-10-05';
const MODELOS_SEM_REFERENCIA = ['65', '59'];

function validarOperacao({ tipoOperacao, finalidade, referencias = [], itens = [], valorIcmsComplementar, tipoDocumento = 1, dataEmissao } = {}) {
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

  // NT 2026.002 v1.10, em produção desde 05/10/2026: NF-e de SAÍDA não pode
  // referenciar NFC-e (modelo 65) nem CF-e SAT (59), salvo complementar (2) ou
  // devolução (4). Era o "cliente pediu NF-e depois da NFC-e" — agora a SEFAZ
  // recusa, e o caminho é cancelar a NFC-e no prazo e emitir a NF-e. O modelo
  // está nas posições 21-22 da chave de acesso.
  const emissao = String(dataEmissao || new Date().toISOString()).slice(0, 10);
  if (emissao >= NT_2026_002_VIGENCIA && Number(tipoDocumento) === 1 && ![2, 4].includes(Number(finalidade))) {
    const proibidas = referencias
      .map((r) => String(r?.chaveAcesso || r?.chave || r || '').replace(/\D/g, ''))
      .filter((c) => c.length === 44 && MODELOS_SEM_REFERENCIA.includes(c.slice(20, 22)));
    if (proibidas.length) {
      erros.push('NF-e de saída não pode referenciar NFC-e ou CF-e (NT 2026.002, desde 05/10/2026). '
        + 'Cancele a NFC-e dentro do prazo e emita a NF-e sem referência.');
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
  PADRAO,
  CAMPOS_BOOLEANOS,
  CAMPOS_EDITAVEIS,
  NATUREZA_MAX,
  validarAjuste,
  normalizarAjuste,
  aplicarAjustes,
  foiAlterada,
  operacao,
  naturezaDaOperacao,
  deveMovimentarEstoque,
  deveGerarFinanceiro,
  finalidadeDaOperacao,
  validarOperacao,
  calcularIcms,
  cfopSugeridoComplemento,
  textoComplementoIcms
};
