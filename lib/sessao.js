// Expiração diária das sessões — a virada do dia derruba todo mundo.
//
// POR QUE
// -------
// Sessão aberta é memória ocupada no servidor e um token válido solto no mundo.
// Ninguém trabalha das 00:00 em diante, mas as sessões do dia anterior ficavam
// vivas indefinidamente: quem esqueceu a tela aberta na sexta continuava
// autenticado na segunda, e o mapa de sessões só crescia.
//
// A regra é a mais simples que resolve os dois problemas: toda sessão morre na
// próxima meia-noite, não importa quando começou. Quem entra às 8h tem o dia
// inteiro; quem entra às 23h50 tem dez minutos — e é justamente esse o caso em
// que manter a sessão viva não serve para nada.
//
// Não é "inatividade": uma sessão em uso ativo às 23:59 também cai. Isso é de
// propósito. Expiração por inatividade exige carimbar cada requisição e ainda
// deixa sessão viva de madrugada; o corte no relógio é previsível para o
// usuário ("vira o dia, entra de novo") e não custa escrita nenhuma.
//
// FUSO
// ----
// Meia-noite é sempre a LOCAL da máquina que roda o servidor. É o mesmo
// relógio que o usuário vê na parede, que é o que "depois da meia-noite"
// significa para ele. A tela também agenda a própria saída no relógio dela; se
// os dois discordarem, quem vale é o servidor — a tela só antecipa o aviso.
'use strict';

// Motivos de encerramento e a frase que a tela mostra. Ficam juntos aqui para
// não existir motivo sem explicação: cair sem saber por quê é o que faz o
// usuário achar que o sistema quebrou.
const MOTIVOS = {
  'outro-dispositivo': 'Sua conta foi conectada em outro dispositivo. Esta sessão foi encerrada.',
  'fim-do-dia': 'O dia virou — as sessões são encerradas à meia-noite. Faça login novamente para continuar.'
};

const MENSAGEM_PADRAO = 'Sua sessão foi encerrada. Faça login novamente.';

function mensagemDoMotivo(motivo) {
  return MOTIVOS[motivo] || MENSAGEM_PADRAO;
}

/**
 * Instante (ms) da próxima meia-noite local depois de `agora`.
 *
 * setHours(24, ...) é o pulo do gato: em vez de somar 24h — que erraria em
 * mudança de horário de verão, e daria 00:00 do dia ERRADO se `agora` já
 * fosse de madrugada — ele normaliza para o começo do dia seguinte, virando
 * mês e ano sozinho.
 */
function proximaViradaDeDia(agora = new Date()) {
  const virada = new Date(agora);
  virada.setHours(24, 0, 0, 0);
  return virada.getTime();
}

/**
 * Quanto falta (ms) para a virada. Nunca negativo: se o relógio já passou,
 * devolve 0 para quem agenda um timer não receber um valor que dispara na
 * hora errada.
 */
function msAteAVirada(agora = new Date()) {
  return Math.max(0, proximaViradaDeDia(agora) - agora.getTime());
}

function sessaoExpirou(sessao, agoraMs = Date.now()) {
  if (!sessao || !sessao.expiraEm) return false;
  return agoraMs >= sessao.expiraEm;
}

module.exports = { MOTIVOS, MENSAGEM_PADRAO, mensagemDoMotivo, proximaViradaDeDia, msAteAVirada, sessaoExpirou };
