#!/usr/bin/env node
/**
 * UM CAMPO SÓ PARA ACHAR O CADASTRO (15/10/2026). Pedido do usuário: "junte o
 * campo de busca de nome/cpf/cnpj na tela inicial como um campo só para
 * consultar clientes cadastrados ao invés de 3 campos diferentes dentro de
 * filtros".
 *
 * Provado no navegador (6.496 cadastros locais): "53.812.831/0001-24" achou 1
 * (SAL INFINITY BY BLUMENAU), "43792899000135" achou a matriz, "jose" achou
 * 155; o painel de Filtros não tem mais Nome / Nome fantasia, CNPJ/CPF nem
 * Busca; com o painel aberto (Tipo: Pessoas) a busca continuou valendo; Limpar
 * filtros zerou a busca.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const L = require('../public/modules/shared/lista_de_cadastros.js');
const app = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');

console.log('--- a busca ---');
const linhas = [
  { id: '1', kind: 'cnpj', name: 'SAL INFINITY BY BLUMENAU LTDA', tradeName: 'SAL BLUMENAU', document: '53812831000124', phone: '47 3208-9326', roles: ['Cliente'], status: 'ativo' },
  { id: '2', kind: 'people', name: 'JOSÉ JATAITAN', tradeName: '', document: '070.003.999-61', phone: '', roles: ['Cliente'], status: 'ativo' }
];
const achar = (q) => L.filtrar(linhas, L.normalizarFiltros({ query: q }), {}, null).map((r) => r.id).join(',') || 'nenhum';
check('CNPJ com pontuação acha o documento guardado só com dígitos', achar('53.812.831/0001-24') === '1', achar('53.812.831/0001-24'));
check('CPF com pontuação acha documento guardado com pontuação', achar('070.003.999-61') === '2');
check('pedaço do número também acha', achar('53812831') === '1');
check('nome sem acento acha "JOSÉ"', achar('jose') === '2');
check('nome fantasia acha', achar('blumenau') === '1');
check('telefone com traço acha', achar('3208-9326') === '1');

console.log('\n--- a tela ---');
check('campo único na tela inicial, sempre à vista', app.includes('<form id="cadastroBuscaRapida" class="cadastro-busca-rapida" role="search">')
  && app.includes('placeholder="Nome, nome fantasia, CPF ou CNPJ"'));
check('o painel não tem mais Nome / Nome fantasia, CNPJ/CPF nem Busca',
  !app.includes('<span>Nome / Nome fantasia</span>') && !app.includes('<input name="document" value="${escapeHtml(listFilters.document)}" />')
  && !app.includes('placeholder="Nome, documento, e-mail ou telefone"'));
check('  nome e documento antigos zerados (não filtram escondido)', (app.match(/nameFantasy: '',/g) || []).length >= 3);
check('o painel lê a busca do campo da tela inicial', app.includes("query: String(document.getElementById('cadastroBuscaInput')?.value || '').trim(),"));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
