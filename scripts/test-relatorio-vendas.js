#!/usr/bin/env node
// RELATÓRIO DE VENDAS — quem vê o quê, provado com dados de mentira.
//
// Os oito testes que o briefing exige antes de dar a funcionalidade por pronta
// estão aqui, do 1 ao 8, na ordem em que ele os pede. Rodam sem servidor e sem
// banco porque a regra mora em duas funções puras (lib/relatorios-escopo.js e
// lib/relatorios-vendas.js) — foi para isto que ela foi escrita assim.
//
// O QUE ESTE TESTE ESTÁ REALMENTE GUARDANDO
// -----------------------------------------
// Não é "o filtro funciona". É que NÃO EXISTE combinação de parâmetros que faça
// um vendedor ver a venda de outro. Por isso os casos 3, 4 e 5 não pedem
// educadamente: eles mandam o id do colega, mandam 'todos', mandam string
// vazia, e conferem o que voltou. Um filtro que só é aplicado quando a tela
// pede direitinho não é um controle de acesso.
const path = require('path');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const escopoLib = require('../lib/relatorios-escopo');
const rel = require('../lib/relatorios-vendas');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`  ${cond ? 'OK ' : 'XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// ---------------------------------------------------------------- o cenário
// Dois vendedores do Cadastros (pessoas), dois usuários com login. Michael tem
// login sem vínculo de propósito: é o caso que precisa falhar FECHADO.
const EDUARDO = 'p-eduardo';
const MICHAEL = 'p-michael';

const usuarioAdmin = { id: 'u-admin', name: 'Admin', role: 'admin', active: true };
const usuarioEduardo = { id: 'u-edu', name: 'Eduardo', role: 'user', active: true, sellerId: EDUARDO };
const usuarioSemVinculo = { id: 'u-novo', name: 'Recém-chegado', role: 'user', active: true, sellerId: '' };

const escopoDe = (usuario) => escopoLib.escopoDeVendas(usuario, { ehAdmin: usuario.role === 'admin' });

const venda = (id, code, sellerId, sellerName, clienteId, clienteNome, itens, extra = {}) => ({
  id, code, type: 'order', status: 'pedido-faturado', date: '2026-08-20',
  sellerId, sellerName, clientSupplierId: clienteId, clientSupplierName: clienteNome,
  items: itens, ...extra
});
const item = (produtoId, nome, sku, qtd, preco) => ({
  productId: produtoId, name: nome, sku, quantity: qtd, unitPrice: preco
});

const REGISTROS = [
  venda('o1', 1025, EDUARDO, 'Eduardo', 'c-a', 'Cliente A', [item('pr-x', 'Produto X', 'SKU-X', 2, 250)]),
  venda('o2', 1027, EDUARDO, 'Eduardo', 'c-c', 'Cliente C', [item('pr-z', 'Produto Z', 'SKU-Z', 4, 200)]),
  venda('o3', 1026, MICHAEL, 'Michael', 'c-b', 'Cliente B', [item('pr-y', 'Produto Y', 'SKU-Y', 1, 300)]),
  // Cancelada: fica no banco e não pode entrar no faturamento sem alguém pedir.
  venda('o4', 1028, EDUARDO, 'Eduardo', 'c-a', 'Cliente A', [item('pr-x', 'Produto X', 'SKU-X', 9, 999)],
    { status: 'pedido-cancelado' })
];

const montar = (usuario, filtros = {}) =>
  rel.montarRelatorio({ registros: REGISTROS, filtros, escopo: escopoDe(usuario) });

// ---------------------------------------------------------------------------
console.log('\n--- 1. ADMIN enxerga todos os vendedores ---');
const comoAdmin = montar(usuarioAdmin);
check('a tabela traz os dois vendedores',
  new Set(comoAdmin.porVendedor.map((g) => g.vendedorNome)).size === 2,
  comoAdmin.porVendedor.map((g) => g.vendedorNome).join(', '));
check('o faturamento soma os dois', comoAdmin.indicadores.faturamento === 1600,
  String(comoAdmin.indicadores.faturamento));
check('e o filtro de vendedor aparece para ele', comoAdmin.escopo.podeEscolherVendedor === true);
check('com o rótulo "Todas as vendas"', comoAdmin.escopo.rotulo === 'Todas as vendas', comoAdmin.escopo.rotulo);
// A cancelada não entra no dinheiro por padrão — e o rótulo do filtro diz isso.
check('a venda cancelada fica fora do padrão',
  !comoAdmin.linhas.some((l) => l.pedidoCodigo === 1028), '1028 fora');

console.log('\n--- 2. EDUARDO enxerga somente as vendas dele ---');
const comoEduardo = montar(usuarioEduardo);
check('só o próprio vendedor aparece',
  comoEduardo.porVendedor.length === 1 && comoEduardo.porVendedor[0].vendedorId === EDUARDO,
  comoEduardo.porVendedor.map((g) => g.vendedorNome).join(', '));
check('nenhuma linha é de outro vendedor',
  comoEduardo.linhas.every((l) => l.vendedorId === EDUARDO));
check('o faturamento é só o dele', comoEduardo.indicadores.faturamento === 1300,
  String(comoEduardo.indicadores.faturamento));
check('a tela chama isso de "Minhas vendas"', comoEduardo.escopo.rotulo === 'Minhas vendas');
// Se ele não escolhe vendedor, o filtro não deve nem aparecer.
check('e o filtro de vendedor NÃO aparece', comoEduardo.escopo.podeEscolherVendedor === false);
// As opções dos <select> saem do universo dele: nem para preencher um dropdown
// o vendedor recebe a lista de clientes do colega.
check('as opções de cliente não vazam o cliente do colega',
  !comoEduardo.opcoes.clientes.some((c) => c.id === 'c-b'),
  comoEduardo.opcoes.clientes.map((c) => c.nome).join(', '));

console.log('\n--- 3. pedir a venda de outro pela API não devolve nada ---');
const pedindoOColega = montar(usuarioEduardo, { vendedorId: MICHAEL });
check('mandar vendedorId do Michael devolve zero linhas dele',
  !pedindoOColega.linhas.some((l) => l.vendedorId === MICHAEL));
check('  e continua devolvendo as do próprio Eduardo',
  pedindoOColega.linhas.length === comoEduardo.linhas.length,
  `${pedindoOColega.linhas.length} linhas`);
check('  com o mesmo faturamento de antes',
  pedindoOColega.indicadores.faturamento === 1300, String(pedindoOColega.indicadores.faturamento));

console.log('\n--- 4. nenhuma variação do parâmetro afrouxa a regra ---');
// O ponto não é o caso feliz: é que NENHUMA forma de escrever o parâmetro
// abre a porta. 'todos' e '' são as duas tentativas óbvias.
for (const tentativa of [MICHAEL, 'todos', '', null, undefined, 'p-michael ']) {
  const r = montar(usuarioEduardo, { vendedorId: tentativa });
  check(`  vendedorId=${JSON.stringify(tentativa)} -> só Eduardo`,
    r.linhas.every((l) => l.vendedorId === EDUARDO) && r.indicadores.faturamento === 1300);
}

console.log('\n--- 5. a exportação sai do MESMO conjunto ---');
const csvEduardo = rel.montarCsv(rel.filtrar(
  REGISTROS.flatMap(rel.linhasDoRegistro), { vendedorId: MICHAEL }, escopoDe(usuarioEduardo)
));
check('o CSV pedido com o id do Michael não contém Michael', !csvEduardo.includes('Michael'));
check('  nem o cliente dele', !csvEduardo.includes('Cliente B'));
check('  e contém as vendas do Eduardo', csvEduardo.includes('Produto X') && csvEduardo.includes('Produto Z'));
// Excel em português: sem BOM os acentos quebram, sem ; as colunas colam.
check('  abre no Excel: BOM, ponto-e-vírgula e vírgula decimal',
  csvEduardo.charCodeAt(0) === 0xFEFF && csvEduardo.includes(';') && /\d+,\d\d/.test(csvEduardo));

console.log('\n--- 6. vendedor novo aparece sozinho ---');
// Ninguém escreve nome de vendedor em lugar nenhum: o agrupamento sai dos dados.
const COM_NOVATO = REGISTROS.concat([
  venda('o5', 1030, 'p-joao', 'João', 'c-d', 'Cliente D', [item('pr-w', 'Produto W', 'SKU-W', 1, 700)])
]);
const comNovato = rel.montarRelatorio({ registros: COM_NOVATO, filtros: {}, escopo: escopoDe(usuarioAdmin) });
check('João entra no agrupamento sem tocar em código',
  comNovato.porVendedor.some((g) => g.vendedorNome === 'João'));
check('  e no filtro de vendedores', comNovato.opcoes.vendedores.some((v) => v.id === 'p-joao'));
check('  o ranking continua ordenado por faturamento',
  comNovato.porVendedor[0].indicadores.faturamento >= comNovato.porVendedor[1].indicadores.faturamento);

console.log('\n--- 7. usuário novo sem vínculo falha FECHADO ---');
// O caso que separa a regra de um enfeite: sem vendedor vinculado, o ramo
// "sem filtro" não pode ser o padrão.
const semVinculo = montar(usuarioSemVinculo);
check('não vê venda nenhuma', semVinculo.linhas.length === 0 && semVinculo.indicadores.faturamento === 0);
check('  nem o agrupamento de ninguém', semVinculo.porVendedor.length === 0);
check('  e a tela recebe o motivo, não um vazio mudo',
  /vinculado a um vendedor/i.test(semVinculo.escopo.motivo), semVinculo.escopo.motivo.slice(0, 60) + '...');

console.log('\n--- 8. card, tabela, agrupamento e CSV: o MESMO universo ---');
// O defeito que o briefing manda evitar em letras maiúsculas: a tabela mostrar
// 25 vendas e o card somar R$ 150.000 porque calculou todas.
const paginado = montar(usuarioEduardo, { porPagina: 1 });
const somaGrupos = paginado.porVendedor.reduce((s, g) => s + g.indicadores.faturamento, 0);
check('o card NÃO muda ao paginar',
  paginado.indicadores.faturamento === comoEduardo.indicadores.faturamento,
  `${paginado.indicadores.faturamento} com 1 linha por página`);
check('  a página traz mesmo só uma linha', paginado.linhas.length === 1);
check('  o total paginado conhece o conjunto inteiro', paginado.paginacao.total === 2,
  `${paginado.paginacao.total} linhas`);
check('a soma dos grupos bate com o card', somaGrupos === paginado.indicadores.faturamento,
  `${somaGrupos} vs ${paginado.indicadores.faturamento}`);
const csvTudo = rel.montarCsv(rel.filtrar(REGISTROS.flatMap(rel.linhasDoRegistro), {}, escopoDe(usuarioEduardo)));
const somaCsv = csvTudo.split('\r\n').slice(1).filter(Boolean)
  .map((l) => Number(l.split(';')[9].replace(',', '.'))).reduce((a, b) => a + b, 0);
check('e o CSV soma exatamente o mesmo', Math.round(somaCsv * 100) / 100 === comoEduardo.indicadores.faturamento,
  `${somaCsv} vs ${comoEduardo.indicadores.faturamento}`);

console.log('\n--- o desconto do pedido é rateado entre as linhas ---');
const comDesconto = rel.linhasDoRegistro(venda('o9', 99, EDUARDO, 'Eduardo', 'c-a', 'Cliente A', [
  item('pr-x', 'Produto X', 'SKU-X', 1, 300),
  item('pr-y', 'Produto Y', 'SKU-Y', 1, 100)
], { discountAmount: 40 }));
check('quem vale mais absorve mais desconto',
  comDesconto[0].desconto === 30 && comDesconto[1].desconto === 10,
  `${comDesconto[0].desconto} / ${comDesconto[1].desconto}`);
check('  e a soma das linhas devolve o valor com desconto',
  comDesconto[0].valorTotal + comDesconto[1].valorTotal === 360);

console.log('\n--- a ordenação existe para as colunas que o briefing pede ---');
for (const coluna of ['data', 'pedido', 'vendedor', 'cliente', 'valor']) {
  check(`  ordena por ${coluna}`, typeof rel.ORDENACOES[coluna] === 'function');
}
const porValor = montar(usuarioAdmin, { ordem: 'valor', direcao: 'desc' });
check('  e a ordem desc começa pela maior venda',
  porValor.linhas[0].valorTotal >= porValor.linhas[porValor.linhas.length - 1].valorTotal);

console.log('\n--- a regra também está no SERVIDOR, não só aqui ---');
// Blindagem contra a rota que um dia leia body.vendedorId direto.
const serverSrc = ler('server.js');
check('a rota do relatório monta o escopo do usuário autenticado',
  /escopoLib\.escopoDeVendas\(\s*user/.test(serverSrc) || /escopoDeVendas\(user/.test(serverSrc));
check('  e passa esse escopo para o cálculo',
  /montarRelatorio\(\{[\s\S]{0,200}escopo/.test(serverSrc));
// Ver e exportar passam pelo MESMO montador. Duas rotas com dois caminhos até
// os dados é como a exportação acaba trazendo o que a tela não mostrava — cada
// uma monta o filtro do seu jeito e uma delas esquece o escopo.
// `await` na frente para contar as CHAMADAS, não a declaração da função.
const montadores = (serverSrc.match(/await montarRelatorioDeVendas\(req/g) || []).length;
check('  a exportação passa pelo mesmo montador que a tela', montadores === 2, `${montadores} rotas`);
// E o CSV não tem caminho próprio até os dados: ele refiltra com o escopo que o
// montador já decidiu, nunca com um filtro montado ali na hora.
check('  e o CSV refiltra com o escopo do montador',
  /montarCsv\(/.test(serverSrc) && /contexto\.escopo/.test(serverSrc));
check('nenhuma rota confia no vendedorId da tela sem passar pelo escopo',
  !/sellerId\s*===\s*(req|body|url)/.test(serverSrc));

console.log('\n--- o vínculo usuário -> vendedor existe de ponta a ponta ---');
check('a migração cria a coluna',
  /alter table if exists users\s+add column if not exists seller_id/i.test(ler('supabase/migrations/fase-al-usuario-vendedor.sql')));
check('o usuário lido do banco traz o vínculo', /sellerId: row\.seller_id/.test(ler('lib/db/auth.js')));
const appSrc = ler('public/app.js');
check('e a tela de Usuários tem o campo de vínculo', /name="sellerId"/.test(appSrc));
check('  com a lista de vendedores vinda do servidor', /data\.sellers/.test(appSrc));
check('  e dá para trocar o vínculo de quem já existe', /class="user-seller"/.test(appSrc));
// ESTE CHECK JÁ COBROU O CONTRÁRIO, e vale registrar por quê mudou.
//
// Enquanto o vínculo servia só ao Relatório, esconder o seletor do admin era o
// certo: lá ele é irrestrito, o vínculo não muda nada para ele, e um select ali
// sugeriria que o acesso dele dependia daquilo. A tela dizia "Admin — vê todas
// as vendas" no lugar do campo, e era verdade.
//
// O Meu Painel quebrou essa premissa. Ele pergunta outra coisa — "o que EU
// vendi" — e responde a partir deste mesmo vínculo, para admin inclusive. Sem o
// seletor, um administrador que também vende não tinha por onde se vincular, e
// o painel pessoal dele ficava vazio para sempre sem explicação nenhuma.
// Ver lib/relatorios-escopo.js (escopoPessoal) e scripts/test-meu-painel.js.
check('  o seletor de vendedor aparece para TODO usuário, admin incluído',
  !/Admin — vê todas as vendas/.test(appSrc));
check('  e a tela explica ao admin para que serve o vínculo dele',
  /Meu Painel dele/.test(appSrc));
// O servidor precisa mandar a lista, senão o select nasce vazio.
check('o servidor manda os vendedores para a tela de Usuários',
  /sellers: canManageUsers \? getSellersDirectory\(data\)/.test(serverSrc));

console.log('\n--- a tela mostra o recorte, e não só os números ---');
const telaSrc = ler('public/modules/reports/subs/relatorios.js');
// Filtros primeiro, indicadores depois, tabela, gráficos: a ordem do briefing.
check('os filtros ficam num painel identificado', /class="panel rel-filtros"/.test(telaSrc) && /<h3>Filtros<\/h3>/.test(telaSrc));
check('o filtro de vendedor só aparece para quem pode escolher',
  /escopo\?\.podeEscolherVendedor \? `[\s\S]{0,200}vendedorId/.test(telaSrc));
check('a tela diz de quem são os números', /rel-escopo-selo/.test(telaSrc) && /escopo\?\.rotulo/.test(telaSrc));
check('há as duas visões: tabela e por vendedor',
  /data-rel-visao="tabela"/.test(telaSrc) && /data-rel-visao="vendedor"/.test(telaSrc));
check('pedido, cliente e produto abrem a tela que já existe',
  /data-rel-pedido/.test(telaSrc) && /data-rel-cliente/.test(telaSrc) && /data-rel-produto/.test(telaSrc));
check('  o pedido abre pela rota de Vendas, sem reimplementar a tela',
  /api\(`\/api\/sales\/records\//.test(telaSrc) && /activeSub = 'new_sale'/.test(telaSrc));
// Gerar no navegador significaria que os dados sairam do servidor antes de
// alguem conferir se podiam sair.
check('a exportação chama o servidor, não monta arquivo na tela',
  /\/api\/reports\/vendas\/export/.test(telaSrc) && !/Blob\(\[/.test(telaSrc));
check('  e leva o token da sessão no cabeçalho', /'x-auth-token'/.test(telaSrc));
// Vendedor comum nao pode ver "ranking dos outros": a tela dele e' o proprio
// desempenho, nao uma lista de um item so'.
check('para o vendedor comum a tela vira "Meu Desempenho"', /Meu Desempenho/.test(telaSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
