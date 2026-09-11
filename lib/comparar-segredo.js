/**
 * COMPARAR SEGREDO SEM DIZER O QUANTO ERROU (fase CB — achado 09).
 *
 * Os dois webhooks — Focus NFe e Open Finance — nao tem sessao: quem prova
 * quem e' o segredo compartilhado no cabecalho. A conferencia era `!==`, e
 * `!==` entre strings compara caractere por caractere e PARA no primeiro que
 * difere. Quem chuta o segredo recebe, junto com o 401, a informacao de quantos
 * caracteres acertou — medida em nanossegundos.
 *
 * MEDIDO AQUI, com 2 milhoes de comparacoes por amostra e 7 rodadas:
 *
 *     erra no 1o caractere ....  37,53 ns
 *     erra no ultimo .........  149,83 ns
 *     diferenca ..............  112,31 ns  (299%)
 *
 * 112 ns e' pouco perto da variacao de uma rede (milissegundos), e por isso
 * isto nunca foi um buraco aberto: extrair um caractere exigiria dezenas de
 * milhares de requisicoes com media estatistica, e os 32 caracteres, muito
 * mais. Mas o sinal EXISTE e cresce com a proximidade — na mesma maquina ou na
 * mesma rede da loja, a margem encolhe. E o conserto custa tres linhas.
 *
 * POR QUE PASSAR PELO SHA-256 ANTES
 * ---------------------------------
 * `crypto.timingSafeEqual` exige buffers do MESMO tamanho — chamar com
 * tamanhos diferentes lanca excecao, e conferir o tamanho antes ja' vazaria o
 * tamanho do segredo. O resumo SHA-256 tem 32 bytes para qualquer entrada, de
 * uma letra a um paragrafo. Comparar os resumos compara sempre 32 bytes contra
 * 32 bytes, no mesmo tempo, e nao conta nada sobre o segredo de verdade.
 */
const crypto = require('crypto');

function segredosIguais(recebido, esperado) {
  const b = String(esperado == null ? '' : esperado);
  // Sem segredo configurado nada confere — senao um servidor sem a variavel de
  // ambiente aceitaria requisicao com o cabecalho vazio.
  if (!b) return false;
  // Cabecalho repetido chega como array; String() junta com virgula e nao casa.
  const a = String(recebido == null ? '' : recebido);
  const resumoA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const resumoB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(resumoA, resumoB);
}

module.exports = { segredosIguais };
