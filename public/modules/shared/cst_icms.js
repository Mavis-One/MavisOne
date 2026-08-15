// O que cada CST do ICMS admite — FONTE ÚNICA.
//
// POR QUE ESTE ARQUIVO EXISTE
// ---------------------------
// O CST não é um rótulo: ele DETERMINA quais campos a nota pode carregar.
// CST 40 é isenta — não tem base, não tem alíquota, não tem valor. Mandar
// esses campos numa isenta é declarar imposto onde não há, e a SEFAZ recusa.
//
// Até 14/08/2026 o payload mandava base, alíquota e valor para QUALQUER CST.
// Não explodiu porque a única regra cadastrada usava CST 00, onde os três são
// mesmo obrigatórios — apareceria na primeira isenção cadastrada.
//
// Mora em public/ para o navegador carregar por <script>, e o server.js faz
// require() do mesmo arquivo — mesma razão do sales_status.js. Se a tela
// escondesse a alíquota num CST e o servidor a enviasse assim mesmo, o usuário
// veria um formulário limpo e a nota sairia com imposto que ele não declarou.
//
// FONTE: Manual de Orientação do Contribuinte da NF-e, grupo N (ICMS).
(function (raiz) {
  // icmsProprio  — leva vBC, pICMS e vICMS (o imposto da própria operação)
  // reducao      — admite pRedBC
  // st           — leva o grupo de substituição tributária (MVA, base, valor)
  // stRetido     — o ST foi retido ANTES; o grupo é o de retenção, não o normal
  // suportado    — false quando o CST exige um grupo que este sistema ainda
  //                não monta. Melhor recusar do que emitir pela metade.
  const SITUACOES = {
    '00': { rotulo: 'Tributada integralmente', icmsProprio: true, reducao: false, st: false, suportado: true },
    '10': { rotulo: 'Tributada e com cobrança do ICMS por substituição tributária', icmsProprio: true, reducao: false, st: true, suportado: true },
    '20': { rotulo: 'Com redução de base de cálculo', icmsProprio: true, reducao: true, st: false, suportado: true },
    // Isenta/não tributada MAS com ST: não tem ICMS próprio e tem ST. É o
    // caso que mais confunde, porque o nome começa com "isenta".
    '30': { rotulo: 'Isenta ou não tributada e com cobrança do ICMS por substituição tributária', icmsProprio: false, reducao: false, st: true, suportado: true },
    '40': { rotulo: 'Isenta', icmsProprio: false, reducao: false, st: false, suportado: true },
    '41': { rotulo: 'Não tributada', icmsProprio: false, reducao: false, st: false, suportado: true },
    '50': { rotulo: 'Suspensão', icmsProprio: false, reducao: false, st: false, suportado: true },
    // Diferimento tem grupo próprio (vICMSOp, pDif, vICMSDif) que ainda não é
    // montado. Marcar como tributada e mandar só base/alíquota produziria uma
    // nota que passa na validação e declara o imposto errado.
    '51': { rotulo: 'Diferimento', icmsProprio: true, reducao: true, st: false, suportado: false, falta: 'grupo de diferimento (vICMSOp, pDif, vICMSDif)' },
    '60': { rotulo: 'ICMS cobrado anteriormente por substituição tributária', icmsProprio: false, reducao: false, st: false, stRetido: true, suportado: false, falta: 'grupo de ST retido (vBCSTRet, pST, vICMSSTRet)' },
    '61': { rotulo: 'Tributação monofásica sobre combustíveis cobrada anteriormente', icmsProprio: false, reducao: false, st: false, suportado: false, falta: 'grupo monofásico de combustíveis' },
    '70': { rotulo: 'Com redução de base de cálculo e cobrança do ICMS por substituição tributária', icmsProprio: true, reducao: true, st: true, suportado: true },
    '90': { rotulo: 'Outras', icmsProprio: true, reducao: true, st: true, suportado: true }
  };

  // Normaliza para 2 dígitos: o banco guarda char(2), mas a tela pode mandar
  // "0" ou 0 e um CST "0" não casaria com "00".
  function normalizar(cst) {
    const limpo = String(cst == null ? '' : cst).replace(/\D/g, '');
    return limpo ? limpo.padStart(2, '0') : '';
  }

  function situacao(cst) {
    return SITUACOES[normalizar(cst)] || null;
  }

  // Sem CST conhecido a resposta é NÃO. O contrário faria um código digitado
  // errado liberar todos os campos e sair na nota como se fosse tributado.
  const temIcmsProprio = (cst) => Boolean(situacao(cst)?.icmsProprio);
  const temReducao = (cst) => Boolean(situacao(cst)?.reducao);
  const temSt = (cst) => Boolean(situacao(cst)?.st);
  const ehSuportado = (cst) => Boolean(situacao(cst)?.suportado);

  // Os que não tributam a operação própria — é o que a tela usa para esconder
  // alíquota, base e redução.
  const SEM_TRIBUTO_PROPRIO = Object.keys(SITUACOES).filter((c) => !SITUACOES[c].icmsProprio);

  function opcoesSelect() {
    return Object.entries(SITUACOES).map(([codigo, def]) => ({
      value: codigo,
      label: `${codigo} — ${def.rotulo}`,
      suportado: def.suportado,
      falta: def.falta || ''
    }));
  }

  const api = {
    SITUACOES, SEM_TRIBUTO_PROPRIO,
    normalizar, situacao,
    temIcmsProprio, temReducao, temSt, ehSuportado,
    opcoesSelect
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisCstIcms = api;
})(typeof window !== 'undefined' ? window : null);
