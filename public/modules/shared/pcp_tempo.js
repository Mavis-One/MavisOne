// AS CONTAS DO TEMPO DE PRODUÇÃO (fase EB, 12/10/2026).
//
// Pedido do usuário: cada modelo tem o seu tempo de montagem (uns 40 minutos,
// outros 1h30), e o dia de produção tem uma jornada (8 horas, ajustável no
// dia) que é preenchida misturando modelos até fechar. Estas funções fazem a
// conta; a tela só desenha. Puras, para o teste rodar sem navegador.
(function (raiz) {
  const numero = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  /** 40 -> "40 min"; 90 -> "1h30"; 480 -> "8h"; 0 -> "0 min". */
  function formatarMinutos(minutos) {
    const total = Math.round(numero(minutos));
    const sinal = total < 0 ? '-' : '';
    const abs = Math.abs(total);
    if (abs < 60) return `${sinal}${abs} min`;
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `${sinal}${h}h${m ? String(m).padStart(2, '0') : ''}`;
  }

  /** Mapa produtoId -> minutos de UMA unidade. */
  function mapaDeTempos(tempos) {
    const mapa = new Map();
    for (const t of tempos || []) if (t && t.productId && numero(t.minutos) > 0) mapa.set(t.productId, numero(t.minutos));
    return mapa;
  }

  /** Minutos de uma quantidade de um produto; null quando o produto não tem tempo. */
  function minutosDe(productId, quantidade, mapa) {
    const unidade = mapa.get(productId);
    if (!unidade) return null;
    return unidade * numero(quantidade);
  }

  /**
   * A jornada do dia, em horas: o ajuste do dia quando existe; senão o padrão
   * do setor; senão 8 (a jornada comum, para quem ainda não definiu).
   */
  function jornadaDoDia({ ajuste, setor } = {}) {
    if (ajuste && ajuste.horas !== null && ajuste.horas !== undefined && ajuste.horas !== '') return numero(ajuste.horas);
    if (setor && setor.jornadaHoras !== null && setor.jornadaHoras !== undefined && setor.jornadaHoras !== '') return numero(setor.jornadaHoras);
    return 8;
  }

  /**
   * O dia: cada linha com o seu tempo, o total ocupado, o que sobra e se passou.
   * Linha de produto SEM tempo cadastrado não entra na soma — e vai listada em
   * `semTempo`, porque somar zero esconderia que o dia está mais cheio do que
   * parece.
   */
  function resumoDoDia({ itens, tempos, jornadaHoras }) {
    const mapa = mapaDeTempos(tempos);
    const disponivel = Math.round(numero(jornadaHoras) * 60);
    const linhas = (itens || []).map((item) => {
      const unidade = mapa.get(item.productId) || null;
      return { ...item, minutosUnidade: unidade, minutosTotal: unidade ? unidade * numero(item.quantidade) : null };
    });
    const ocupado = linhas.reduce((s, l) => s + (l.minutosTotal || 0), 0);
    return {
      linhas,
      disponivel,
      ocupado,
      sobra: disponivel - ocupado,
      excedeu: ocupado > disponivel,
      percentual: disponivel > 0 ? Math.round((ocupado / disponivel) * 100) : (ocupado > 0 ? 100 : 0),
      semTempo: linhas.filter((l) => !l.minutosUnidade)
    };
  }

  /** Quantas unidades inteiras do produto ainda cabem na sobra do dia. */
  function cabemNoDia(productId, sobraMinutos, tempos) {
    const unidade = mapaDeTempos(tempos).get(productId);
    if (!unidade) return null;
    return Math.max(0, Math.floor(numero(sobraMinutos) / unidade));
  }

  const api = { formatarMinutos, mapaDeTempos, minutosDe, jornadaDoDia, resumoDoDia, cabemNoDia };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisPcpTempo = api;
})(typeof window !== 'undefined' ? window : null);
