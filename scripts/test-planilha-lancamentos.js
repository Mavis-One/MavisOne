#!/usr/bin/env node
/**
 * CONTAS A PAGAR / A RECEBER / LANÇAMENTOS: O EXCEL PRONTO PARA IMPRIMIR
 * (16/10/2026). Pedido do usuário: "formatar o excel que vem diretamente das
 * contas a pagar e receber ... sem precisar mexer nele, gostaria que ele viesse
 * pronto, apenas para impressão".
 *
 * Era um CSV de colunas fixas. Agora "Exportar Excel" baixa um .xlsx com as
 * colunas e a ordem da tela, os mesmos textos dela, total, e a folha impressa
 * pronta: deitada, na largura da página, texto que quebra em vez de ser
 * cortado, o nome da tela no alto e "Emitido em ... · Página X de Y" no pé.
 *
 * Provado: pela tela de Contas a Receber (aba A vencer, 2 títulos), o arquivo
 * baixado abriu no Excel 16 com as 12 colunas da tela, total R$ 650,00, alto
 * "Contas a Receber", pé "Emitido em 16/10/2026 às 09:30" / "Página 1 de 1",
 * linhas de 2 alturas onde o nome não cabia e o total numa linha só. O e2e
 * scripts/test-lote-de-lancamentos.js (seção 6) prova a rota.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const RAIZ = path.join(__dirname, '..');
const xlsx = require(path.join(RAIZ, 'lib/xlsx'));
const P = require(path.join(RAIZ, 'lib/planilha-lancamentos'));
const { lerXlsx } = require(path.join(RAIZ, 'lib/xlsx-leitor'));

console.log('\n--- as colunas seguem a tela ---');
const fonteTela = fs.readFileSync(path.join(RAIZ, 'public/modules/finance/subs/lancamentos.js'), 'utf8');
const chavesDaTela = [...fonteTela.slice(fonteTela.indexOf('const FINANCE_LISTA_COLUNAS = ['), fonteTela.indexOf('const FINANCE_COLUNAS_PADRAO'))
  .matchAll(/\{ chave: '([a-zA-Z]+)'|chave: '([a-zA-Z]+)',/g)].map((m) => m[1] || m[2]);
check('toda coluna da tela existe na planilha', chavesDaTela.length > 10 && chavesDaTela.every((c) => P.COLUNAS[c]), chavesDaTela.filter((c) => !P.COLUNAS[c]).join(','));
check('  com o mesmo rótulo', chavesDaTela.every((c) => fonteTela.includes(`chave: '${c}', rotulo: '${P.COLUNAS[c].titulo}'`) || new RegExp(`chave: '${c}',\\s*rotulo: '${P.COLUNAS[c].titulo}'`).test(fonteTela)));
const padraoDaTela = (fonteTela.match(/const FINANCE_COLUNAS_PADRAO = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/'/g, ''));
check('padrão igual ao da tela', padraoDaTela.slice().sort().join() === P.PADRAO.slice().sort().join());
check('colunas pedidas: só as conhecidas, sem repetir', P.colunasPedidas('description,x,amountPrevisto,description').join() === 'description,amountPrevisto');
check('  nenhuma pedida = as da tela', P.colunasPedidas('').join() === P.PADRAO.join());

console.log('\n--- o conteúdo, como a tela mostra ---');
const lancamentos = [
  { codigo: 'LF0001', code: 1, date: '2026-10-10', dueDate: '2026-10-12', type: 'despesa', status: 'parcial',
    description: 'Despesa referente ao plano de conta 20.01 - FORNECEDOR LTDA.', document: 'LF0001 · NF 12',
    bankAccountName: 'ITAU', empresaNome: 'SAL INFINITY PLUS', empresaCnpj: '43792899000135', clienteFornecedor: '-',
    amountPrevisto: 100, amountRealizado: 40, emAberto: 60 },
  { codigo: 'LF0002', date: '2026-10-11', dueDate: '2026-10-30', type: 'receita', status: 'pago', empresaCnpj: '43792899',
    amountPrevisto: 50, amountRealizado: 50 }
];
const aba = P.abaDosLancamentos({ lancamentos, colunas: P.colunasPedidas('bankAccount,empresa,description,status,document,emAberto,clienteFornecedor'), tela: 'contas_a_pagar', hoje: '2026-10-16', emitidoEm: '16/10/2026 às 10:00' });
const valor = (i, titulo) => aba.linhas[i][aba.colunas.findIndex((c) => c.titulo === titulo)];
check('na ordem pedida', aba.colunas.map((c) => c.titulo).join('|') === 'Conta bancária|Empresa|Descrição|Situação|Documento|Em aberto|Cliente/Fornecedor');
check('descrição resumida, como na tela', valor(0, 'Descrição') === 'FORNECEDOR LTDA.', valor(0, 'Descrição'));
check('documento sem o código na frente', valor(0, 'Documento') === 'NF 12', valor(0, 'Documento'));
check('empresa pelo nome; sem nome, o CNPJ (ou a raiz)', valor(0, 'Empresa') === 'SAL INFINITY PLUS' && valor(1, 'Empresa') === '43.792.899');
check('"-" da tela vira vazio', valor(0, 'Cliente/Fornecedor') === '');
check('parcial vencido, como o selo da tela', valor(0, 'Situação') === 'Parcial vencido' && valor(1, 'Situação') === 'Pago');
check('em aberto: o da serialização; pago não deve nada', valor(0, 'Em aberto') === 60 && valor(1, 'Em aberto') === 0);
check('aba com o nome da tela, total com a contagem', aba.nome === 'Contas a Pagar' && aba.total === 'Total (2 lançamentos)');
check('tela desconhecida vira Lançamentos', P.abaDosLancamentos({ lancamentos: [], tela: 'constructor' }).nome === 'Lançamentos');

console.log('\n--- pronta para imprimir ---');
const partes = xlsx.partesDaPlanilha([aba]);
const folha = partes.find((p) => p.nome === 'xl/worksheets/sheet1.xml').conteudo;
const estilos = partes.find((p) => p.nome === 'xl/styles.xml').conteudo;
check('nome da tela no alto de cada página', folha.includes('<oddHeader>&amp;C&amp;B&amp;14Contas a Pagar</oddHeader>'));
check('"Emitido em" e "Página X de Y" no pé', folha.includes('<oddFooter>&amp;LEmitido em 16/10/2026 às 10:00&amp;RPágina &amp;P de &amp;N</oddFooter>'));
check('"&" do texto não vira comando de impressão', xlsx.partesDaPlanilha([{ ...aba, impressao: { titulo: 'A & B' } }])
  .find((p) => p.nome === 'xl/worksheets/sheet1.xml').conteudo.includes('&amp;C&amp;B&amp;14A &amp;&amp; B'));
check('deitada e na largura da folha', /orientation="landscape" fitToWidth="1" fitToHeight="0"/.test(folha));
check('texto quebra na célula (não sai cortado)', /<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"\/><\/xf>/.test(estilos));
check('  e o total não quebra (o rótulo se estende ao lado)', /<xf numFmtId="0" fontId="2" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"\/><\/xf>/.test(estilos));
const lida = lerXlsx(P.planilhaDosLancamentos({ lancamentos, tela: 'contas_a_receber', hoje: '2026-10-16' }))[0];
check('o arquivo abre: cabeçalho da tela + 2 linhas + total', lida.nome === 'Contas a Receber' && lida.linhas.length === 4 && lida.linhas[0][0] === 'Conta bancária');

console.log('\n--- a rota e o botão ---');
const server = semComentarios(fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8'));
const rota = server.slice(server.indexOf("pathname === '/api/finance/entries/exportar' && req.method === 'GET'"), server.indexOf("pathname === '/api/finance/entries/lote' && req.method === 'POST'"));
check('?formato=csv continua dando o CSV de dados', /if \(url\.searchParams\.get\('formato'\) === 'csv'\) \{[\s\S]{0,300}relatoriosCsv\.lancamentos/.test(rota));
check('sem formato: a planilha, com a empresa de cada título', /empresasDosTitulos\(lista, data\)/.test(rota) && /planilhaLancamentos\.planilhaDosLancamentos\(\{/.test(rota));
check('  tela só das conhecidas (hasOwnProperty)', /Object\.prototype\.hasOwnProperty\.call\(planilhaLancamentos\.TELAS, url\.searchParams\.get\('tela'\)\)/.test(rota));
check('  .xlsx com o nome da tela e a data', rota.includes("'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'") && rota.includes("filename=\"${tela.replace(/_/g, '-')}-${hoje}.xlsx\""));
const tela = semComentarios(fonteTela);
check('botão "Exportar Excel"', />Exportar Excel<\/button>/.test(tela) && !/Exportar CSV/.test(tela));
check('manda a tela e as colunas visíveis', /params\.set\('tela', telaChave\);\s*params\.set\('colunas', colunasVisiveis\(\)\.map\(\(c\) => c\.chave\)\.join\(','\)\);/.test(tela));
check('  no filtro inteiro e nos selecionados', (tela.match(/\$\{paraAPlanilha\(/g) || []).length === 2);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
