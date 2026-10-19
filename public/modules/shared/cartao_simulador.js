// O SIMULADOR DE VENDA NO CARTÃO (fase ET, 19/10/2026) — FONTE ÚNICA.
//
// Pedido do usuário: o script "006_cartao_simulador.sql" (taxas Rede, fatores
// do simulador da loja, "Quem paga a taxa"), adaptado. Mora em public/ porque
// a tela de venda carrega por <script> e o servidor faz require(): o número
// que o vendedor vê é o que o servidor grava — ele recalcula com esta mesma
// conta e não confia no que veio da tela.
//
// AS REGRAS (as do script):
//   CLIENTE PAGA (padrão): cobrado = valor dos produtos × fator do simulador
//     (por canal e parcelas; igual para todas as bandeiras);
//     acréscimo = cobrado − valor dos produtos (vai como outras despesas na NF-e).
//   LOJA ASSUME (promoção): cobrado = valor dos produtos; acréscimo 0.
//   Taxa da credenciadora = cobrado × taxa (fica no título, como já era).
//   Retorno (só informativo) = cobrado − valor dos produtos ÷ (1 − taxa).
//
// A CONTA É EM CENTAVOS INTEIROS, com arredondamento meio-para-cima, igual ao
// `round(numeric, 2)` do Postgres que o script usava. Em ponto flutuante,
// 6.990,00 × 1,1545 dá 8.069,9549999… e sairia 8.069,95 em vez de 8.069,96.
(function (raiz) {
  const CANAIS = [
    { id: 'maquininha', nome: 'Maquininha' },
    { id: 'link', nome: 'Link de pagamento' }
  ];
  const MODALIDADES = {
    debito: 'Débito',
    credito: 'Crédito',
    pre_pago: 'Pré-pago',
    parcelado_emissor: 'Parcelado emissor',
    crediario: 'Crediário'
  };
  const QUEM_PAGA = [
    { id: 'cliente', nome: 'Cliente paga' },
    { id: 'loja', nome: 'Loja assume' }
  ];

  // a ÷ b em inteiros, meio-para-cima (a, b > 0).
  function dividirArredondando(a, b) {
    const q = Math.floor(a / b);
    const r = a - q * b;
    return r * 2 >= b ? q + 1 : q;
  }
  const centavos = (v) => Math.round(Number(v || 0) * 100);
  const reais = (c) => c / 100;
  const dataIso = (v) => String(v || '').slice(0, 10);

  /** A linha vigente: a de vigência mais recente que não passa da data. */
  function vigente(linhas, data) {
    const dia = dataIso(data) || new Date().toISOString().slice(0, 10);
    return linhas
      .filter((l) => dataIso(l.vigencia) <= dia)
      .sort((a, b) => dataIso(b.vigencia).localeCompare(dataIso(a.vigencia)))[0] || null;
  }

  function taxaDaOpcao(taxas, { canal, bandeira, modalidade, parcelas, data }) {
    return vigente((taxas || []).filter((t) => t.canal === canal && t.bandeira === bandeira
      && t.modalidade === modalidade && Number(t.parcelas) === Number(parcelas)), data);
  }

  // Pré-pago usa o fator do crédito à vista; o da empresa vence o geral.
  function fatorDaOpcao(fatores, { empresaId, canal, modalidade, parcelas, data }) {
    const md = modalidade === 'pre_pago' ? 'credito' : modalidade;
    const daOpcao = (fatores || []).filter((f) => f.canal === canal && f.modalidade === md && Number(f.parcelas) === Number(parcelas));
    const daEmpresa = empresaId ? vigente(daOpcao.filter((f) => f.empresaId === empresaId), data) : null;
    return daEmpresa || vigente(daOpcao.filter((f) => !f.empresaId), data);
  }

  /** Dias úteis (segunda a sexta; feriado não conta, como no script). */
  function somarDiasUteis(dia, n) {
    const d = new Date(`${dataIso(dia)}T12:00:00Z`);
    let k = 0;
    while (k < n) {
      d.setUTCDate(d.getUTCDate() + 1);
      const semana = d.getUTCDay();
      if (semana !== 0 && semana !== 6) k += 1;
    }
    return d.toISOString().slice(0, 10);
  }

  /** Quando a credenciadora paga (na taxa por parcela, a 1ª parcela). '' sem prazo. */
  function vencimentoDoRepasse(dia, taxa) {
    if (!taxa || taxa.prazoDias === null || taxa.prazoDias === undefined || taxa.prazoDias === '') return '';
    const n = Number(taxa.prazoDias);
    if (taxa.prazoDiasUteis !== false) return somarDiasUteis(dia, n);
    const d = new Date(`${dataIso(dia)}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /**
   * UMA opção. `tabelas`: { taxas, fatores }. Devolve os números ou { erro }.
   */
  function calcular({ base, canal, bandeira, modalidade, parcelas, quemPaga, empresaId, data, tabelas }) {
    const baseC = centavos(base);
    const n = Math.max(1, Number(parcelas) || 1);
    if (!(baseC > 0)) return { erro: 'Informe o valor dos produtos neste cartão.' };
    if (!bandeira) return { erro: 'Escolha a bandeira.' };
    const loja = quemPaga === 'loja';
    if (loja && modalidade === 'parcelado_emissor') return { erro: 'Parcelado emissor já tem os juros do banco: use "Cliente paga".' };
    const t = taxaDaOpcao((tabelas || {}).taxas, { canal, bandeira, modalidade, parcelas: n, data });
    if (!t) return { erro: `Sem taxa cadastrada para ${MODALIDADES[modalidade] || modalidade} ${n}x nesta bandeira.` };
    let fatorMicro = 1000000;
    if (!loja && ['debito', 'credito', 'pre_pago'].includes(modalidade)) {
      const f = fatorDaOpcao((tabelas || {}).fatores, { empresaId, canal, modalidade, parcelas: n, data });
      if (!f) return { erro: `Fator do simulador não cadastrado: ${MODALIDADES[modalidade]} ${n}x.` };
      fatorMicro = Math.round(Number(f.fator) * 1000000);
    }
    const taxaBp = Math.round(Number(t.taxa) * 10000);
    const cobradoC = dividirArredondando(baseC * fatorMicro, 1000000);
    const taxaC = dividirArredondando(cobradoC * taxaBp, 10000);
    const cheioC = taxaBp >= 10000 ? cobradoC : dividirArredondando(baseC * 10000, 10000 - taxaBp);
    return {
      canal, bandeira, modalidade, parcelas: n, quemPaga: loja ? 'loja' : 'cliente',
      fator: fatorMicro / 1000000,
      base: reais(baseC),
      cobrado: reais(cobradoC),
      acrescimo: reais(cobradoC - baseC),
      parcela: reais(dividirArredondando(cobradoC, n)),
      taxa: taxaBp / 10000,
      valorTaxa: reais(taxaC),
      liquido: reais(cobradoC - taxaC),
      valorCheio: reais(cheioC),
      retorno: reais(cobradoC - cheioC),
      prazoDias: t.prazoDias === null || t.prazoDias === undefined ? null : Number(t.prazoDias),
      prazoDiasUteis: t.prazoDiasUteis !== false,
      taxaPorParcela: t.taxaPorParcela === true,
      repasse: vencimentoDoRepasse(data, t)
    };
  }

  /**
   * AS OPÇÕES DA TELA: débito (1x) e crédito 1x até a maior parcela que a
   * bandeira tem no canal. `modalidades` restringe (a forma "Cartão de Débito"
   * só mostra débito).
   */
  function opcoes({ base, canal, bandeira, quemPaga, empresaId, data, tabelas, modalidades = ['debito', 'credito'] }) {
    const taxas = ((tabelas || {}).taxas || []).filter((t) => t.canal === canal && t.bandeira === bandeira
      && modalidades.includes(t.modalidade) && dataIso(t.vigencia) <= (dataIso(data) || new Date().toISOString().slice(0, 10)));
    const chaves = [...new Set(taxas.map((t) => `${t.modalidade}|${Number(t.parcelas)}`))]
      .map((c) => ({ modalidade: c.split('|')[0], parcelas: Number(c.split('|')[1]) }))
      .sort((a, b) => (a.modalidade === 'credito') - (b.modalidade === 'credito') || a.parcelas - b.parcelas);
    return chaves.map((c) => ({ ...c, ...calcular({ base, canal, bandeira, quemPaga, empresaId, data, tabelas, ...c }) }));
  }

  const api = { CANAIS, MODALIDADES, QUEM_PAGA, calcular, opcoes, taxaDaOpcao, fatorDaOpcao, vencimentoDoRepasse, somarDiasUteis };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisCartaoSimulador = api;
})(typeof window !== 'undefined' ? window : globalThis);
