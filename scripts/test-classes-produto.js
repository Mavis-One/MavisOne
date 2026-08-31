#!/usr/bin/env node
// Classes de produto — camada de dados (COR e, no futuro, VOLTAGEM/TAMANHO).
//
// O PROBLEMA QUE ELAS RESOLVEM
// ----------------------------
// Um mesmo produto existe em cores diferentes, e cada cor tem saldo próprio.
// Sem isso as saídas são ruins: cadastrar quatro produtos ("Godzilla Preto",
// "Godzilla Branco"...), o que quadruplica o cadastro e quebra todo relatório
// por produto; ou controlar a cor no papel, e o estoque do sistema deixa de
// valer.
//
// A DECISÃO MAIS IMPORTANTE, E POR QUE ELA CONTRARIA A ESPECIFICAÇÃO
// ------------------------------------------------------------------
// O §7 pedia uma tabela `product_stock_classes` com o saldo por cor gravado.
// Neste sistema o saldo por depósito NÃO é gravado — ele é a soma do razão de
// movimentos (depositBalance, em lib/stock-core.js). Uma tabela de saldo por
// cor seria um TERCEIRO número, capaz de discordar do razão e de
// products.stock_quantity: exatamente a inconsistência que o §8 da própria
// especificação proíbe. O saldo por cor sai da mesma soma que já produz o
// saldo por depósito.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');
const migracao = ler('banco/migrations/fase-ac-classes-de-produto.sql');
const dbSrc = ler('lib/db/classes.js');
const serverSrc = ler('server.js');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log('--- as quatro tabelas do desenho ---');
[
  ['product_classes', 'a classe em si'],
  ['product_class_values', 'os valores dela'],
  ['product_class_assignments', 'quais classes o produto usa'],
  ['product_class_value_assignments', 'quais valores o produto oferece']
].forEach(([tabela, papel]) => {
  check(`${tabela} (${papel})`, new RegExp(`create table if not exists ${tabela} \\(`).test(migracao));
});
// Catálogo global + atribuição por produto. Sem a separação, cadastrar uma cor
// nova exigiria repetir a linha em cada produto que a usa.
check('o código explica as duas camadas', /CATÁLOGO/.test(dbSrc) && /ATRIBUIÇÃO/.test(dbSrc));

console.log('\n--- saldo por cor NÃO vira tabela ---');
check('não existe product_stock_classes', !/create table if not exists product_stock_classes/.test(migracao));
// A justificativa precisa estar no arquivo: sem ela, o próximo a ler a
// especificação vai "corrigir" a ausência.
check('a migração explica por que não criou', /TERCEIRO número/.test(migracao));
check('e cita o §8', /§8/.test(migracao));
check('a camada de dados repete o motivo', /O SALDO POR COR NÃO ESTÁ AQUI/.test(dbSrc));

console.log('\n--- §21.1: valor duplicado na mesma classe ---');
// "Preto" e "preto" seriam duas cores para o sistema e uma só para quem vende.
check('índice único por classe + nome', /idx_product_class_values_nome[\s\S]{0,80}\(class_id, lower\(name\)\)/.test(migracao));
check('usa lower, então a caixa não engana', /lower\(name\)/.test(migracao));
check('código também é único na classe', /idx_product_class_values_codigo[\s\S]{0,90}upper\(code\)/.test(migracao));
// Dois valores sem código conviveriam; dois com código '' colidiriam.
check('código vazio vira NULL', /\.toUpperCase\(\) \|\| null/.test(dbSrc));
check('e o índice ignora nulos', /where code is not null/.test(migracao));

console.log('\n--- §21.2: mesma classe duas vezes no produto ---');
// Duas atribuições da mesma classe dariam duas listas de cor na tela de venda.
check('índice único produto + classe', /idx_product_class_assign_unico[\s\S]{0,80}\(product_id, class_id\)/.test(migracao));
check('e produto + valor', /idx_product_class_value_assign_unico[\s\S]{0,90}\(product_id, class_value_id\)/.test(migracao));

console.log('\n--- §21.5 e §21.6: histórico não se apaga ---');
// Apagar a classe COR levaria junto o registro de qual cor cada movimento teve.
check('classe usada por valor é RESTRICT', /references product_classes\(id\) on delete restrict/.test(migracao));
const restricts = (migracao.match(/on delete restrict/g) || []).length;
check('todas as referências à classe/valor são RESTRICT', restricts >= 4, `${restricts} restrict(s)`);
// Excluir o PRODUTO deve limpar as atribuições dele — elas não são histórico.
check('produto excluído limpa as atribuições', (migracao.match(/references products\(id\) on delete cascade/g) || []).length === 2);
// O erro cru do Postgres fala em nome de índice, que não diz nada a quem
// cadastrou uma cor.
check('erro de uso vira mensagem legível', /Desative-a em vez de excluir/.test(dbSrc));
check('e explica o porquê', /o histórico de estoque depende dela/.test(dbSrc));
check('duplicata também', /assertSemDuplicata/.test(dbSrc) && /Já existe/.test(dbSrc));

console.log('\n--- §21.9: uma classe serve a vários produtos ---');
// Nada pode impedir isso — o único índice em assignments é (produto, classe).
check('nenhum índice único só por class_id',
  !/create unique index[^;]*product_class_assignments \(class_id\)/.test(migracao));

console.log('\n--- empresa: o campo existe, mas não obriga ---');
// `products` não tem empresa: um produto é global aqui. Classe obrigatoriamente
// por empresa deixaria produto global apontando para classe de uma empresa só.
check('company_id existe', /company_id text,/.test(migracao));
check('e é opcional', !/company_id text not null/.test(migracao));
check('o motivo está escrito', /um produto é global neste sistema/.test(migracao));
// NULL nunca é igual a NULL num índice: sem coalesce, dez classes globais
// chamadas COR passariam.
check('unicidade trata o nulo', /coalesce\(company_id, ''\)/.test(migracao));

console.log('\n--- semente: COR já vem pronta ---');
// Exigir que o usuário crie "Preto" antes de poder usar a funcionalidade é
// atrito no primeiro minuto.
check('a classe COR é cadastrada', /insert into product_classes[\s\S]{0,160}'COR'/.test(migracao));
['Preto', 'Branco', 'Vermelho', 'Azul', 'Cinza'].forEach((cor) => {
  check(`  ${cor}`, new RegExp(`'${cor}'`).test(migracao));
});
// O hex alimenta a bolinha de cor na tela.
check('cada cor traz o hex', (migracao.match(/"hex":"#/g) || []).length === 5);
check('a camada de dados expõe o hex pronto', /hex: \(row\.metadata && row\.metadata\.hex\) \|\| ''/.test(dbSrc));

console.log('\n--- idempotência ---');
check('create table if not exists', (migracao.match(/create table if not exists/g) || []).length === 4);
check('create unique index if not exists', /create unique index if not exists/.test(migracao));
check('inserts com on conflict', (migracao.match(/on conflict \(id\) do update/g) || []).length === 2);

console.log('\n--- atribuição: estado final, não diferença ---');
// A tela manda o conjunto completo; um diff aqui teria de adivinhar o que foi
// tirado. As linhas não são histórico — quem guarda histórico é o movimento.
check('apaga e regrava', /apagarValores[\s\S]{0,400}apagarClasses[\s\S]{0,400}insert\(linhasClasse\)/.test(dbSrc));
check('e explica por que não faz diff', /Apaga e regrava em vez de calcular diferença/.test(dbSrc));
// Valor desativado some da escolha, mas o movimento antigo continua íntegro.
check('valor inativo some da lista do produto', /\.filter\(\(v\) => v && v\.active\)/.test(dbSrc));

console.log('\n--- rotas ---');
check('catálogo de classes', /pathname === '\/api\/stock\/classes' && req\.method === 'GET'/.test(serverSrc));
check('criar classe', /pathname === '\/api\/stock\/classes' && req\.method === 'POST'/.test(serverSrc));
check('criar valor', /pathname === '\/api\/stock\/classes\/valores' && req\.method === 'POST'/.test(serverSrc));
check('classes do produto', /\^\\\/api\\\/stock\\\/products\\\/\[\^\/\]\+\\\/classes\$/.test(serverSrc));
// A rota de valores tem de ser testada ANTES da de classe/:id, senão
// "valores" seria lido como o id de uma classe.
check('valores vem antes de classes/:id',
  serverSrc.indexOf("pathname.startsWith('/api/stock/classes/valores/')") < serverSrc.indexOf("pathname.startsWith('/api/stock/classes/')"));
check('exige permissão de estoque', /allowedModules\.includes\('stock'\)/.test(serverSrc));
// O catálogo devolve classes e valores juntos: duas chamadas fariam a lista
// piscar meia preenchida.
check('classe e valores vêm na mesma resposta', /valores: valores\.filter\(\(v\) => v\.classId === c\.id\)/.test(serverSrc));
// A tela de Classes salva sozinha, sem reenviar o resto do cadastro.
check('a atribuição tem rota própria', /Rota separada da do produto/.test(serverSrc));

console.log('\n=== CADASTRO DO PRODUTO (camada 2) ===\n');
const telaSrc = ler('public/modules/stock/subs/new_product.js');
const cssSrc = ler('public/app.css');

console.log('--- só na edição ---');
// A atribuição aponta para o id do produto, que não existe antes de salvar.
// Oferecer as cores num produto inexistente daria uma escolha que se perderia.
check('busca as classes só com produto carregado', /if \(current\) \{\s*\n\s*try \{\s*\n\s*const \[cat, doProduto\] = await Promise\.all/.test(telaSrc));
check('e explica por quê', /aponta para o id do produto/.test(telaSrc));
check('produto novo avisa para salvar antes', /Salve o produto primeiro/.test(telaSrc));
// Sem as classes o resto do cadastro continua salvável.
check('falha de classe não impede cadastrar', /catch \(error\) \{[\s\S]{0,180}catalogoClasses = \[\];/.test(telaSrc));
// Antes esta tela mandava rodar a migração à mão — instrução inútil para quem
// não tem acesso ao banco. Agora o caminho é a própria tela de catálogo.
check('sem classes, oferece cadastrá-las', /id="produtoIrParaClasses">Cadastrar classes e cores</.test(telaSrc));
check('e não manda mais rodar SQL na mão', !/fase-ac-classes-de-produto\.sql/.test(telaSrc));

console.log('\n--- marcar a classe revela os valores ---');
check('a caixa da classe alterna os valores', /valores\.hidden = !caixa\.checked/.test(telaSrc));
// Quem desmarca por engano e remarca não pode perder as cores que escolheu.
check('desmarcar NÃO limpa as escolhas', /NÃO limpa/.test(telaSrc));
check('a borda acesa mostra as classes em uso', /\.classe-bloco\.is-ativa \{ border-color: var\(--primary\)/.test(cssSrc));

console.log('\n--- classe sem valor não é salva ---');
// Um produto que "usa COR" mas não oferece cor nenhuma travaria a venda, que
// pediria uma escolha sem opções.
check('filtra classe sem valor marcado', /\.filter\(\(c\) => c\.valores\.length\)/.test(telaSrc));
check('e o motivo está escrito', /travaria a venda/.test(telaSrc));

console.log('\n--- um clique salva as duas coisas ---');
// Dois botões de salvar na mesma tela fariam metade do cadastro se perder por
// quem clicasse no errado.
check('salva o produto e depois as classes', /await api\('\/api\/stock\/products'[\s\S]{0,600}\/classes`, \{\s*\n\s*method: 'PUT'/.test(telaSrc));
// O produto já foi gravado quando as classes falham — "erro ao salvar" seria
// mentira, e o usuário reenviaria tudo.
check('falha nas classes diz o que ficou para trás', /Produto salvo, mas as classes não/.test(telaSrc));

console.log('\n--- a cor é visível, não só o nome ---');
check('amostra de cor pelo hex', /classe-amostra" style="background:\$\{S\.escape\(valor\.hex\)\}/.test(telaSrc));
// Branco sobre painel claro sumiria sem borda própria.
check('a amostra tem borda', /\.classe-amostra \{[\s\S]*?border: 1px solid var\(--border\)/.test(cssSrc));
check('valor marcado se destaca', /\.classe-valor:has\(input:checked\)/.test(cssSrc));

console.log('\n=== SALDO POR COR (camada 3) ===\n');
const S = require('../lib/stock-core');

// Razão com duas cores, dois depósitos e um movimento ANTIGO sem cor — o que
// existia antes de o produto passar a controlar por classe.
const razao = {
  deposits: [{ id: 'd1', name: 'Joinville' }, { id: 'd2', name: 'Timbó' }],
  stockMovements: [
    { productId: 'p1', depositId: 'd1', type: 'entrada', quantity: 10, classValueId: 'preto' },
    { productId: 'p1', depositId: 'd1', type: 'entrada', quantity: 5, classValueId: 'branco' },
    { productId: 'p1', depositId: 'd1', type: 'saida', quantity: 2, classValueId: 'preto' },
    { productId: 'p1', depositId: 'd2', type: 'entrada', quantity: 3, classValueId: 'preto' },
    { productId: 'p1', depositId: 'd1', type: 'entrada', quantity: 7 }
  ]
};

console.log('--- o saldo por cor sai do mesmo razão ---');
check('preto num depósito', S.classValueBalance(razao, 'p1', 'preto', 'd1') === 8, String(S.classValueBalance(razao, 'p1', 'preto', 'd1')));
check('preto somando os depósitos', S.classValueBalance(razao, 'p1', 'preto') === 11, String(S.classValueBalance(razao, 'p1', 'preto')));
check('cor inexistente dá zero', S.classValueBalance(razao, 'p1', 'roxo') === 0);
const quebra = S.classBalances(razao, 'p1');
check('quebra traz as duas cores', quebra.valores.length === 2, JSON.stringify(quebra.valores));
// Escondê-lo faria o total do produto parecer errado.
check('movimento antigo sem cor aparece', quebra.semClasse === 7, String(quebra.semClasse));

console.log('\n--- os dois números NÃO podem divergir ---');
// É o ponto da decisão: mesma soma, filtro diferente. Uma tabela de saldo por
// cor seria um terceiro número atualizado por outro caminho.
const somaDepositos = S.depositBalance(razao, 'p1', 'd1') + S.depositBalance(razao, 'p1', 'd2');
check('soma dos depósitos = soma das cores', somaDepositos === quebra.total, `${somaDepositos} vs ${quebra.total}`);
check('e o código explica por quê', /MESMA SOMA do saldo por depósito/.test(ler('lib/stock-core.js')));

console.log('\n--- a quebra varre o razão, não o cadastro ---');
// Uma cor tirada do cadastro mas ainda com saldo precisa aparecer, senão o
// total do produto não fecha e ninguém descobre onde sumiu.
const comCorRemovida = S.classBalances({
  deposits: [{ id: 'd1' }],
  stockMovements: [{ productId: 'p1', depositId: 'd1', type: 'entrada', quantity: 4, classValueId: 'cor_apagada' }]
}, 'p1');
check('cor fora do cadastro ainda soma', comCorRemovida.total === 4 && comCorRemovida.valores[0].classValueId === 'cor_apagada');
check('e o motivo está escrito', /Varre o RAZÃO, e não a lista de valores/.test(ler('lib/stock-core.js')));

console.log('\n--- §21.3 e §21.4: saída não pode furar o saldo DA COR ---');
// Validar só o total deixaria vender 10 pretos existindo 2 pretos e 8 brancos:
// o total fecharia e o preto ficaria negativo.
check('a saída valida o saldo da cor', /const disponivel = stockCore\.classValueBalance\(data, productId, classValueId, depositId\)/.test(serverSrc));
check('e o erro nomeia a cor', /Saldo insuficiente de \$\{nome\} em \$\{deposit\.name\}/.test(serverSrc));
check('o motivo está no código', /existindo 2 pretos e 8 brancos/.test(serverSrc));
// Produto sem classe continua validando pelo total, como sempre (§9).
check('sem cor, valida o total como antes', /const available = stockCore\.depositBalance\(data, productId, depositId\)/.test(serverSrc));

console.log('\n--- valor precisa ser um que o produto oferece ---');
// Um id qualquer criaria saldo de uma cor que o produto não tem — e o total
// continuaria fechando, escondendo o erro.
check('recusa valor não atribuído', /Este valor de classe não está disponível para o produto/.test(serverSrc));
// Produto com classe obrigatória exige a escolha, senão o saldo cai no
// "sem cor" e some da quebra.
check('classe obrigatória exige o valor', /Este produto é controlado por \$\{obrigatoria\.name\}/.test(serverSrc));

console.log('\n--- §18: a cor atravessa a transferência ---');
// Sem isto, transferir 4 pretos tiraria 4 pretos da origem e daria 4 SEM COR
// ao destino: o total do produto continuaria certo e o preto sumiria.
check('os dois movimentos levam a cor', /classId: body\.classId \|\| '',\s*\n\s*classValueId: body\.classValueId \|\| ''\s*\n\s*\};/.test(serverSrc));
check('a transferência valida o saldo da cor na origem', /type: 'saida',\s*\n\s*quantity: body\.quantity,\s*\n\s*classValueId: body\.classValueId/.test(serverSrc));
// A tela de transferências lista do registro, não dos movimentos.
check('o registro da transferência guarda a cor', /tela de transferências lista daqui/.test(serverSrc));

console.log('\n--- estorno respeita a cor ---');
// Estornar a entrada de 10 pretos quando 8 já saíram deixaria o preto em -8,
// mesmo com o total do produto positivo por causa das outras cores.
check('estorno usa o saldo da cor', /movement\.classValueId\s*\n?\s*\? stockCore\.classValueBalance\(data, movement\.productId, movement\.classValueId, movement\.depositId\)/.test(serverSrc));

console.log('\n--- §9: produto sem classe não muda ---');
const semClasse = {
  deposits: [{ id: 'd1' }],
  stockMovements: [{ productId: 'parafuso', depositId: 'd1', type: 'entrada', quantity: 500 }]
};
check('saldo continua o de sempre', S.depositBalance(semClasse, 'parafuso', 'd1') === 500);
const quebraSemClasse = S.classBalances(semClasse, 'parafuso');
// "Não criar registros desnecessários" — sem cor, não há linha de cor.
check('não inventa linha de cor', quebraSemClasse.valores.length === 0);
check('e o total fecha assim mesmo', quebraSemClasse.total === 500);
// Falha do catálogo não pode travar quem não usa classe nenhuma.
check('falha de catálogo não trava o movimento', /catch \(erroClasses\) \{\s*\n\s*classesDoProduto = \[\];/.test(serverSrc));

console.log('\n--- o movimento carrega a cor ---');
check('buildMovementRecord grava classValueId', /classValueId: classValueId \|\| '',/.test(serverSrc));
check('serializeMovement devolve a cor', /classValueId: movement\.classValueId \|\| '',/.test(ler('lib/stock-core.js')));
// Buscar o catálogo por movimento seria uma consulta por linha da tabela.
check('o nome da cor é resolvido por quem exibe', /O NOME da cor vem de fora/.test(ler('lib/stock-core.js')));
check('o produto expõe a quebra', /classBalances: classBalances\(data, product\.id\)/.test(ler('lib/stock-core.js')));

console.log('\n--- §12 e §13: escolher a cor na venda ---');
const appSrc = ler('public/app.js');
// A cor tem de ficar no ITEM. Se ficasse no produto, o mesmo produto em duas
// cores viraria uma linha só e a segunda cor sumiria do pedido.
check('o item da venda guarda a cor', /classValueId,\s*\n\s*\/\/ O nome fica gravado no item/.test(appSrc));
check('o payload da venda envia a cor', /classValueId: item\.classValueId \|\| '',/.test(appSrc));
check('o servidor aceita a cor no item', /classValueId: item\.classValueId \|\| '',/.test(serverSrc));
// Nome gravado junto: pedido antigo continua dizendo "Preto" mesmo se a cor
// for desativada no catálogo depois.
check('e o nome da cor viaja com o item', /classValueName: String\(item\.classValueName \|\| ''\)\.trim\(\),/.test(serverSrc));
// Classe obrigatória sem cor escolhida cairia no saldo "sem cor".
check('a venda exige a cor quando é obrigatória', /Selecione \$\{classe\.name\.toLowerCase\(\)\} para este produto/.test(appSrc));
// O campo só aparece para produto que tem cor — o resto do catálogo não ganha
// um campo vazio permanente.
// Uma linha de adicionar produto por venda -- os grupos de produtos (fase AH)
// foram retirados da tela, e com eles o sufixo que separava um campo do outro.
check('o campo de cor é condicional', /id="salesClassField" hidden/.test(appSrc));

console.log('\n--- §12: o saldo mostrado é o DA COR ---');
// Mostrar o saldo geral numa linha colorida é sempre um número maior que o
// real: o item passaria na tela e o faturamento recusaria.
check('a linha do item mede o saldo da cor', /const registro = classesPorProduto\.get\(item\.productId\);\s*\n\s*if \(!registro\) return null;\s*\n\s*return Number\(registro\.saldos\[item\.classValueId\] \|\| 0\);/.test(appSrc));
check('sem o dado, não inventa número', /\$\{semCadastro \|\| saldoDesconhecido \? '-' : salesFormatQty\(livre\)\}/.test(appSrc));
check('o alerta de saldo usa a mesma conta', /const livre = disponivelDoItem\(item\);\s*\n\s*return livre !== null && Number\(item\.quantity \|\| 0\) > livre;/.test(appSrc));
// A rota do produto devolve saldo junto com as classes: duas chamadas fariam a
// lista abrir sem os números.
check('a rota devolve classes e saldos juntos', /return sendJson\(res, \{ classes, saldos, semClasse: quebra\.semClasse \}\);/.test(serverSrc));
// Vender exige LER as cores; alterar a atribuição continua sendo do Estoque.
check('vendas pode ler as cores do produto', /user\.allowedModules\.includes\('stock'\) \|\| user\.allowedModules\.includes\('sales'\)/.test(serverSrc));
check('mas só o Estoque altera', /req\.method !== 'GET' && !user\.allowedModules\.includes\('stock'\)/.test(serverSrc));

console.log('\n--- §14: o faturamento baixa DA COR ---');
// A projeção por produto deixaria faturar 3 pretos existindo 10 no total e 2
// pretos: o total fecharia e o preto ficaria em -1.
check('a projeção é por produto + cor', /const chaveItem = \(item\) => `\$\{item\.productId\}\|\$\{item\.classValueId \|\| ''\}`;/.test(serverSrc));
check('e parte do saldo da cor', /item\.classValueId\s*\n\s*\? stockCore\.classValueBalance\(data, item\.productId, item\.classValueId\)/.test(serverSrc));
check('o erro nomeia a cor', /\$\{cor \? ` \(\$\{cor\}\)` : ''\}/.test(serverSrc));
// Item sem cor continua projetando pelo total — é todo produto sem classe.
check('sem cor, projeta pelo total como antes', /: Number\(produtos\.get\(item\.productId\)\?\.stockQuantity \|\| 0\)\);/.test(serverSrc));
// O movimento gerado pela venda precisa levar a cor, senão a baixa some da
// quebra e o produto perde 3 sem nenhuma cor perder nada.
check('o movimento da venda leva a cor', /classId: classId \|\| '',\s*\n\s*classValueId: classValueId \|\| '',\s*\n\s*quantity: Math\.abs\(delta\)/.test(serverSrc));
// Estornar para o saldo sem cor deixaria a cor devendo para sempre.
check('o estorno devolve para a mesma cor', /O estorno devolve para a MESMA cor/.test(serverSrc));

console.log('\n--- §16 e §17: entrada com cor ---');
const movSrc = ler('public/modules/stock/subs/new_movement.js');
check('a movimentação envia a cor', /classValueId: formData\.get\('classValueId'\) \|\| '',/.test(movSrc));
// O saldo por cor é por depósito: "8 pretos" que estão em outro galpão faria a
// saída ser recusada depois de preenchida.
check('o saldo da cor segue o depósito escolhido', /const query = depositId \? `\?depositId=\$\{encodeURIComponent\(depositId\)\}` : '';/.test(movSrc));
check('e trocar de depósito recarrega', /depositId = event\.target\.value;\s*\n\s*const productId/.test(movSrc));
// Na entrada não há nada a decidir pelo saldo; o número só polui o rótulo.
check('o saldo só aparece na saída', /type === 'saida' \? `\$\{valor\.name\} — \$\{S\.formatQty\(saldo\)\} disponível` : valor\.name/.test(movSrc));
// O razão guarda UMA classe por movimento. Duas classes atribuídas não cabem —
// gravar metade em silêncio é pior do que avisar.
check('avisa quando o produto tem mais de uma classe', /mas a movimentação registra apenas/.test(movSrc));
check('a venda avisa pelo mesmo motivo', /mas o item da venda registra apenas/.test(appSrc));

console.log('\n--- §18: escolher a cor na transferência ---');
const transfSrc = ler('public/modules/stock/subs/new_transfer.js');
check('a transferência envia a cor', /classValueId: formData\.get\('classValueId'\) \|\| '',/.test(transfSrc));
// A tabela de saldo é o que decide de qual depósito tirar. Mostrar o total do
// depósito com uma cor escolhida sugere um saldo que pode não existir na cor.
check('a tabela mostra o saldo da cor escolhida', /const linha = \(balance\.classes \|\| \[\]\)\.find\(\(c\) => c\.classValueId === classValueId\);/.test(transfSrc));
check('e o cabeçalho diz de que cor é o número', /`Saldo de \$\{S\.escape\(cores\.get\(classValueId\)\?\.name \|\| classValueId\)\}`/.test(transfSrc));
// Redesenhar tudo ao trocar a cor apagaria origem, destino e quantidade.
check('trocar de cor não apaga o formulário', /Só a tabela é redesenhada/.test(transfSrc));
check('o registro devolve a cor para a lista', /classValueId: transfer\.classValueId \|\| '',/.test(ler('lib/stock-core.js')));

console.log('\n--- saldo por cor DENTRO do depósito ---');
// Saber que existem 8 pretos não diz de qual galpão dá para tirá-los.
const porDeposito = S.serializeProduct({ id: 'p1', name: 'Godzilla', stockQuantity: 17 }, {
  deposits: [{ id: 'd1', name: 'Galpão A' }, { id: 'd2', name: 'Galpão B' }],
  stockMovements: [
    { productId: 'p1', depositId: 'd1', type: 'entrada', quantity: 10, classValueId: 'preto' },
    { productId: 'p1', depositId: 'd2', type: 'entrada', quantity: 4, classValueId: 'branco' },
    { productId: 'p1', depositId: 'd1', type: 'entrada', quantity: 3 }
  ]
});
const galpaoA = porDeposito.balances.find((b) => b.depositId === 'd1');
const galpaoB = porDeposito.balances.find((b) => b.depositId === 'd2');
check('cada depósito traz a própria quebra', galpaoA.classes[0].classValueId === 'preto' && galpaoA.classes[0].quantity === 10);
check('cor que não está no depósito não aparece', !galpaoB.classes.some((c) => c.classValueId === 'preto'));
// O saldo do depósito inclui o que não tem cor; a quebra não pode contradizê-lo.
check('o depósito soma o saldo sem cor também', galpaoA.quantity === 13);
const somaGalpoes = porDeposito.balances.reduce((s, b) => s + b.quantity, 0);
check('soma dos depósitos fecha com a quebra global', somaGalpoes === porDeposito.classBalances.total);

console.log('\n--- §19: filtrar o razão por cor ---');
check('o servidor filtra por classValueId', /if \(classValueId && classValueId !== '_sem' && movement\.classValueId !== classValueId\) return false;/.test(serverSrc));
// Sem "_sem" não há como achar o saldo herdado que ainda precisa ser classificado.
check('e isola o que ficou sem cor', /if \(classValueId === '_sem' && movement\.classValueId\) return false;/.test(serverSrc));
const movsSrc = ler('public/modules/stock/subs/movements.js');
check('a tela tem o filtro de cor', /<option value="_sem"/.test(movsSrc));
// Quem não usa classe não ganha um campo permanentemente vazio.
check('o filtro só aparece se houver catálogo', /if \(!cores\.size\) return '';/.test(movsSrc));
check('a linha da movimentação mostra a cor', /S\.corBadge\(cores, movement\.classValueId\)/.test(movsSrc));
check('a transferência listada também', /S\.corBadge\(cores, transfer\.classValueId\)/.test(ler('public/modules/stock/subs/transfers.js')));

console.log('\n--- §20: a quebra por cor na lista de produtos ---');
const prodSrc = ler('public/modules/stock/subs/products.js');
check('o saldo mostra a quebra embaixo', /\$\{S\.formatQty\(product\.stockQuantity\)\}\$\{reservaDoProduto\(product\)\}\$\{quebraPorCor\(product\)\}/.test(prodSrc));
// Esconder o "sem cor" faria a soma das cores não bater com o total exibido.
check('o saldo sem cor aparece', /if \(quebra\.semClasse !== 0\) partes\.push/.test(prodSrc));
check('cor zerada não polui a linha', /\.filter\(\(linha\) => linha\.quantity !== 0\)/.test(prodSrc));

console.log('\n--- o nome da cor vem do catálogo, uma vez só ---');
const sharedSrc = ler('public/modules/stock/shared.js');
check('o meta do estoque traz o catálogo', /const catalogo = await classesDb\.listarClasses\(\);/.test(serverSrc));
// Falha do catálogo não pode derrubar o módulo inteiro de Estoque.
check('falha do catálogo não derruba o meta', /\} catch \(erroClasses\) \{\s*\n\s*classes = \[\];/.test(serverSrc));
check('o índice é montado uma vez por tela', /Stock\.indiceDeCores = function indiceDeCores\(meta\)/.test(sharedSrc));
// Sumir com o movimento seria pior: ele existe e alguém precisa rastreá-lo.
check('cor fora do catálogo mostra o id cru', /const nome = valor\?\.name \|\| classValueId;/.test(sharedSrc));
// "Azul Marinho" e "Azul Royal" viram o mesmo quadrado se a cor for inventada.
check('a bolinha só sai com hex cadastrado', /hex \? `<span class="stock-cor-bolinha"/.test(sharedSrc));

console.log('\n--- a tela de catálogo: sem ela nada disso é utilizável ---');
const catSrc = ler('public/modules/stock/subs/classes.js');
const appJs = ler('public/app.js');
const html = ler('public/index.html');
// As rotas de catálogo existiam desde a camada 1 e NADA no front as chamava:
// dava para atribuir cor a produto, vender e transferir por cor, mas não para
// criar a cor. Só por SQL direto no banco.
check('a tela cria classe', /await api\('\/api\/stock\/classes', \{ method: 'POST'/.test(catSrc));
check('a tela cria valor', /await api\('\/api\/stock\/classes\/valores', \{ method: 'POST'/.test(catSrc));
check('a tela edita os dois', /\/api\/stock\/classes\/\$\{encodeURIComponent\(classe\.id\)\}`, \{ method: 'PUT'/.test(catSrc)
  && /\/api\/stock\/classes\/valores\/\$\{encodeURIComponent\(valor\.id\)\}`, \{ method: 'PUT'/.test(catSrc));
check('está no menu do Estoque', /\{ key: 'classes', label: 'Classes de Produto'/.test(appJs));
check('e carregada no index', /modules\/stock\/subs\/classes\.js/.test(html));

console.log('\n--- excluir x desativar ---');
// Excluir o que está em uso deixaria saldo órfão; o servidor recusa (FK) e a
// tela precisa oferecer a saída que a mensagem dele sugere.
check('a listagem inclui os inativos', /api\('\/api\/stock\/classes\?todas=1'\)/.test(catSrc));
check('e o motivo está escrito', /sumir da tela sem nenhum caminho de volta/.test(catSrc));
check('dá para reativar', /Reativar/.test(catSrc));
// A mensagem do servidor explica por que não dá e o que fazer — reescrevê-la
// aqui faria duas explicações divergirem.
check('o erro do servidor é repassado inteiro', /showToast\(error\.message \|\| 'Não foi possível excluir\.'/.test(catSrc));

console.log('\n--- a amostra de cor é opcional de propósito ---');
// <input type="color"> nunca vem vazio: sem a caixa, todo valor nasceria preto
// e um quadrado preto ao lado de "Branco" é pior do que quadrado nenhum.
check('há uma caixa para ligar a amostra', /name="temHex"/.test(catSrc));
check('desmarcar limpa de verdade', /metadata: hex \? \{ hex \} : null/.test(catSrc));

console.log('\n--- o caminho de ida e volta pelo produto ---');
const prodFormSrc = ler('public/modules/stock/subs/new_product.js');
check('o produto leva ao catálogo', /state\.activeSub = 'classes';/.test(prodFormSrc));
// Voltar para a lista de produtos obrigaria a reencontrar o que se editava.
check('e guarda para onde voltar', /state\.stockClassesVoltarPara = \{ sub: 'new_product', productId:/.test(prodFormSrc));
check('a tela devolve ao produto', /state\.stockEditProductId = voltarPara\.productId \|\| null;/.test(catSrc));
// Sair do formulário reconstrói a tela do servidor: o que foi digitado se perde.
check('avisa que perde o que não foi salvo', /Alterações não salvas neste produto serão perdidas/.test(prodFormSrc));
// Consumido na leitura: senão entrar pelo menu meses depois ainda ofereceria
// "voltar ao produto".
check('o retorno é consumido uma vez', /state\.stockClassesVoltarPara = null;/.test(catSrc));

console.log('\n--- a mesma tela dentro de Cadastros ---');
const proxySrc = ler('public/modules/cadastros/subs/classes_produto.js');
// Duas telas para o mesmo catálogo divergem na primeira alteração feita de um
// lado — é o mesmo acordo já usado em Produtos.
check('Cadastros reusa a tela do Estoque', /window\.MavisSubscreenRegistry\.stock\?\.classes/.test(proxySrc));
check('o proxy mantém o usuário em Cadastros', /classes: 'classes_produto'/.test(proxySrc));
// Sem o mapeamento no formulário de produto, o botão jogaria para o Estoque.
check('o botão do produto respeita o módulo', /classes: 'classes_produto'/.test(ler('public/modules/cadastros/subs/novo_produto.js')));
check('está no menu de Cadastros', /\{ key: 'classes_produto', label: 'Classes de Produto'/.test(appJs));
check('e carregada no index', /modules\/cadastros\/subs\/classes_produto\.js/.test(html));
// A tela aparece no menu de Cadastros; aceitar só 'stock' faria ela responder
// "Sem permissão" a quem a abrisse por lá.
check('a rota aceita quem só tem Cadastros', /user\.allowedModules\.includes\('stock'\) \|\| user\.allowedModules\.includes\('cadastros'\)/.test(serverSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
