// O DIFAL ANTES DE ENVIAR (21/10/2026, rejeição 694 numa NF-e da Plus para a
// ENGESOLDA: "Nao informado o grupo de ICMS para a UF de destino [nItem:1]").
//
// A ENGESOLDA tem IE (confirmado pelo usuário), mas saiu como NÃO contribuinte:
// a IE não estava no cadastro. Venda para outro estado a não contribuinte
// exige o grupo ICMSUFDest, e as regras fiscais (todas "qualquer UF", 17%) não
// têm a alíquota interna do destino — então o grupo não ia e a SEFAZ recusava.
// Agora a emissão recusa ANTES de enviar, dizendo as duas saídas: marcar
// contribuinte e informar a IE, ou cadastrar a alíquota interna da UF.
//
// Regra 694 (oobj/NCM Buscador): idDest 2, indFinal 1, indIEDest 9, sem ISSQN.
// Dispensados: CST 41, CSOSN 300 e 400. Simples (CRT 1) fica fora: as fontes
// divergem e o montador não monta o grupo por decisão (ADI 5.464).
const fs = require('fs');
const path = require('path');
const { buildNfePayload, conferirDifalDaNota } = require('../lib/nfePayloadBuilder');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas++;
};

const montar = (dest, regra = {}, crt = 3) => buildNfePayload({
  estabelecimento: { cnpj: '12345678000199', razaoSocial: 'X', uf: 'SC', municipio: 'F', codigoMunicipio: '4205407', logradouro: 'R', numero: '1', bairro: 'C', cep: '88000000', inscricaoEstadual: '123' },
  empresa: { crt, regimeTributario: crt === 1 ? 'SIMPLES_NACIONAL' : 'LUCRO_PRESUMIDO' },
  destinatario: { nome: 'ENGESOLDA', documento: '11222333000181', uf: 'PR', contribuinte: false, ...dest },
  itens: [{ codigoProduto: 'P1', descricao: 'Item', ncm: '87116000', quantidade: 1, valorUnitario: 100,
    difal: !(dest.contribuinte) && (dest.uf || 'PR') !== 'SC',
    regraFiscal: { cfop: '6102', cstIcms: '00', aliquotaIcms: 12, ...regra } }],
  naturezaOperacao: 'Venda', ambiente: 'producao', pagamentos: [{ forma: '01', valor: 100 }]
});

console.log('\n--- a conferência ---');
const recusa = conferirDifalDaNota(montar({}));
check('outro estado, não contribuinte, regra sem alíquota interna: recusa antes de enviar', /rejeição 694/.test(recusa));
check('  dizendo as duas saídas', /marque "Contribuinte de ICMS"/.test(recusa) && /cadastre a alíquota interna de PR/.test(recusa));
check('com a alíquota interna do destino na regra, o grupo vai e passa', conferirDifalDaNota(montar({}, { aliquotaInternaUfDestino: 19.5 })) === '');
check('contribuinte com IE: não há DIFAL', conferirDifalDaNota(montar({ contribuinte: true, inscricaoEstadual: '9012345678' })) === '');
check('mesmo estado: não há DIFAL', conferirDifalDaNota(montar({ uf: 'SC' })) === '');
check('Simples (CRT 1) fica fora', conferirDifalDaNota(montar({}, { cstIcms: undefined, csosn: '102' }, 1)) === '');
check('CST 41 é dispensado pela regra 694', conferirDifalDaNota(montar({}, { cstIcms: '41' })) === '');

console.log('\n--- o servidor ---');
const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
check('a emissão (e a prévia) confere, depois do endereço', /const difalFaltando = nfce \? '' : conferirDifalDaNota\(payload\);\s*if \(difalFaltando\) \{/.test(servidor)
  && servidor.indexOf('conferirDestinatarioDaNota(payload)') < servidor.indexOf('conferirDifalDaNota(payload)'));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
