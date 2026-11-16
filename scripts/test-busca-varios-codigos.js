/**
 * VÁRIOS CÓDIGOS COLADOS NA BUSCA DE LANÇAMENTOS (16/11/2026).
 *
 * O usuário colou os 131 títulos duplicados de 25/11 ("LF32217, LF32221, ...",
 * a última linha de scripts/titulos-duplicados.js) para excluir. A busca aceitava
 * um código por vez; agora a lista traz exatamente esses títulos, para conferir
 * na tela, marcar "todos" e excluir em lote pela regra de sempre.
 *
 * Provado pela API na porta 3999: três títulos de teste, a lista dos três
 * códigos trouxe os três e nenhum outro (títulos apagados depois).
 *
 *   node scripts/test-busca-varios-codigos.js
 */
const fs = require('fs');
const path = require('path');
const L = require('../public/modules/shared/lancamentos_lista.js');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log('--- a leitura da lista ---');
check('vírgula, espaço, ponto e vírgula e quebra de linha', JSON.stringify(L.codigosDaBusca('LF32217, LF32221 LF32225;lf32229\nLF-32237')) === '[32217,32221,32225,32229,32237]');
check('repetido conta uma vez', JSON.stringify(L.codigosDaBusca('LF1, LF1, LF2')) === '[1,2]');
check('um código só segue pela busca de sempre', L.codigosDaBusca('LF32217') === null && L.codigosDaBusca('  LF32217 ') === null);
check('código misturado com texto também (é busca de texto)', L.codigosDaBusca('LF32217 energia') === null && L.codigosDaBusca('LF1, 2500') === null);
check('vazio', L.codigosDaBusca('') === null && L.codigosDaBusca(null) === null);
const colada = 'LF32217, LF32221, LF32225, LF32229, LF32237, LF32275, LF32316, LF32319, LF32332, LF32340, LF32342, LF32345, LF32353, LF32355, LF32373, LF32393, LF32401, LF32411, LF32447, LF32454, LF32461, LF32468, LF32475, LF32482, LF32489, LF32496, LF32503, LF32510, LF32517, LF32523, LF32552, LF32559, LF32562, LF32568, LF32571, LF32574, LF32577, LF32580, LF32583, LF32586, LF32589, LF32592, LF32595, LF32598, LF32601, LF32604, LF32607, LF32610, LF32613, LF32616, LF32619, LF32622, LF32625, LF32628, LF32631, LF32634, LF32637, LF32640, LF32643, LF32646, LF32649, LF32652, LF32655, LF32658, LF32661, LF32665, LF32669, LF32673, LF32677, LF32681, LF32685, LF32689, LF32693, LF32697, LF32701, LF32705, LF32709, LF32713, LF32717, LF32721, LF32725, LF32729, LF32733, LF32737, LF32741, LF32745, LF32749, LF32753, LF32757, LF32761, LF32765, LF32769, LF32773, LF32777, LF32781, LF32785, LF32789, LF32793, LF32797, LF32801, LF32805, LF32809, LF32813, LF32817, LF32821, LF32825, LF32829, LF32833, LF32837, LF32841, LF32845, LF32849, LF32853, LF32857, LF32861, LF32865, LF32869, LF32873, LF32877, LF32881, LF32885, LF32889, LF32893, LF32897, LF32901, LF32905, LF32909, LF32913, LF32917, LF32925, LF32928';
const lidos = L.codigosDaBusca(colada.toLowerCase());
check('a lista colada pelo usuário: 131 códigos, cabe em um lote', Array.isArray(lidos) && lidos.length === 131 && lidos.length <= L.MAXIMO_DO_LOTE, lidos && lidos.length);

console.log('\n--- o servidor ---');
const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
check('a lista filtra só os códigos dela, antes da busca de texto',
  /const codigosDaLista = listaDeLancamentos\.codigosDaBusca\(search\);\s*if \(codigosDaLista\) \{\s*const procurados = new Set\(codigosDaLista\);\s*entries = entries\.filter\(\(entry\) => procurados\.has\(Number\(entry\.code\)\)\);\s*\} else if \(search\) \{/.test(servidor));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
