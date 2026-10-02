#!/usr/bin/env node
/**
 * O RELATÓRIO PERSONALIZADO (fase DQ), sem banco.
 *
 * O que este teste guarda é uma coisa só: NADA QUE O USUÁRIO ESCOLHE OU DIGITA
 * VIRA SQL. O relatório salvo traz nomes de campo, operadores e valores; a
 * consulta é montada a partir da lista fechada de cada fonte, e os valores vão
 * como parâmetro. Se um dia alguém "simplificar" passando o nome da coluna ou
 * o valor direto para o texto da consulta, este teste quebra.
 *
 * E as portas: a fonte pede o módulo dela, a venda respeita o escopo do
 * vendedor, e editar ou excluir é de quem criou.
 *
 * A consulta de cada campo de cada fonte é provada contra o banco por
 * scripts/prova-relatorio-personalizado.js.
 */
const fs = require('fs');
const path = require('path');
const p = require('../lib/relatorios/personalizado');
const catalogo = require('../lib/relatorios');
const motor = require('../lib/relatorios/motor');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (arq) => fs.readFileSync(path.join(__dirname, '..', arq), 'utf8');
const recusa = (bruto) => { try { p.validarDefinicao(bruto); return ''; } catch (e) { return e.status === 400 ? e.message : `SEM STATUS: ${e.message}`; } };

console.log('\n--- 1. as fontes ---');
const modulos = new Set(catalogo.GRUPOS.map((g) => g.modulo));
check('as oito fontes do Viper', JSON.stringify(p.FONTES.map((f) => f.key)) === JSON.stringify(['lancamentos', 'vendas', 'itens-vendas', 'notas-entrada', 'itens-notas-entrada', 'notas-saida', 'pessoas', 'movimentos-estoque']));
check('cada fonte pede um módulo que existe', p.FONTES.every((f) => modulos.has(f.modulo)), p.FONTES.map((f) => f.modulo).join(','));
check('campo sem nome repetido dentro da fonte', p.FONTES.every((f) => new Set(f.campos.map((c) => c.campo)).size === f.campos.length));
const TIPOS = new Set(['texto', 'codigo', 'data', 'moeda', 'numero', 'quantidade', 'percentual', 'inteiro']);
check('todo campo tem tipo conhecido', p.FONTES.every((f) => f.campos.every((c) => TIPOS.has(c.tipo))));
check('toda fonte tem colunas padrão', p.FONTES.every((f) => f.campos.some((c) => c.padrao)));
check('o campo de data do período existe e é data', p.FONTES.every((f) => !f.campoData || (f.campos.find((c) => c.campo === f.campoData) || {}).tipo === 'data'));
check('as fontes de pedido aplicam o escopo do vendedor', p.FONTES.filter((f) => /\borders o\b/.test(f.from) && f.key !== 'notas-saida').every((f) => f.vendedorSql === 'o.seller_id'));
const tela = p.fontesVisiveis(() => true);
check('a tela não recebe expressão SQL nem o FROM', !JSON.stringify(tela).includes('coalesce(') && !JSON.stringify(tela).includes('left join'));
check('a tela só recebe as fontes do módulo que a pessoa tem', JSON.stringify(p.fontesVisiveis((m) => m === 'sales').map((f) => f.key)) === '["vendas","itens-vendas"]');

console.log('\n--- 2. o que pode ser gravado ---');
const ok = { nome: 'Inventário 2026', fonte: 'itens-vendas', colunas: ['pedido', 'data', 'produto', 'quantidade'] };
check('definição correta passa', recusa(ok) === '');
check('sem nome é recusado', /nome/.test(recusa({ ...ok, nome: '  ' })));
check('fonte inventada é recusada', /fonte/.test(recusa({ ...ok, fonte: 'pg_shadow' })));
check('coluna inventada é recusada (não descartada)', /não existe/.test(recusa({ ...ok, colunas: ['pedido', 'total; drop table orders'] })));
check('sem coluna é recusado', /coluna/.test(recusa({ ...ok, colunas: [] })));
check('"contém" num valor em dinheiro é recusado', /operador/.test(recusa({ ...ok, filtros: [{ campo: 'total', operador: 'contem', valor: '1' }] })));
check('operador inventado é recusado', /operador/.test(recusa({ ...ok, filtros: [{ campo: 'produto', operador: "'; delete", valor: 'x' }] })));
check('data que não é data é recusada', /válido/.test(recusa({ ...ok, filtros: [{ campo: 'data', operador: 'maior', valor: 'ontem' }] })));
check('número que não é número é recusado', /válido/.test(recusa({ ...ok, filtros: [{ campo: 'quantidade', operador: 'maior', valor: '1 or 1=1' }] })));
check('"entre" sem o segundo valor é recusado', /dois valores/.test(recusa({ ...ok, filtros: [{ campo: 'data', operador: 'entre', valor: '2026-01-01' }] })));
check('ordem por campo inventado é recusada', /ordem/.test(recusa({ ...ok, ordem: [{ campo: 'random()' }] })));
const limpa = p.validarDefinicao({ ...ok, extra: 'x', ordem: [{ campo: 'data', direcao: 'qualquer' }], filtros: [{ campo: 'produto', operador: 'vazio', valor: 'ignorado' }] });
check('o que volta é só o que se grava', JSON.stringify(Object.keys(limpa)) === '["nome","fonte","colunas","filtros","ordem","compartilhado"]');
check('  direção desconhecida vira crescente', limpa.ordem[0].direcao === 'asc');
check('  "está vazio" não guarda valor', !('valor' in limpa.filtros[0]));

console.log('\n--- 3. a consulta ---');
const INJECAO = "x'; drop table orders; --";
const def = p.validarDefinicao({
  ...ok,
  filtros: [
    { campo: 'produto', operador: 'contem', valor: INJECAO },
    { campo: 'cliente', operador: 'igual', valor: 'Robert"); select pg_sleep(10); --' },
    { campo: 'quantidade', operador: 'entre', valor: '1', valor2: '5' },
    { campo: 'data', operador: 'maiorIgual', valor: '2026-01-01' }
  ],
  ordem: [{ campo: 'data', direcao: 'desc' }]
});
const q = p.montarConsulta(def, { de: '2026-01-01', ate: '2026-12-31', vendedores: ['v1'] });
check('o valor digitado não aparece no texto da consulta', !q.texto.includes('drop table') && !q.texto.includes('pg_sleep'));
check('  vai como parâmetro', q.parametros.some((v) => String(v).includes('drop table')));
check('"contém" escapa o curinga: quem busca "10%" busca o texto', p.montarConsulta(p.validarDefinicao({ ...ok, filtros: [{ campo: 'produto', operador: 'contem', valor: '10%_' }] })).parametros[0] === '%10\\%\\_%');
check('o escopo do vendedor entra como parâmetro', /o\.seller_id = any\(\$1::text\[\]\)/.test(q.texto) && JSON.stringify(q.parametros[0]) === '["v1"]');
check('vendedor sem nenhum vendedor permitido não vê nada (lista vazia, não "todos")',
  /o\.seller_id = any/.test(p.montarConsulta(def, { vendedores: [] }).texto));
check('quem vê todas as vendas não ganha a condição', !/seller_id = any/.test(p.montarConsulta(def, { vendedores: null }).texto));
check('fonte que não é venda ignora o escopo', !/seller_id = any/.test(p.montarConsulta(p.validarDefinicao({ nome: 'x', fonte: 'lancamentos', colunas: ['valor'] }), { vendedores: ['v1'] }).texto));
check('o período recorta o campo de data da fonte', /o\.date >= \$2::date/.test(q.texto) && /o\.date <= \$3::date/.test(q.texto));
check('a ordem pedida', /order by o\.date desc nulls last/.test(q.texto));
check('e um teto de linhas', new RegExp(`limit ${p.LIMITE_DE_LINHAS + 1}`).test(q.texto));
check('os apelidos das colunas não vêm do usuário', /as c0,/.test(q.texto) && !/as "/.test(q.texto));

console.log('\n--- 4. a execução ---');
(async () => {
  const linhasFalsas = [{ c0: 15507, c1: '2026-09-11', c2: 'BIKE', c3: '2' }, { c0: 15508, c1: '2026-09-12', c2: 'PECA', c3: '3.5' }];
  const r = await p.executar(def, { sql: async () => linhasFalsas, de: '2026-09-01', ate: '2026-09-30', id: 'rel-1', agora: '2026-10-02T15:00:00Z' });
  check('as colunas na ordem escolhida', JSON.stringify(r.colunas.map((c) => c.campo)) === '["pedido","data","produto","quantidade"]');
  check('número vem como número', r.linhas[1].quantidade === 3.5);
  check('o total soma a quantidade e não o número do pedido', r.totais.quantidade === 5.5 && !('pedido' in r.totais), JSON.stringify(r.totais));
  check('o título é o nome do relatório e o CSV sai', r.titulo === 'Inventário 2026' && motor.paraCsv(r).includes('Total'));
  const muitas = Array.from({ length: p.LIMITE_DE_LINHAS + 1 }, (_, i) => ({ c0: i, c1: '2026-01-01', c2: 'x', c3: 1 }));
  const cortado = await p.executar(def, { sql: async () => muitas });
  check('passou do teto: corta e avisa', cortado.limitado === true && cortado.linhas.length === p.LIMITE_DE_LINHAS);

  console.log('\n--- 5. a rota e a gravação ---');
  const servidor = ler('server.js');
  const rota = servidor.slice(servidor.indexOf('// O RELATÓRIO PERSONALIZADO'), servidor.indexOf("if (pathname === '/api/reports/vendas' && req.method === 'GET')"));
  check('as rotas existem', /\/\^\\\/api\\\/reports\\\/personalizados\\\/\(\[A-Za-z0-9_-\]\+\)/.test(rota) && /pathname === '\/api\/reports\/personalizados'/.test(rota));
  check('criar e editar passam pela validação', (rota.match(/validarDefinicao\(await readBody\(req\)\)/g) || []).length === 2);
  check('  e a definição gravada é conferida de novo ao rodar', /const def = relatorioPersonalizado\.validarDefinicao\(rel\);/.test(rota));
  check('editar e excluir só de quem criou (ou do administrador)', /if \(!podeMexerNoPersonalizado\(porta, rel\)\) return sendJson\(res, \{ error: 'Só quem criou/.test(rota));
  check('a fonte pede o módulo dela, ao ver e ao gravar', (rota.match(/podeVerModulo\(porta, relatorioPersonalizado\.fonte\(def\.fonte\)\.modulo\)/g) || []).length === 2 && /podeVerPersonalizado/.test(rota));
  check('o escopo de vendas é o de quem RODA', /vendedores: escopoLib\.vendedoresPermitidos\(escopo, ''\)/.test(rota));
  check('inexistente e invisível respondem igual (404)', /if \(!rel \|\| !podeVerPersonalizado\(porta, rel\)\) return sendJson\(res, \{ error: 'Relatório não encontrado' \}, 404\)/.test(rota));
  const migracao = ler('banco/migrations/fase-dq-relatorio-personalizado.sql');
  check('a tabela guarda escolha, não SQL', /create table if not exists relatorio_personalizado/.test(migracao) && !/\bsql\b text/.test(migracao));
  check('e as permissões de gravar existem', ['reports.criar', 'reports.editar', 'reports.excluir'].every((s) => migracao.includes(`'${s}'`)));
  const db = ler('lib/db/relatorios-personalizados.js');
  check('a camada de banco só usa parâmetros', !/consultar\(\s*`[^`]*\$\{/.test(db));

  console.log('\n--- 6. a tela ---');
  const index = ler('public/index.html');
  check('a tela entra na página depois do catálogo', index.indexOf('reports/subs/catalogo.js') > 0 && index.indexOf('reports/subs/personalizado.js') > index.indexOf('reports/subs/catalogo.js'));
  check('e no menu de Relatórios, em primeiro', /reports: \[\n    \{ key: 'personalizado', label: 'Personalizado'/.test(ler('public/app.js')));
  check('o módulo despacha para ela', /state\.activeSub === 'personalizado' && window\.MavisRelatoriosPersonalizados/.test(ler('public/modules/reports/index.js')));
  const telaJs = ler('public/modules/reports/subs/personalizado.js');
  check('a tela não monta SQL', !/select |from |where /i.test(telaJs.replace(/^\s*\/\/.*$/gm, '').replace(/<select|<\/select>|querySelector/g, '')));

  console.log(falhas ? `\n===== ${falhas} CHECK(S) FALHARAM =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})();
