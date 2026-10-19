// O CONTROLE DE MONTAGEM DESLIGADO, POR ENQUANTO (fase EV, 19/10/2026).
//
// Pedido do usuário, depois de as lojas pararem de fazer pedido de
// AUTOPROPELIDO ("Escolha se ... sai montado ou desmontado"): "desative essa
// funcionalidade por enquanto". Desliga pelos dados — a marca "Controla
// Montagem" sai dos produtos, guardada em montagem_pausada para religar — e a
// coluna Condição do pedido some quando nenhum item controla montagem.
//
// Conferido no banco local: 113 produtos guardados e desmarcados.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const sql = ler('banco/migrations/fase-ev-montagem-pausada.sql');
const semComentario = sql.replace(/--.*$/gm, '');
check('guarda quem estava marcado antes de desmarcar',
  semComentario.indexOf('insert into montagem_pausada (product_id)') > 0
  && semComentario.indexOf('insert into montagem_pausada') < semComentario.indexOf('update products set controla_montagem = false'));
check('  sem apagar a guarda numa segunda rodada', /on conflict \(product_id\) do nothing/.test(semComentario) && !/delete from montagem_pausada/.test(semComentario));
check('  e não mexe no razão', !/stock_movements|stock_transfers/.test(semComentario));
check('a regra continua no código (só os dados desligam)', /if \(product\.controlaMontagem && !cond && type === 'saida'\)/.test(ler('server.js')));

const app = ler('public/app.js');
check('a coluna Condição só aparece com produto que controla montagem',
  /const comMontagem = items\.some\(\(item\) => Boolean\(produtoDoItem\(item\)\?\.controlaMontagem\)\);/.test(app)
  && /\$\{comMontagem \? '<th>Condição<\/th>' : ''\}/.test(app)
  && /\$\{comMontagem \? `<td>\s*<!-- Fase ER: produto que controla montagem/.test(app));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
