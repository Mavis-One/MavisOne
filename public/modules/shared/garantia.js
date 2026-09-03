// A GARANTIA DO EQUIPAMENTO — FONTE ÚNICA.
//
// Mora em public/ porque o navegador carrega por <script> e o servidor faz
// require(). Mesma razão do forma_pagamento.js: se a tela calculasse o
// vencimento da garantia de um jeito e o servidor de outro, a máquina estaria
// na garantia numa tela e fora dela na outra.
//
// O QUE ELA RESOLVE
// -----------------
// O cadastro de equipamento tinha um campo "Garantia até": uma data que alguém
// digita. Ninguém digita — e quando digita, digita errado. Meses depois, a
// pergunta que decide se um conserto é cobrado ou não ("esta máquina está na
// garantia?") não tem resposta no sistema, e vira a memória de quem vendeu.
//
// A data existe num documento: a NF-e que vendeu a máquina. A garantia é um
// PRAZO contado a partir dela, e prazo o vendedor sabe de cor ("12 meses").
//
// OS DOIS MODOS, E POR QUE SÃO DOIS
// ----------------------------------
//   'prazo' — N meses a partir da nota (ou da data de aquisição, quando não há
//             nota). É o caso normal, e é o que tira a data das mãos de quem
//             cadastra.
//
//   'data'  — uma data escrita à mão. Existe porque garantia negociada existe
//             ("estendida até 31/12/2027"), e sem esta saída alguém inventaria
//             um número de meses que não bate com o combinado.
//
// SÃO MODOS, E NÃO DOIS CAMPOS QUE CONVIVEM. Com os dois valendo ao mesmo
// tempo, um dia eles discordam e ninguém sabe qual vale — que é exatamente o
// erro que este arquivo existe para não repetir.
(function (raiz) {
  const MODOS = ['prazo', 'data'];

  function ehData(texto) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(texto || '').slice(0, 10));
  }

  /**
   * Soma meses a uma data, em UTC.
   *
   * O ÚLTIMO DIA DO MÊS É PRESO NO ÚLTIMO DIA DO MÊS DE DESTINO. Somar 1 mês a
   * 31/01 daria 03/03 na conta ingênua do JavaScript (31 de fevereiro
   * "transborda"), e uma garantia que vence dois dias depois do previsto é a
   * diferença entre cobrar e não cobrar um conserto. Aqui dá 28/02.
   */
  function somarMeses(dataBase, meses) {
    const texto = String(dataBase || '').slice(0, 10);
    const n = Number(meses);
    if (!ehData(texto) || !Number.isFinite(n)) return '';
    const [ano, mes, dia] = texto.split('-').map(Number);
    const alvo = new Date(Date.UTC(ano, mes - 1 + Math.trunc(n), 1));
    // Dia 0 do mês seguinte = último dia do mês alvo.
    const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
    alvo.setUTCDate(Math.min(dia, ultimoDia));
    return alvo.toISOString().slice(0, 10);
  }

  /**
   * Quando a garantia termina, e POR QUÊ.
   *
   * O `porque` não é enfeite: é o que a tela mostra ao lado da data. Sem ele o
   * usuário vê "vence em 03/09/2027" e não tem como conferir se está certo —
   * e uma data que ninguém consegue conferir volta a ser uma data em que
   * ninguém confia.
   *
   * `inicio` é a data da NOTA quando existe, e a de aquisição quando não. Quem
   * escolhe é o chamador, porque é ele que tem a nota em mãos; aqui só se conta.
   */
  function calcular({ modo, meses, inicio, inicioRotulo, dataFixa } = {}) {
    const qual = MODOS.includes(modo) ? modo : 'prazo';

    if (qual === 'data') {
      const ate = String(dataFixa || '').slice(0, 10);
      if (!ehData(ate)) return { ate: '', porque: 'Garantia por data, mas a data não foi informada.' };
      return { ate, porque: 'Data informada manualmente.' };
    }

    const n = Number(meses);
    if (!Number.isFinite(n) || n <= 0) {
      return { ate: '', porque: 'Sem prazo de garantia informado.' };
    }
    const base = String(inicio || '').slice(0, 10);
    if (!ehData(base)) {
      return {
        ate: '',
        porque: `${n} ${n === 1 ? 'mês' : 'meses'} de garantia, mas falta a data de início `
          + '(a NF-e que vendeu, ou a data de aquisição).'
      };
    }
    const ate = somarMeses(base, n);
    const de = inicioRotulo || 'data de aquisição';
    return { ate, porque: `${n} ${n === 1 ? 'mês' : 'meses'} a partir de ${de} (${formatarBR(base)}).` };
  }

  function formatarBR(iso) {
    const t = String(iso || '').slice(0, 10);
    if (!ehData(t)) return t;
    const [a, m, d] = t.split('-');
    return `${d}/${m}/${a}`;
  }

  /**
   * 'sem-garantia' | 'vigente' | 'vencida'.
   *
   * SEM GARANTIA NÃO É VENCIDA. A máquina que nunca teve garantia e a que teve
   * e acabou pedem conversas diferentes com o cliente, e pintar as duas de
   * vermelho apaga a diferença.
   */
  function situacao(ate, hoje) {
    const fim = String(ate || '').slice(0, 10);
    if (!ehData(fim)) return 'sem-garantia';
    const dia = ehData(hoje) ? String(hoje).slice(0, 10) : new Date().toISOString().slice(0, 10);
    // O DIA DO VENCIMENTO AINDA ESTÁ NA GARANTIA. "Garantia de 12 meses" que
    // acaba na véspera do aniversário da compra é um dia a menos do que foi
    // vendido, e é o dia em que a máquina quebra.
    return fim >= dia ? 'vigente' : 'vencida';
  }

  /** Quantos dias faltam. Negativo quando já venceu; null sem garantia. */
  function diasRestantes(ate, hoje) {
    const fim = String(ate || '').slice(0, 10);
    if (!ehData(fim)) return null;
    const dia = ehData(hoje) ? String(hoje).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const ms = new Date(`${fim}T00:00:00Z`) - new Date(`${dia}T00:00:00Z`);
    return Math.round(ms / 86400000);
  }

  const api = { MODOS, somarMeses, calcular, situacao, diasRestantes, formatarBR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisGarantia = api;
})(typeof window !== 'undefined' ? window : globalThis);
