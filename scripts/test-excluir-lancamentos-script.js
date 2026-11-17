/**
 * EXCLUIR LANÇAMENTOS EM LOTE PELO VPS (17/11/2026).
 *
 * "pra excluir tudo isso de uma vez pelo vps como eu faço" — os 130 títulos
 * duplicados de 25/11. O script scripts/excluir-lancamentos.js vai pela MESMA
 * rota da tela (DELETE /api/finance/entries), nunca por SQL, e sem --enviar só
 * mostra a prévia. Prova de ponta a ponta feita na porta 3999 (prévia, recusa
 * sem motivo, parada no título com baixa, exclusão pelo arquivo, sessão
 * encerrada); aqui fica o que não pode voltar atrás.
 *
 *   node scripts/test-excluir-lancamentos-script.js
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas++;
};

const fonte = fs.readFileSync(path.join(__dirname, 'excluir-lancamentos.js'), 'utf8');
const codigo = fonte.replace(/^\s*\/\/.*$/gm, '');

console.log('--- pela rota da tela, nunca por SQL ---');
check('exclui pelo DELETE /api/finance/entries', /chamar\('\/api\/finance\/entries', \{ metodo: 'DELETE', token, corpo: \{ ids: lote, motivo \} \}\)/.test(codigo));
check('nenhum DELETE/UPDATE direto no banco', !/\b(delete\s+from|update\s+financial|insert\s+into)\b/i.test(codigo));
check('a única consulta é a leitura código -> id', (codigo.match(/consultar\(/g) || []).length === 1 && /select id, code::int as code from financial_entries/.test(codigo));

console.log('\n--- sem --enviar, só a prévia ---');
check('prévia primeiro, com previa: true', /corpo: \{ ids: lote, previa: true \}/.test(codigo));
check('sem --enviar para antes de excluir', /if \(!enviar\) \{[\s\S]*?Nada foi excluído[\s\S]*?return;/.test(codigo));
check('--enviar exige motivo de 10 caracteres', /if \(enviar && motivo\.length < 10\) throw/.test(codigo));
check('título com baixa ou conciliado para o lote (salvo --mesmo-com-baixa)', /if \(comBaixa\.length && !mesmoComBaixa\) \{[\s\S]*?return;/.test(codigo));
check('a ordem: parada da baixa e da prévia vêm antes do envio',
  codigo.indexOf('!mesmoComBaixa') < codigo.indexOf('if (!enviar)')
  && codigo.indexOf('if (!enviar)') < codigo.indexOf('corpo: { ids: lote, motivo }'));

console.log('\n--- login e sessão ---');
check('senha perguntada sem eco (ou MAVIS_SENHA no teste)', /rl\._writeToOutput = \(\) => \{\};/.test(codigo) && /process\.env\.MAVIS_SENHA \|\| await perguntar\('Senha: ', \{ oculto: true \}\)/.test(codigo));
check('sai da sessão no fim, mesmo com erro', /finally \{\s*if \(token\) await chamar\('\/api\/logout'/.test(codigo));
check('lotes do tamanho que a rota aceita', /MAXIMO_DO_LOTE/.test(codigo) && require('../public/modules/shared/lancamentos_lista').MAXIMO_DO_LOTE === 200);

console.log('\n--- leitura dos códigos ---');
const trecho = fonte.slice(fonte.indexOf('function codigosDoTexto('), fonte.indexOf('function perguntar('));
const lancamentoCodigo = require('../public/modules/shared/lancamento_codigo');
// eslint-disable-next-line no-new-func
const codigosDoTexto = new Function('lancamentoCodigo', `${trecho}; return codigosDoTexto;`)(lancamentoCodigo);
check('a linha do titulos-duplicados.js inteira', JSON.stringify(codigosDoTexto('Códigos sugeridos para excluir: LF32217, LF32221,\nLF32225')) === '[32217,32221,32225]');
check('sem repetir, e minúsculo vale', JSON.stringify(codigosDoTexto('lf0042 LF42 LF0043')) === '[42,43]');
check('texto sem código não vira número', codigosDoTexto('Parcela 8 - Compra 1760 - NF 11468').length === 0);

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
