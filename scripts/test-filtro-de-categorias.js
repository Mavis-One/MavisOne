/**
 * O FILTRO DE CATEGORIAS DOS RELATÓRIOS (17/11/2026).
 *
 * Pedido do usuário: "preciso que os relatórios tenham filtros de categorias
 * para que eu consiga diferenciar quais categorias eu quero pegar, exemplo:
 * vendas ou transferência entre filiais, garantia e etc".
 *
 *   - a categoria do filtro é a do pedido SEM a filial ("... / Timbo"), sem
 *     acento e sem caixa — a mesma conta no JS (opções) e no SQL (consulta);
 *   - nos 16 relatórios do catálogo que usam a regra de venda, sem escolha
 *     fica como sempre (só vendas); com escolha, entram EXATAMENTE as
 *     categorias marcadas, inclusive transferência e garantia;
 *   - em Pedidos e Vendas por Vendedor, sem escolha = todas (como sempre).
 *
 * Prova de ponta a ponta na porta 3999 contra o banco: só Transferência = 268
 * pedidos (banco 268), Garantia + Remessa = 39 (39), sem escolha = 14.031
 * (14.031, igual a antes); e a tela no navegador.
 *
 *   node scripts/test-filtro-de-categorias.js
 */
const fs = require('fs');
const path = require('path');
const categoriaVenda = require('../public/modules/shared/categoria_venda');
const comum = require('../lib/relatorios/comum');
const motor = require('../lib/relatorios/motor');
const vendas = require('../lib/relatorios/vendas');
const relatoriosVendas = require('../lib/relatorios-vendas');
require('../lib/relatorios/index'); // confere os filtros conhecidos ao carregar

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas++;
};
const ler = (arquivo) => fs.readFileSync(path.join(__dirname, '..', arquivo), 'utf8');

(async () => {
  console.log('--- a chave da categoria ---');
  check('sem a filial, sem acento, sem caixa', categoriaVenda.chaveDoFiltro('Venda de Materiais e Serviços / Timbo') === 'venda de materiais e servicos'
    && categoriaVenda.chaveDoFiltro('  VENDA DE MATERIAIS E SERVIÇOS  ') === 'venda de materiais e servicos');
  check('vazia = sem-categoria', categoriaVenda.chaveDoFiltro('') === 'sem-categoria' && categoriaVenda.chaveDoFiltro('/ Timbo') === 'sem-categoria');
  check('o filtro da tela vira chaves, sem repetir', JSON.stringify(categoriaVenda.lerFiltro('Garantia|garantia||Transferência entre Filiais|sem-categoria'))
    === '["garantia","transferencia entre filiais","sem-categoria"]');
  const opcoes = categoriaVenda.opcoesDoFiltro(
    [{ category: 'Venda de Materiais e Serviços / Timbo', total: 5 }, { category: 'Venda de Materiais e Serviços', total: 9 }, { category: '', total: 3 }, { category: 'Garantia', total: 2 }],
    [{ name: 'Remessa' }]);
  check('opções: uma por categoria, com a grafia mais usada; "Sem categoria" no fim',
    JSON.stringify(opcoes.map((o) => o.name)) === '["Garantia","Remessa","Venda de Materiais e Serviços","Sem categoria"]');
  check('o SQL faz a mesma conta (sem a última "/", translate, lower, espaços)',
    /regexp_replace\(coalesce\(o\.category, ''\), '\\s\*\/\[\^\/\]\*\$', ''\)/.test(comum.categoriaSql('o')) && /'sem-categoria'\)$/.test(comum.categoriaSql('o')));

  console.log('\n--- o que entra ---');
  check('sem escolha: a regra de venda de sempre', comum.vendaOuCategoriasSql('o', '$9').startsWith('(case when $9::text[] is null then ') && comum.vendaOuCategoriasSql('o', '$9').includes(comum.ehVendaSql('o')));
  check('parâmetro: null sem escolha, a lista com escolha', comum.parametrosDeVenda({ f: { categorias: '' } }).categorias === null
    && JSON.stringify(comum.parametrosDeVenda({ f: { categorias: 'garantia|remessa' } }).categorias) === '["garantia","remessa"]');

  const comRegra = vendas.filter((d) => String(d.executar || '').includes('filtroDeVendas('));
  check(`os ${comRegra.length} relatórios com a regra de venda oferecem o campo`, comRegra.length === 16 && comRegra.every((d) => d.filtros.includes('categoria')));
  check('relatório sem a regra de venda não oferece', vendas.filter((d) => (d.filtros || []).includes('categoria')).length === comRegra.length);

  // O $n da categoria aponta para a lista certa em TODOS (alguns somam
  // parâmetros antes: o ano, a data de hoje).
  const tortos = [];
  for (const def of comRegra) {
    const consultas = [];
    const ctx = {
      f: motor.normalizarFiltros(def, { categorias: 'Garantia', de: '2026-01-01', ate: '2026-01-31' }),
      sql: async (texto, parametros) => { consultas.push({ texto, parametros }); return []; },
      data: { companies: [] },
      vendedores: null
    };
    try { await def.executar(ctx); } catch (e) { /* sem linhas, alguns param antes; o que importa é a consulta */ }
    const comCase = consultas.filter((c) => /case when \$(\d+)::text\[\] is null then/.test(c.texto));
    const ok = comCase.length > 0 && comCase.every((c) => {
      const n = Number(/case when \$(\d+)::text\[\] is null then/.exec(c.texto)[1]);
      return JSON.stringify(c.parametros[n - 1]) === '["garantia"]';
    });
    if (!ok) tortos.push(def.key);
  }
  check('o parâmetro da categoria é a lista escolhida em cada consulta', !tortos.length);
  if (tortos.length) console.log('     ', tortos.join(', '));
  check('o motor só lê o campo onde o relatório o oferece',
    motor.normalizarFiltros({ filtros: ['periodo', 'categoria'] }, { categorias: 'Garantia|Remessa' }).categorias === 'garantia|remessa'
    && motor.normalizarFiltros({ filtros: ['periodo'] }, { categorias: 'Garantia' }).categorias === ''
    && motor.CAMPOS_RESERVADOS.has('categorias'));
  check('o arquivo (Excel/PDF) diz as categorias', motor.descricaoDaCategoria({ categoriasEscolhidas: ['Garantia', 'Remessa'] }) === 'Categorias: Garantia, Remessa');

  console.log('\n--- Pedidos e Vendas por Vendedor ---');
  const registro = (id, category) => ({ id, code: id, type: 'order', date: '2026-11-10', status: 'Pedido Faturado', sellerId: 's', category, items: [{ quantity: 1, unitPrice: 10 }] });
  const registros = [registro('a', 'Venda de Materiais e Serviços / Timbo'), registro('b', 'Garantia'), registro('c', 'Transferencia entre Filiais')];
  const escopo = { tipo: 'todos', sellerIds: null, podeEscolherVendedor: true };
  const todas = relatoriosVendas.montarRelatorio({ registros, filtros: {}, escopo });
  const garantia = relatoriosVendas.montarRelatorio({ registros, filtros: { categorias: ['garantia'] }, escopo });
  check('sem escolha = todas (como sempre); com escolha, só ela', todas.paginacao.total === 3 && garantia.paginacao.total === 1 && garantia.linhas[0].pedidoId === 'b');

  console.log('\n--- servidor e tela ---');
  const servidor = ler('server.js');
  check('o menu manda as opções (categoriasDeVenda)', /categoriasDeVenda,\s*podeEscolherVendedor/.test(servidor) && /async function categoriasDosRelatorios\(\)/.test(servidor));
  check('Pedidos lê o filtro e manda as opções', /categorias: categoriaVenda\.lerFiltro\(params\.get\('categorias'\)\)/.test(servidor) && /categorias: categoriasDaTela/.test(servidor));
  check('a carga de Pedidos lê a categoria', /'category'\s*\]\.join/.test(ler('lib/relatorios-cargas.js')));
  const catalogo = ler('public/modules/reports/subs/catalogo.js');
  check('catálogo: o campo aparece onde o relatório oferece, e é ligado', /usa\('categoria'\) \? campoDeCategorias\(ctx, \{ opcoes: opcoes\.categoriasDeVenda, valor: filtros\.categorias \}\)/.test(catalogo)
    && /ligarCategorias\(content\);/.test(catalogo));
  check('escrever no campo escondido avisa a tela (change)', /escondido\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/.test(catalogo));
  const especiais = ler('public/modules/reports/subs/relatorios.js');
  check('Pedidos: o campo com "Todas" e o estado guardado', /atributo: 'data-rel-filtro', vazio: 'Todas'/.test(especiais) && /empresa: '', categorias: ''/.test(especiais)
    && /window\.MavisRelatoriosCatalogo\.ligarCategorias\(content\);/.test(especiais));

  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})();
