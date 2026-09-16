// Inscrição estadual — REGRA ÚNICA para "é contribuinte de ICMS?".
//
// POR QUE ESTE ARQUIVO EXISTE
// ---------------------------
// O sistema decidia "contribuinte" em três lugares — pré-checagem fiscal do
// pedido, montagem da NF-e a partir do pedido e tela de emissão — e nos três a
// regra era a mesma linha: `Boolean(stateRegistration)`. Qualquer coisa
// escrita no campo virava contribuinte, inclusive "ISENTO", que é o que se
// escreve justamente para dizer o contrário.
//
// Enquanto a I.E. era opcional, isso não mordia: quem não tinha deixava em
// branco. Em 15/09/2026 o atalho de Novo Cliente passou a EXIGIR a I.E., e
// exigir sem admitir "ISENTO" obrigaria a inventar um número para toda pessoa
// física. Com "ISENTO" admitido, a regra antiga mandaria a nota com indicador
// 1 (contribuinte) e IE "ISENTO" — rejeição da SEFAZ na transmissão,
// descoberta longe do cadastro que a causou.
//
// MEDIDO no banco antes de mudar: 6.492 pessoas, 552 com I.E., todas pessoa
// jurídica e todas só dígitos, nenhuma "ISENTO". Para todas elas esta regra
// devolve o mesmo que a antiga; o que muda é só o que a antiga não previa.
//
// Mora em public/ para o navegador carregar por <script>, e o server.js e o
// lib/nfePayloadBuilder.js fazem require() do MESMO arquivo — a razão é a do
// cst_icms.js: se a tela dissesse "não contribuinte" e o servidor
// "contribuinte", a nota sairia diferente do que a pessoa viu.
//
// FONTE: Manual de Orientação do Contribuinte da NF-e, grupo E (destinatário):
// indIEDest 1 = contribuinte (a IE vai na nota), 2 = isento de inscrição,
// 9 = não contribuinte. Nos casos 2 e 9 a tag IE NÃO é informada. O tipo TIe
// do schema aceita de 2 a 14 dígitos.
(function (raiz) {
  const ISENTO = 'ISENTO';

  // O que a pessoa digitou, na forma em que se guarda: "isento" em qualquer
  // caixa, com ou sem espaços, vira ISENTO; o resto fica só com os dígitos,
  // que é como a IE vai no XML — ponto e traço são de exibição.
  function normalizar(valor) {
    const texto = String(valor || '').trim();
    if (!texto) return '';
    if (/^isento$/i.test(texto)) return ISENTO;
    return texto.replace(/\D/g, '');
  }

  // Preenchida e diferente de ISENTO. Vazia NÃO é contribuinte: é o cadastro
  // de antes de a I.E. ser pedida, e presumir contribuinte para ele mandaria
  // nota com indicador 1 sem IE nenhuma.
  function ehContribuinte(valor) {
    const n = normalizar(valor);
    return n !== '' && n !== ISENTO;
  }

  // De 2 a 14 dígitos: o tipo TIe do schema da NF-e.
  const FORMA_DA_IE = /^\d{2,14}$/;

  // O que vai em inscricao_estadual do destinatário: só quando é contribuinte
  // e só o que o XML aceita. ISENTO, vazio, 1 dígito ou 15 devolvem undefined,
  // e o campo não entra no payload.
  function paraNota(valor) {
    const n = normalizar(valor);
    return ehContribuinte(valor) && FORMA_DA_IE.test(n) ? n : undefined;
  }

  // Aceitável para guardar: ISENTO, ou de 2 a 14 dígitos. "abc" normaliza para
  // vazio e cai aqui — é o erro que o atalho mostra ao lado do campo.
  function valida(valor) {
    const n = normalizar(valor);
    return n === ISENTO || FORMA_DA_IE.test(n);
  }

  // CONTRIBUINTE SEM IE NÃO VIRA NOTA. Indicador 1 exige a tag IE (é o que o
  // próprio indicador significa: "contribuinte ICMS — informar a IE"), e a
  // tela deixa marcar "Contribuinte" com o campo em branco de propósito: a
  // consulta de CNPJ marca o checkbox e deixa a IE para ser digitada. Quem
  // esquecia recebia a rejeição da SEFAZ depois de transmitir; com este
  // motivo, recebe antes. Devolve '' quando não há o que recusar.
  function motivoParaRecusar(destinatario) {
    if (!destinatario || !destinatario.contribuinte) return '';
    if (paraNota(destinatario.inscricaoEstadual)) return '';
    return 'O destinatário está marcado como contribuinte de ICMS, mas não tem inscrição estadual válida. '
      + 'Informe só os números da IE (de 2 a 14 dígitos), ou desmarque "Contribuinte de ICMS".';
  }

  const api = { ISENTO, normalizar, ehContribuinte, paraNota, valida, motivoParaRecusar };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisInscricaoEstadual = api;
})(typeof window !== 'undefined' ? window : null);
