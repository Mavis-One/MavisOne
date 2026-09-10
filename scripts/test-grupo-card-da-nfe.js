#!/usr/bin/env node
/**
 * O GRUPO `card` DA NF-e (fase BW) — INTEIRO OU NENHUM.
 *
 * O DEFEITO QUE ISTO EVITA
 * ------------------------
 * Na observação do ViperERP de 08/09/2026, duas notas caíram seguidas na mesma
 * rejeição:
 *
 *   Rejeicao: Falha no Schema XML da NFe
 *   (Elemento: enviNFe/NFe[1]/infNFe/pag/detPag/card/CNPJ/) (Cod: 225)
 *
 * O grupo `card` saía SEM o CNPJ da credenciadora. O operador corrigiu a
 * primeira nota à mão e minutos depois a seguinte caiu no mesmo erro — o
 * defeito era do cadastro, não da nota.
 *
 * A lição está na assimetria: enquanto o grupo NÃO é montado, a SEFAZ não cobra
 * nada dele. É montá-lo PELA METADE que derruba a nota. Por isso a fase BV fez
 * primeiro o cadastro de credenciadoras, e só esta fase monta o grupo.
 *
 * O QUE ESTE TESTE PROVA
 * ----------------------
 * 1. Linha que não é cartão não ganha grupo nenhum.
 * 2. Linha de cartão SEMPRE declara `tipo_integracao`, com padrão 2 (POS).
 * 3. Campo inválido não viaja: CNPJ que não tem 14 dígitos, bandeira fora da
 *    tabela tBand.
 * 4. Declarar INTEGRADO (tpIntegra=1) sem CNPJ ou sem NSU é RECUSADO — antes
 *    de transmitir, que é a única hora em que ainda dá para consertar.
 * 5. O CNPJ da credenciadora é resolvido NO SERVIDOR, pelo methodId da linha,
 *    e não aceito do navegador.
 * 6. A linha de pagamento do pedido GUARDA os campos do cartão. `salesPaymentLines`
 *    monta a linha campo a campo: o que não estiver listado lá é descartado em
 *    silêncio ao salvar, e a tela mostraria bandeira e NSU que sumiriam ao reabrir.
 *
 * O QUE ESTE TESTE NÃO COBRE: se a Focus NFe monta o XML a partir destes nomes
 * de campo. Eles vêm da referência oficial dela
 * (campos.focusnfe.com.br/nfe/FormaPagamentoXML.html), com a tag XML de cada um
 * conferida — mas a Focus IGNORA campo desconhecido em silêncio e responde
 * sucesso, então só uma emissão em homologação com o XML de volta fecha isso.
 * É a mesma pendência de `notas_referenciadas`.
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

const { buildNfePayload, conferirCartoesDaNota } = require('../lib/nfePayloadBuilder');
const bandeiras = require('../public/modules/shared/bandeira_cartao');
const formaPagamento = require('../public/modules/shared/forma_pagamento');

// Um CNPJ que passa no dígito verificador — o cadastro de credenciadoras não
// aceita outro, e um inválido aqui provaria o teste errado.
const CNPJ_REDE = '01425787000104';

const BASE = {
  estabelecimento: {
    razaoSocial: 'Loja', cnpj: '11222333000181', logradouro: 'Rua', numero: '1',
    bairro: 'Centro', municipio: 'Blumenau', uf: 'SC', cep: '89000000',
    codigoMunicipio: '4202404', inscricaoEstadual: '123456789'
  },
  empresa: { crt: 1 },
  destinatario: {
    nome: 'Cliente', documento: '11222333000181', uf: 'SC',
    logradouro: 'Rua', bairro: 'Centro', municipio: 'Blumenau', cep: '89000000'
  },
  itens: [{ descricao: 'Produto', quantidade: 1, valorUnitario: 1000, ncm: '61091000', regraFiscal: { cfop: '5102' } }],
  naturezaOperacao: 'Venda'
};
const linhas = (pagamentos) => buildNfePayload({ ...BASE, pagamentos }).formas_pagamento;
const primeira = (pagamentos) => linhas(pagamentos)[0];
const paga = (p) => buildNfePayload({ ...BASE, pagamentos: [p] });

console.log('--- 1. o catálogo de bandeiras é um só ---');
check('a tabela tBand está no catálogo compartilhado', bandeiras.CATALOGO.length === 10, `${bandeiras.CATALOGO.length} bandeiras`);
check('  com código de dois dígitos', bandeiras.CATALOGO.every((b) => /^\d{2}$/.test(b.codigo)));
// Bandeira desconhecida devolve '' e não '99': dizer "Outros" no lugar de "não
// sei" seria inventar informação para a SEFAZ.
check('bandeira desconhecida não vira "Outros"', bandeiras.nome('ZZ') === '');
// O cadastro promete em texto que não marcar nenhuma não restringe.
check('credenciadora sem bandeira marcada não restringe', bandeiras.ofertadas([]).length === 10);
check('  e com bandeiras marcadas oferece só elas', bandeiras.ofertadas(['01', '06']).map((b) => b.codigo).join(',') === '01,06');
check('  ignorando código que não existe', bandeiras.ofertadas(['01', 'ZZ']).length === 1);
// A duplicata que esta fase desfez: a lista estava escrita em lib/db/adquirentes.js
// E à mão no formulário. Um terceiro consumidor foi o limite.
check('adquirentes.js usa o catálogo, não uma cópia',
  /require\('\.\.\/\.\.\/public\/modules\/shared\/bandeira_cartao'\)/.test(ler('lib/db/adquirentes.js')));
check('o formulário de credenciadora também',
  /window\.MavisBandeiraCartao\.CATALOGO/.test(ler('public/modules/cadastros/subs/nova_credenciadora.js')));
check('quem é cartão está no catálogo de formas', formaPagamento.ehCartao('cartao-credito') && formaPagamento.ehCartao('cartao-debito'));
check('  e o que não é, não é', !formaPagamento.ehCartao('pix') && !formaPagamento.ehCartao('dinheiro'));

console.log('--- 2. o grupo só existe onde faz sentido ---');
check('dinheiro não ganha grupo de cartão', primeira([{ forma: '01', valor: 1000 }]).tipo_integracao === undefined);
// Mandar bandeira num PIX seria oferecer à SEFAZ um grupo que não existe ali.
check('PIX com bandeira também não', primeira([{ forma: '17', valor: 1000, bandeira: '06', integracao: '1' }]).tipo_integracao === undefined);
check('crédito ganha', primeira([{ forma: '03', valor: 1000 }]).tipo_integracao === 2);
check('débito também', primeira([{ forma: '04', valor: 1000 }]).tipo_integracao === 2);

console.log('--- 3. o padrão é a verdade da loja: maquininha POS ---');
// Declarar "integrado" obriga CNPJ e autorização. O padrão 2 é o que uma
// maquininha ao lado do computador é — e não obriga nada.
const pos = primeira([{ forma: '03', valor: 1000 }]);
check('sem nada informado, tpIntegra = 2', pos.tipo_integracao === 2);
check('  e nenhum campo inventado viaja',
  pos.cnpj_credenciadora === undefined && pos.bandeira_operadora === undefined && pos.numero_autorizacao === undefined);

console.log('--- 4. campo inválido some, não viaja ---');
const invalidos = primeira([{ forma: '03', valor: 1000, cnpjCredenciadora: '123', bandeira: 'ZZ', autorizacao: '  ' }]);
check('CNPJ que não tem 14 dígitos não vai', invalidos.cnpj_credenciadora === undefined);
check('bandeira fora da tabela tBand não vai', invalidos.bandeira_operadora === undefined);
check('autorização em branco não vai', invalidos.numero_autorizacao === undefined);
const comMascara = primeira([{ forma: '03', valor: 1000, cnpjCredenciadora: '01.425.787/0001-04' }]);
check('CNPJ com máscara vira só dígitos', comMascara.cnpj_credenciadora === CNPJ_REDE, comMascara.cnpj_credenciadora);
// cAut vai até 128 caracteres no layout; cortar aqui é melhor do que a SEFAZ
// recusar a nota inteira por causa do NSU.
const nsuLongo = primeira([{ forma: '03', valor: 1000, autorizacao: 'A'.repeat(200) }]);
check('NSU é cortado no limite do cAut', nsuLongo.numero_autorizacao.length === 128, `${nsuLongo.numero_autorizacao.length} caracteres`);

console.log('--- 5. INTEGRADO exige o grupo inteiro (a rejeição 225) ---');
const completo = { forma: '03', valor: 1000, integracao: '1', cnpjCredenciadora: CNPJ_REDE, bandeira: '06', autorizacao: 'R07242' };
check('integrado e completo passa', conferirCartoesDaNota(paga(completo)) === '');
check('  com os quatro campos montados',
  JSON.stringify(primeira([completo])) === JSON.stringify({
    forma_pagamento: '03', valor_pagamento: 1000, tipo_integracao: 1,
    cnpj_credenciadora: CNPJ_REDE, bandeira_operadora: '06', numero_autorizacao: 'R07242'
  }));
// ESTE é o caso do ViperERP: card sem CNPJ.
const semCnpj = conferirCartoesDaNota(paga({ ...completo, cnpjCredenciadora: '' }));
check('integrado SEM CNPJ é recusado', semCnpj.includes('CNPJ da credenciadora'));
check('  explicando que volta como rejeição 225', /225/.test(semCnpj));
check('  e dizendo o que fazer', /nao integrado|não integrado/.test(semCnpj));
check('integrado SEM autorização é recusado',
  conferirCartoesDaNota(paga({ ...completo, autorizacao: '' })).includes('NSU'));
// A recusa não pode se estender ao que a SEFAZ não cobra: exigir CNPJ do POS
// impediria de vender no cartão só porque ninguém cadastrou a credenciadora.
check('NÃO integrado sem nada NÃO é recusado',
  conferirCartoesDaNota(paga({ forma: '03', valor: 1000, integracao: '2' })) === '');
check('  nem sem bandeira', conferirCartoesDaNota(paga({ ...completo, bandeira: '' })) === '');

console.log('--- 6. o CNPJ é resolvido no servidor, não aceito da tela ---');
const src = ler('server.js');
check('a função existe', /async function pagamentosComCredenciadora\(pagamentos\)/.test(src));
// Pelo methodId da linha -> forma de pagamento -> credenciadora. Aceitar o CNPJ
// do navegador emitiria com o número que estava carregado quando o pedido foi
// aberto: corrigir um cadastro errado não consertaria as notas seguintes.
check('  buscando pelo methodId da linha', /const forma = formasPorId\.get\(String\(p\.methodId\)\);/.test(src));
check('  e lendo a credenciadora do banco', /adquirentesPorId\.get\(forma\.cardAcquirerId\)/.test(src));
check('a emissão usa a versão resolvida',
  /pagamentos: await pagamentosComCredenciadora\(body\.pagamentos\),/.test(src));
// Antes de gravar rascunho e antes de falar com a Focus: passar deste ponto
// consome numeração, e nota rejeitada não se conserta.
//
// Desde a fase BY isso é estrutural, e não mais uma questão de ordem das
// linhas: a conferência inteira mora em `prepararNfeParaTransmitir`, que não
// grava NADA (scripts/test-pre-check-fiscal.js prova campo a campo), e
// `emitirNfeFiscal` abre chamando aquela. Não há como a conferência do cartão
// rodar depois do rascunho sem alguém mover a função de lugar.
const preparar = src.slice(src.indexOf('async function prepararNfeParaTransmitir'), src.indexOf('async function emitirNfeFiscal'));
check('a conferência do cartão roda ANTES do rascunho',
  /conferirCartoesDaNota\(payload\)/.test(preparar) && !preparar.includes('createNfeRascunho'));
check('o meta de vendas leva a credenciadora junto', /paymentMethods: await formasComCredenciadora\(data\),/.test(src));
// O CNPJ NÃO vai para o navegador — só nome e bandeiras.
const helper = (/async function formasComCredenciadora\(data\) \{[\s\S]*?\n\}/.exec(src) || [''])[0];
check('  mas sem o CNPJ', helper.includes('cardAcquirerName') && helper.includes('cardAcquirerBrands') && !helper.includes('cnpj'));

console.log('--- 7. a linha de pagamento GUARDA o cartão ---');
// salesPaymentLines monta a linha campo a campo: o que não está lá é descartado
// em silêncio ao salvar. A tela mostraria bandeira e NSU, e o pedido reabriria
// sem eles — o pior tipo de defeito, o que não dá erro.
const guarda = (/function salesPaymentLines\(body\) \{[\s\S]*?\n\}/.exec(src) || [''])[0];
check('cardBrand é guardado', /cardBrand:/.test(guarda));
check('  conferido contra a tabela tBand', /bandeiraCartao\.existe\(linha\.cardBrand\)/.test(guarda));
check('cardIntegration é guardado', /cardIntegration:/.test(guarda));
check('  e só admite 1 ou 2', /\['1', '2'\]\.includes/.test(guarda));
check('cardAuthorization é guardado', /cardAuthorization:/.test(guarda));
check('  cortado no limite do cAut', /\.slice\(0, 128\)/.test(guarda));

console.log('--- 8. as telas ---');
const app = ler('public/app.js');
check('o pedido desenha a linha de cartão', /<tr class="sales-payment-cartao">/.test(app));
check('  só quando a forma é cartão', /window\.MavisFormaPagamento\.ehCartao\(formaDaLinha\.type\)/.test(app));
check('  oferecendo as bandeiras da credenciadora', /window\.MavisBandeiraCartao\.ofertadas\(formaDaLinha\.cardAcquirerBrands\)/.test(app));
check('  e avisando quando não há credenciadora', /sales-payment-cartao-sem-adquirente/.test(app));
// Trocar cartão por dinheiro e deixar bandeira/NSU para trás faria a linha
// viajar para a NF-e com dados de um cartão que a venda não tem mais.
check('trocar a forma limpa o que não vale mais', /const ajustarCamposDeCartao = \(linha, forma\) => \{/.test(app));
check('  e apaga os três campos fora do cartão',
  /delete linha\.cardIntegration;\s*\n\s*delete linha\.cardBrand;\s*\n\s*delete linha\.cardAuthorization;/.test(app));
check('o pedido manda o methodId para a nota', /methodId: linha\.methodId \|\| '',/.test(app));
const emitir = ler('public/modules/finance/subs/emitir_nfe_focus.js');
check('a tela de emissão encaminha o cartão', /integracao: linha\.integracao,/.test(emitir));
check('  e mostra o que vai no XML', /<th>Cartão<\/th>/.test(emitir));
check('o catálogo entra no index.html', ler('public/index.html').includes('modules/shared/bandeira_cartao.js'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
