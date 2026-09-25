#!/usr/bin/env node
/**
 * MODALIDADE DO FRETE NA NF-e (modFrete) — sem banco e sem servidor.
 *
 * O DEFEITO (fase CY). A aba Entrega do pedido tem "Meio de Envio" com cinco
 * opções, entre elas "Entrega Própria" e "Retirada no Balcão" — escolhidas para
 * a operação real (venda em loja, 13 lojas, entrega própria/combinada). Nenhum
 * dos dois caminhos de emissão lia esse campo:
 *
 *   · a tela mandava `modalidadeFrete: 0` FIXO sempre que havia valor de frete;
 *   · o servidor (`montarNfeDoPedido`, que o pré-check também usa) não mandava
 *     nada, caindo no palpite do builder: `frete > 0 ? 0 : 9`.
 *
 * O resultado na nota:
 *
 *   Meio de Envio        frete cobrado   declarava   é
 *   Entrega Própria       R$ 0,00           9         3
 *   Entrega Própria       R$ 80,00          0         3
 *   Transportadora        R$ 0,00           9         0
 *   Retirada no Balcão    R$ 0,00           9         9   (já certo)
 *   Transportadora        R$ 80,00          0         0   (já certo)
 *
 * Toda nota de entrega própria saía declarando frete CONTRATADO de terceiro, e
 * toda entrega cujo frete a loja absorveu saía declarando que não houve
 * transporte nenhum.
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * 1. O VALOR NÃO DECIDE A MODALIDADE. `modFrete` responde QUEM CONTRATOU o
 *    transporte; `vFrete` responde quanto custou. O `freteCobrado` da fase BQ
 *    zera o segundo sem mexer no primeiro, e foi amarrar os dois que criou
 *    metade do defeito.
 * 2. "OUTRO" DEVOLVE `undefined`, NÃO 0. Devolver 0 apagaria o último palpite
 *    do builder e faria "Outro" sem frete declarar transporte contratado.
 * 3. A REGRA TEM UM DONO SÓ, e a lista de Meio de Envio mora com ela: solta em
 *    app.js, um sexto meio entraria no select e sairia declarando 0 sem ninguém
 *    decidir nada.
 * 4. OS DOIS CAMINHOS USAM O MESMO MÓDULO. São dois montadores do corpo da nota
 *    (a tela e o servidor), e é o segundo que o pré-check chama — duas
 *    traduções do mesmo de-para divergiriam na primeira mudança.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const { semComentarios } = require('./sem-comentarios');

const mf = require(path.join(RAIZ, 'public/modules/shared/modalidade_frete'));

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`  ${cond ? 'OK  ' : 'XX  '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// ---------------------------------------------------------------------------
console.log('--- 1. o de-para é o da tabela da SEFAZ ---');
check('Entrega Própria é transporte próprio do remetente (3)', mf.paraNota('Entrega Própria') === 3,
  String(mf.paraNota('Entrega Própria')));
check('Retirada no Balcão é sem ocorrência de transporte (9)', mf.paraNota('Retirada no Balcão') === 9,
  String(mf.paraNota('Retirada no Balcão')));
check('Transportadora é frete contratado pelo remetente (0)', mf.paraNota('Transportadora') === 0);
check('Correios também é 0', mf.paraNota('Correios') === 0);

console.log('\n--- 2. "Outro" e o vazio não respondem, e devolvem undefined ---');
// undefined, e não 0: quem chama repassa ao builder, e é o builder que tem o
// último palpite (`frete > 0 ? 0 : 9`). Zero aqui apagaria esse palpite.
check('"Outro" devolve undefined', mf.paraNota('Outro') === undefined);
check('vazio devolve undefined', mf.paraNota('') === undefined);
check('null devolve undefined', mf.paraNota(null) === undefined);
check('meio desconhecido devolve undefined', mf.paraNota('Jadlog') === undefined,
  'meio novo no cadastro nao pode inventar modalidade');

console.log('\n--- 3. o 1 e o 4 não são escolhíveis, de propósito ---');
// Os dois dizem que quem CONTRATOU foi o destinatário, e o pedido não tem campo
// que registre isso. "Cobrar frete do comprador" é quem PAGA, não quem contrata
// — repassar o frete na nota é o próprio CIF, e continua sendo 0.
const codigos = Object.values(mf.POR_MEIO);
check('nenhum meio mapeia para 1 (FOB)', !codigos.includes(1));
check('nenhum meio mapeia para 4', !codigos.includes(4));
check('nenhum meio mapeia para 2 (terceiros)', !codigos.includes(2),
  'o pedido nao sabe dizer que um terceiro contratou');

console.log('\n--- 4. a lista de Meio de Envio mora com a regra ---');
check('o módulo exporta MEIOS_ENVIO', Array.isArray(mf.MEIOS_ENVIO) && mf.MEIOS_ENVIO.length === 5,
  mf.MEIOS_ENVIO.join(' · '));
// TODO meio da lista precisa de decisão: ou está no de-para, ou é "Outro".
for (const meio of mf.MEIOS_ENVIO) {
  check(`  "${meio}" tem decisão`, meio === 'Outro' || mf.paraNota(meio) !== undefined,
    meio === 'Outro' ? 'undefined, e e o unico que pode' : mf.rotulo(mf.paraNota(meio)));
}
const app = semComentarios(ler('public/app.js'));
check('e a tela NÃO tem mais a sua própria cópia da lista',
  !/const MEIOS_ENVIO = \['Outro'/.test(app),
  'era um array literal solto em app.js');
check('  ela lê do módulo', /const MEIOS_ENVIO = window\.MavisModalidadeFrete\.MEIOS_ENVIO;/.test(app));

console.log('\n--- 5. os DOIS caminhos de emissão usam o módulo ---');
const servidor = semComentarios(ler('server.js'));
const tela = semComentarios(ler('public/modules/finance/subs/emitir_nfe_focus.js'));

check('o servidor requer o módulo',
  /require\('\.\/public\/modules\/shared\/modalidade_frete'\)/.test(ler('server.js')));
check('  e montarNfeDoPedido traduz o meio de envio do pedido',
  /modalidadeFrete: modalidadeFrete\.paraNota\(pedido\.delivery && pedido\.delivery\.shippingMethod\)/.test(servidor));
check('a tela traduz pelo módulo',
  /window\.MavisModalidadeFrete\.paraNota\(doPedido && doPedido\.meioDeEnvio\)/.test(tela));

// O DEFEITO EM UMA LINHA. Se voltar, é aqui que falha.
check('e NÃO existe mais modalidadeFrete fixo em 0',
  !/modalidadeFrete: 0/.test(tela) && !/modalidadeFrete: 0/.test(servidor),
  'era `...(frete ? { frete, modalidadeFrete: 0 } : {})`');

console.log('\n--- 6. a modalidade não viaja amarrada ao valor do frete ---');
// Transporte próprio sem cobrança tem vFrete zero e modFrete 3. Enquanto a
// modalidade morava dentro do `...(frete ? ...)`, esse caso declarava 9.
check('a modalidade sai do seu próprio spread',
  /\.\.\.\(modalidadeDoFrete === undefined \? \{\} : \{ modalidadeFrete: modalidadeDoFrete \}\)/.test(tela));
check('  e o frete sai sozinho no dele', /\.\.\.\(frete \? \{ frete \} : \{\}\)/.test(tela));
// Vendas manda o MEIO, não o código já resolvido: mandar o número criaria uma
// segunda tradução do mesmo de-para.
check('Vendas manda o meio, não o código', /meioDeEnvio: formState\.shippingMethod \|\| '',/.test(app));

console.log('\n--- 7. o módulo carrega antes de quem o usa ---');
const html = ler('public/index.html');
const posicao = (trecho) => html.indexOf(trecho);
check('antes do app.js',
  posicao('shared/modalidade_frete.js') > 0
  && posicao('shared/modalidade_frete.js') < posicao('src="/app.js"'));
check('e antes da tela de emissão',
  posicao('shared/modalidade_frete.js') < posicao('emitir_nfe_focus.js'));

console.log('\n--- 8. o builder continua com o último palpite ---');
// Ele é o fundo do poço para a nota AVULSA, que não tem pedido nem meio de
// envio. Tirar o palpite deixaria modFrete ausente numa nota com frete.
const builder = semComentarios(ler('lib/nfePayloadBuilder.js'));
check('sem modalidade, o valor decide', /\(num\(frete\) > 0 \? 0 : 9\)/.test(builder));
check('  e a modalidade explícita ganha do palpite',
  /modalidade_frete: modalidadeFrete !== undefined && modalidadeFrete !== null/.test(builder));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
