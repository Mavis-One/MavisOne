// Grupos de Produtos do Pedido/Orçamento.
//
// Passo 5 do módulo Vendas. O que este teste guarda:
//
//   1. as garantias de normalizarGrupos — sempre um grupo, nenhum item órfão,
//      ordem sem buracos. É a função que a tela E o servidor chamam, e é ela
//      que impede um pedido de abrir com produtos somando no total e
//      aparecendo em lugar nenhum;
//   2. que o `groupId` sobrevive à lista branca dos itens, nos dois lados. Ele
//      já foi descartado calado uma vez em cada lugar onde há whitelist;
//   3. que a migração é aditiva — o pedido gravado antes dela continua válido.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const grupos = require('../public/modules/shared/sales_grupos');

console.log('--- sempre existe ao menos um grupo ---');
// Pedido sem grupo nenhum deixaria os itens sem onde aparecer.
[null, undefined, [], 'lixo', [{}, null]].forEach((entrada, i) => {
  const r = grupos.normalizarGrupos(entrada, []);
  check(`  entrada ${i} produz um grupo`, r.groups.length >= 1, `${r.groups.length} grupo(s)`);
});
check('o nome padrão é numerado a partir de 01', grupos.nomePadrao(0).endsWith(' - 01'), grupos.nomePadrao(0));
check('e o terceiro é 03', grupos.nomePadrao(2).endsWith(' - 03'), grupos.nomePadrao(2));

console.log('\n--- nenhum item fica órfão ---');
// Pedido de antes da fase AH: itens sem groupId nenhum.
const antigo = grupos.normalizarGrupos([], [{ name: 'A', quantity: 1, total: 10 }, { name: 'B', quantity: 1, total: 5 }]);
check('item sem grupo vai para o grupo criado', antigo.items.every((i) => i.groupId === antigo.groups[0].id));
check('e nenhum item se perde', antigo.items.length === 2, `${antigo.items.length} itens`);

// Grupo excluído por fora, item apontando para o vazio.
const orfao = grupos.normalizarGrupos(
  [{ id: 'g1', name: 'Um', ordem: 0 }],
  [{ name: 'A', groupId: 'g1' }, { name: 'B', groupId: 'sumiu' }]
);
check('item apontando para grupo inexistente vai para o primeiro',
  orfao.items[1].groupId === 'g1', orfao.items[1].groupId);
check('e o que já estava certo não muda', orfao.items[0].groupId === 'g1');

console.log('\n--- ordem e nomes ---');
const bagunca = grupos.normalizarGrupos(
  [{ id: 'b', name: 'Beta', ordem: 7 }, { id: 'a', name: '', ordem: 2 }],
  []
);
check('a ordem é sequencial e sem buracos',
  bagunca.groups.map((g) => g.ordem).join(',') === '0,1', bagunca.groups.map((g) => g.ordem).join(','));
check('quem tinha ordem menor vem primeiro', bagunca.groups[0].id === 'a', bagunca.groups[0].id);
check('grupo sem nome recebe o padrão da sua POSIÇÃO', bagunca.groups[0].name === grupos.nomePadrao(0), bagunca.groups[0].name);

// Id repetido faria dois grupos disputarem os mesmos itens, e mover um item
// entre eles não teria efeito visível.
const repetido = grupos.normalizarGrupos([{ id: 'x', name: 'Um' }, { id: 'x', name: 'Dois' }], []);
check('id repetido é trocado', repetido.groups[0].id !== repetido.groups[1].id,
  `${repetido.groups[0].id} / ${repetido.groups[1].id}`);

console.log('\n--- total do grupo ---');
const comItens = grupos.normalizarGrupos(
  [{ id: 'g1', name: 'Um' }, { id: 'g2', name: 'Dois' }],
  [
    { name: 'A', groupId: 'g1', quantity: 2, unitPrice: 10, total: 20 },
    { name: 'B', groupId: 'g1', quantity: 1, unitPrice: 5, total: 5 },
    { name: 'C', groupId: 'g2', quantity: 3, unitPrice: 7 }
  ]
);
check('soma só o que é do grupo', grupos.totalDoGrupo(comItens.items, 'g1') === 25, String(grupos.totalDoGrupo(comItens.items, 'g1')));
// Aceita `total` já calculado (é assim que vem do servidor) ou qtd × preço.
check('calcula quando não há total pronto', grupos.totalDoGrupo(comItens.items, 'g2') === 21, String(grupos.totalDoGrupo(comItens.items, 'g2')));
check('grupo vazio soma zero', grupos.totalDoGrupo(comItens.items, 'nao-existe') === 0);
check('itensDoGrupo respeita a ordem da lista plana',
  grupos.itensDoGrupo(comItens.items, 'g1').map((i) => i.name).join('') === 'AB');

console.log('\n--- o groupId sobrevive às listas brancas ---');
const serverSrc = semComentarios(ler('server.js'));
// normalizeSalesItems monta um objeto novo campo a campo: sem o groupId ali,
// ele era descartado calado e todos os itens voltavam ao primeiro grupo.
check('normalizeSalesItems guarda o groupId', /groupId: String\(item\.groupId \|\| ''\)/.test(serverSrc));
const appSrc = semComentarios(ler('public/app.js'));
check('o payload da tela manda o groupId', /groupId: item\.groupId \|\| ''/.test(appSrc));
check('e manda a lista de grupos', /productGroups: grupos\.map\(\(grupo, i\) =>/.test(appSrc));

console.log('\n--- os dois lados usam a MESMA função ---');
check('o servidor faz require do módulo', /require\('\.\/public\/modules\/shared\/sales_grupos'\)/.test(serverSrc));
check('e o navegador carrega o mesmo arquivo', /sales_grupos\.js/.test(ler('public/index.html')));
check('a gravação normaliza (criar)', (serverSrc.match(/salesGrupos\.normalizarGrupos\(body\.productGroups/g) || []).length === 2,
  'criar e editar');
// Pedido antigo não tem grupo: sem normalizar na LEITURA, ele abriria vazio.
check('a leitura também normaliza', /salesGrupos\.normalizarGrupos\(\s*record\.productGroups/.test(serverSrc));
check('o serializer devolve os grupos', /^\s{4}productGroups,$/m.test(serverSrc));

console.log('\n--- a migração é aditiva ---');
const sql = ler('supabase/migrations/fase-ah-grupos-de-produtos.sql');
check('cria product_groups em orders', /alter table if exists orders add column if not exists product_groups jsonb/.test(sql));
// Orçamento vira pedido sem trocar de tabela; perder os grupos ao aprovar
// seria pior do que nunca tê-los tido.
check('e em quotes também', /alter table if exists quotes add column if not exists product_groups jsonb/.test(sql));
check('com padrão de lista vazia', /default '\[\]'::jsonb/.test(sql));
// Nada de drop, nada de update em massa, nada de mudar tipo de coluna.
check('não apaga nem altera nada', !/\b(drop|delete|truncate|alter column)\b/i.test(sql));

console.log('\n--- degrada se a fase-AH não rodou ---');
const dbSrc = semComentarios(ler('lib/db/vendas-compras.js'));
// Sem isto, gravar um pedido antes da migração devolveria erro e o usuário
// perderia o que acabou de digitar.
check('a fase AH entra no fallback de coluna ausente', /nome: 'Fase AH', colunas: COLUNAS_FASE_AH/.test(dbSrc));
check('e é a primeira a ser tirada (mais nova)', dbSrc.indexOf("'Fase AH'") < dbSrc.indexOf("'Fase P'"));
check('a perda é explicada no log', /os itens continuam gravados, todos num grupo só/.test(ler('lib/db/vendas-compras.js')));

console.log('\n--- a tela ---');
const appBruto = ler('public/app.js');
check('cada grupo tem a própria linha de adicionar', /class="secondary sales-add-item" data-grupo=/.test(appBruto));
// Com ids fixos, a cor escolhida no segundo grupo ia parar no campo do primeiro.
check('os campos de produto/cor são por grupo', /salesClassValue__/.test(appBruto) && /salesProduct__/.test(appBruto));
check('existe o botão de novo grupo', /salesNovoGrupoBtn/.test(appBruto));
check('duplicar e excluir grupo', /data-duplicar-grupo/.test(appBruto) && /data-excluir-grupo/.test(appBruto));
// Excluir o único grupo deixaria o pedido sem onde pôr item nenhum.
check('o último grupo não pode ser excluído', /grupos\.length === 1 \? 'disabled/.test(appBruto));
check('excluir grupo com itens pede confirmação', /confirmModal\(\s*`Excluir "/.test(appBruto));
// O chassi identifica UMA unidade física.
check('duplicar não copia o chassi', /groupId: novo\.id, chassi: ''/.test(appBruto));
check('mover item existe', /sales-mover-item/.test(appBruto) && /const moverItem = \(index, direcao\)/.test(appBruto));
// Trocar com o vizinho de índice embaralharia a ordem dos outros grupos junto.
check('mover troca com o vizinho DO MESMO grupo', /filter\(\(x\) => x\.it\.groupId === item\.groupId\)/.test(appSrc));
// Os handlers de qtd/preço/chassi trabalham por índice absoluto.
check('a linha recebe o índice da lista plana', /doGrupo\.map\(\(\{ item, index \}, posicao\)/.test(appBruto));
check('o documento impresso mostra os grupos', /grupos\.length > 1[\s\S]{0,200}class="grp"/.test(appBruto));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
