#!/usr/bin/env node
/**
 * O PCP NÃO MEXE NO ESTOQUE ÀS ESCURAS (fase BP).
 *
 * Seis defeitos do apontamento de produção, todos reproduzidos num banco de
 * prova com `git stash` para medir o antes.
 *
 * 1. O MOVIMENTO NASCIA SEM COR — e o saldo por cor parava de fechar.
 *
 *    A ficha técnica (pcp_bom) não tem coluna de cor, a ordem também não, e
 *    registrarMovimentoEstoque era chamado sem classValueId. Medido, com um
 *    componente controlado por COR que tinha 30 Azuis e 30 sem cor:
 *
 *      antes  apontar 10 -> ACEITOU. Consumo saiu do balde "sem cor";
 *             Azul continuou dizendo 30 com 10 unidades já consumidas.
 *             Vender 30 Azuis passaria, e o total do produto iria a negativo.
 *      depois recusa nomeando a classe e mandando lançar pela tela de
 *             Movimentações, que é onde dá para escolher a cor.
 *
 *    RECUSAR, e não inventar uma cor: dar cor à ficha técnica e à ordem é
 *    feature, não conserto. É a mesma resposta que a entrada por NF-e já dá ao
 *    mesmo problema — o XML também não traz cor.
 *
 * 2. EXCLUIR A ORDEM APAGAVA OS APONTAMENTOS POR CASCADE, SEM ESTORNAR NADA.
 *
 *      antes  DELETE /api/pcp/orders/<id> -> {"ok":true}
 *             componente seguiu consumido, e ficaram 2 movimentos apontando
 *             para uma OP que não existe mais
 *      depois 409 mandando excluir os apontamentos primeiro
 *
 *    Recusar em vez de estornar em cascata: excluir apontamento a apontamento
 *    já estorna, e é o caminho em que a pessoa vê o que está desfazendo.
 *
 * 3. TROCAR O APONTAMENTO DE ORDEM ERAM DUAS ESCRITAS SOLTAS. O estorno da
 *    antiga commitava; se a nova fosse recusada por falta de componente, a rota
 *    devolvia 400 e o estorno FICAVA. A tela mostrava o apontamento intacto na
 *    ordem antiga, com o estoque mexido pelas costas.
 *
 * 4. A SUFICIÊNCIA ERA CONFERIDA CONTRA O TOTAL, mas o movimento nasce no
 *    depósito PADRÃO do produto. Com o estoque todo em outro depósito, o
 *    consumo passava e o padrão ficava negativo — e a partir dali qualquer
 *    saída dele era recusada.
 *
 * 5. ORDEM CANCELADA CONTINUAVA ACEITANDO APONTAMENTO, e passava a exibir
 *    "Produzido: 50" com a etiqueta Cancelada ao lado.
 *
 * 6. A RECUSA DO ESTORNO VINHA INVERTIDA: quem excluía um apontamento cujo
 *    produto acabado já fora vendido lia "dê entrada no componente antes de
 *    apontar" — ação errada, produto errado, saída errada.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const src = ler('server.js');
const corpoDe = (nome) => {
  const m = new RegExp(`(?:async )?function ${nome}\\([\\s\\S]*?\\n\\}`).exec(src);
  return m ? m[0] : '';
};
const consumo = corpoDe('aplicarConsumoDeProducao');
check('achei aplicarConsumoDeProducao', consumo.length > 500, `${consumo.length} caracteres`);

console.log('--- 1. produto controlado por classe é recusado ---');
check('a ficha de classes do produto é consultada', /await classesDb\.classesDoProduto\(produtoId\)/.test(consumo));
check('  e classe obrigatória recusa o apontamento',
  /const obrigatoria = \(classes \|\| \[\]\)\.find\(\(c\) => c\.required\);\s*\n\s*if \(obrigatoria\) \{/.test(consumo));
// Nomear a classe e dizer por onde lançar: "não pode" sem alternativa deixa a
// pessoa tentando de novo.
check('  nomeando a classe e o caminho alternativo',
  /\$\{obrigatoria\.name\}/.test(consumo) && /tela de Movimentações/.test(consumo));
// Tabela de classes fora do ar não pode travar o PCP inteiro.
check('  e degrada se a consulta de classes falhar', /catch \(erroClasses\) \{\s*\n\s*classes = \[\];/.test(consumo));

console.log('--- 2. excluir a ordem com apontamento é recusado ---');
check('o DELETE trata pcp/orders', /if \(recurso === 'pcp\/orders'\) \{[\s\S]{0,300}?apontamentos\.length/.test(src));
check('  recusando com 409', /ou cancele a ordem em vez de excluí-la\.'\s*\n\s*\}, 409\);/.test(src));
check('  e dizendo quanto já foi produzido', /\(\$\{total\} produzido\)/.test(src));

console.log('--- 3. trocar de ordem não deixa o estorno órfão ---');
const rotaModulos = src.slice(src.indexOf('// Trocou de ordem') - 2000, src.indexOf('// Trocou de ordem') + 2500);
check('a segunda perna fica dentro de um try', /try \{\s*\n\s*await mexerNoEstoqueDaProducao\(novaOrdem, novaQtd, usuarioDaRequisicao\);\s*\n\s*\} catch \(erroDaNova\)/.test(src));
// O estorno é exatamente simétrico: o movimento contrário do que acabou de ser
// gravado, com os mesmos números. Por isso dá para refazê-lo.
check('  e o estorno é refeito quando ela falha',
  /await mexerNoEstoqueDaProducao\(anterior\.orderId, Number\(anterior\.quantity \|\| 0\), usuarioDaRequisicao\);/.test(src));
// Falhar ao refazer é o caso em que o usuário PRECISA saber das duas coisas.
check('  e se nem isso passar, o erro diz as duas coisas',
  /erroDaNova\.message \+= ' ATENÇÃO: o estorno na ordem anterior/.test(src));

console.log('--- 4. o depósito do movimento é o que limita ---');
check('a projeção olha o depósito padrão do produto',
  /const depositoDoMovimento = stockCore\.productMeta\(data, produtoId\)\.defaultDepositId \|\| '';/.test(consumo));
check('  e recusa quando ele ficaria negativo',
  /if \(noDeposito \+ variacao < 0\) \{/.test(consumo));
// Sem depósito padrão o movimento cai no saldo não alocado: cobrar um depósito
// que não existe travaria quem nunca usou o campo.
check('  só quando existe depósito padrão', /if \(depositoDoMovimento && variacao < 0\)/.test(consumo));
check('  nomeando o depósito na mensagem', /que é o depósito padrão dele/.test(consumo));
// A projeção soma data.stockMovements: sem o razão em memória ela leria zero.
check('e o razão entra em memória antes de projetar',
  /await Promise\.all\(\[sincronizarRazao\(data\), syncCadastroData\(data\)\]\);/.test(corpoDe('mexerNoEstoqueDaProducao')));

console.log('--- 5. ordem fechada não aceita apontamento ---');
const aceita = corpoDe('ordemAceitaApontamento');
check('ordemAceitaApontamento existe', aceita.length > 0);
check('  recusa cancelada', /if \(status === 'cancelada'\)/.test(aceita));
check('  e concluída', /if \(status === 'concluida'\)/.test(aceita));
// Ordem inexistente não é assunto desta guarda: quem trata é o próprio
// mexerNoEstoqueDaProducao, que sai calado, e a chave estrangeira.
check('  mas não inventa recusa para ordem inexistente', /if \(!ordem\) return '';/.test(aceita));
check('o POST a consulta', /if \(recurso === 'pcp\/entries'\) \{\s*\n\s*const recusa = await ordemAceitaApontamento\(corpo\.orderId\);/.test(src));
check('  e o PUT também', /const recusa = await ordemAceitaApontamento\(novaOrdem\);/.test(src));

console.log('--- 6. a recusa do estorno fala do estorno ---');
check('a mensagem ramifica pelo sentido', /const desfazendo = quantidade < 0;/.test(consumo));
check('  desfazer diz que a saída precisa ser estornada antes',
  /estorne a saída antes de desfazer o apontamento/.test(consumo));
// A mesma verificação cobre produto final e componente: chamar os dois de
// "componente" mandava o usuário dar entrada no que ele produziu.
check('  e apontar distingue produto de componente',
  /\$\{ehProdutoFinal \? 'produto' : 'componente'\}/.test(consumo));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
