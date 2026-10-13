#!/usr/bin/env node
/**
 * A LISTA DE LANÇAMENTOS — as regras que a tela e o servidor dividem (fase EI).
 *
 * Sem banco e sem servidor. O que depende de banco está em
 * scripts/test-lista-de-lancamentos.js (a lista paginada igual à leitura
 * inteira, para cada filtro e cada ordem); o de ponta a ponta, com o lote de
 * verdade, em scripts/test-lote-de-lancamentos.js (fora do npm test).
 *
 *   1. o texto da busca como valor ("2.500,00") e como código ("LF42");
 *   2. as abas e quem pode ser baixado ou cancelado em lote;
 *   3. o resumo da descrição — o que a coluna mostra no lugar das frases do
 *      Viper — e o corte;
 *   4. o CSV da exportação;
 *   5. a tela e o servidor falando das MESMAS colunas e rotas.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const Lista = require('../public/modules/shared/lancamentos_lista');
const D = require('../public/modules/shared/descricao_lancamento');
const relatoriosCsv = require('../lib/relatorios-csv');

console.log('\n--- 1. a busca como valor e como código ---');
const valores = [
  ['2.500,00', 2500], ['2500,5', 2500.5], ['R$ 2.500', 2500], ['r$2.500,00', 2500], ['2500', 2500],
  ['2500.50', 2500.5], ['25.73', 25.73], ['2.500', 2500], ['1.234.567,89', 1234567.89], ['0,01', 0.01],
  ['1,234', null], ['2.50.0', null], ['12a', null], ['-5', null], ['', null], ['LF0042', null],
  ['1,', null], [',5', null], ['2,500,00', null], ['12.34.56', null], ['  300,00  ', 300]
];
const errosDeValor = valores.filter(([t, esperado]) => Lista.valorDaBusca(t) !== esperado);
check(`${valores.length} textos lidos como valor (ou recusados) do jeito brasileiro`, errosDeValor.length === 0,
  errosDeValor.map(([t]) => `${t} -> ${Lista.valorDaBusca(t)}`).join('; ') || 'todos');
check('centavos não erram no último bit (0,1 + 0,2)', Lista.centavos(0.1 + 0.2) === Lista.centavos(0.3));
const codigos = [['LF0042', 42], ['lf42', 42], ['LF 42', 42], ['LF-42', 42], ['42', null], ['LF', null], ['LF0', null], ['xLF42', null]];
const errosDeCodigo = codigos.filter(([t, esperado]) => Lista.codigoDaBusca(t) !== esperado);
check('o código com o prefixo, e só com ele', errosDeCodigo.length === 0, errosDeCodigo.map(([t]) => t).join('; ') || 'todos');

console.log('\n--- 2. abas e lote ---');
check('situações por vírgula, sem espaço nem maiúscula', JSON.stringify(Lista.situacoesDoFiltro(' Vencido , pendente,,')) === '["vencido","pendente"]');
check('"Todos" é a primeira aba e não filtra', Lista.ABAS[0].chave === '' && Lista.ABAS[0].status.length === 0);
check('"Em aberto" junta a vencer, vencido e parcial',
  Lista.ABAS.find((a) => a.chave === 'aberto').status.slice().sort().join() === 'parcial,pendente,vencido');
check('"Vencidos" inclui o parcial vencido (o dashboard o conta como vencido)',
  Lista.ABAS.find((a) => a.chave === 'vencido').status.includes('parcial-vencido'));
const l = (rawStatus) => ({ id: rawStatus, rawStatus });
check('baixar: pendente e parcial sim', Lista.ACOES.baixar.elegivel(l('pending')) === true && Lista.ACOES.baixar.elegivel(l('parcial')) === true);
check('  pago e cancelado não, com motivo', typeof Lista.ACOES.baixar.elegivel(l('paid')) === 'string'
  && typeof Lista.ACOES.baixar.elegivel(l('cancelado')) === 'string');
check('cancelar: só o sem baixa', Lista.ACOES.cancelar.elegivel(l('pending')) === true
  && /estorne/i.test(Lista.ACOES.cancelar.elegivel(l('parcial'))) && /estorne/i.test(Lista.ACOES.cancelar.elegivel(l('paid')))
  && typeof Lista.ACOES.cancelar.elegivel(l('cancelado')) === 'string');
const av = Lista.avaliar('baixar', [l('pending'), l('paid'), l('parcial')]);
check('avaliar separa elegíveis e ignorados com o motivo', av.elegiveis.length === 2 && av.ignorados.length === 1 && av.ignorados[0].motivo);
check('ação desconhecida não é elegível para ninguém', Lista.avaliar('constructor', [l('pending')]).elegiveis.length === 0);
check('resumo no plural certo', Lista.resumo(1, 0) === '1 processado.' && Lista.resumo(2, 1) === '2 processados, 1 ignorado.');

console.log('\n--- 3. o resumo da descrição ---');
const resumos = [
  ['Valor de R$ 2.826,60 (Parcela 1 de 2). Referente ao PEDIDO DE VENDA de codigo 14508 efetuado em 12/08/2026 no valor de R$ 3.297,69',
    'Pedido 14508 de 12/08/2026 · Parcela 1/2'],
  ['Valor de R$ 100,00 (Parcela 1 de 1). Referente ao PEDIDO DE VENDA de codigo 3063 efetuado em 23/01/2025 no valor de R$ 100,00',
    'Pedido 3063 de 23/01/2025'],
  ['Referente ao PEDIDO DE VENDA de codigo 119 efetuado em 21/06/2024 no valor de R$ 100,00- RECEBIDO 99,01 06/06 QUEROPAY',
    'Pedido 119 de 21/06/2024 · RECEBIDO 99,01 06/06 QUEROPAY'],
  ['Referente a NF DE ENTRADA de codigo 1203 - Nº 9275, emitida em 13/10/2025 no valor de R$ 49,58 (Parcela 8 de 12).',
    'NF de entrada 9275 de 13/10/2025 · Parcela 8/12'],
  ['Despesa referente ao plano de conta 20.05.01 - ICMS A RECOLHER - REFTE FATURAMENTO JULHO 2026 (Recorrência 3 de 20).',
    'ICMS A RECOLHER - REFTE FATURAMENTO JULHO 2026 · Recorrência 3/20'],
  ['Despesa referente ao plano de conta 20.05.01 - ICMS A RECOLHER', 'ICMS A RECOLHER'],
  ['Despesa referente ao plano de conta ALUGUEIS (Parcela 2 de 12).', 'ALUGUEIS · Parcela 2/12'],
  ['Receita referente ao plano de conta 10.02.02 - RENDIMENTOS DE APLICACAO', 'RENDIMENTOS DE APLICACAO'],
  // O que o próprio sistema escreve já é curto e passa intacto.
  ['Receita de venda · Pedido 1042 · NF-e 000000123 · Parcela 1/3 · Boleto', 'Receita de venda · Pedido 1042 · NF-e 000000123 · Parcela 1/3 · Boleto'],
  ['Conta de luz de outubro', 'Conta de luz de outubro'],
  ['', '']
];
const errosDeResumo = resumos.filter(([de, para]) => D.resumir(de) !== para);
check(`${resumos.length} descrições resumidas como a coluna mostra`, errosDeResumo.length === 0,
  errosDeResumo.map(([de]) => `"${de.slice(0, 40)}" -> "${D.resumir(de)}"`).join(' | ') || 'todas');
check('o que não casa com modelo nenhum volta inteiro', D.resumir('Valor de R$ 10,00 (Parcela 1 de 1).') === 'Valor de R$ 10,00 (Parcela 1 de 1).');
const longa = 'MULTAS DE TRANSITO - INFRAÇÃO EM 05/12/2026 ÀS 16:13 NÚMERO 008588 JAR 0413152-6050 - VEÍCULO SPRINTER';
const cortada = D.cortar(longa, 60);
check('cortar respeita o limite e termina em "…"', cortada.length <= 60 && cortada.endsWith('…'), cortada);
check('  no fim de uma palavra', !/\S…$/.test(cortada.replace(/[A-Za-zÀ-ú0-9]…$/, 'x…')) || /\s/.test(longa.charAt(cortada.length - 1)), cortada);
check('  e não mexe no que cabe', D.cortar('curto', 60) === 'curto' && D.cortar('sem limite', 0) === 'sem limite');
check('palavra única comprida é cortada no meio, não vira só "…"', D.cortar('A'.repeat(100), 20).length === 20);
// A regex de aparar as pontas era quadrática: 300 mil hífens e uma letra
// travavam a tela de todo mundo por minutos.
const inicio = process.hrtime.bigint();
D.resumir(`a${'-'.repeat(300000)}a`);
D.cortar(`${'-'.repeat(300000)}a`, 60);
const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
check('resumir e cortar não travam com texto patológico', ms < 200, `${ms.toFixed(1)} ms`);
check('  e o ponto final de abreviação fica ("LTDA.")', D.resumir('Despesa referente ao plano de conta 20.01 - FORNECEDOR LTDA.') === 'FORNECEDOR LTDA.');

console.log('\n--- 4. o CSV da exportação ---');
const csv = relatoriosCsv.lancamentos([
  { codigo: 'LF0001', date: '2026-10-10', dueDate: '2026-10-20', description: '=HYPERLINK("http://x")', type: 'despesa',
    categoryName: 'ICMS', costCenterName: '', bankAccountName: 'ITAU', clienteFornecedor: '-', amountPrevisto: 1234.5,
    amountRealizado: 234.5, status: 'parcial', document: 'LF0001 · NF 12', note: '' },
  { codigo: 'LF0002', date: '2026-10-11', dueDate: '2026-10-11', description: 'Cancelado', type: 'receita',
    amountPrevisto: 10, amountRealizado: 0, status: 'cancelado' }
]);
const linhasCsv = csv.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
check('BOM, cabeçalho e uma linha por lançamento', csv.startsWith('\uFEFF') && linhasCsv.length === 3 && /^Código;Data;Vencimento;Descrição;Tipo/.test(linhasCsv[0]));
check('fórmula neutralizada na descrição', linhasCsv[1].includes(`"'=HYPERLINK(""http://x"")"`), linhasCsv[1]);
check('dinheiro com vírgula e sem apóstrofo; em aberto = previsto − realizado', /;1234,50;234,50;1000,00;Parcial;/.test(linhasCsv[1]), linhasCsv[1]);
check('"-" da tela vira célula vazia, e não "\'-"', !linhasCsv[1].includes("'-"));
check('cancelado não deve nada', /;10,00;0,00;0,00;Cancelado;/.test(linhasCsv[2]), linhasCsv[2]);

console.log('\n--- 5. tela e servidor falam das mesmas coisas ---');
const tela = ler('public/modules/finance/subs/lancamentos.js');
const servidor = ler('server.js');
const dbFin = ler('lib/db/financeiro.js');
const ordensDaTela = [...tela.matchAll(/ordem: '([a-zA-Z]+)'/g)].map((m) => m[1]);
check('toda coluna que a tela ordena o servidor aceita', ordensDaTela.length > 0 && ordensDaTela.every((o) => Lista.ORDENAVEIS.includes(o)), ordensDaTela.join(','));
check('  e toda ordem aceita tem coluna na tela', Lista.ORDENAVEIS.every((o) => ordensDaTela.includes(o)));
const ordensDoServidor = (servidor.match(/const ORDENS_DA_LISTA_DE_LANCAMENTOS = \{([\s\S]*?)\n\};/) || [])[1] || '';
check('  e o servidor tem comparador para cada uma', Lista.ORDENAVEIS.every((o) => new RegExp(`\\n  ${o}: \\{`).test(`\n${ordensDoServidor}`)));
const colunasDaOrdem = (dbFin.match(/const COLUNAS_DA_ORDEM = \{([\s\S]*?)\n\};/) || [])[1] || '';
const precisaDeColuna = ['codigo', 'description', 'category', 'clienteFornecedor', 'document', 'costCenter', 'bankAccount'];
check('a leitura parcial traz a coluna de cada ordem que precisa de uma', precisaDeColuna.every((o) => new RegExp(`\\b${o}:`).test(colunasDaOrdem)));
check('  e consulta COLUNAS_DA_ORDEM por hasOwnProperty (sort=constructor não derruba)', /hasOwnProperty\.call\(COLUNAS_DA_ORDEM/.test(dbFin));
const iExportar = servidor.indexOf("pathname === '/api/finance/entries/exportar' && req.method === 'GET'");
const iGetPorId = servidor.indexOf("pathname.startsWith('/api/finance/entries/') && req.method === 'GET'");
check('a rota de exportar vem ANTES do GET /:id (senão "exportar" vira id)', iExportar > 0 && iGetPorId > 0 && iExportar < iGetPorId);
const iLote = servidor.indexOf("pathname === '/api/finance/entries/lote' && req.method === 'POST'");
check('a rota do lote existe e confere a ação por hasOwnProperty', iLote > 0
  && /hasOwnProperty\.call\(listaDeLancamentos\.ACOES, acao\)/.test(servidor.slice(iLote, iLote + 3000)));
check('o lote reaproveita a regra de elegibilidade do módulo compartilhado',
  /listaDeLancamentos\.ACOES\[acao\]\.elegivel\(\{ rawStatus: entry\.status \}\)/.test(servidor));
const rotaLote = servidor.slice(iLote, servidor.indexOf("if (pathname === '/api/finance/entries' && req.method === 'POST')", iLote));
check('prévia e gravação passam pela MESMA planoDoLote', (rotaLote.match(/planoDoLote\(acao, entry, baixas\)/g) || []).length === 2);
check('o lote trava por lançamento e relê DENTRO da trava', /lancamentosEmGravacao\.add\(id\);[\s\S]{0,200}getFinancialEntriesByIds\(\[id\]\)/.test(rotaLote)
  && /finally \{\s*lancamentosEmGravacao\.delete\(id\);/.test(rotaLote));
const rotaBaixa = servidor.slice(servidor.indexOf("payments$/.test(pathname) && req.method === 'POST')"), servidor.indexOf("'Erro ao registrar pagamento'") + 200);
check('a baixa avulsa respeita a mesma trava', /lancamentosEmGravacao\.has\(id\)/.test(rotaBaixa) && /lancamentosEmGravacao\.delete\(travado\)/.test(rotaBaixa));
const rotaExportar = servidor.slice(iExportar, iLote);
check('a exportação agrupa as baixas uma vez (não varre todas por lançamento)',
  /baixasPorLancamento/.test(rotaExportar) && /serializeFinanceEntry\(entry, data, baixasPorLancamento\.get\(entry\.id\)/.test(rotaExportar));
check('Descrição e Documento ordenam pelo que a coluna mostra',
  /description: \{ tipo: 'texto', valor: \(e\) => descricaoLancamento\.resumir\(e\.description\) \}/.test(ordensDoServidor)
  && /document: \{ tipo: 'texto', valor: \(e\) => lancamentoCodigo\.referencia\(e\.code, e\.document\) \}/.test(ordensDoServidor)
  && /document: \['code', 'document'\]/.test(colunasDaOrdem));
check('a descrição tem teto de 1.000 caracteres ao gravar', /String\(description\)\.length > 1000/.test(servidor));
const app = ler('public/app.js');
const adotar = app.slice(app.indexOf('function adotarUsuarioDaSessao('), app.indexOf('function adotarUsuarioDaSessao(') + 900);
check('o login zera o estado da lista (seleção de quem saiu não passa para quem entra)', /state\.financeLista = null;/.test(adotar));
check('a tela não reenvia lote com outro no ar', /if \(loteEmAndamento\) return;/.test(tela) && /const fechar = \(\) => \{ if \(!loteEmAndamento\) overlay\.remove\(\); \};/.test(tela));
check('o modal do lote soma o que a PRÉVIA do servidor diz', /previaDoLote\('baixar', ids\)/.test(tela) && /previa: true/.test(tela));
check('a busca do servidor reconhece valor e código pelo módulo compartilhado',
  /listaDeLancamentos\.valorDaBusca\(search\)/.test(servidor) && /listaDeLancamentos\.codigoDaBusca\(search\)/.test(servidor));
const indice = ler('public/index.html');
const posModulo = indice.indexOf('/modules/shared/lancamentos_lista.js');
const posTela = indice.indexOf('/modules/finance/subs/lancamentos.js');
check('o index.html carrega o módulo antes da tela', posModulo > 0 && posTela > 0 && posModulo < posTela);
check('a descrição vai inteira no title, escapada', /title="\$\{f\.esc\(inteira\)\}"/.test(tela));
check('a data padrão das baixas é a local, não a UTC', !/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(tela) && /financeHojeLocal\(\)/.test(tela));
const padrao = (tela.match(/const FINANCE_COLUNAS_PADRAO = \[([^\]]*)\]/) || [])[1] || '';
const chavesDaTela = [...tela.matchAll(/\{ chave: '([a-zA-Z]+)'|chave: '([a-zA-Z]+)',\n/g)].map((m) => m[1] || m[2]);
check('as colunas do padrão existem no catálogo', padrao.split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean)
  .every((c) => chavesDaTela.includes(c)), padrao);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
