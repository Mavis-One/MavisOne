/**
 * O QUE O USUARIO VE QUANDO ALGO DA ERRADO (fase CC — achado 08).
 *
 * Havia 62 pontos de saida de erro no server.js, e eles se dividiam em dois
 * grupos, cada um errando para um lado.
 *
 * GRUPO 1 — 62 menos 39: mostravam a mensagem, fosse ela de quem fosse
 * -------------------------------------------------------------------
 * O formato era `error: error.message || 'Erro ao salvar deposito'`. Quando o
 * erro era nosso, a mensagem era exatamente o que a pessoa precisava ler.
 * Quando vinha do Postgres, ela recebia isto — medido, num banco descartavel
 * com uma restricao que o app nao conhece:
 *
 *     "createDeposit: new row for relation "deposits" violates check
 *      constraint "prova_cb_dep""
 *
 * Nao ensina nada a ela; ensina bastante a quem estiver sondando o sistema —
 * nome da tabela, nome da restricao, nome da funcao interna que chamou.
 *
 * GRUPO 2 — 39 blocos `catch`: descartavam o erro inteiro
 * -------------------------------------------------------
 * `return sendJson(res, { error: 'Erro ao emitir NF-e' }, 400)` e mais nada. Sem
 * vazamento e sem rastro: a pessoa via "Erro ao emitir NF-e", e nao havia, em
 * lugar nenhum do sistema, o que tinha acontecido.
 *
 * O CRITERIO JA EXISTIA AQUI DENTRO, EM UM MODULO SO
 * --------------------------------------------------
 * O Estoque tinha `sendStockError`: mostrava a mensagem apenas quando o erro
 * trazia `.status`. `.status` e' a marca de "este erro fui EU que lancei, de
 * proposito, e escolhi o codigo HTTP" — erro de banco nao tem, TypeError de bug
 * nao tem. Era a regra certa, aplicada em 9 dos 71 lugares.
 *
 * MEDIDO ANTES DE GENERALIZAR: das 27 mensagens em portugues que o codigo
 * lanca, 24 ja vinham com `.status`. As outras 3 ganharam o seu nesta mesma
 * fase (duas eram "Registro nao encontrado."; a terceira ja tinha, e era o meu
 * detector que nao via status vindo de variavel). Nao havia tensao entre
 * esconder e explicar: so' faltava a marca.
 *
 * E OS PONTOS JA SABIAM O QUE DIZER
 * ---------------------------------
 * Todos os 35 do primeiro formato ja tinham um texto de reserva escrito ao lado
 * (`|| 'Erro ao salvar venda'`). Ele so' nunca aparecia quando havia mensagem do
 * banco — justamente o caso em que ele era o texto certo.
 *
 * O QUE SE PERDE, E ONDE ELE VAI PARAR
 * ------------------------------------
 * Esconder a mensagem do banco esconderia tambem o diagnostico, e o grupo 2
 * mostra aonde isso leva. Por isso o erro inteiro, com a pilha, vai para o log
 * do servidor sob um codigo curto, e o mesmo codigo vai junto da resposta. Quem
 * atende ouve "deu erro, codigo 3f9a1c" e acha a linha exata no log, em vez de
 * procurar por horario.
 *
 * O codigo e' aleatorio de proposito: sequencial contaria quantos erros o
 * sistema deu.
 */
const crypto = require('crypto');

function respostaDeErro(error, reserva, statusPadrao = 400) {
  // `.status` = erro lancado pelo proprio codigo, com mensagem escrita para ser
  // lida por uma pessoa. Vai inteira.
  if (error && error.status) {
    return { status: error.status, mensagem: error.message || reserva, codigo: null };
  }
  // Qualquer outra coisa — banco, bug, biblioteca — nao foi escrita para o
  // usuario. Ele recebe o texto de reserva com o codigo; o erro de verdade vai
  // para o log sob esse mesmo codigo.
  const codigo = crypto.randomBytes(3).toString('hex');
  return { status: statusPadrao, mensagem: `${reserva} (código ${codigo})`, codigo };
}

module.exports = { respostaDeErro };
