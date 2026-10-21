// O VALOR DO TÍTULO DE ENTRADA DE NF-e SE EDITA (21/10/2026, pedido do usuário,
// no print da Edição de Título LF33474 da NF-e 72604: "ao editar um lançamento
// no financeiro de uma NFE lançada pelo arquivo XML, seja possível alterar o
// valor, pois muitas vezes a NFE é emitida por um valor, mas o valor cobrado na
// fatura é outro").
//
// Só o título da entrada de NF-e (referenceId de nfe_entrada). O de pedido e o
// de NF-e emitida seguem com o valor travado; data, descrição e fornecedor
// seguem da nota. A trilha guarda de quanto para quanto.
//
// Provado na 3099 com a entrada de teste (apagada depois): o título abriu com
// o Valor livre e o aviso "o valor pode ser ajustado ao que a fatura cobra";
// 306,25 → 299,90 gravado, com { valorAnterior: 306.25, valorNovo: 299.9 } na
// trilha; o título 2 ficou com o dele; valor zero recusado; e no título de
// pedido o servidor recusou ("não dá para alterar: valor").
const fs = require('fs');
const path = require('path');

const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas++;
};

const servidor = ler('server.js');
console.log('\n--- o servidor ---');
check('é título de entrada quando a referência é uma nfe_entrada',
  /async function tituloDeEntradaDeNfe\(referenceId\) \{[\s\S]*?select 1 from nfe_entrada where id = \$1/.test(servidor));
check('a edição libera só o valor, e só na entrada de NF-e',
  /const valorEditavel = !vinculadoANfe && await tituloDeEntradaDeNfe\(entry\.referenceId\);/.test(servidor)
  && /\['valor', !valorEditavel && mudou\('amount'/.test(servidor)
  && /if \(valorEditavel && body\.amount !== undefined\) entry\.amount = Math\.round\(Number\(body\.amount\) \* 100\) \/ 100;/.test(servidor));
check('  data, descrição e fornecedor seguem protegidos',
  /\['data', mudou\('date'/.test(servidor) && /\['descrição', mudou\('description'/.test(servidor) && /\['cliente', mudou\('clientSupplierId'/.test(servidor));
check('  e a trilha guarda de quanto para quanto', /\{ valorAnterior, valorNovo: Number\(entry\.amount \|\| 0\) \}/.test(servidor));
check('abrir o título conta à tela que o valor está livre',
  /if \(!entry\.nfeId && await tituloDeEntradaDeNfe\(entry\.referenceId\)\) \{\s*serializado\.vinculo = 'entrada';\s*serializado\.camposTravados = \(serializado\.camposTravados \|\| \[\]\)\.filter\(\(campo\) => campo !== 'amount'\);/.test(servidor));

console.log('\n--- a tela ---');
const tela = ler('public/modules/finance/subs/novo_lancamento.js');
check('o valor vai no envio quando não está travado', /\.\.\.\(travado\('amount'\) \? \{\} : \{ amount: Number\(formData\.get\('amount'\)\) \}\)/.test(tela));
check('o aviso da fila e o do título dizem que o valor se ajusta',
  tela.includes("'Data, descrição e fornecedor vêm da nota; o valor pode ser ajustado ao que a fatura cobra.'")
  && /<strong>Lançamento gerado por uma entrada de NF-e\.<\/strong>/.test(tela));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
