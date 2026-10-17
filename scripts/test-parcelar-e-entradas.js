#!/usr/bin/env node
/**
 * PEDIDOS DO USUÁRIO DE 17/10/2026:
 *  - "abrir opção no Financeiro contas a pagar, para parcelar pagamento de
 *    NF-e, quando o vencimento das parcelas não está no XML";
 *  - "permitir excluir uma NF-e de entrada lançada errada, para lançar a mesma
 *    novamente certa" (agora também em Compras › Notas de Entrada);
 *  - "em Compras, Notas de Entrada, criar uma opção de consultar o financeiro
 *    das mesmas, deve constar parcelas, valores e vencimentos";
 *  - a Edição de Título da aprovação "já puxar diretamente a filial ou matriz"
 *    do pedido, e a Observação da linha de pagamento nas observações do título.
 *
 * Provado no servidor local: título de R$ 1.000,00 parcelado em 3 (333,34 +
 * 333,33 + 333,33, a cada 30 dias, "Parcela i/3"); Notas de Entrada com as
 * colunas Consultar e Corrigir, o financeiro da NF-e 291733 (parcela 1/1,
 * valor, pago, em aberto) e o Refazer reabrindo a conferência da mesma nota;
 * pedido da ARAQUARI aprovado com os títulos já no estabelecimento ARAQUARI e
 * as observações "SAL INFINITY" e "7X". Tudo apagado depois.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => semComentarios(fs.readFileSync(path.join(__dirname, '..', p), 'utf8'));
const servidor = ler('server.js');
const trecho = (inicio, fim) => { const i = servidor.indexOf(inicio); return servidor.slice(i, servidor.indexOf(fim, i + inicio.length)); };

console.log('--- 1. parcelar um título ---');
const parcelar = trecho("if (/^\\/api\\/finance\\/entries\\/[^/]+\\/parcelar$/.test(pathname) && req.method === 'POST')", "if (/^\\/api\\/finance\\/entries\\/[^/]+\\/cancelar$/");
check('a rota existe', parcelar.length > 100);
check('  só título em aberto, sem baixa, que não é transferência',
  /if \(entry\.status !== 'pending' \|\| getFinanceEntryPayments\(data, id\)\.length\)/.test(parcelar) && /classifyFinanceEntry\(entry\) === 'transferencia'/.test(parcelar));
check('  de 2 a 120 parcelas, cada uma com vencimento e valor', /parcelas\.length < 2 \|\| parcelas\.length > 120/.test(parcelar) && /!dia\.test\(p\.dueDate\) \|\| !\(p\.centavos > 0\)/.test(parcelar));
check('  a soma fecha com o título, ao centavo', /if \(somaDasParcelas !== totalDoTitulo\)/.test(parcelar));
check('  o título vira a parcela 1 e as outras copiam tudo dele',
  /await db\.updateFinancialEntry\(entry\.id, \{ amount: entry\.amount, dueDate: entry\.dueDate, description: entry\.description \}\);/.test(parcelar)
  && /referenceId: entry\.referenceId \|\| '',/.test(parcelar) && /estabelecimentoId: entry\.estabelecimentoId \|\| '',/.test(parcelar)
  && /category: entry\.category \|\| '',/.test(parcelar));
check('  "Parcela i/N" na descrição (ou "Parte i/N" se já era parcela)', /\$\{jaEraParcela \? 'Parte' : 'Parcela'\} \$\{i\}\/\$\{parcelas\.length\}/.test(parcelar));
check('  e fica na auditoria', /action: 'parcelarLancamento',/.test(parcelar));
const lancamentos = ler('public/modules/finance/subs/lancamentos.js');
check('na janela do título, o botão Parcelar (aberto, sem baixa)',
  /const podeParcelar = entry\.rawStatus === 'pending' && !entry\.payments\.length && entry\.type !== 'transferencia';/.test(lancamentos)
  && /id="financeModalParcelar">Parcelar<\/button>/.test(lancamentos));
check('  as linhas saem de quantidade, 1º vencimento e intervalo; o centavo que sobra vai na 1ª',
  /const centavos = i === 0 \? totalEmCentavos - base \* \(qtd - 1\) : base;/.test(lancamentos));
check('  e a tela confere a soma antes de mandar', /if \(soma !== totalEmCentavos\) \{/.test(lancamentos)
  && /\/api\/finance\/entries\/\$\{encodeURIComponent\(entry\.id\)\}\/parcelar/.test(lancamentos));

console.log('\n--- 2. Notas de Entrada: financeiro e corrigir ---');
const rotaFin = trecho("if (pathname.startsWith('/api/purchases/entrada-nfe/') && pathname.endsWith('/financeiro') && req.method === 'GET')", "if (pathname.startsWith('/api/purchases/entrada-nfe/') && pathname.endsWith('/resumo')");
check('a rota do financeiro da entrada (antes da genérica)', rotaFin.length > 100);
check('  parcela, vencimento, valor, pago, em aberto, situação, forma, conta e data do pagamento',
  /parcela: posicao >= 0 \? `\$\{posicao \+ 1\}\/\$\{vivos\.length\}` : '-',/.test(rotaFin)
  && /pago: comValores \? realizadoDoLancamento\(l, dele\) : null,/.test(rotaFin) && /pagoEm: /.test(rotaFin));
check('  valores para administrador ou quem tem o Financeiro', /const comValores = \(await ehAdmin\(user\)\) \|\| user\.allowedModules\.includes\('finance'\);/.test(rotaFin));
const resumo = require('../public/modules/shared/resumo_entrada');
const html = resumo.desenharFinanceiro({
  entrada: { numero: '291733', serie: '2', emitenteNome: 'HERALDO', emitenteDocumento: '05824631000149', dataEmissao: '2026-10-10', valorTotal: 38, gerouFinanceiro: true },
  comValores: true,
  titulos: [{ parcela: '1/1', codigo: 'LF28368', vencimento: '2026-10-10', valor: 38, pago: 0, emAberto: 38, situacao: 'vencido', status: 'pending', forma: '', conta: '', pagoEm: '' }],
  totais: { valor: 38, pago: 0, emAberto: 38 }
});
check('a janela mostra parcela, vencimento, valores e o total', /Financeiro da NF-e 291733\/2/.test(html) && /<td>1\/1<\/td>/.test(html)
  && /10\/10\/2026/.test(html) && /R\$\s38,00/.test(html) && /<tfoot>/.test(html) && /<td>Vencido<\/td>/.test(html));
const entrada = ler('public/modules/purchases/subs/entrada_nfe.js');
check('a lista ganha Consultar (resumo, financeiro) e Corrigir (refazer, excluir)',
  /<th>Consultar<\/th>/.test(entrada) && /<th>Corrigir<\/th>/.test(entrada)
  && /data-financeiro-entrada="\$\{escapeHtml\(e\.id\)\}">financeiro<\/button>/.test(entrada)
  && /data-refazer-entrada="\$\{escapeHtml\(e\.id\)\}">refazer<\/button>/.test(entrada)
  && /data-excluir-entrada="\$\{escapeHtml\(e\.id\)\}">excluir<\/button>/.test(entrada));
check('  refazer: pela nota recebida, senão pelo XML da entrada, senão pede o arquivo',
  /if \(refazer && r\.dfeId && state\) \{\s*state\.entradaNfeDoDfe = \{ dfeId: r\.dfeId, chave: r\.chave \};/.test(entrada)
  && /if \(refazer && r\.xml\) \{\s*await analisarXml\(r\.xml\);/.test(entrada));

console.log('\n--- 3. o título da aprovação: estabelecimento e observação ---');
check('o título nasce no estabelecimento do CNPJ da empresa do pedido',
  /async function estabelecimentoDoPedido\(data, record\) \{/.test(servidor)
  && /const estabelecimentoId = await estabelecimentoDoPedido\(data, record\);/.test(servidor)
  && /estabelecimentoId,\s*note: parcela\.note \|\| '',\s*status: 'pending',/.test(servidor));
const { parcelasDoPedido } = require('../lib/vendas-financeiro');
const notas = parcelasDoPedido({ id: 'o1', code: 1, date: '2026-10-17', totalAmount: 80, amount: 80,
  payments: [{ methodId: 'b', amount: 50, note: ' SAL INFINITY ' }, { methodId: 'd', amount: 30, note: '7X' }] }, new Map(), {}).map((p) => p.note);
check('  com a Observação da linha de pagamento', JSON.stringify(notas) === '["SAL INFINITY","7X"]', JSON.stringify(notas));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
