#!/usr/bin/env node
// Geração das parcelas de um contrato — parcelasDoContrato / vencimentoDoPeriodo.
//
// É conta de data, e o erro clássico é somar 30 dias em vez de somar um MÊS:
// o vencimento escorrega alguns dias por ciclo e, depois de um ano, a parcela
// de janeiro cai em dezembro. O outro é o dia 31 em mês de 30, que numa soma
// ingênua vira dia 1º do mês seguinte e troca a competência.
//
// As funções não são exportadas pelo server.js (ele sobe um servidor ao ser
// carregado), então o teste recorta e avalia só elas — é o mesmo recurso que
// test-fiscal-telas.js usa para ler o fonte.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8').replace(/\r\n/g, '\n');

function recortar(nome) {
  const inicio = serverSrc.indexOf(`function ${nome}(`);
  if (inicio < 0) throw new Error(`não achei function ${nome} no server.js`);
  const fim = serverSrc.indexOf('\n}\n', inicio);
  if (fim < 0) throw new Error(`não achei o fim de ${nome}`);
  return serverSrc.slice(inicio, fim + 2);
}

function recortarLinha(prefixo) {
  const inicio = serverSrc.indexOf(prefixo);
  if (inicio < 0) throw new Error(`não achei "${prefixo}" no server.js`);
  return serverSrc.slice(inicio, serverSrc.indexOf('\n', inicio));
}

// new Function em vez de eval: monta um escopo próprio com as três peças, sem
// depender do escopo do módulo (eval indireto roda no global e não enxerga
// nada daqui).
const { vencimentoDoPeriodo, parcelasDoContrato } = new Function(`
  ${recortarLinha('const MESES_POR_CICLO =')}
  ${recortar('vencimentoDoPeriodo')}
  ${recortar('parcelasDoContrato')}
  return { vencimentoDoPeriodo, parcelasDoContrato };
`)();

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log('--- soma MÊS, não 30 dias ---');
check('jan -> fev', vencimentoDoPeriodo('2026-01-10', 1) === '2026-02-10', vencimentoDoPeriodo('2026-01-10', 1));
check('12 meses caem no mesmo dia do ano seguinte', vencimentoDoPeriodo('2026-01-10', 12) === '2027-01-10', vencimentoDoPeriodo('2026-01-10', 12));
// Somar 30 dias daria 2026-12-06 aqui — quase um mês de erro acumulado.
check('não escorrega ao longo de 12 ciclos', vencimentoDoPeriodo('2026-01-10', 11) === '2026-12-10', vencimentoDoPeriodo('2026-01-10', 11));

console.log('\n--- dia 31 em mês curto cai no ÚLTIMO dia, não no mês seguinte ---');
check('31/01 -> 28/02 (ano comum)', vencimentoDoPeriodo('2026-01-31', 1) === '2026-02-28', vencimentoDoPeriodo('2026-01-31', 1));
check('31/01 -> 29/02 (bissexto)', vencimentoDoPeriodo('2028-01-31', 1) === '2028-02-29', vencimentoDoPeriodo('2028-01-31', 1));
check('31/03 -> 30/04', vencimentoDoPeriodo('2026-03-31', 1) === '2026-04-30', vencimentoDoPeriodo('2026-03-31', 1));
// E volta ao dia 31 quando o mês comporta — não fica preso no dia 28.
check('31/01 + 2 meses -> 31/03', vencimentoDoPeriodo('2026-01-31', 2) === '2026-03-31', vencimentoDoPeriodo('2026-01-31', 2));

console.log('\n--- ciclos ---');
const anual = { id: 'c1', title: 'Suporte', value: 1200, billingCycle: 'anual', startDate: '2026-01-15', endDate: '2028-12-31' };
const parcAnual = parcelasDoContrato(anual);
check('anual gera 3 parcelas em 3 anos', parcAnual.length === 3, `${parcAnual.length}`);
check('e de ano em ano', parcAnual[1].dueDate === '2027-01-15', parcAnual[1].dueDate);

const trimestral = parcelasDoContrato({ id: 'c2', title: 'Locação', value: 500, billingCycle: 'trimestral', startDate: '2026-01-10', endDate: '2026-12-31' });
check('trimestral em 12 meses gera 4', trimestral.length === 4, `${trimestral.length}`);
check('de 3 em 3 meses', trimestral.map((p) => p.dueDate).join(',') === '2026-01-10,2026-04-10,2026-07-10,2026-10-10', trimestral.map((p) => p.dueDate).join(','));

const mensal = parcelasDoContrato({ id: 'c3', title: 'Serviço', value: 300, billingCycle: 'mensal', startDate: '2026-01-05', endDate: '2026-06-30' });
check('mensal de jan a jun gera 6', mensal.length === 6, `${mensal.length}`);
check('a última não passa do término', mensal[mensal.length - 1].dueDate === '2026-06-05', mensal[mensal.length - 1].dueDate);

console.log('\n--- parcela única ---');
const unico = parcelasDoContrato({ id: 'c4', title: 'Projeto', value: 9000, billingCycle: 'unico', startDate: '2026-03-20', endDate: '2027-03-20' });
check('gera exatamente uma', unico.length === 1, `${unico.length}`);
check('no dia do início', unico[0].dueDate === '2026-03-20', unico[0].dueDate);
check('com o valor cheio', unico[0].amount === 9000);

console.log('\n--- contrato sem término não gera parcela infinita ---');
// Prazo indeterminado é comum; gerar até o fim dos tempos encheria o Financeiro.
const semFim = parcelasDoContrato({ id: 'c5', title: 'Aluguel', value: 2000, billingCycle: 'mensal', startDate: '2026-01-01' });
check('para no horizonte padrão de 12', semFim.length === 12, `${semFim.length}`);
const semFim24 = parcelasDoContrato({ id: 'c5', title: 'Aluguel', value: 2000, billingCycle: 'mensal', startDate: '2026-01-01' }, { periodos: 24 });
check('e respeita um horizonte maior quando pedido', semFim24.length === 24, `${semFim24.length}`);

console.log('\n--- contrato que não pode gerar nada ---');
check('sem valor não gera', parcelasDoContrato({ id: 'c6', value: 0, billingCycle: 'mensal', startDate: '2026-01-01' }).length === 0);
check('sem data de início não gera', parcelasDoContrato({ id: 'c7', value: 100, billingCycle: 'mensal' }).length === 0);
check('valor negativo não gera', parcelasDoContrato({ id: 'c8', value: -50, billingCycle: 'mensal', startDate: '2026-01-01' }).length === 0);
// Término antes do início: a primeira já passa do fim e o laço para na hora.
check('término antes do início não gera', parcelasDoContrato({ id: 'c9', value: 100, billingCycle: 'mensal', startDate: '2026-05-01', endDate: '2026-01-01' }).length === 0);

console.log('\n--- descrição identifica a competência ---');
// É o que permite achar a parcela do mês certo no Financeiro.
check('mensal traz ano-mês', /2026-03/.test(mensal[2].description), mensal[2].description);
check('parcela única se identifica', /parcela única/.test(unico[0].description), unico[0].description);

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
