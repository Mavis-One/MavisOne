// Prazo de cancelamento da NF-e: 24 horas contadas da AUTORIZAÇÃO.
//
// Regra única, lida pelo navegador e pelo servidor. Duplicar a conta nos dois
// lados é como as duas versões começam a divergir — e aqui divergir significa
// a tela liberar um cancelamento que o servidor recusa, ou pior, o contrário.
//
// O relógio começa na AUTORIZAÇÃO, não na emissão. São coisas diferentes: a
// nota pode ficar minutos (ou horas, quando o webhook não chega) entre
// "transmitida" e "autorizada", e é a autorização que a SEFAZ registra.
//
// Depois das 24h a SEFAZ recusa o cancelamento comum. Continua existindo o
// CANCELAMENTO EXTEMPORÂNEO, que é outra coisa: depende de autorização
// específica do estado e pode ser recusado. Este módulo não decide se ele é
// permitido — só informa que o prazo comum acabou.
(function (raiz) {
  'use strict';

  const HORAS = 24;
  const MS = HORAS * 60 * 60 * 1000;

  function paraData(valor) {
    if (!valor) return null;
    const d = valor instanceof Date ? valor : new Date(valor);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /**
   * A nota ainda está dentro do prazo comum de cancelamento?
   *
   * Devolve { dentroDoPrazo, motivo, horasDecorridas, expiraEm, semReferencia }.
   *
   * `semReferencia` marca o caso em que NÃO dá para saber: nota sem data de
   * autorização. Aí o prazo NÃO é dado como vencido — bloquear por falta de
   * informação impediria o cancelamento legítimo de uma nota recém-autorizada
   * cujo carimbo ainda não voltou do webhook. Quem tem a palavra final é a
   * SEFAZ, que recusa com "prazo de cancelamento excedido".
   */
  function avaliar(autorizadoEm, agora) {
    const inicio = paraData(autorizadoEm);
    const referencia = paraData(agora) || new Date();

    if (!inicio) {
      return {
        dentroDoPrazo: true,
        semReferencia: true,
        horasDecorridas: null,
        expiraEm: null,
        motivo: ''
      };
    }

    const decorrido = referencia.getTime() - inicio.getTime();
    const horasDecorridas = decorrido / 3600000;
    const expiraEm = new Date(inicio.getTime() + MS);

    // Relógio adiantado no cliente não pode "vencer" uma nota recém-autorizada.
    if (decorrido < 0) {
      return { dentroDoPrazo: true, semReferencia: false, horasDecorridas: 0, expiraEm, motivo: '' };
    }

    if (decorrido <= MS) {
      return { dentroDoPrazo: true, semReferencia: false, horasDecorridas, expiraEm, motivo: '' };
    }

    return {
      dentroDoPrazo: false,
      semReferencia: false,
      horasDecorridas,
      expiraEm,
      motivo: mensagem(horasDecorridas)
    };
  }

  // Uma frase só, dizendo o prazo, o que já passou e qual é a saída — quem lê
  // um botão desligado precisa saber o que fazer em seguida.
  function mensagem(horasDecorridas) {
    return `O prazo de ${HORAS} horas para cancelar esta NF-e terminou (${descreverAtraso(horasDecorridas)} desde a autorização). `
      + 'Depois disso a SEFAZ só aceita cancelamento extemporâneo, que depende de autorização específica dela.';
  }

  function descreverAtraso(horas) {
    if (!Number.isFinite(horas)) return 'tempo desconhecido';
    if (horas < 48) return `${Math.floor(horas)} horas`;
    const dias = Math.floor(horas / 24);
    return `${dias} dia${dias === 1 ? '' : 's'}`;
  }

  const api = { HORAS, MS, avaliar, descreverAtraso };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisPrazoCancelamento = api;
})(typeof window !== 'undefined' ? window : null);
