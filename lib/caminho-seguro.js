/**
 * O ARQUIVO PEDIDO ESTA' MESMO DENTRO DA PASTA? (fase CB — achado 11)
 *
 * O servidor entrega dois diretorios inteiros por URL: public/modules e
 * public/assets. O nome do arquivo vem do pedido, entao a pergunta "isto ainda
 * esta' dentro da pasta permitida?" e' a unica coisa entre a URL e o disco.
 *
 * A resposta era `filePath.startsWith(raiz)` — PREFIXO DE TEXTO, nao fronteira
 * de pasta. `public/modules-privado/chaves.js` comeca com `public/modules` e
 * nao esta dentro dele; a checagem aprovava.
 *
 * ISSO NUNCA VAZOU NADA, E VALE DIZER POR QUE
 * -------------------------------------------
 * Sondei 13 caminhos crus, sem navegador no meio para normalizar: `..`,
 * `%2e%2e`, duplo encode, barra invertida do Windows, byte nulo, irmao de mesmo
 * prefixo. Nenhum saiu da pasta. Duas coisas seguravam — e nenhuma das duas era
 * esta linha:
 *
 *   1. o `new URL()` do Node resolve os `..` ANTES de o caminho chegar aqui;
 *   2. hoje nao existe pasta irma comecando com "modules" ou "assets".
 *
 * As duas podem mudar sem que ninguem se lembre desta linha. Uma pasta
 * `public/assets-privados` criada daqui a um ano nao parece, para quem a cria,
 * ter relacao nenhuma com a seguranca do servidor de arquivos.
 *
 * O QUE E' "FORA" COM PRECISAO
 * ----------------------------
 * `path.relative` responde em vocabulario de caminho: devolve como se chega da
 * raiz ate' o arquivo. Sair da pasta e' o desvio ser `..` ou comecar com `..` +
 * separador. NAO basta "comecar com ..": um arquivo chamado `..coisa.js` esta
 * dentro da pasta, e a primeira versao desta checagem o barrava com 403 (medido
 * com `/modules/..%2fapp.js`, que e' nome de arquivo e nao fuga).
 *
 * Drive diferente no Windows (`D:\...` a partir de `C:\...`) devolve caminho
 * absoluto — por isso o `isAbsolute` tambem conta como fora.
 */
const path = require('path');

function dentroDaPasta(raiz, caminho) {
  const desvio = path.relative(raiz, caminho);
  if (path.isAbsolute(desvio)) return false;
  if (desvio === '..' || desvio.startsWith('..' + path.sep)) return false;
  return true;
}

module.exports = { dentroDaPasta };
