#!/usr/bin/env node
// Permissões do módulo Fiscal — a tela e o portão do servidor têm de falar a
// mesma língua.
//
// A FALHA QUE ESTE TESTE PEGA NÃO DÁ ERRO EM LUGAR NENHUM
// -------------------------------------------------------
// A tela de Usuários oferecia 15 permissões fiscais. resolveFiscalPermission,
// que é quem decide se a requisição passa, só sabia exigir 10. As outras cinco
// — criar, editar, documentos_recebidos, manifestar, auditoria — podiam ser
// marcadas, salvavam no banco e voltavam marcadas na próxima abertura. Não
// controlavam nada: nenhuma rota as exigia, nenhuma tela as consultava.
//
// Ninguém descobre isso por acidente. O administrador marca "Manifestar
// documentos", vê a caixa marcada, e acredita ter concedido (ou, pior, ter
// NEGADO ao deixar desmarcada) um controle que não existe. É o mesmo problema
// do prefixo errado em lib/permissoes.js: uma regra que não casa é pior do que
// regra nenhuma, porque faz o leitor acreditar que há proteção.
//
// Roda sem banco e sem rede: lê o catálogo compartilhado e o texto do
// server.js.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, detalhe) => {
  if (cond) {
    console.log(`  OK  ${nome}`);
  } else {
    falhas += 1;
    console.log(`  XX  ${nome}${detalhe ? ` -> ${detalhe}` : ''}`);
  }
};

const P = require(path.join(RAIZ, 'public/modules/shared/fiscal_permissoes.js'));
const serverSrc = ler('server.js');
const formSrc = ler('public/modules/settings/subs/users_form.js');

console.log('--- toda permissão oferecida é realmente exigida por alguma rota ---');
// O corpo de resolveFiscalPermission é a lista COMPLETA do que o portão sabe
// cobrar: nenhuma outra parte do sistema consulta fiscalPermissions.
const corpo = serverSrc.match(/function resolveFiscalPermission[\s\S]*?\n\}/);
check('resolveFiscalPermission foi encontrada', Boolean(corpo));
const exigidas = [...new Set([...(corpo ? corpo[0] : '').matchAll(/return '([a-z_]+)'/g)].map((m) => m[1]))];

const oferecidasSemUso = P.VALORES.filter((v) => !exigidas.includes(v));
check('nenhuma permissão oferecida sem rota que a exija', oferecidasSemUso.length === 0, oferecidasSemUso.join(', '));

// O outro lado do mesmo acordo: uma rota que exige 'inutilizar' sem a caixa na
// tela tranca o usuário para fora sem nenhum jeito de liberar.
const exigidasSemCaixa = exigidas.filter((v) => !P.VALORES.includes(v));
check('nenhuma rota exige permissão que não existe na tela', exigidasSemCaixa.length === 0, exigidasSemCaixa.join(', '));

console.log('\n--- as cinco permissões fantasma não voltam ---');
P.REMOVIDAS.forEach((valor) => {
  check(`'${valor}' saiu do catálogo`, !P.VALORES.includes(valor));
});
// Usuário salvo antes da limpeza ainda tem 'manifestar' na coluna do banco.
check('permissão antiga é filtrada na leitura', JSON.stringify(P.sanitizar(['emitir', 'manifestar', 'auditoria', 'xml'])) === '["emitir","xml"]');
check('e duplicata não passa', JSON.stringify(P.sanitizar(['xml', 'xml'])) === '["xml"]');
check('lista inválida vira vazia', JSON.stringify(P.sanitizar(null)) === '[]');
// Sanitizar só na tela deixaria um POST à mão gravar o que quisesse.
check('o servidor sanitiza ao criar', /fiscalPermissions: fiscalPermissoes\.sanitizar\(body\.payload\.fiscalPermissions\)/.test(serverSrc));
check('ao editar', /fiscalPermissions: fiscalPermissoes\.sanitizar\(/.test(serverSrc));
check('e ao devolver a lista de usuários', /fiscalPermissions: fiscalPermissoes\.sanitizar\(entry\.fiscalPermissions\)/.test(serverSrc));

console.log('\n--- uma lista só, carregada pelos dois lados ---');
// Duas cópias da mesma decisão divergem na primeira alteração feita de um lado
// — foi exatamente como as cinco fantasmas apareceram.
check('o servidor carrega o catálogo compartilhado', /require\('\.\/public\/modules\/shared\/fiscal_permissoes'\)/.test(serverSrc));
check('a tela usa o mesmo catálogo', /window\.MavisFiscalPermissoes\.CATALOGO/.test(formSrc));
check('e não tem lista própria', !/\{ value: 'emitir', label: 'Emitir NF-e' \}/.test(formSrc));
check('o arquivo é carregado no index', /modules\/shared\/fiscal_permissoes\.js/.test(ler('public/index.html')));

console.log('\n--- quem tem o módulo Fiscal consegue receber permissão fiscal ---');
// A seção só aparecia para 'finance' e 'settings', enquanto o portão aceitava
// 'fiscal' também: marcar só o módulo Fiscal escondia as caixas, e o usuário
// ficava sem nenhuma permissão fiscal sem que o admin entendesse por quê.
check('fiscal habilita', P.habilitadoPor(['fiscal']));
check('finance habilita', P.habilitadoPor(['finance']));
check('settings habilita', P.habilitadoPor(['settings']));
check('estoque sozinho não habilita', !P.habilitadoPor(['stock']));
check('a tela usa a regra compartilhada', /window\.MavisFiscalPermissoes\.habilitadoPor\(marcados\)/.test(formSrc));
check('o servidor usa a mesma', /fiscalPermissoes\.habilitadoPor\(user\.allowedModules\)/.test(serverSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
