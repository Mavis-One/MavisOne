#!/usr/bin/env node
/**
 * O FILTRO "EMPRESA (FATURAMENTO)" DOS RELATÓRIOS (05/11/2026).
 *
 * Pedido do usuário: "quero que apareça as empresas aonde os pedidos foram
 * faturados". O filtro "Filial" listava o fim da categoria do pedido
 * (Assistência, Peças, Kaccau, Plus...) — a LOJA da venda, que não diz onde o
 * pedido faturou: medido no banco, metade dos "Marcolla" saiu com NF-e da
 * Matriz. A empresa agora vem de cada pedido (lib/relatorios/comum.js,
 * empresaDoPedidoSql), na ordem: a NF-e autorizada dele, o documento fiscal
 * ligado, a Empresa do pedido e, no pedido do Viper, o "Empresa:" que a
 * importação gravou na observação.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const comum = require('../lib/relatorios/comum');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

console.log('\n--- 1. a regra ---');
const sql = comum.empresaDoPedidoSql('o', [
  { id: 'company-1', document: '43.792.899/0001-35' },
  { id: "x'); drop table orders; --", document: '43792899000135' },
  { id: 'company-2', document: '123' }
]);
const pos = (trecho) => sql.indexOf(trecho);
check('nesta ordem: a NF-e autorizada, o documento fiscal ligado, a Empresa do pedido, o pedido do Viper',
  pos('from nfe n') > 0 && pos('from nfe n') < pos('from fiscal_documentos fd') && pos('from fiscal_documentos fd') < pos('company_id')
  && pos('company_id') < pos("Importado do ViperERP"));
check('  só a NF-e AUTORIZADA, e só o documento REGULAR', /upper\(n\.status\) = 'AUTORIZADO'/.test(sql) && /fd\.situacao = 'REGULAR'/.test(sql));
check('  o mapa da Empresa do pedido só leva id e CNPJ no formato (nada de aspa)',
  /"company-1":"43792899000135"/.test(sql) && !/drop table/.test(sql) && !/company-2/.test(sql));
check('  os nomes do Viper viram o CNPJ pelo mapa da importação',
  /\('SAL INFINITY ELECTRIC LTDA', '46877837000114'\)/.test(sql) && /\('SAL INFINITY PLUS COMERCIO LTDA FILIAL 06 \(GUARAMIRIM\)', '43792899000640'\)/.test(sql)
  && /'viper:' \|\| x\.nome/.test(sql));

console.log('\n--- 2. o valor do filtro ---');
check('CNPJ com ou sem pontuação', comum.empresaPedida('43.792.899/0001-35') === '43792899000135' && comum.empresaPedida('43792899000135') === '43792899000135');
check('empresa só do Viper, em maiúsculas', comum.empresaPedida('viper:Kaccau Eletric') === 'viper:KACCAU ELETRIC');
check('"não identificada"', comum.empresaPedida('sem-empresa') === comum.SEM_EMPRESA);
check('o resto vira "todas" (o nome antigo da filial, texto torto)',
  comum.empresaPedida('Araquari') === '' && comum.empresaPedida("viper:x'; drop") === '' && comum.empresaPedida('') === '');

console.log('\n--- 3. os nomes ---');
(async () => {
  const nomes = await comum.nomesDasEmpresas(async () => [{ cnpj: '43792899000216', nome: 'SAL INFINITY PLUS (MARCOLLA)' }],
    [{ document: '46.877.837/0001-14', tradeName: 'SAL INFINITY ELECTRIC' }, { document: '43792899000216', tradeName: 'outro nome' }]);
  check('o do estabelecimento vale mais que o do cadastro', nomes.get('43792899000216') === 'SAL INFINITY PLUS (MARCOLLA)');
  check('  sem estabelecimento, o do cadastro de empresas (a Electric no banco local)', nomes.get('46877837000114') === 'SAL INFINITY ELECTRIC');
  check('  a do Viper diz que é de lá', nomes.get('viper:KACCAU ELETRIC') === 'KACCAU ELETRIC (só no Viper)');
  check('  CNPJ sem nome sai formatado', nomes.get('11222333000181') === '11.222.333/0001-81');

  console.log('\n--- 4. onde vale ---');
  const vendas = ler('lib/relatorios/vendas.js');
  check('o filtro de todo relatório de venda é a empresa', /filtroDeEmpresaSql\('o', `\$\$\{i \+ 2\}`, ctx\.data && ctx\.data\.companies\)/.test(vendas) && !/filialSql\(/.test(vendas));
  check('  Pedidos Faturados e Itens dos Pedidos mostram a coluna', (vendas.match(/rotulo: 'Empresa \(faturamento\)'/g) || []).length === 2);
  const fiscal = ler('lib/relatorios/fiscal.js');
  check('  Pedidos x NF-e também (filtro e coluna)', /filtroDeEmpresaSql\('o', '\$4', empresas\)/.test(fiscal) && /rotulo: 'Empresa \(faturamento\)'/.test(fiscal));
  const servidor = ler('server.js');
  // (06/11/2026: a lista virou empresasDosRelatorios, a de todo relatório.)
  check('a lista do filtro: as empresas, as só do Viper e "não identificada"',
    /\.\.\.empresasDoFiltroDosRelatorios\(nomes\.todos\(\)\),\s*\.\.\.soNoViper,/.test(servidor)
    && /id: relatoriosComum\.SEM_EMPRESA, name: 'Empresa não identificada'/.test(servidor));
  check('a tela chama o campo de "Empresa (faturamento)" nas vendas, com o CNPJ no valor',
    /select\('filial', def\.rotuloDaEmpresa \|\| 'Empresa',/.test(ler('public/modules/reports/subs/catalogo.js'))
    && require('../lib/relatorios').catalogoVisivel({ allowedModules: [] }, true).find((g) => g.key === 'vendas')
      .relatorios.find((r) => r.key === 'pedidos-faturados').rotuloDaEmpresa === 'Empresa (faturamento)');
  // A lista mudou de nome (05/11/2026): a tela aberta antes do deploy lia os
  // objetos novos em `filiais` como texto e mostrava "[object Object]".
  check('  a lista vem como empresasDeFaturamento, e não mais como filiais', /empresasDeFaturamento: empresas,/.test(servidor) && !/\n\s*filiais: \[/.test(servidor));

  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})();
