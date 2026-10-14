#!/usr/bin/env node
/**
 * CENTRO DE CUSTO VINCULADO ÀS EMPRESAS (fase EK, 14/10/2026).
 *
 * Pedido do usuário: "o usuário do financeiro consegue criar centro de custo,
 * nomeia e vincula a empresa que ele gostaria de utilizar em tal centro de
 * custo". Tela Financeiro › Centros de Custo; no lançamento, o campo mostra os
 * centros da empresa do lançamento (e os sem empresa, que valem para todas).
 *
 * Provado no navegador (centros de teste apagados depois): um centro ligado a
 * Marcolla e Timbó aparece no lançamento da Marcolla e some no da Araquari;
 * um sem empresa aparece nos dois; o "+" do lançamento cria já ligado à
 * empresa escolhida; empresa inexistente é recusada.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

console.log('--- 1. banco ---');
check('migração: lista de empresas no centro, vazia = todas',
  /alter table cost_centers\s+add column if not exists estabelecimento_ids text\[\] not null default '\{\}';/.test(ler('banco/migrations/fase-ek-centro-de-custo-por-empresa.sql')));
check('  e o SQL de recriar do zero já tem a coluna', /estabelecimento_ids text\[\] not null default '\{\}'/.test(ler('banco/RECRIAR-DO-ZERO.sql')));
const fin = ler('lib/db/financeiro.js');
check('a leitura devolve as empresas do centro', /estabelecimentoIds: Array\.isArray\(row\.estabelecimento_ids\) \? row\.estabelecimento_ids : \[\]/.test(fin));
check('criar e editar gravam as empresas', /estabelecimento_ids: Array\.isArray\(payload\.estabelecimentoIds\)/.test(fin) && /async function updateCostCenter\(id, payload\)/.test(fin));
check('nada é criado sozinho (o usuário cria)', !/CENTROS_DAS_EMPRESAS|cc-estab-/.test(fin));

console.log('\n--- 2. servidor ---');
const servidor = ler('server.js');
check('criar recebe as empresas', /const estabelecimentoIds = await estabelecimentosDoCentroDeCusto\(body\.estabelecimentoIds\);\s*const costCenter = await db\.createCostCenter\(\{ name, estabelecimentoIds \}\);/.test(servidor));
check('editar: rota PUT com nome e empresas', /\/\^\\\/api\\\/finance\\\/cost-centers\\\/\[\^\/\]\+\$\/\.test\(pathname\) && req\.method === 'PUT'/.test(servidor)
  && /await db\.updateCostCenter\(id, \{ name, estabelecimentoIds \}\)/.test(servidor));
check('empresa que não existe é recusada', /'Empresa não encontrada para o centro de custo\.'/.test(servidor));
check('só quem tem o Financeiro', (servidor.match(/cost-centers[\s\S]{0,400}user\.allowedModules\.includes\('finance'\)/g) || []).length >= 2);

console.log('\n--- 3. telas ---');
const app = ler('public/app.js');
check('Centros de Custo no menu do Financeiro', /\{ key: 'centros_de_custo', label: 'Centros de Custo'/.test(app)
  && /'centros_de_custo'/.test(ler('public/modules/finance/index.js'))
  && /finance\/subs\/centros_de_custo\.js/.test(ler('public/index.html')));
const tela = ler('public/modules/finance/subs/centros_de_custo.js');
check('a tela cria e edita com nome e empresas', /name="estabelecimentoIds"/.test(tela) && /method: 'PUT'/.test(tela) && /method: 'POST'/.test(tela));
const novo = ler('public/modules/finance/subs/novo_lancamento.js');
check('o lançamento mostra os centros da empresa (e os de todas)', /return !ids\.length \|\| !estabelecimentoAtual \|\| ids\.includes\(estabelecimentoAtual\);/.test(novo));
check('  e refaz a lista ao trocar a empresa', /querySelectorAll\('\.js-cost-center-select'\)\.forEach\(\(select\) => \{\s*const escolhido = select\.value;/.test(novo));
check('o + do lançamento cria ligado à empresa escolhida', /inlineAddKind === 'costCenter' && estabelecimentoAtual \? \{ name, estabelecimentoIds: \[estabelecimentoAtual\] \}/.test(novo));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
