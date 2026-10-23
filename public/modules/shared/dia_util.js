// DIA ÚTIL E O VENCIMENTO DA CONTA A PAGAR (23/10/2026).
//
// Pedido do usuário: "tudo que for colocado no sistema com vencimento para
// sábado, domingo e/ou feriados nacionais brasileiros seja jogado para o
// próximo dia útil" — e, logo depois: "essa regra se trata apenas de contas a
// pagar com intuito de parcelamento ou a prazo; tudo que for à vista não entra".
//
// QUAL CONTA A PAGAR É "A PRAZO": a despesa que vence DEPOIS da data do
// lançamento. A que vence no próprio dia (ou antes) é à vista e fica como está.
// Conta a receber (receita) e transferência não entram.
//
// OS FERIADOS são os nacionais do calendário bancário (FEBRABAN), porque é o
// banco que paga a conta: os fixos da lei (1/1, 21/4, 1/5, 7/9, 12/10, 2/11,
// 15/11, 20/11 desde 2024 e 25/12), a Sexta-feira Santa, e Carnaval (segunda e
// terça) e Corpus Christi — que não são feriado na lei, mas são dia sem
// expediente bancário no país inteiro. Feriados estaduais e municipais não.
//
// FONTE ÚNICA: as telas (parcelas da entrada de NF-e, do Novo Lançamento, do
// Parcelar) e o servidor (lib/db/financeiro.js, ao gravar o título) usam este
// arquivo. As datas são texto 'AAAA-MM-DD', contadas em UTC: fuso nenhum muda o
// dia.
(function (raiz) {
  const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
  const paraData = (iso) => {
    const m = ISO.exec(String(iso || '').slice(0, 10));
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  };
  const paraIso = (d) => d.toISOString().slice(0, 10);
  const somarDias = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));

  // Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano).
  function pascoa(ano) {
    const a = ano % 19;
    const b = Math.floor(ano / 100);
    const c = ano % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31);
    const dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(ano, mes - 1, dia));
  }

  const guardados = new Map();
  /** Map 'AAAA-MM-DD' -> nome, dos feriados nacionais (calendário bancário) do ano. */
  function feriadosNacionais(ano) {
    if (guardados.has(ano)) return guardados.get(ano);
    const lista = new Map();
    const fixo = (mes, dia, nome) => lista.set(`${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`, nome);
    fixo(1, 1, 'Confraternização Universal');
    fixo(4, 21, 'Tiradentes');
    fixo(5, 1, 'Dia do Trabalho');
    fixo(9, 7, 'Independência do Brasil');
    fixo(10, 12, 'Nossa Senhora Aparecida');
    fixo(11, 2, 'Finados');
    fixo(11, 15, 'Proclamação da República');
    // Lei 14.759/2023: feriado nacional desde 2024.
    if (ano >= 2024) fixo(11, 20, 'Dia Nacional de Zumbi e da Consciência Negra');
    fixo(12, 25, 'Natal');
    const p = pascoa(ano);
    lista.set(paraIso(somarDias(p, -48)), 'Carnaval');
    lista.set(paraIso(somarDias(p, -47)), 'Carnaval');
    lista.set(paraIso(somarDias(p, -2)), 'Sexta-feira Santa');
    lista.set(paraIso(somarDias(p, 60)), 'Corpus Christi');
    guardados.set(ano, lista);
    return lista;
  }

  /** Por que o dia não é útil: 'sábado', 'domingo', o nome do feriado, ou '' (é útil). */
  function motivo(iso) {
    const d = paraData(iso);
    if (!d) return '';
    const semana = d.getUTCDay();
    if (semana === 6) return 'sábado';
    if (semana === 0) return 'domingo';
    return feriadosNacionais(d.getUTCFullYear()).get(paraIso(d)) || '';
  }

  function ehDiaUtil(iso) {
    return Boolean(paraData(iso)) && !motivo(iso);
  }

  /** O próprio dia, se útil; senão o próximo dia útil. Data inválida volta como veio. */
  function proximoDiaUtil(iso) {
    let d = paraData(iso);
    if (!d) return iso;
    for (let i = 0; i < 15 && motivo(paraIso(d)); i += 1) d = somarDias(d, 1);
    return paraIso(d);
  }

  /** Conta a pagar a prazo: despesa que vence depois da data do lançamento. */
  function ehContaAPagarAPrazo({ type, date, dueDate } = {}) {
    const tipo = String(type || '').toUpperCase();
    const despesa = tipo === 'DESPESA' || tipo === 'PURCHASE';
    const lancamento = String(date || '').slice(0, 10);
    const vencimento = String(dueDate || '').slice(0, 10);
    return despesa && ISO.test(lancamento) && ISO.test(vencimento) && vencimento > lancamento;
  }

  /**
   * O VENCIMENTO QUE O TÍTULO GRAVA: o da conta a pagar a prazo vai para o
   * próximo dia útil; qualquer outro fica como veio.
   */
  function vencimentoDoTitulo(titulo = {}) {
    if (!ehContaAPagarAPrazo(titulo)) return titulo.dueDate;
    return proximoDiaUtil(String(titulo.dueDate).slice(0, 10));
  }

  const api = { pascoa, feriadosNacionais, motivo, ehDiaUtil, proximoDiaUtil, ehContaAPagarAPrazo, vencimentoDoTitulo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisDiaUtil = api;
})(typeof window !== 'undefined' ? window : globalThis);
