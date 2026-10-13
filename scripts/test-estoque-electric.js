// ESTOQUE DA ELECTRIC PELA PLANILHA "PRODUTOS" (13/10/2026): a leitura.
//
//   node scripts/test-estoque-electric.js
const { lerPlanilha, numero } = require('../lib/importacao-estoque-electric');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const CAB = ['Código', 'Descrição', 'UN', 'Tipo', 'Preço', 'Estoque', 'NCM', 'Tipo Tributo', 'Status', 'Inclusão'];
const planilha = (empresa, linhas) => [[['PRODUTOS'], [empresa], ['Gerado em: 13/10/2026'], CAB, ...linhas]];
const linha = (sku, estoque) => [sku, 'ITEM ' + sku, 'UN', 'Produto', '10', estoque, '8711.60.00', 'TRIBUTADO', 'Ativo', '14/09/2026'];

const r = lerPlanilha(planilha('SAL INFINITY ELECTRIC LTDA', [
  linha('1', '3'), linha('2', '0'), linha('3', '-2'), linha('4', '1.5'), linha('588', ''), linha('1', '9')
]));
check('entram só os positivos', r.itens.map((i) => i.sku).join(',') === '1,4', r.itens.map((i) => i.sku).join(','));
check('negativo fica de fora e volta listado', r.negativos.length === 1 && r.negativos[0].sku === '3');
check('estoque em branco (serviço) conta como zero', r.zerados === 2 && r.invalidos.every((i) => i.sku !== '588'));
check('código repetido não entra duas vezes', r.invalidos.length === 1 && /repetido/.test(r.invalidos[0].motivo));
check('unidades somam 4,5', r.unidades === 4.5, r.unidades);
check('número com vírgula', numero('1.234,5') === 1234.5 && numero('2.5') === 2.5);

let erro = '';
try { lerPlanilha(planilha('SAL INFINITY PLUS COMERCIO LTDA', [linha('1', '3')])); } catch (e) { erro = e.message; }
check('planilha de outra empresa é recusada', /não da SAL INFINITY ELECTRIC/.test(erro), erro);
erro = '';
try { lerPlanilha([[['SAL INFINITY ELECTRIC LTDA'], ['Código', 'Descrição', 'UN', 'Tipo', 'Estoque', 'Preço']]]); } catch (e) { erro = e.message; }
check('cabeçalho fora do lugar é recusado', erro.length > 0, erro);

// O RELATÓRIO "ESTOQUES" DO VIPER (posição atual de UM depósito) — 13/10/2026.
// Com ele o "Depósito Electric" fica igual ao relatório; provado no banco
// local: 891 itens, 16.296,61 unidades, 136 ajustes a zero (CNT-0014).
const { lerPlanilhaEstoques, CABECALHO_ESTOQUES } = require('../lib/importacao-estoque-electric');
const relatorio = (empresa, linhas) => [[['ESTOQUES'], [empresa], ['Posição atual'], CABECALHO_ESTOQUES, ...linhas]];
const deEstoque = (sku, saldo, deposito = 'ELECTRIC (ASSISTENCIA)', empresaDaLinha = 'SAL INFINITY ELECTRIC LTDA') =>
  [sku, 'ITEM ' + sku, '', empresaDaLinha, deposito, '10', saldo, '0'];
const e = lerPlanilhaEstoques(relatorio('SAL INFINITY ELECTRIC LTDA', [
  deEstoque('1', '3'), deEstoque('2', '0'), deEstoque('3', '-1'), deEstoque('4', '16.296,61'), ['Totais', 'Saldo físico: 16.299,61', '']
]));
check('Estoques: entram só os positivos', e.itens.map((i) => i.sku).join(',') === '1,4', e.itens.map((i) => i.sku).join(','));
check('Estoques: o saldo com milhar e vírgula', e.itens[1].quantidade === 16296.61, e.itens[1].quantidade);
check('Estoques: a linha de Totais não vira item', !e.itens.concat(e.invalidos).some((i) => i.sku === 'Totais'));
check('Estoques: diz de qual depósito do Viper é', e.depositoDoViper === 'ELECTRIC (ASSISTENCIA)' && e.formato === 'estoques');
check('Estoques: negativo fica de fora', e.negativos.length === 1 && e.zerados === 1);
erro = '';
try { lerPlanilhaEstoques(relatorio('SAL INFINITY ELECTRIC LTDA', [deEstoque('1', '3'), deEstoque('2', '5', 'ELECTRIC (LOJA)')])); } catch (x) { erro = x.message; }
check('Estoques: dois depósitos no mesmo arquivo são recusados', /UM depósito/.test(erro), erro);
erro = '';
try { lerPlanilhaEstoques(relatorio('SAL INFINITY PLUS COMERCIO LTDA', [deEstoque('1', '3')])); } catch (x) { erro = x.message; }
check('Estoques: relatório de outra empresa é recusado', /não da SAL INFINITY ELECTRIC/.test(erro), erro);
const outra = lerPlanilhaEstoques(relatorio('SAL INFINITY ELECTRIC LTDA', [deEstoque('1', '3'), deEstoque('9', '7', 'ELECTRIC (ASSISTENCIA)', 'SAL INFINITY PLUS COMERCIO LTDA')]));
check('Estoques: linha de outra empresa não entra', outra.itens.length === 1 && outra.invalidos.some((i) => i.sku === '9'));
const fonte = require('fs').readFileSync(require('path').join(__dirname, 'importar-estoque-electric.js'), 'utf8');
check('o script reconhece os dois formatos', /lerPlanilha\(abas\)/.test(fonte) && /lerPlanilhaEstoques\(abas\)/.test(fonte));
check('  igualar zera quem tem saldo aqui e não está no relatório', /if \(saldo !== 0 && !naPlanilha\.has\(p\.id\)\) zerar\.push/.test(fonte));
check('  e os zeros entram na mesma contagem', /const faltam = \[\.\.\.casados, \.\.\.zerar\]/.test(fonte));
check('  com marca própria (roda depois da carga da planilha Produtos)', /MARCA_ESTOQUES/.test(fonte) && /const MARCA = igualar \? MARCA_ESTOQUES : MARCA_PRODUTOS;/.test(fonte));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exitCode = falhas ? 1 : 0;
