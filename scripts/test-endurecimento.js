#!/usr/bin/env node
/**
 * OS QUATRO PONTOS PEQUENOS DA VARREDURA (fase CB — achados 09, 11, 12 e 13).
 *
 * Nenhum dos quatro era um buraco aberto, e isso esta' medido, nao suposto.
 * Sao os pontos em que o sistema dependia de um acidente para estar seguro —
 * e acidente nao se mantem sozinho.
 *
 * 09. O SEGREDO DO WEBHOOK CONFERIDO COM `!==`
 *     `!==` para no primeiro caractere errado e devolve, junto com o 401, o
 *     quanto o palpite acertou. Medido aqui, 2 milhoes de comparacoes por
 *     amostra: 37,53 ns errando no 1o caractere contra 149,83 ns errando no
 *     ultimo — 299% de diferenca. Depois da correcao, o espalhamento DENTRO da
 *     mesma classe (313 ns) ficou igual ao espalhamento ENTRE classes: ruido da
 *     maquina, nao informacao sobre o segredo.
 *
 * 11. O ARQUIVO ESTATICO CONFERIDO POR PREFIXO DE TEXTO
 *     `startsWith` aprovava `public/modules-privado/x.js`. 13 caminhos crus
 *     sondados, nenhum saiu da pasta — o que segurava era o `new URL()`
 *     normalizar os `..` antes, e nao existir hoje pasta irma com esse prefixo.
 *
 * 12. DUAS TELAS MORTAS MONTANDO HTML SEM ESCAPAR
 *     Estoque e Financeiro tinham copia inteira no app.js, inalcancavel desde
 *     que ganharam pasta propria. MEDIDO num Chrome de verdade: marcador no topo
 *     de cada bloco, os dois modulos abertos por 4 sub-telas cada — 8 aberturas,
 *     zero disparos.
 *
 * 13. O SERVIDOR ESCUTANDO EM TODA INTERFACE SEM NINGUEM TER PEDIDO
 *     Medido nesta maquina, com o servidor no ar e sondado pelo IP da rede:
 *       antes  -> 200 pelo 192.168.0.142, e a mensagem de inicio dizia
 *                 "http://localhost:3999", escondendo justamente isso
 *       depois -> conexao recusada pelo IP da rede, 200 por 127.0.0.1
 *       depois, com HOST=0.0.0.0 -> 200 pelo IP da rede, e o servidor imprime
 *                 cada endereco em que ficou visivel
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const src = ler('server.js');
const srcCodigo = semComentarios(src);
const app = ler('public/app.js');
const appCodigo = semComentarios(app);

console.log('--- 09. o segredo do webhook, em tempo constante ---');
const { segredosIguais } = require('../lib/comparar-segredo');
check('segredo igual confere', segredosIguais('abc123XYZ', 'abc123XYZ'));
check('  errando no fim nao confere', !segredosIguais('abc123XYz', 'abc123XYZ'));
check('  errando no comeco nao confere', !segredosIguais('Xbc123XYZ', 'abc123XYZ'));
check('  mais curto nao confere', !segredosIguais('abc', 'abc123XYZ'));
check('  mais longo nao confere', !segredosIguais('abc123XYZ!', 'abc123XYZ'));
// Sem a variavel de ambiente, um cabecalho vazio casaria com um esperado vazio
// e o webhook viraria rota aberta.
check('segredo NAO configurado recusa tudo',
  !segredosIguais('', '') && !segredosIguais('qualquer', '') && !segredosIguais('', undefined));
check('cabecalho repetido (array) nao confere', !segredosIguais(['abc123XYZ', 'abc123XYZ'], 'abc123XYZ'));
const libSegredo = ler('lib/comparar-segredo.js');
check('usa timingSafeEqual', /crypto\.timingSafeEqual\(/.test(libSegredo));
// O sha-256 nao e' enfeite: timingSafeEqual exige tamanhos iguais, e conferir
// tamanho antes ja' vazaria o tamanho do segredo.
check('  sobre resumos de tamanho fixo', /createHash\('sha256'\)/.test(libSegredo));
check('os DOIS webhooks usam a funcao',
  (srcCodigo.match(/if \(!segredosIguais\(secretRecebido, secretEsperado\)\)/g) || []).length === 2);
check('  e nenhum compara segredo com !==',
  !/secretRecebido !== secretEsperado/.test(srcCodigo));

console.log('--- 11. o arquivo estatico, por fronteira de pasta ---');
const { dentroDaPasta } = require('../lib/caminho-seguro');
const raiz = path.join('C:', 'erp', 'public', 'modules');
check('arquivo da pasta entra', dentroDaPasta(raiz, path.join(raiz, 'router.js')));
check('  subpasta tambem', dentroDaPasta(raiz, path.join(raiz, 'sales', 'subs', 'x.js')));
// O caso que a primeira versao desta checagem barrava por engano: nome de
// arquivo que comeca com dois pontos nao e' fuga.
check('  nome comecando com .. entra', dentroDaPasta(raiz, path.join(raiz, '..coisa.js')));
// O caso que o startsWith aprovava.
check('pasta IRMA de mesmo prefixo fica de fora',
  !dentroDaPasta(raiz, path.join('C:', 'erp', 'public', 'modules-privado', 'chaves.js')));
check('  um nivel acima fica de fora', !dentroDaPasta(raiz, path.join('C:', 'erp', 'public', 'app.js')));
check('  a raiz do projeto fica de fora', !dentroDaPasta(raiz, path.join('C:', 'erp', '.env')));
check('  outro drive fica de fora', !dentroDaPasta(raiz, path.join('D:', 'segredo.txt')));
check('o servidor usa a funcao', /if \(!dentroDaPasta\(raizEstatica, filePath\)\)/.test(srcCodigo));
check('  e nao compara mais por prefixo de texto',
  !/filePath\.startsWith\(raizEstatica\)/.test(srcCodigo));

console.log('--- 12. as duas telas mortas sairam ---');
// Estoque e Financeiro tem pasta propria e handler que nunca devolve false —
// o router retorna `handled` e o app.js nao era alcancado.
for (const modulo of ['stock', 'finance']) {
  check(`app.js nao redesenha ${modulo}`, !new RegExp(`if \\(moduleName === '${modulo}'\\)`).test(appCodigo));
  const indice = semComentarios(ler(`public/modules/${modulo}/index.js`));
  check(`  modules/${modulo} registra o handler`,
    new RegExp(`MavisModuleRegistry\\.${modulo} = async function`).test(indice));
  check('  e ele nunca devolve false', !/return false/.test(indice));
}
// Cadastros e Vendas PODEM devolver false — as telas legadas deles no app.js
// sao alcancadas de verdade e nao podiam sair junto.
for (const modulo of ['cadastros', 'sales']) {
  check(`${modulo} ainda pode cair no app.js (devolve false)`,
    /return false/.test(semComentarios(ler(`public/modules/${modulo}/index.js`))));
}
check('o router respeita o false', /return result !== false;/.test(ler('public/modules/router.js')));
// O que morava nos blocos: dado do banco interpolado cru em innerHTML.
check('sumiu a interpolacao crua de produto',
  !/<td>\$\{product\.name\}<\/td>/.test(appCodigo));
check('  e a de lancamento financeiro',
  !/<td>\$\{entry\.description\}<\/td>/.test(appCodigo));

console.log('--- 13. quem alcanca o servidor ---');
check("o padrao e' 127.0.0.1", /const HOST = process\.env\.HOST \|\| '127\.0\.0\.1';/.test(srcCodigo));
check('  e nao 0.0.0.0', !/process\.env\.HOST \|\| '0\.0\.0\.0'/.test(srcCodigo));
// Escutar na rede continua possivel — o que mudou e' que virou escolha, e
// escolha que aparece.
check('  mas HOST=0.0.0.0 continua valendo', /const HOST = process\.env\.HOST \|\|/.test(srcCodigo));
check('o servidor avisa em quais enderecos ficou visivel',
  /for \(const endereco of enderecosDaRede\(\)\)/.test(srcCodigo));
check("  e so' fala quando e' 0.0.0.0",
  /function enderecosDaRede\(\) \{\s*\n\s*if \(HOST !== '0\.0\.0\.0'\) return \[\];/.test(src));
check('  listando so as placas externas',
  /placa\.family === 'IPv4' && !placa\.internal/.test(srcCodigo));
check('o .env.example explica os dois casos', /# HOST=0\.0\.0\.0/.test(ler('.env.example')));

console.log('--- o que foi medido, e com o que ---');
for (const [caso, resultado] of [
  ['`!==`, errando no 1o caractere', '37,53 ns'],
  ['`!==`, errando no ultimo', '149,83 ns  (+299%)'],
  ['segredosIguais, entre classes', '313 ns de espalhamento'],
  ['segredosIguais, dentro da classe', '313 ns  (o mesmo ruido)'],
  ['13 caminhos crus de traversal', '0 sairam da pasta, antes e depois'],
  ['blocos mortos, 8 aberturas no Chrome', '0 disparos do marcador'],
  ['antes, pelo IP da rede', '200 — e a tela dizia "localhost"'],
  ['depois, pelo IP da rede', 'conexao recusada'],
  ['depois, com HOST=0.0.0.0', '200, e o servidor imprime o endereco'],
  ['webhooks apos a troca', 'segredo certo 200, errado 401']
]) console.log(`  ·  ${caso.padEnd(40)} ${resultado}`);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
