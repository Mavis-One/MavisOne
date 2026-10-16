#!/usr/bin/env node
// O CADASTRO DE PRODUTO EM BLOCOS (fase EP, 15/10/2026).
//
// Pedido do usuário, com o print do cadastro de outro sistema: uma página só,
// em blocos, no lugar das cinco abas (Dados, Preços, Fiscal, Estoque,
// Classes), e os campos que faltavam — código do fabricante, preço a prazo,
// preço mínimo, pode vender e matéria-prima. "Vender sem estoque" NÃO entra
// (desde 13/10/2026 nenhum produto fatura sem saldo).
//
// Provado no navegador (banco local, temas claro e escuro):
//   - produto 1406: NCM 35061010 com ✓ e "À base de cianoacrilatos", CEST do
//     NCM na busca; margem 100% sobre custo 39,90 -> à vista 79,80, "Sobre
//     venda: 50,00%"; visual resumido esconde os 3 blocos de exceção; Serviço
//     ligado desliga e trava Controla Estoque;
//   - produto novo pela tela, com grupo NOVO digitado, marca nova, C.Fabricante
//     FAB-7691, a prazo 150, mínimo 120, pode vender desligado, matéria-prima
//     e ESTOQUE INICIAL 3: tudo gravado (o grupo criado, e grupo, marca,
//     mínimo e depósito — que se perdiam com estoque inicial); a busca por
//     "fab-7691" acha; a busca do pedido não oferece o produto (e oferece o
//     1406, o controle). O produto de teste foi apagado.
//
// Do teste antigo das abas (test-produto-abas.js) ficam as regras que valem
// para as OUTRAS telas com abas (Pessoas e Venda).
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const telaSrc = ler('public/modules/stock/subs/new_product.js');
const cssSrc = ler('public/app.css');
const servidor = ler('server.js');

console.log('--- nenhum campo se perdeu na troca de layout ---');
const lidosNoPayload = [...telaSrc.matchAll(/formData\.get\('([^']+)'\)/g)].map((m) => m[1]);
const declaradosNoHtml = new Set([...telaSrc.matchAll(/name="([^"]+)"/g)].map((m) => m[1]));
check('o formulário lê os campos do cadastro', lidosNoPayload.length >= 20, lidosNoPayload.length + ' campos');
const orfaos = [...new Set(lidosNoPayload)].filter((campo) => !declaradosNoHtml.has(campo));
check('todo campo lido no submit existe no HTML', orfaos.length === 0, orfaos.length ? 'órfãos: ' + orfaos.join(', ') : 'nenhum órfão');
// O código saiu da lista em 16/10/2026: vazio, ele vem da sequência
// (test-codigo-automatico-do-produto.js).
['name', 'unit', 'costPrice', 'salePrice'].forEach((campo) => {
  check(`"${campo}" é obrigatório`, new RegExp(`name="${campo}"[^>]*required|required[^>]*name="${campo}"`).test(telaSrc));
});

console.log('\n--- os blocos do print, na ordem ---');
check('sem abas', !/cadastro-tab/.test(telaSrc));
const ordem = (rotulos) => {
  let pos = -1;
  return rotulos.every((r) => { const i = telaSrc.indexOf(r, pos + 1); const ok = i > pos; pos = i; return ok; });
};
check('identificação: Código, C.Fabricante, C.Barras, Un, Descrição, Serviço, Ativo',
  ordem(['Código*<input', 'C.Fabricante<input', 'C.Barras<input', 'Un*<input', 'Descrição*<input', "chave('servico', 'Serviço'", "chave('ativo', 'Ativo'"]));
check('grupo, marca, Controla Estoque, Pode Vender, Matéria-Prima',
  ordem(['Grupo do Produto', 'Marca do Produto', "'Controla Estoque'", "'Pode Vender'", "'Matéria-Prima'"]));
check('fiscal: NCM, CEST, Origem ICMS, Tipo de Tributação', ordem(['>NCM', '>CEST', 'Origem ICMS', 'Tipo de Tributação']));
check('preços: custo, margem, à vista, a prazo, mínimo, estoque atual, estoque mínimo',
  ordem(['Preço de Custo*', 'Margem (%)', 'Preço à Vista*', 'Preço a Prazo', 'Preço Mínimo', 'Estoque Atual', 'Estoque Mínimo']));
check('"Vender sem estoque" não entra', !/vendeSemEstoque|Vender Sem Estoque<|name="venderSemEstoque"/.test(telaSrc));

console.log('\n--- visual resumido ---');
check('os blocos de exceção só ficam ocultos (continuam no envio)', /const completo = \(corpo\) => `<div class="produto-completo" \$\{resumida \? 'hidden' : ''\}>/.test(telaSrc));
check('  a escolha fica nas preferências', telaSrc.includes("salvarPreferencia('produto_cadastro', { resumida })"));
check('  e o CSS esconde de fato', /\.produto-completo\[hidden\] \{ display: none; \}/.test(cssSrc));
check('campo recusado escondido abre o completo', /closest\('\.produto-completo'\)[\s\S]{0,160}b\.hidden = false/.test(telaSrc));

console.log('\n--- as contas e as chaves ---');
check('seta →: preço à vista = custo × (1 + margem)', /campo\('salePrice'\)\.value = Math\.round\(custo \* \(1 \+ margem \/ 100\) \* 100\) \/ 100/.test(telaSrc));
check('seta ←: margem sobre o custo', /\(\(\(venda - custo\) \/ custo\) \* 100\)\.toFixed\(2\)/.test(telaSrc));
check('sobre venda: (preço − custo) ÷ preço', /\(\(preco - custo\) \/ preco\) \* 100/.test(telaSrc));
check('Serviço desliga e trava Controla Estoque', /controla\.checked = !campo\('servico'\)\.checked;\s*controla\.disabled = campo\('servico'\)\.checked;/.test(telaSrc));
check('  e vai como movimentaEstoque', telaSrc.includes('movimentaEstoque: !servicoMarcado,'));
check('o grupo digitado: existente pelo nome, novo vai como categoryName',
  telaSrc.includes("categoryId: grupo ? grupo.id : '',") && telaSrc.includes("categoryName: grupo ? '' : nomeDoGrupo,"));
check('NCM conferido na rota do estoque', telaSrc.includes('await api(`/api/stock/ncm/${ncm}`)'));

console.log('\n--- o servidor ---');
check('o grupo novo é criado pelo nome', /const nomeDoGrupo = String\(body\.categoryName \|\| ''\)\.trim\(\);[\s\S]{0,900}data\.productCategories\.push\(grupo\);/.test(servidor));
check('preço mínimo não passa do à vista', servidor.includes("return sendJson(res, { error: 'O preço mínimo está acima do preço à vista.' }, 400);"));
check('o FCI só é gravado quando vem (a tela não o tem)', servidor.includes("numeroFci: body.numeroFci === undefined ? undefined : String(body.numeroFci ?? '').trim(),"));
check('produto novo com estoque inicial grava o db.json (grupo, marca, mínimo)',
  /await commitStockMovements\(data, \[movement\], productsById\);[\s\S]{0,300}saveData\(data\);\s*\} else \{/.test(servidor));
check('a busca de produtos acha pelo código do fabricante', servidor.includes('${p.codigoFabricante || \'\'}`.toLowerCase().includes(search)'));
check('as marcas já usadas vão no meta do estoque', /marcas: \[\.\.\.new Set\(Object\.values\(data\.productMeta/.test(servidor));
check('NCM e os CEST dele pela tabela oficial', /\/\^\\\/api\\\/stock\\\/ncm\\\/\\d\{8\}\$\/[\s\S]{0,600}from fiscal_ncm[\s\S]{0,300}from fiscal_cest/.test(servidor));

console.log('\n--- banco, venda e SPED ---');
const migracao = ler('banco/migrations/fase-ep-produto-em-blocos.sql');
['codigo_fabricante text', 'preco_prazo numeric', 'preco_minimo numeric', 'pode_vender boolean not null default true', 'materia_prima boolean not null default false']
  .forEach((col) => check(`  coluna ${col.split(' ')[0]}`, migracao.includes(`add column if not exists ${col}`)));
const { camposComerciais } = (() => {
  const src = ler('lib/db/estoque.js');
  const fonte = src.match(/function camposComerciaisDoProduto\(payload\) \{[\s\S]*?\n\}/)[0];
  return { camposComerciais: new Function(`${fonte}; return camposComerciaisDoProduto;`)() };
})();
check('sem o campo no corpo, a coluna não é escrita (baixa de estoque, gestor de preços)', JSON.stringify(camposComerciais({})) === '{}');
check('  com ele, é', JSON.stringify(camposComerciais({ podeVender: false, materiaPrima: true, precoPrazo: '', codigoFabricante: ' FAB ' }))
  === JSON.stringify({ codigo_fabricante: 'FAB', preco_prazo: null, pode_vender: false, materia_prima: true }));
const venda = ler('lib/db/vendas-compras.js');
const app = ler('public/app.js');
check('a venda recebe o pode vender', venda.includes('podeVender: row.pode_vender !== false'));
check('  e a busca do pedido não oferece quem não pode (mantém os itens do pedido)',
  /\.filter\(\(p\) => p\.podeVender !== false \|\| produtosJaNoPedido\.has\(p\.id\)\)/.test(app));
check('matéria-prima sai com TIPO_ITEM 01 no SPED', ler('lib/db/sped-escrituracao.js').includes("case when prod.materia_prima then 'MATERIA_PRIMA' else pf.tipo_produto_fiscal end as pf_tipo"));

console.log('\n--- CSS ---');
check('o painel do produto é centrado', /\.produto-form-wrap\s*\{[^}]*margin-inline:\s*auto/.test(cssSrc));
check('e a tela usa esse invólucro', /class="produto-form-wrap"/.test(telaSrc));
check('as chaves não esticam (o checkbox fica fora da largura dos campos)', /\.produto-bloco label > input:not\(\[type="checkbox"\]\),/.test(cssSrc));

console.log('\n--- as abas das OUTRAS telas (Pessoas, Venda) continuam de pé ---');
check('.cadastro-tabs é definida uma vez só no CSS', (cssSrc.match(/^\.cadastro-tabs\s*\{/gm) || []).length === 1);
check('.cadastro-tab-panel também', (cssSrc.match(/^\.cadastro-tab-panel\s*\{/gm) || []).length === 1);
check('e o painel oculto tem display:none explícito', /\.cadastro-tab-panel\[hidden\]\s*\{\s*display:\s*none/.test(cssSrc));
check('a aba da venda é grade', /\.sales-tab-panel \{[^}]*display: grid/.test(cssSrc));
check('  com o mesmo passo do formulário', /\.sales-tab-panel \{[^}]*gap: 26px/.test(cssSrc));
check('  e a aba oculta tem display:none explícito', /\.sales-tab-panel\[hidden\]\s*\{\s*display:\s*none/.test(cssSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
