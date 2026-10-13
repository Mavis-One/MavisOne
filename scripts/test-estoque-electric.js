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

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exitCode = falhas ? 1 : 0;
