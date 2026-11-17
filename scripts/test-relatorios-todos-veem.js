/**
 * NOS RELATÓRIOS, TODOS VEEM TODAS AS VENDAS (17/11/2026).
 *
 * O usuário mandou o print do Relatório de Vendas com "0 linhas" — "os
 * usuários não estão tendo acesso aos relatórios" — e decidiu: "Todos veem
 * tudo". Até aqui só o administrador via todas as vendas; o vendedor via só as
 * dele e quem não tinha vendedor vinculado (inclusive o Gerente) via nenhuma.
 *
 * SÓ NOS RELATÓRIOS: lista de vendas, Meu Painel, Dashboard, metas e
 * alterar/excluir pedido seguem com a regra do vendedor (escopoDeVendas).
 *
 *   node scripts/test-relatorios-todos-veem.js
 */
const fs = require('fs');
const path = require('path');
const escopoLib = require('../lib/relatorios-escopo');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas++;
};

console.log('--- a regra dos relatórios ---');
const semVinculo = { id: 'u1', active: true, sellerId: '' };
const vendedor = { id: 'u2', active: true, sellerId: 'vend-1' };
for (const [nome, usuario] of [['sem vendedor vinculado', semVinculo], ['vendedor comum', vendedor]]) {
  const e = escopoLib.escopoDosRelatorios(usuario);
  check(`${nome}: todas as vendas, e escolhe o vendedor`, e.sellerIds === null && e.podeEscolherVendedor === true && e.rotulo === 'Todas as vendas'
    && escopoLib.vendaVisivel(e, 'qualquer-outro') && escopoLib.vendedoresPermitidos(e, '') === null);
}
check('usuário inativo ou sem sessão: nada', escopoLib.escopoDosRelatorios({ active: false }).sellerIds.length === 0
  && escopoLib.escopoDosRelatorios(null).sellerIds.length === 0);

console.log('\n--- fora dos relatórios nada muda ---');
check('o vendedor segue vendo só as dele', JSON.stringify(escopoLib.escopoDeVendas(vendedor, { ehAdmin: false }).sellerIds) === '["vend-1"]');
check('sem vínculo segue sem nenhuma', escopoLib.escopoDeVendas(semVinculo, { ehAdmin: false }).sellerIds.length === 0);

console.log('\n--- onde vale no servidor ---');
const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const trecho = (inicio, fim) => servidor.slice(servidor.indexOf(inicio), servidor.indexOf(fim, servidor.indexOf(inicio)));
check('Relatório de Vendas', /const escopo = escopoLib\.escopoDosRelatorios\(user\);/.test(trecho('async function montarRelatorioDeVendas(', 'async function pedidosDaEmpresaDoRelatorio(')));
check('relatórios do catálogo', /const escopo = escopoLib\.escopoDosRelatorios\(porta\.user\);/.test(trecho('async function executarDoCatalogo(', 'motorDeRelatorios.executar(')));
check('menu do catálogo (a lista de vendedores aparece para todos)', /const escopo = escopoLib\.escopoDosRelatorios\(porta\.user\);/.test(trecho("pathname === '/api/reports/catalogo' && req.method === 'GET'", 'empresasDosRelatorios()')));
check('relatórios personalizados', /const escopo = escopoLib\.escopoDosRelatorios\(porta\.user\);\s*\/\/ A definição gravada/.test(servidor));
check('a porta continua: módulo Relatórios e o módulo do grupo',
  /if \(!podeVerRelatorios\(user, ehAdministrador\)\) \{\s*return \{ erro: 'Sem permissão', status: 403 \};/.test(servidor)
  && /if \(!catalogoDeRelatorios\.podeVerGrupo\(porta\.user, catalogoDeRelatorios\.grupoDe\(def\.grupo\), porta\.ehAdministrador\)\)/.test(servidor));
check('Dashboard e lista de vendas seguem com a regra do vendedor', (servidor.match(/escopoLib\.escopoDeVendas\(/g) || []).length >= 15);

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
