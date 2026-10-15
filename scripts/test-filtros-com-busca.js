#!/usr/bin/env node
/**
 * PEDIDOS E ORÇAMENTOS: AS LISTAS DA BUSCA AVANÇADA VIRARAM CAMPOS DE BUSCA
 * (15/10/2026). Pedido do usuário: "transforme esses campos em campos de
 * pesquisa e seleção unidos", como a Tabela de Preços da venda.
 *
 * Tipo, Status do Sistema, Empresa, Vendedor, Transportadora, Categoria e
 * Origem da Venda: digita e escolhe, ou abre tudo pela lupa. Campo vazio é
 * Todos; a lista começa por "Todos", que limpa o filtro; texto solto sem
 * escolha some ao sair do campo.
 *
 * Provado no navegador: "fatur" no Status listou os 5 status de faturamento;
 * Status "Pedido Faturado" + Vendedor pela lupa + Buscar = 93 registros, e os
 * dois campos voltaram preenchidos; "xyz" na Empresa sem escolher ficou vazio;
 * "Todos" na lupa do Status limpou o campo.
 *
 * De carona, a lupa: ela abria a lista inteira e DEPOIS focava o campo — e o
 * foco num campo com texto filtra pelo texto. Com algo escolhido, a lupa
 * mostrava só o próprio escolhido (em todo campo de busca do sistema).
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const app = semComentarios(fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8'));
const NOMES = ['type', 'status', 'companyId', 'sellerId', 'carrierId', 'category', 'saleOrigin'];

console.log('\n--- os sete filtros de lista ---');
const painel = app.slice(app.indexOf('<form id="salesFilterForm"'), app.indexOf('<aside class="sales-busca-datas">'));
check('o painel existe', painel.length > 1000);
NOMES.forEach((nome) => {
  check(`${nome}: campo de busca`, painel.includes(`filtroComBusca('${nome}')`));
});
check('nenhum <select> sobrou fora do bloco de datas', !/<select\b/.test(painel), (painel.match(/<select[^>]*>/g) || []).join(' '));
NOMES.forEach((nome) => {
  check(`${nome} continua no catálogo de filtros`, new RegExp(`'${nome}'`).test(app.slice(app.indexOf('const SALES_FILTROS'), app.indexOf('const salesFiltrosVazios'))));
});

console.log('\n--- Todos ---');
check('a lista começa pela opção vazia (Todos/Todas)',
  /\.map\(\(f\) => \(\{ \.\.\.f, options: \[\{ value: '', label: f\.todos \}, \.\.\.f\.opcoes\] \}\)\)/.test(app));
check('o campo é desenhado sem ela (filtro vazio = campo vazio)',
  /renderSearchableSelect\(\{\s*id: f\.id, name: f\.name, options: f\.opcoes, selectedValue: filters\[name\],/.test(app));
check('escolher Todos limpa o texto', /onSelect: \(escolhido\) => \{ if \(!escolhido && campo\) campo\.value = ''; \}/.test(app));
check('texto sem escolha some ao sair', /campo\?\.addEventListener\('blur', \(\) => \{\s*if \(valor && !valor\.value\) campo\.value = '';/.test(app));
check('lista vazia (sem transportadora/categoria) fica só leitura', /readonly: f\.opcoes\.length === 0/.test(app));

console.log('\n--- a lupa abre tudo, mesmo com algo escolhido ---');
check('foca antes de abrir a lista inteira',
  /if \(!dropdown\.hidden\) \{ fecharLista\(\); return; \}\s*input\.focus\(\);\s*renderDropdown\('', \{ mostrarTudo: true \}\);/.test(app));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
