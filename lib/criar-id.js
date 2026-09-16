/**
 * O GERADOR DE IDs DA CASA. Num lugar só.
 *
 * Formato: `<prefixo>-<timestamp em ms>-<15 hex>`  (ex.: `pes-1758021234567-a3f9c21d0e4b8a7`)
 *
 * POR QUE 15 E NÃO 6
 * ------------------
 * Eram 6 caracteres hex — 24 bits, ~16,7 milhões de valores. Parece muito até
 * lembrar que o timestamp tem resolução de MILISSEGUNDO: num laço apertado
 * (importação de pedidos, carga inicial, migração de dados) centenas de ids
 * caem no mesmo milissegundo, e aí os 24 bits são tudo o que separa um do
 * outro. Pelo paradoxo do aniversário, algumas centenas no mesmo ms já dão
 * fração de por cento de colisão — e foi isso que apareceu: a suíte acusou
 * `5000 ids seguidos` com 4999 distintos, uma vez, e passou nas seguintes.
 *
 * Um teste que falha "de vez em quando" é fácil de culpar pelo azar. Este não
 * era azar: era o gerador colidindo de verdade, e em produção a colisão não
 * aparece como teste vermelho — aparece como chave primária duplicada no meio
 * de uma importação, ou pior, como um registro sobrescrevendo outro.
 *
 * 15 hex são 60 bits (~1,15 quintilhão). Os mesmos 5000 ids no mesmo
 * milissegundo passam de "acontece" para ~1 em 100 bilhões.
 *
 * O QUE NÃO MUDA
 * --------------
 * Os ids já gravados continuam válidos: nada no sistema interpreta a parte
 * aleatória, e as colunas de id são `text` (ou uuid, nas tabelas fiscais), sem
 * limite de tamanho — conferido antes de mexer. Ids antigos e novos convivem.
 *
 * ISTO NÃO GERA TOKEN DE SESSÃO nem segredo de coisa nenhuma. Token de sessão
 * são 32 bytes de randomBytes, sem prefixo e sem carimbo de tempo (ver
 * `criarToken` em server.js) — justamente para não ter parte previsível. Um id
 * com timestamp legível serve para ordenar e depurar, não para proteger.
 *
 * POR QUE MORA AQUI, E NÃO EM lib/db/client.js
 * --------------------------------------------
 * Porque havia DUAS cópias, e elas divergiram: a de client.js já tinha saído do
 * Math.random para crypto; a de lib/cadastros-core.js (contatos, equipamentos,
 * contas bancárias, agendamentos) ficou para trás com `Math.random().toString(36)`
 * e ninguém notou, porque o teste olhava só para uma delas. Mesma lição de
 * lib/migracoes.js: enquanto cada lado tem a sua cópia, a primeira correção
 * feita de um lado deixa o outro para trás — em silêncio.
 */
const crypto = require('crypto');

// 8 bytes viram 16 hex; ficam 15, que é o tamanho escolhido. Cortar um
// caractere é mais barato do que sortear meio byte, e 60 bits já resolvem o
// problema com folga de várias ordens de grandeza.
const HEX = 15;

function createId(prefix) {
  const aleatorio = crypto.randomBytes(8).toString('hex').slice(0, HEX);
  return `${prefix}-${Date.now()}-${aleatorio}`;
}

module.exports = { createId, HEX_DO_ID: HEX };
