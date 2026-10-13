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

  // --- O RESUMO PARA A LISTA (fase EI) -------------------------------------
  //
  // A coluna Descrição da lista de lançamentos estourava a tabela: 26.950 dos
  // 27.362 lançamentos (98%) passam de 60 caracteres, média de 110. Cortar só
  // no tamanho não resolvia — quase todos vieram do Viper com a mesma frase na
  // frente, e a lista cortada ficaria com todas as linhas iguais:
  //
  //   12.630  "Valor de R$ 2.826,60 (Parcela 1 de 2). Referente ao PEDIDO DE VE…"
  //    6.512  "Despesa referente ao plano de conta 20.05.01 - ICMS A RECOLHER - …"
  //    3.811  "Referente a NF DE ENTRADA de codigo 1472 - Nº 35318, emitida em 3…"
  //    3.213  "Referente ao PEDIDO DE VENDA de codigo 13705 efetuado em 13/07/20…"
  //
  // (contagem do banco em 13/10/2026). O resumo tira o que a linha já diz em
  // outra coluna — o valor, o "referente ao plano de conta" e o código interno
  // da nota no Viper — e deixa o que só a descrição diz:
  //
  //   "Pedido 14508 de 12/08/2026 · Parcela 1/2"
  //   "ICMS A RECOLHER - REFTE FATURAMENTO JULHO 2026 · Recorrência 3/20"
  //   "NF de entrada 35318 de 30/01/2026 · Parcela 8/12"
  //
  // SÓ PARA MOSTRAR. O texto gravado não muda, a busca procura no texto
  // inteiro, e a lista põe a descrição inteira no `title` da célula. Descrição
  // que não casa com nenhum dos modelos sai como está — inclusive as que o
  // próprio sistema escreve com `montar`, que já são curtas.
  const VALOR = 'R\\$ ?[\\d.,]*\\d';
  const DATA = '(\\d{2}\\/\\d{2}\\/\\d{4})';
  const NO_COMECO_VALOR_E_PARCELA = new RegExp(`^Valor de ${VALOR} \\(Parcela (\\d+) de (\\d+)\\)\\.? ?`, 'i');
  const PEDIDO_DO_VIPER = new RegExp(`^Referente ao PEDIDO DE VENDA de codigo (\\d+) efetuado em ${DATA} no valor de ${VALOR}`, 'i');
  const NOTA_DE_ENTRADA_DO_VIPER = new RegExp(`^Referente a NF DE ENTRADA de codigo \\d+ - N[ºo°]? ?(\\d+), emitida em ${DATA} no valor de ${VALOR}`, 'i');
  const PLANO_DE_CONTA_DO_VIPER = /^(?:Despesa|Receita) referente ao plano de conta (?:[\d.]+ ?- ?)?/i;
  const NO_FIM_PARCELA = /\s*\((Parcela|Recorr[êe]ncia) (\d+) de (\d+)\)\.?$/i;

  // "Parcela 1/1" é ruído, pela mesma regra de `montar`.
  function fracao(rotulo, indice, total) {
    return Number(total) > 1 ? `${rotulo} ${Number(indice)}/${Number(total)}` : '';
  }

  // A pontuação que gruda a frase do Viper ao texto livre. Tirada das pontas
  // por laço, e não por `/[...]+$/`: essa regex volta atrás a cada posição, e
  // numa descrição de 300 mil hífens seguidos de uma letra levava minutos —
  // com a tela de Lançamentos de todo mundo travada nela.
  const COLA = new Set([' ', '-', '–', '—', '.', ',', ';', ':', '·']);
  function aparar(texto, tirarPontoDoFim) {
    let ini = 0;
    let fim = texto.length;
    while (ini < fim && COLA.has(texto[ini])) ini += 1;
    while (fim > ini && COLA.has(texto[fim - 1]) && (tirarPontoDoFim || texto[fim - 1] !== '.')) fim -= 1;
    return texto.slice(ini, fim);
  }

  function resumir(descricao) {
    // Só os primeiros mil caracteres: a célula mostra 60, o resto vai inteiro
    // no title. O servidor já recusa descrição maior (validarLancamentoFinanceiro),
    // mas a gravada antes do teto ainda passa por aqui.
    const original = String(descricao || '').slice(0, 1000).replace(/\s+/g, ' ').trim();
    let resto = original;
    const partes = [];
    let parcela = '';

    let m = NO_COMECO_VALOR_E_PARCELA.exec(resto);
    if (m) { parcela = fracao('Parcela', m[1], m[2]); resto = resto.slice(m[0].length); }

    if ((m = PEDIDO_DO_VIPER.exec(resto))) {
      partes.push(`Pedido ${m[1]} de ${m[2]}`);
      resto = resto.slice(m[0].length);
    } else if ((m = NOTA_DE_ENTRADA_DO_VIPER.exec(resto))) {
      partes.push(`NF de entrada ${m[1]} de ${m[2]}`);
      resto = resto.slice(m[0].length);
    } else if ((m = PLANO_DE_CONTA_DO_VIPER.exec(resto))) {
      resto = resto.slice(m[0].length);
    }

    m = NO_FIM_PARCELA.exec(resto);
    if (m) {
      const rotulo = /^parcela$/i.test(m[1]) ? 'Parcela' : 'Recorrência';
      parcela = parcela || fracao(rotulo, m[2], m[3]);
      resto = resto.slice(0, m.index);
    }

    // O que sobrou é texto livre de quem lançou ("- RECEBIDO 99,01 06/06
    // QUEROPAY"): sai sem o traço e a pontuação que o colavam à frase do Viper.
    // O ponto final fica (pode ser de abreviação: "LTDA."), o resto da cola sai.
    resto = aparar(resto, false);
    if (resto) partes.push(resto);
    if (parcela) partes.push(parcela);
    return partes.length ? partes.join(SEPARADOR) : original;
  }

  /**
   * Corta em `limite` caracteres, no fim de uma palavra quando dá, com
   * reticências. Sem limite, ou texto que cabe, volta inteiro.
   */
  function cortar(texto, limite) {
    const s = String(texto || '');
    const n = Number(limite);
    if (!n || s.length <= n) return s;
    const pedaco = s.slice(0, n - 1);
    const espaco = pedaco.lastIndexOf(' ');
    // Só volta até o espaço se ele não comer mais de um terço do limite: um
    // nome comprido sem espaço viraria "…" quase sozinho.
    const ate = espaco > n * 0.66 ? espaco : pedaco.length;
    return `${aparar(pedaco.slice(0, ate), true)}…`;
  }

  const api = { SEPARADOR, NATUREZA, natureza, montar, resumir, cortar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisDescricaoLancamento = api;
})(typeof window !== 'undefined' ? window : globalThis);
