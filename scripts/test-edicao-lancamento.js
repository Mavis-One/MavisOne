#!/usr/bin/env node
/**
 * EDITAR UM LANÇAMENTO OBEDECE ÀS MESMAS REGRAS DE CRIÁ-LO (fase BG).
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * As regras viviam só no POST. O PUT não repetia nenhuma delas, e o formulário
 * confiava em `required` e `min="0.01"` no HTML — que valem só dentro do
 * navegador, e não em quem chama a API direto.
 *
 * Provado contra a API antes da correção:
 *
 *   POST {"description":"","amount":0}       -> 400 "Informe a descrição"
 *   PUT  {"description":"   ","amount":-500} -> 200, gravado com valor -500
 *   POST transferência com origem = destino  -> 400
 *   PUT  destino := a conta de origem        -> 200, transferência para si mesma
 *
 * Por que isso importa mais do que parece: um lançamento com valor NEGATIVO não
 * é uma despesa a mais — ele SUBTRAI do total a pagar e some da conferência,
 * porque ninguém procura um título com o sinal trocado. O R$ -500 fica
 * escondido dentro de um total que fecha.
 *
 * A CONFERÊNCIA É SOBRE O ESTADO PROPOSTO, não sobre o corpo da requisição.
 * Um PUT que manda só `amount` precisa ser conferido contra a descrição que já
 * estava gravada; validar só o que veio deixaria passar tudo o que não veio.
 *
 * E VEM ANTES DOS DOIS RAMOS do PUT. O ramo do lançamento vinculado protege
 * valor e descrição, mas deixa as contas bancárias editáveis — era por ali que
 * a transferência para si mesma passava.
 *
 * O TIPO FICOU DE FORA do validador, de propósito. É conferência de ENTRADA, e
 * só o POST recebe tipo. Cobrá-lo na edição recusaria salvar um lançamento
 * antigo por um campo que a tela nem mostra: a pessoa abriria para mudar o
 * vencimento e ficaria presa sem saída.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const src = ler('server.js');
const corpoDe = (nome) => {
  const m = new RegExp(`(?:async )?function ${nome}\\([\\s\\S]*?\\n\\}`).exec(src);
  return m ? m[0] : '';
};

console.log('--- 1. o validador existe e é função pura ---');

const fonte = corpoDe('validarLancamentoFinanceiro');
check('validarLancamentoFinanceiro existe', fonte.length > 0);
// eslint-disable-next-line no-new-func
const validar = new Function(`${fonte}; return validarLancamentoFinanceiro;`)();

const valido = { type: 'DESPESA', description: 'Conta de luz', amount: 250 };
check('lançamento correto passa', validar(valido) === '', JSON.stringify(validar(valido)));
check('descrição vazia é recusada', /descri/i.test(validar({ ...valido, description: '' })));
check('  e só de espaços também', /descri/i.test(validar({ ...valido, description: '   ' })));
check('valor zero é recusado', /maior que zero/.test(validar({ ...valido, amount: 0 })));
// O caso que mais dói: o negativo não engrossa o total a pagar, ele o reduz.
check('valor negativo é recusado', /maior que zero/.test(validar({ ...valido, amount: -500 })));
check('  e texto que não é número também', /maior que zero/.test(validar({ ...valido, amount: 'abc' })));

console.log('--- 2. transferência não vai para a própria conta ---');
const transf = { type: 'TRANSFERENCIA', description: 'Entre contas', amount: 100 };
check('origem igual ao destino é recusada',
  /origem e a conta de destino/.test(validar({ ...transf, bankAccountId: 'b1', targetBankAccountId: 'b1' })));
check('  contas diferentes passam',
  validar({ ...transf, bankAccountId: 'b1', targetBankAccountId: 'b2' }) === '');
// Sem conta escolhida ainda não há o que comparar — recusar aqui impediria de
// salvar a transferência antes de escolher as contas.
check('  e sem conta escolhida não trava', validar(transf) === '');
// A regra é só da transferência: uma despesa com a mesma conta nos dois campos
// não é erro nenhum, e o campo de destino nem aparece na tela.
check('  a regra não vaza para despesa/receita',
  validar({ ...valido, bankAccountId: 'b1', targetBankAccountId: 'b1' }) === '');

console.log('--- 3. o tipo fica no POST, onde é entrada ---');
check('o validador não confere tipo', !/Tipo de lan/.test(fonte));
check('  mas o POST continua conferindo',
  /\['RECEITA', 'DESPESA', 'TRANSFERENCIA'\]\.includes\(type\)/.test(src));

console.log('--- 4. as duas rotas usam o mesmo validador ---');
const chamadas = (src.match(/validarLancamentoFinanceiro\(/g) || []).length;
// Uma na declaração, uma no POST, uma no PUT.
check('POST e PUT chamam o validador', chamadas >= 3, `${chamadas} ocorrência(s)`);
check('o PUT confere o estado PROPOSTO, com o registro atual por baixo',
  /const proposto = \{[\s\S]{0,600}?description: body\.description !== undefined \? body\.description : entry\.description,/.test(src));
// Antes dos dois ramos: o vinculado deixa as contas bancárias editáveis.
const put = src.slice(src.indexOf("if (pathname.startsWith('/api/finance/entries/') && req.method === 'PUT')"));
const posValida = put.indexOf('const invalido = validarLancamentoFinanceiro(proposto)');
const posRamo = put.indexOf('const vinculadoAoPedido');
check('  e confere ANTES de separar vinculado de livre',
  posValida >= 0 && posRamo >= 0 && posValida < posRamo);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
