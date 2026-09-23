// A FILA DE PENDÊNCIAS DE CADASTRO — sem banco e sem servidor.
//
// O QUE ISTO GUARDA, medido no banco em 23/09/2026:
//
//   5.475 produtos importados
//   3.078 com preço de venda 0  (56% do catálogo)
//       5 sem NCM
//
// E nenhuma tela conseguia listá-los. Produtos filtrava por categoria,
// depósito, status e "situação" — e "situação" olha minStock/maxStock, que
// estão vazios em 5.474 dos 5.475 produtos (o db.json tem UM registro em
// productMeta), então "Zerado" devolvia o catálogo inteiro. O Gestor de Preços,
// que é a ferramenta para corrigir o preço, filtrava só por nome ou SKU: para
// chegar aos 3.078 era preciso já saber os nomes deles.
//
// Por isso a lista vivia numa planilha — e a planilha não sabe quando o produto
// foi corrigido.
//
// O QUE ESTE TESTE PROTEGE
// ------------------------
// 1. O predicado, que é a regra: sem preço, sem custo, sem NCM e 'qualquer'.
// 2. Que ele tem UM dono. As duas rotas (Produtos e Gestor de Preços) chamam a
//    MESMA função — se cada uma escrevesse o seu `if`, a contagem do cartão de
//    uma deixaria de bater com as linhas da outra, e quem confiasse no número
//    concluiria que a segunda tela perdeu produtos.
// 3. Que a contagem sai do SERVIDOR. Contar no navegador significaria reescrever
//    "sem preço" em JavaScript de tela — a segunda cópia da regra.
// 4. Que chave desconhecida NÃO esvazia a lista. `?pendencia=semPreco` (camelCase
//    em vez do hífen) devolvendo zero produtos se lê como "o cadastro está
//    completo", que é o contrário da verdade.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const stockCore = require(path.join(RAIZ, 'lib/stock-core'));
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
function check(titulo, condicao, detalhe) {
  console.log(`  ${condicao ? 'OK  ' : 'XX  '} ${titulo}${detalhe ? ' -> ' + detalhe : ''}`);
  if (!condicao) falhas++;
}

const { temPendenciaDeCadastro: tem, PENDENCIAS_DE_CADASTRO } = stockCore;

// ---------------------------------------------------------------------------
console.log('--- 1. o predicado ---');

const completo = { salePrice: 200, costPrice: 100, ncm: '84672100' };
const semPreco = { salePrice: 0, costPrice: 100, ncm: '84672100' };
const semCusto = { salePrice: 200, costPrice: 0, ncm: '84672100' };
const semNcm = { salePrice: 200, costPrice: 100, ncm: '' };

check('produto completo não tem pendência', !tem(completo, 'qualquer'));
check('preço 0 é pendência', tem(semPreco, 'sem-preco'));
check('  e aparece em "qualquer"', tem(semPreco, 'qualquer'));
check('  mas não em "sem-ncm"', !tem(semPreco, 'sem-ncm'));
check('custo 0 é pendência', tem(semCusto, 'sem-custo'));
check('NCM vazio é pendência', tem(semNcm, 'sem-ncm'));
check('NCM só com espaços também', tem({ ...completo, ncm: '   ' }, 'sem-ncm'));
check('NCM nulo também', tem({ ...completo, ncm: null }, 'sem-ncm'));

// Preço em texto é o que chega de um <input type="number"> vazio ou de um JSON
// antigo. `toNumber` resolve, e é por isso que o predicado o usa em vez de `>`
// direto: '0' > 0 é false em JS, mas '' > 0 também, e 'abc' > 0 idem — os três
// SÃO pendência, e por acidente acertariam. `'200' > 0` é true, e esse acerta
// por acidente também. O que não pode é depender do acidente.
check('preço "0" (texto) é pendência', tem({ ...completo, salePrice: '0' }, 'sem-preco'));
check('preço "200" (texto) NÃO é pendência', !tem({ ...completo, salePrice: '200' }, 'sem-preco'));
check('preço negativo é pendência', tem({ ...completo, salePrice: -5 }, 'sem-preco'));

console.log('\n--- 2. o que NÃO filtra, não esconde ---');
check('chave vazia devolve todo mundo', tem(semPreco, '') && tem(completo, ''));
check('chave DESCONHECIDA devolve todo mundo', tem(completo, 'semPreco'),
  'um parametro errado na URL nao pode dizer "cadastro completo"');
check('  inclusive para quem tem pendência', tem(semPreco, 'chave-que-nao-existe'));

console.log('\n--- 3. as três pendências têm rótulo ---');
for (const [chave, def] of Object.entries(PENDENCIAS_DE_CADASTRO)) {
  check(`${chave} tem rótulo e teste`, Boolean(def.rotulo) && typeof def.testar === 'function', def.rotulo);
}
check('são exatamente três', Object.keys(PENDENCIAS_DE_CADASTRO).length === 3,
  Object.keys(PENDENCIAS_DE_CADASTRO).join(', '));
check('"qualquer" NÃO é uma delas', !PENDENCIAS_DE_CADASTRO.qualquer,
  'e o OU das tres, nao uma quarta pendencia');

// ---------------------------------------------------------------------------
console.log('\n--- 4. as duas rotas usam o MESMO predicado ---');

const servidor = semComentarios(fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8'));
const chamadas = (servidor.match(/stockCore\.temPendenciaDeCadastro\(/g) || []).length;
check('temPendenciaDeCadastro é chamado no servidor', chamadas >= 2, `${chamadas} chamada(s)`);
// `salePrice < 0` NÃO conta: é a guarda de preço negativo do Gestor de Preços,
// outra pergunta. O que não pode voltar é `<= 0`, que é a pendência reescrita.
check('nenhuma rota reimplementa "sem preço"',
  !/salePrice\s*<=\s*0/.test(servidor) && !/!\(\s*[\w.]*salePrice[^)]*>\s*0\s*\)/.test(servidor),
  'a regra tem um dono so');

/**
 * O PEDAÇO DE UMA ROTA vai da sua linha `if (pathname === ...)` até a próxima.
 *
 * Cortar no primeiro `sendJson` não serve: o primeiro de toda rota é o
 * `{ error: 'Sem permissão' }, 403` da segunda linha, e o trecho sairia com 200
 * caracteres. Foi o que estes checks fizeram na primeira versão deste arquivo —
 * cinco falsos negativos de uma vez.
 */
function pedacoDaRota(assinatura) {
  const inicio = servidor.indexOf(assinatura);
  if (inicio < 0) return '';
  const resto = servidor.slice(inicio + assinatura.length);
  const fim = resto.search(/\n {2}if \(pathname/);
  return assinatura + (fim < 0 ? resto : resto.slice(0, fim));
}

const trechoProdutos = pedacoDaRota("pathname === '/api/stock/products' && req.method === 'GET'");
check('a rota de Produtos foi localizada', trechoProdutos.length > 500, `${trechoProdutos.length} chars`);
check('Produtos lê o parâmetro pendencia', /searchParams\.get\('pendencia'\)/.test(trechoProdutos));
check('Produtos filtra por ele', /temPendenciaDeCadastro\(p, pendencia\)/.test(trechoProdutos));

const trechoGestor = pedacoDaRota("pathname === '/api/stock/price-manager' && req.method === 'GET'");
check('a rota do Gestor foi localizada', trechoGestor.length > 500, `${trechoGestor.length} chars`);
check('Gestor de Preços lê o parâmetro', /searchParams\.get\('pendencia'\)/.test(trechoGestor));
check('Gestor de Preços filtra por ele', /temPendenciaDeCadastro\(p, pendencia\)/.test(trechoGestor));

console.log('\n--- 5. a contagem sai do servidor, não do navegador ---');
check('a rota devolve `pendencias`', /pendencias\b/.test(trechoProdutos) && /total: list\.length, pendencias/.test(trechoProdutos));
check('e conta varrendo PENDENCIAS_DE_CADASTRO',
  /Object\.keys\(stockCore\.PENDENCIAS_DE_CADASTRO\)/.test(trechoProdutos),
  'uma pendencia nova entra na contagem sem tocar nesta rota');
check('inclusive "qualquer"', /pendencias\.qualquer = /.test(trechoProdutos));

// A ORDEM IMPORTA e é o ponto mais fácil de estragar numa refatoração: contar
// DEPOIS de aplicar o próprio filtro daria sempre o tamanho da lista, e o
// cartão diria "3.078 com pendência" numa tela mostrando 3.078 produtos
// filtrados — um número que concorda consigo mesmo e não informa nada.
const posContagem = trechoProdutos.indexOf('pendencias[chave] =');
const posFiltro = trechoProdutos.indexOf('temPendenciaDeCadastro(p, pendencia)');
check('conta ANTES de aplicar o filtro de pendência',
  posContagem > 0 && posFiltro > posContagem, `contagem em ${posContagem}, filtro em ${posFiltro}`);

const posDeposito = trechoProdutos.indexOf('b.depositId === depositId');
check('e DEPOIS dos outros filtros',
  posDeposito > 0 && posContagem > posDeposito,
  'a pergunta e "nesta selecao, quantos estao incompletos?"');

// ---------------------------------------------------------------------------
console.log('\n--- 6. as duas telas oferecem a fila ---');

const telaProdutos = fs.readFileSync(path.join(RAIZ, 'public/modules/stock/subs/products.js'), 'utf8');
const telaGestor = fs.readFileSync(path.join(RAIZ, 'public/modules/stock/subs/price_manager.js'), 'utf8');

for (const [nome, fonte] of [['Produtos', telaProdutos], ['Gestor de Preços', telaGestor]]) {
  const codigo = semComentarios(fonte);
  check(`${nome}: tem o <select> de pendência`, /name="pendencia"|id="priceManagerPendencia"/.test(codigo));
  for (const chave of ['qualquer', 'sem-preco', 'sem-custo', 'sem-ncm']) {
    check(`${nome}: oferece ${chave}`, codigo.includes(`value="${chave}"`));
  }
  check(`${nome}: manda o parâmetro ao servidor`, /pendencia/.test(codigo));
}

// Produtos manda o filtro por varrer o objeto `filters` — então a chave tem de
// estar LÁ, e não só no <select>. Um <select> sem a chave no objeto renderiza,
// muda, e não filtra nada.
const codigoProdutos = semComentarios(telaProdutos);
check('Produtos: `pendencia` está no objeto filters',
  /const filters = \{[^}]*pendencia: ''/.test(codigoProdutos));

// O Gestor de Preços NÃO varre um objeto: cada filtro é uma linha no load() e
// um handler. Faltando um dos dois, o filtro aparece e não funciona.
const codigoGestor = semComentarios(telaGestor);
check('Gestor: monta o params com pendencia', /params\.set\('pendencia', pendencia\)/.test(codigoGestor));
check('Gestor: tem o handler de change', /priceManagerPendencia'\)\?\.addEventListener\('change'/.test(codigoGestor));
check('Gestor: e o handler volta para a página 1',
  /priceManagerPendencia[\s\S]{0,260}pagina = 1/.test(codigoGestor),
  'filtrar na pagina 30 mostraria "nenhum produto encontrado"');

console.log('\n--- 7. o cartão não reimplementa a regra ---');
check('a tela lê `res.pendencias` do servidor', /res\.pendencias/.test(codigoProdutos));
check('e não calcula pendência por conta própria',
  !/salePrice[^)]*<=\s*0/.test(codigoProdutos) && !/filter\(\(p\) => !p\.ncm/.test(codigoProdutos));
check('o cartão mostra o total da seleção', /pendencias\.qualquer/.test(codigoProdutos));

console.log('\n--- 8. a descrição do menu diz o que a tela FAZ ---');
// Esta tela e' uma CONSULTA de posicao de um produto. A descricao antiga
// ("Situacoes que um produto pode assumir") prometia um CADASTRO de status --
// o tipo de rotulo errado que manda a pessoa procurar uma tela que nao existe.
const app = fs.readFileSync(path.join(RAIZ, 'public/app.js'), 'utf8');
const linhaStatus = app.split('\n').find((l) => l.includes("key: 'product_status'")) || '';
check('product_status não promete mais um cadastro de situações',
  !/Situações que um produto pode assumir/.test(linhaStatus), linhaStatus.trim().slice(0, 100));
check('e fala de posição/saldo/histórico',
  /Posição|saldo|histórico/i.test(linhaStatus));

const telaStatus = fs.readFileSync(path.join(RAIZ, 'public/modules/stock/subs/product_status.js'), 'utf8');
check('  que é o que a própria tela diz no subtítulo',
  /Posição atual e histórico/.test(telaStatus));

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
process.exit(falhas === 0 ? 0 : 1);
