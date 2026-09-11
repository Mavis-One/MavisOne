/**
 * TIRAR OS COMENTARIOS ANTES DE PROCURAR NO CODIGO.
 *
 * Meia duzia de testes fazem a mesma pergunta: "este padrao ainda existe no
 * codigo?". Quase sempre a resposta certa e' NAO — `!/Math.random/`,
 * `!/onclick=/`, `!/createId\('token'\)/`. Como o comentario ao lado de cada
 * correcao EXPLICA o padrao que foi tirado, a busca crua encontra a explicacao e
 * o teste acusa a propria documentacao. Ja' aconteceu duas vezes nesta suite.
 *
 * A ORDEM IMPORTA, E ERRAR A ORDEM APAGA CODIGO DE VERDADE
 * -------------------------------------------------------
 * Havia oito copias desta funcao, todas tirando o bloco `/* ... *\/` ANTES da
 * linha `//`. Parece indiferente. Nao e':
 *
 *     // JS dos modulos (public/modules/**) e assets (logo, favicon).
 *
 * Este comentario de LINHA contem `/*` — vem do `/**` dentro de
 * `public/modules/**`. Tirando bloco primeiro, o varredor le aquilo como
 * abertura de bloco e engole tudo ate' o proximo `*\/` do arquivo. Medido no
 * server.js: 1.216 caracteres de codigo real desapareceram, incluindo a linha
 * que um teste desta mesma fase procurava — e o teste acusou falha num codigo
 * que estava la'.
 *
 * Pior que a falha barulhenta e' a silenciosa: um `!/padrao/` passa com folga
 * quando o trecho que continha o padrao foi engolido junto.
 *
 * Tirando a linha PRIMEIRO, aquele `/*` sai junto com a linha inteira, e o que
 * sobra para o varredor de bloco sao blocos de verdade.
 *
 * O que ainda nao trata: `/*` dentro de string ou de literal de expressao
 * regular. Nao existe no codigo hoje, e tratar exigiria um analisador de
 * verdade em vez de duas substituicoes — o custo passaria a ser maior que o
 * risco.
 */

function semComentarios(texto) {
  return String(texto)
    // Comentario de linha inteira primeiro. O `^\s*` e' de proposito: uma
    // linha de codigo com comentario no fim (`const x = 1; // nota`) perde so'
    // a nota se tambem casasse aqui, e nao e' isso que se quer — o codigo antes
    // do `//` tem de ficar.
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

module.exports = { semComentarios };
