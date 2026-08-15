#!/usr/bin/env node
// O CST decide QUAIS campos a nota carrega — não é um rótulo.
//
// O QUE ESTE TESTE EXISTE PARA PEGAR
// ----------------------------------
// Até 14/08/2026 o payload mandava base, alíquota e valor de ICMS para
// QUALQUER CST. Numa isenta (40) isso é declarar imposto onde não há, e a
// SEFAZ recusa. Não tinha explodido porque a única regra cadastrada usava
// CST 00, onde os três são mesmo obrigatórios — apareceria na primeira
// isenção que alguém cadastrasse.
//
// A armadilha do meio: "isenta ou não tributada E COM ST" (CST 30) começa com
// a palavra isenta e NÃO tem ICMS próprio, mas TEM substituição tributária.
// Tratar os dois lados pelo nome erra os dois.
//
// A outra: CST que exige grupo que este sistema ainda não monta (diferimento,
// ST retido, monofásico) precisa ser RECUSADO. Emitir pela metade produz nota
// que passa na validação declarando o imposto errado — e isso só aparece numa
// fiscalização.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const CST = require('../public/modules/shared/cst_icms');
const { buildNfePayload } = require('../lib/nfePayloadBuilder');

const ARGS = {
  estabelecimento: { cnpj: '11222333000181', razaoSocial: 'Emitente SC Ltda', logradouro: 'Rua B', numero: '1', bairro: 'Centro', municipio: 'Joinville', uf: 'SC', cep: '89201000', codigoMunicipio: '4209102', inscricaoEstadual: '123456789' },
  empresa: { crt: 3 },
  destinatario: { nome: 'Cliente', documento: '12345678000199', contribuinte: true, logradouro: 'Rua A', numero: '10', bairro: 'Centro', municipio: 'Joinville', uf: 'SC', cep: '89201000' },
  naturezaOperacao: 'Venda', tipoDocumento: 1, finalidadeEmissao: 1, dataEmissao: '2026-08-15T10:00:00-03:00',
  ambiente: 'homologacao'
};
const montar = (regra) => buildNfePayload({
  ...ARGS,
  itens: [{
    descricao: 'Produto', codigoProduto: 'P1', ncm: '73181500', quantidade: 2, valorUnitario: 100, unidadeComercial: 'UN',
    regraFiscal: { cfop: '5102', cstPis: '01', aliquotaPis: 0.65, cstCofins: '01', aliquotaCofins: 3, ...regra }
  }]
}).items[0];

console.log('--- a tabela cobre os 12 CST do layout ---');
const OFICIAIS = ['00', '10', '20', '30', '40', '41', '50', '51', '60', '61', '70', '90'];
OFICIAIS.forEach((c) => check(`CST ${c} está na tabela`, Boolean(CST.situacao(c)), CST.situacao(c)?.rotulo));
check('e nada além deles', Object.keys(CST.SITUACOES).length === OFICIAIS.length, String(Object.keys(CST.SITUACOES).length));

console.log('\n--- quem tributa a operação própria ---');
// Estes levam base, alíquota e valor.
['00', '10', '20', '70', '90'].forEach((c) => check(`CST ${c} tem ICMS próprio`, CST.temIcmsProprio(c)));
// Estes NÃO. O 30 é o que engana: o nome começa com "isenta".
['30', '40', '41', '50', '60', '61'].forEach((c) => check(`CST ${c} NÃO tem ICMS próprio`, !CST.temIcmsProprio(c)));

console.log('\n--- CST isento sai com SÓ a situação tributária ---');
const camposIcms = (item) => Object.keys(item).filter((k) => k.startsWith('icms_')).sort();
['40', '41', '50', '30'].forEach((cst) => {
  const item = montar({ cstIcms: cst, aliquotaIcms: 17 });
  const campos = camposIcms(item);
  // A alíquota foi passada DE PROPÓSITO: mesmo declarada na regra, não pode
  // sair na nota. Uma regra antiga pode ter alíquota gravada de quando o campo
  // aparecia para todo CST.
  check(`CST ${cst}: nada de base/alíquota/valor`, campos.join(',') === 'icms_origem,icms_situacao_tributaria', campos.join(', '));
  check(`CST ${cst}: mas a situação tributária vai`, item.icms_situacao_tributaria === cst);
});

console.log('\n--- CST tributado continua completo ---');
const tributado = montar({ cstIcms: '00', aliquotaIcms: 17 });
check('CST 00 leva base', tributado.icms_base_calculo === 200, String(tributado.icms_base_calculo));
check('CST 00 leva alíquota', tributado.icms_aliquota === 17, String(tributado.icms_aliquota));
check('CST 00 leva valor (200 x 17%)', tributado.icms_valor === 34, String(tributado.icms_valor));

const reduzido = montar({ cstIcms: '20', aliquotaIcms: 17, reducaoBcIcms: 50 });
check('CST 20 declara a redução da base', reduzido.icms_reducao_base_calculo === 50, String(reduzido.icms_reducao_base_calculo));
check('e a base já vai reduzida (200 - 50%)', reduzido.icms_base_calculo === 100, String(reduzido.icms_base_calculo));

console.log('\n--- ST só onde o CST admite ---');
// Marcar ST numa regra de CST 00 declararia substituição numa operação que
// não tem.
const stEmCst00 = montar({ cstIcms: '00', aliquotaIcms: 17, cstIcmsSt: '60', mvaSt: 40, aliquotaIcmsSt: 17 });
check('CST 00 ignora o grupo de ST', !('icms_valor_st' in stEmCst00));
const stEmCst10 = montar({ cstIcms: '10', aliquotaIcms: 17, cstIcmsSt: '60', mvaSt: 40, aliquotaIcmsSt: 17 });
check('CST 10 monta o grupo de ST', stEmCst10.icms_valor_st > 0, String(stEmCst10.icms_valor_st));
const stEmCst30 = montar({ cstIcms: '30', cstIcmsSt: '60', mvaSt: 40, aliquotaIcmsSt: 17 });
check('CST 30 monta ST mesmo sem ICMS próprio', stEmCst30.icms_valor_st > 0, String(stEmCst30.icms_valor_st));

console.log('\n--- CST não implementado é RECUSADO, não emitido pela metade ---');
['51', '60', '61'].forEach((cst) => {
  let recusou = false;
  let mensagem = '';
  try { montar({ cstIcms: cst, aliquotaIcms: 17 }); } catch (e) { recusou = true; mensagem = e.message; }
  check(`CST ${cst} é recusado`, recusou, recusou ? '' : 'EMITIU');
  if (recusou) {
    check(`  e o erro diz o que falta`, /falta o /.test(mensagem) && /não é emitido por este sistema/.test(mensagem));
  }
});
let recusouDesconhecido = false;
try { montar({ cstIcms: '99', aliquotaIcms: 17 }); } catch (e) { recusouDesconhecido = /não existe na tabela/.test(e.message); }
check('CST inexistente também é recusado', recusouDesconhecido);

console.log('\n--- Simples Nacional segue por outro caminho ---');
// CSOSN não é CST: quem usa o Simples não passa pela tabela acima.
const simples = montar({ csosn: '102' });
check('CSOSN vai na situação tributária', simples.icms_situacao_tributaria === '102');
check('e sem base/alíquota', !('icms_base_calculo' in simples) && !('icms_aliquota' in simples));

console.log('\n--- servidor e tela leem a MESMA tabela ---');
// Se a tela tivesse a sua própria lista, um CST novo entraria num lado só: o
// formulário esconderia a alíquota e o payload a mandaria assim mesmo.
const builderSrc = ler('lib/nfePayloadBuilder.js');
const telaSrc = ler('public/modules/fiscal/subs/regras.js');
const indexSrc = ler('public/index.html');
check('o builder importa o módulo compartilhado', /require\('\.\.\/public\/modules\/shared\/cst_icms'\)/.test(builderSrc));
check('a tela usa o mesmo módulo', /window\.MavisCstIcms/.test(telaSrc));
check('e ele é carregado no index', /shared\/cst_icms\.js/.test(indexSrc));
check('antes da tela de regras', indexSrc.indexOf('shared/cst_icms.js') < indexSrc.indexOf('fiscal/subs/regras.js'));
// O módulo precisa funcionar nos dois mundos.
const cstSrc = ler('public/modules/shared/cst_icms.js');
check('exporta para o Node', /module\.exports = api/.test(cstSrc));
check('e para o navegador', /raiz\.MavisCstIcms = api/.test(cstSrc));

console.log('\n--- a tela esconde o que não se aplica ---');
check('a linha de ICMS próprio é marcada', /data-icms-proprio/.test(telaSrc));
check('a redução da BC é marcada à parte', /data-icms-reducao/.test(telaSrc));
check('e some quando o CST não tributa', /linhaIcms\.hidden = !mostrarTributo/.test(telaSrc));
// Campo que desaparece sem explicação parece defeito da tela.
check('com um aviso explicando o porquê', /Não há base, alíquota nem valor de ICMS a declarar/.test(telaSrc));
check('e avisa antes de emitir quando o CST não é suportado', /a emissão vai recusar/.test(telaSrc));
check('o aviso tem estilo', /\.fiscal-aviso-cst/.test(ler('public/app.css')));
// Editar uma regra isenta tem que ABRIR sem os campos, não só depois de mexer.
check('a regra vale já na abertura do formulário', /\n\s*aplicarRegrasDoCst\(\);/.test(telaSrc));

console.log('\n--- "0" e "00" são o mesmo CST ---');
// O banco guarda char(2) e a tela pode mandar "0": sem normalizar, um CST "0"
// não casaria com "00" e cairia no caminho do desconhecido.
check('normaliza "0" para "00"', CST.normalizar('0') === '00');
check('normaliza 40 numérico', CST.normalizar(40) === '40');
check('e devolve vazio para nulo', CST.normalizar(null) === '');

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
