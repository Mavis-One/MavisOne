// A DESCRIÇÃO DO LANÇAMENTO FINANCEIRO — FONTE ÚNICA.
//
// Mora em public/ porque o navegador carrega por <script> e o servidor faz
// require(). Mesma razão do lancamento_codigo.js e do forma_pagamento.js.
//
// O QUE ELA RESOLVE
// -----------------
// Cada origem escrevia a sua própria frase, e as quatro discordavam:
//
//   pedido faturado   ->  "Pedido 1042 · Parcela 1/3 · Cartão"
//   ordem de compra   ->  "Ordem de Compra OC0007 - Fornecedor Alfa"
//   entrada de NF-e   ->  "NF-e 5599 — Fornecedor Alfa (1/2)"
//   NF-e avulsa       ->  "NF-e 123 · Parcela 1/2"
//
// Três separadores diferentes (·, -, —), duas grafias de parcela ("Parcela
// 1/3" e "(1/2)"), e nenhuma delas dizia o que a linha É. Quem abre o
// Financeiro e lê "Pedido 1042" não sabe se aquilo é dinheiro entrando ou
// saindo sem cruzar com outra coluna — e é a primeira pergunta que se faz
// diante de uma lista de lançamentos.
//
// A ORDEM DAS PARTES, E POR QUE ELA
// ----------------------------------
//   Receita de venda · Pedido 1042 · NF-e 000000123 · Parcela 1/3 · Boleto
//
// 1. NATUREZA E TIPO primeiro. É o que a coluna Descrição precisa dizer e as
//    outras colunas não dizem com a mesma clareza — e é o que sobra quando a
//    coluna corta o texto no meio.
// 2. OS DOCUMENTOS depois, do mais geral para o mais específico: o pedido
//    nasce antes da nota, e quem procura costuma ter o número do pedido em
//    mãos.
// 3. PARCELA E FORMA por último: só interessam depois de achada a linha.
//
// O SEPARADOR É " · " EM TODAS. Escolhido porque já era o do pedido (a origem
// mais frequente) e porque não aparece dentro de número de documento — vírgula
// e hífen aparecem, e viram ambiguidade na hora de ler.
//
// O QUE NÃO ENTRA AQUI
// --------------------
// O NOME DO CLIENTE/FORNECEDOR. A lista tem coluna própria para ele
// (`clienteFornecedor`), e repetir na descrição gasta o espaço que faz a
// coluna cortar justamente a parte que só existe aqui. As origens continuam
// gravando `clientSupplierName` — o nome não se perdeu, mudou de lugar.
(function (raiz) {
  const SEPARADOR = ' · ';

  const NATUREZA = {
    receita: 'Receita',
    despesa: 'Despesa',
    transferencia: 'Transferência'
  };

  /**
   * "Receita de venda", "Despesa de compra", "Transferência".
   *
   * TRANSFERÊNCIA NÃO GANHA COMPLEMENTO: "Transferência de transferência" é o
   * que sairia, porque dinheiro que sai de uma conta para outra não é receita
   * nem despesa de coisa nenhuma — ele não tem "tipo" no sentido das outras
   * duas.
   */
  function natureza(qual, tipo) {
    const base = NATUREZA[String(qual || '').toLowerCase()] || '';
    if (!base) return '';
    const complemento = String(tipo || '').trim();
    if (!complemento || base === NATUREZA.transferencia) return base;
    // minúscula porque vira meio de frase: "Receita de venda", não "Receita de
    // Venda" — e o tipo chega escrito de fontes diferentes ("Venda", "venda").
    return `${base} de ${complemento.charAt(0).toLowerCase()}${complemento.slice(1)}`;
  }

  /**
   * A frase inteira.
   *
   * Todo campo é opcional: o que não vier simplesmente não aparece, em vez de
   * virar "Pedido -" ou "NF-e undefined". Origem que só sabe o número da nota
   * chama com `nota` e pronto.
   */
  function montar({
    qual = '',
    tipo = '',
    pedido = '',
    ordem = '',
    nota = '',
    semNota = false,
    parcela = 0,
    parcelas = 0,
    forma = '',
    complemento = ''
  } = {}) {
    const partes = [];

    const cabeca = natureza(qual, tipo);
    if (cabeca) partes.push(cabeca);

    if (String(pedido || '').trim()) partes.push(`Pedido ${String(pedido).trim()}`);
    if (String(ordem || '').trim()) partes.push(`Ordem ${String(ordem).trim()}`);

    if (String(nota || '').trim()) {
      partes.push(`NF-e ${String(nota).trim()}`);
    } else if (semNota) {
      // A DISPENSA APARECE ONDE O DINHEIRO ESTÁ. A fase AV passou a exigir
      // documento fiscal para faturar e a registrar a dispensa com motivo no
      // pedido — mas quem concilia o recebimento abre o Financeiro, não o
      // pedido. Sem esta linha, a parcela sem nota é indistinguível da que
      // ainda não teve a nota resolvida.
      partes.push('Sem NF-e (dispensada)');
    }

    // "Parcela 1/1" é ruído: uma parcela só não é parcelamento.
    const total = Number(parcelas || 0);
    const indice = Number(parcela || 0);
    if (total > 1 && indice > 0) partes.push(`Parcela ${indice}/${total}`);

    if (String(forma || '').trim()) partes.push(String(forma).trim());
    if (String(complemento || '').trim()) partes.push(String(complemento).trim());

    return partes.join(SEPARADOR);
  }

  const api = { SEPARADOR, NATUREZA, natureza, montar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisDescricaoLancamento = api;
})(typeof window !== 'undefined' ? window : globalThis);
