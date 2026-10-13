// INVENTÁRIOS (fase EG): custo médio do razão, montagem e ligações da tela.
//
//   node scripts/test-inventario.js
//
// Sem banco: as contas moram em lib/custo-medio.js e lib/inventario.js, que são
// puras; o resto é conferência de que a tela, a rota e a migração existem e
// estão ligadas umas às outras.
const fs = require('fs');
const path = require('path');
const { custoMedioPorProduto } = require('../lib/custo-medio');
const { montarInventario } = require('../lib/inventario');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const quase = (a, b) => Math.abs(a - b) < 1e-6;

console.log('--- custo médio ponderado móvel ---');
{
  const medios = custoMedioPorProduto([
    { productId: 'A', type: 'entrada', quantity: 10, unitCost: 100, transferId: '' },
    { productId: 'A', type: 'entrada', quantity: 10, unitCost: 200, transferId: '' }
  ]);
  check('duas compras iguais em quantidade: média simples', quase(medios.get('A'), 150), medios.get('A'));
}
{
  const medios = custoMedioPorProduto([
    { productId: 'A', type: 'entrada', quantity: 10, unitCost: 100, transferId: '' },
    { productId: 'A', type: 'saida', quantity: 5, unitCost: 0, transferId: '' },
    { productId: 'A', type: 'entrada', quantity: 5, unitCost: 160, transferId: '' }
  ]);
  check('a saída tira pelo médio e a compra seguinte pondera sobre o que sobrou', quase(medios.get('A'), 130), medios.get('A'));
}
{
  const medios = custoMedioPorProduto([
    { productId: 'A', type: 'entrada', quantity: 10, unitCost: 100, transferId: '' },
    { productId: 'A', type: 'saida', quantity: 4, unitCost: 0, transferId: 't1' },
    { productId: 'A', type: 'entrada', quantity: 4, unitCost: 999, transferId: 't1' }
  ]);
  check('transferência não mexe no médio', quase(medios.get('A'), 100), medios.get('A'));
}
{
  const medios = custoMedioPorProduto([
    { productId: 'A', type: 'entrada', quantity: 10, unitCost: 100, transferId: '' },
    { productId: 'A', type: 'entrada', quantity: 10, unitCost: 0, transferId: '' }
  ]);
  check('entrada sem custo (estorno de venda) não puxa o médio para baixo', quase(medios.get('A'), 100), medios.get('A'));
}
{
  const medios = custoMedioPorProduto([
    { productId: 'A', type: 'saida', quantity: 3, unitCost: 0, transferId: '' },
    { productId: 'A', type: 'entrada', quantity: 5, unitCost: 80, transferId: '' }
  ]);
  check('com saldo negativo antes, a entrada define o médio', quase(medios.get('A'), 80), medios.get('A'));
}
{
  const medios = custoMedioPorProduto([
    { productId: 'B', type: 'entrada', quantity: 5, unitCost: 0, transferId: '' }
  ]);
  check('sem nenhuma entrada com custo, não há médio (null)', medios.get('B') === null, medios.get('B'));
}

console.log('\n--- montagem do inventário ---');
{
  const produtos = new Map([
    ['A', { sku: 'A1', name: 'Scooter A', ncm: '87116000', unidade: 'UN', costPrice: 120 }],
    ['B', { sku: 'B1', name: 'Bateria B', ncm: '85076000', unidade: 'UN', costPrice: 50 }],
    ['C', { sku: 'C1', name: 'Capacete C', ncm: '65061000', unidade: 'UN', costPrice: 0 }],
    ['D', { sku: 'D1', name: 'Descontinuado', ncm: '', unidade: 'UN', costPrice: 10 }]
  ]);
  const saldos = [
    { productId: 'A', saldo: 3, nomeNoRazao: '' },
    { productId: 'B', saldo: 2, nomeNoRazao: '' },
    { productId: 'C', saldo: 1, nomeNoRazao: '' },
    { productId: 'D', saldo: -2, nomeNoRazao: '' }
  ];
  const medios = new Map([['A', 100], ['B', null]]);
  const r = montarInventario({ saldos, medios, produtos, valoracao: 'custo_medio' });
  const porId = new Map(r.itens.map((i) => [i.productId, i]));
  check('saldo negativo fica de fora e volta separado', !porId.has('D') && r.negativos.length === 1 && r.negativos[0].quantidade === -2);
  check('A pelo custo médio', porId.get('A').custoUnitario === 100 && porId.get('A').origemCusto === 'medio' && porId.get('A').valor === 300);
  check('B sem médio cai para o custo do cadastro', porId.get('B').custoUnitario === 50 && porId.get('B').origemCusto === 'cadastro');
  check('C sem custo nenhum entra com valor zero e marcado', porId.get('C').valor === 0 && porId.get('C').origemCusto === 'sem_custo');
  check('total = 300 + 100 + 0', r.valorTotal === 400, r.valorTotal);
  check('quantidade total só dos que entraram', r.quantidadeTotal === 6, r.quantidadeTotal);
  check('itens em ordem de nome', r.itens.map((i) => i.productId).join(',') === 'B,C,A', r.itens.map((i) => i.productId).join(','));

  const c = montarInventario({ saldos, medios, produtos, valoracao: 'custo_cadastro' });
  check('valoração pelo cadastro ignora o médio', c.itens.find((i) => i.productId === 'A').custoUnitario === 120 && c.valorTotal === 460, c.valorTotal);
}

console.log('\n--- migração, rota e tela ligadas ---');
const mig = ler('banco/migrations/fase-eg-inventarios.sql');
check('a migração cria as duas tabelas', /create table if not exists inventarios\b/.test(mig) && /create table if not exists inventario_itens\b/.test(mig));
check('e liga RLS nas duas', /inventarios enable row level security/.test(mig) && /inventario_itens enable row level security/.test(mig));
check('RECRIAR-DO-ZERO inclui a fase EG', ler('banco/RECRIAR-DO-ZERO.sql').includes('fase-eg-inventarios.sql'));
const server = ler('server.js');
check('rotas de listar, gerar, abrir/exportar e excluir',
  server.includes("pathname === '/api/stock/inventories' && req.method === 'GET'")
  && server.includes("pathname === '/api/stock/inventories' && req.method === 'POST'")
  && server.includes(String.raw`/^\/api\/stock\/inventories\/[^/]+(\/export)?$/.test(pathname) && req.method === 'GET'`)
  && server.includes(String.raw`/^\/api\/stock\/inventories\/[^/]+$/.test(pathname) && req.method === 'DELETE'`));
check('as rotas exigem o módulo Estoque',
  (server.split("/api/stock/inventories").length - 1) >= 4
  && /INVENTÁRIOS \(fase EG\)[\s\S]{0,2000}userCanStock\(user\)/.test(server));
check('a data de referência no futuro é recusada', /dataReferencia > stockCore\.todayStr\(\)/.test(server));
const app = ler('public/app.js');
check('menu do Estoque tem Inventários', /key: 'inventories', label: 'Inventários'/.test(app));
check('e a folha não tem entrada de menu', !/key: 'inventory_view'/.test(app));
const indice = ler('public/modules/stock/index.js');
check('o roteador do Estoque conhece as duas telas', indice.includes("'inventories', 'inventory_view'"));
const html = ler('public/index.html');
check('index.html carrega as duas telas',
  html.includes('stock/subs/inventories.js') && html.includes('stock/subs/inventory_view.js'));
check('as telas se registram',
  /MavisSubscreenRegistry\.stock\.inventories = /.test(ler('public/modules/stock/subs/inventories.js'))
  && /MavisSubscreenRegistry\.stock\.inventory_view = /.test(ler('public/modules/stock/subs/inventory_view.js')));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exitCode = falhas ? 1 : 0;
