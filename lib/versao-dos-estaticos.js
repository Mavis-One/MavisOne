/**
 * A VERSÃO DE CADA ARQUIVO ESTÁTICO — e por que o sistema abria devagar.
 *
 * O PROBLEMA, MEDIDO
 * ------------------
 * `public/index.html` carrega 142 `<script src>` mais o CSS e o logo: 144
 * arquivos, 1,67 MB de JavaScript, todos servidos com `Cache-Control:
 * no-cache`. E `no-cache` não é "não guarde" — é "guarde, mas CONFIRME antes de
 * usar". A confirmação é uma requisição.
 *
 * Então cada abertura do sistema custava 144 requisições. Medido nesta máquina,
 * com o navegador já tendo tudo em cache: 144 de 144 voltaram 304, sem um byte
 * de corpo. Em localhost isso é rápido (53 ms) e o defeito não aparece.
 *
 * Só que o ERP roda num VPS, e aí o que se paga não é o corpo — é a IDA E
 * VOLTA. O HTTP/1.1 abre 6 conexões por origem, então 144 pedidos viram 24
 * ondas em fila:
 *
 *     ping 20 ms .....  480 ms
 *     ping 50 ms .... 1.200 ms
 *     ping 90 ms .... 2.160 ms
 *
 * A CADA ABERTURA, e antes de a primeira tela pedir o primeiro dado. É o
 * "demora para carregar" que não aparece em nenhum cronômetro de rota, porque
 * não é rota: é o custo de existir 144 arquivos com revalidação obrigatória.
 *
 * O QUE ISTO FAZ
 * --------------
 * Põe a versão do arquivo na própria URL: `/app.js` vira `/app.js?v=k3x9p2mq`,
 * onde o `v` é o hash do CONTEÚDO. Aí o arquivo pode ser servido com
 * `immutable` e um ano de validade — o navegador nem pergunta, lê do disco.
 *
 * A conta passa de 144 requisições para UMA: o `index.html`, que continua com
 * `no-cache` porque é ele que carrega os endereços novos.
 *
 * POR QUE ISSO NÃO SERVE VERSÃO VELHA
 * -----------------------------------
 * É a inversão que faz o esquema ser seguro, e vale escrever porque
 * "cache de um ano" assusta com razão:
 *
 *   - o `index.html` NUNCA é cacheado sem confirmar (segue `no-cache`);
 *   - todo endereço de script nasce dentro dele, carimbado com o hash do
 *     conteúdo de agora;
 *   - mudou o arquivo, mudou o hash, mudou o ENDEREÇO. O navegador não tem o
 *     endereço novo em cache, então baixa. Não existe o caso "guardei a versão
 *     velha e vou usá-la": a versão velha mora em outra URL, que ninguém mais
 *     pede.
 *
 * É mais seguro que o `no-cache` de antes, não menos: lá, um 304 mal cacheado
 * por um proxy intermediário podia servir arquivo velho. Aqui o endereço é a
 * garantia.
 *
 * E o `immutable` só sai quando o `v` pedido CONFERE com o hash atual (ver
 * `versaoConfere`). Endereço com hash antigo — um link guardado, uma aba velha —
 * recebe o conteúdo de hoje com `no-cache`, e não com um ano de validade
 * gravado em cima de um endereço que já não corresponde.
 *
 * O HASH É DO CONTEÚDO, E NÃO DO mtime, pelo mesmo motivo que o ETag já era:
 * `git checkout` mexe na data sem mudar o arquivo, e um deploy que recopia tudo
 * invalidaria o cache inteiro à toa. O mtime entra só como CHAVE DO CACHE em
 * memória — para saber quando reler o arquivo do disco, não para versionar.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Oito caracteres de base64url do sha1 do conteúdo. Não é criptografia: é
// identidade. O que se pede dele é que dois conteúdos diferentes não caiam no
// mesmo carimbo, e 8 caracteres (48 bits) dão isso com folga para os 144
// arquivos de um deploy.
const TAMANHO_DO_CARIMBO = 8;

// caminho absoluto -> { mtimeMs, size, versao }
//
// Sem cache, cada abertura do sistema leria e faria o hash dos 144 arquivos
// (1,67 MB) para montar o index.html. Com ele, custa 144 `statSync` — e relê
// só o que mudou. A chave de invalidação é mtime+tamanho: é o que um deploy
// muda, e é barato de perguntar.
const cache = new Map();

/**
 * O carimbo do arquivo, ou '' quando ele não existe/não é arquivo.
 *
 * Devolver '' para arquivo ausente é deliberado: quem carimba o HTML deixa a
 * URL como estava, e um `<script src>` apontando para um arquivo que não
 * existe continua dando 404 — o mesmo erro de antes, no mesmo lugar. Inventar
 * um carimbo aqui esconderia o problema atrás de uma URL diferente.
 */
function versaoDe(caminhoAbsoluto) {
  let info;
  try {
    info = fs.statSync(caminhoAbsoluto);
  } catch {
    return '';
  }
  if (!info.isFile()) return '';

  const guardado = cache.get(caminhoAbsoluto);
  if (guardado && guardado.mtimeMs === info.mtimeMs && guardado.size === info.size) {
    return guardado.versao;
  }

  let versao;
  try {
    versao = crypto.createHash('sha1')
      .update(fs.readFileSync(caminhoAbsoluto))
      .digest('base64url')
      .slice(0, TAMANHO_DO_CARIMBO);
  } catch {
    return '';
  }
  cache.set(caminhoAbsoluto, { mtimeMs: info.mtimeMs, size: info.size, versao });
  return versao;
}

/** O `v` pedido é o carimbo atual deste arquivo? Só então vale `immutable`. */
function versaoConfere(caminhoAbsoluto, versaoPedida) {
  if (!versaoPedida) return false;
  const atual = versaoDe(caminhoAbsoluto);
  return Boolean(atual) && atual === versaoPedida;
}

// `src="/x.js"` e `href="/x.css"`, com aspas simples ou duplas.
//
// SÓ CAMINHO ABSOLUTO LOCAL, e é o que a barra inicial garante: `https://...`,
// `//cdn...` e `data:` não casam, e nem deveriam — não é este servidor que os
// entrega. E o `[^"'?#\s]` recusa quem já tem query ou fragmento: carimbar duas
// vezes produziria `?v=a?v=b`.
const REFERENCIA = /\b(src|href)=("|')(\/[^"'?#\s]+)\2/g;

/**
 * Devolve o HTML com `?v=<carimbo>` em cada referência a arquivo local existente.
 *
 * `raizPublica` é a pasta que a URL `/` representa. A checagem de fronteira de
 * pasta é a mesma ideia de lib/caminho-seguro.js: `/../../.env` no HTML não
 * passaria a ser lido aqui — e, não conferindo, fica sem carimbo em vez de
 * virar um caminho fora da pasta.
 */
function carimbarHtml(html, raizPublica) {
  const raiz = path.resolve(raizPublica);
  return String(html == null ? '' : html).replace(REFERENCIA, (inteiro, atributo, aspas, url) => {
    const destino = path.resolve(path.join(raiz, url));
    if (destino !== raiz && !destino.startsWith(raiz + path.sep)) return inteiro;
    const versao = versaoDe(destino);
    if (!versao) return inteiro;
    return `${atributo}=${aspas}${url}?v=${versao}${aspas}`;
  });
}

/**
 * A VERSÃO DO SISTEMA INTEIRO, e a aba que ficou aberta durante o deploy
 * (05/11/2026).
 *
 * O carimbo resolve quem ABRE a página: o index.html novo traz os endereços
 * novos. Não resolve quem já estava com ela aberta. O sistema é uma página só —
 * trocar de tela não recarrega nada —, então a aba aberta antes do deploy
 * segue rodando o JavaScript de antes, falando com o servidor de agora. Foi o
 * "[object Object]" no filtro dos relatórios: a tela velha (campo "Filial",
 * lista de textos) lendo a lista nova (objetos com id e nome), mesmo depois do
 * conserto publicado.
 *
 * A versão é o hash do index.html JÁ CARIMBADO: como ele leva o carimbo de cada
 * script e do CSS, qualquer arquivo da tela que mude muda a versão. Ela vai
 * escrita na página (`<meta name="mavis-versao">`) e em todo JSON da API
 * (`X-Versao-Sistema`); a tela compara as duas e, diferentes, recarrega na
 * próxima troca de tela (public/app.js, conferirVersaoDoSistema).
 */
const META_DA_VERSAO = 'mavis-versao';
const TAMANHO_DA_VERSAO = 12;

function versaoDoHtmlCarimbado(carimbado) {
  return crypto.createHash('sha1').update(String(carimbado)).digest('base64url').slice(0, TAMANHO_DA_VERSAO);
}

/** O index.html carimbado e com a versão escrita no `<head>`. */
function paginaComVersao(html, raizPublica) {
  const carimbado = carimbarHtml(html, raizPublica);
  const versao = versaoDoHtmlCarimbado(carimbado);
  lembrarVersaoDoSistema(raizPublica, versao);
  const meta = `<meta name="${META_DA_VERSAO}" content="${versao}" />`;
  return /<head[^>]*>/i.test(carimbado)
    ? carimbado.replace(/<head[^>]*>/i, (cabeca) => `${cabeca}\n    ${meta}`)
    : `${meta}\n${carimbado}`;
}

// raiz -> { versao, em }. Cada resposta da API pergunta a versão; refazê-la
// custaria os ~144 statSync do carimbo a cada JSON. Meio minuto de validade
// basta: o deploy reinicia o servidor (o cache nasce vazio), e abrir a página
// renova a conta na hora (paginaComVersao).
const VALIDADE_DA_VERSAO_MS = 30 * 1000;
const versaoDoSistemaGuardada = new Map();

function lembrarVersaoDoSistema(raizPublica, versao) {
  versaoDoSistemaGuardada.set(path.resolve(raizPublica), { versao, em: Date.now() });
}

/** A versão de agora ('' se não há index.html para ler). */
function versaoDoSistema(raizPublica, agora = Date.now()) {
  const raiz = path.resolve(raizPublica);
  const guardada = versaoDoSistemaGuardada.get(raiz);
  if (guardada && agora - guardada.em < VALIDADE_DA_VERSAO_MS) return guardada.versao;
  let html;
  try {
    html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  } catch {
    return '';
  }
  const versao = versaoDoHtmlCarimbado(carimbarHtml(html, raiz));
  versaoDoSistemaGuardada.set(raiz, { versao, em: agora });
  return versao;
}

/** Esvazia o cache. Existe para o teste medir releitura sem mexer no relógio. */
function esquecer() {
  cache.clear();
  versaoDoSistemaGuardada.clear();
}

module.exports = {
  versaoDe, versaoConfere, carimbarHtml, paginaComVersao, versaoDoSistema, esquecer,
  TAMANHO_DO_CARIMBO, META_DA_VERSAO
};
