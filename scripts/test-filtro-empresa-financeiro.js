// O FILTRO DE EMPRESA DE CONTAS A PAGAR / A RECEBER (19/10/2026, pedido do
// usuário: "um campo de seleção ... para que eu possa escolher a empresa
// referente que eu quero ver os títulos e não mostrar tudo embaralhado").
//
// Decisões do usuário, na mesma data: escolhe-se a EMPRESA (raiz do CNPJ, a
// Plus com todas as filiais) e, se quiser, a FILIAL; o título antigo do Viper,
// sem empresa gravada, entra pela conta bancária — e por isso só no filtro da
// empresa, não no de uma filial.
//
// A regra de qual título é de qual empresa é UMA: a da coluna Empresa
// (resolvedorDeEmpresas). Provado no banco local (porta 3099): receitas 16.990
// = Electric 10.541 + Plus 5.847 + 602 sem empresa conhecida (contas KACCAU e
// BY BLUMENAU, que não estão nos cadastros locais); Plus › Timbó, 40 títulos,
// todos com a coluna Empresa "SAL INFINITY PLUS (TIMBO)"; a exportação segue o
// filtro.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const servidor = ler('server.js');
const tela = ler('public/modules/finance/subs/lancamentos.js');
const banco = ler('lib/db/financeiro.js');

console.log('--- a mesma regra da coluna Empresa ---');
check('a coluna usa o resolvedor', /async function empresasDosTitulos\(entries, data\) \{[\s\S]{0,200}const empresaDe = await resolvedorDeEmpresas\(entries, data\);/.test(servidor));
check('o filtro também', /async function filtrarPorEmpresaDoTitulo\(entries, query, data\) \{[\s\S]{0,400}const empresaDe = await resolvedorDeEmpresas\(entries, data\);/.test(servidor));
check('  empresa pela raiz, filial pelo CNPJ inteiro', /return filial \? cnpj === filial : cnpj\.slice\(0, 8\) === raiz;/.test(servidor));
check('  o título antigo entra pela conta bancária (o nome da conta)', /\|\| pelaContaUmaVez\(e\.bankAccountId\);/.test(servidor));

console.log('\n--- a lista inteira, não só a página ---');
check('a lista filtra antes das abas e dos totais',
  /const todos = filtrarListaDeLancamentos\(data, await filtrarPorEmpresaDoTitulo\(parciais, url\.searchParams, data\), semSituacao\);/.test(servidor));
check('a exportação também', /: filtrarListaDeLancamentos\(data, await filtrarPorEmpresaDoTitulo\(parciais, url\.searchParams, data\), url\.searchParams\)\.map/.test(servidor));
check('o banco traz as colunas de que a regra precisa',
  /if \(query\.get\('empresa'\) \|\| query\.get\('filial'\)\) \{\s*\['estabelecimento_id', 'nfe_id', 'reference_id', 'bank_account_id'\]\.forEach/.test(banco));

console.log('\n--- as opções do campo ---');
const ini = servidor.indexOf('function empresasParaOFiltro(');
// eslint-disable-next-line no-new-func
const empresasParaOFiltro = new Function(`${servidor.slice(ini, servidor.indexOf('\n}\n', ini) + 2)}; return empresasParaOFiltro;`)();
const opcoes = empresasParaOFiltro(
  [{ cnpj: '43.792.899/0005-69', razaoSocial: 'SAL INFINITY PLUS COMERCIO LTDA' }, { cnpj: '43792899000135', razaoSocial: 'SAL INFINITY PLUS COMERCIO LTDA' }],
  [{ document: '43792899000135', name: 'SAL INFINITY PLUS COMERCIO LTDA', tradeName: 'SAL INFINITY PLUS COMERCIO LTDA (MATRIZ)' },
    { document: '43792899000569', name: 'SAL INFINITY PLUS COMERCIO LTDA', tradeName: 'SAL INFINITY PLUS (TIMBO)' },
    { document: '46877837000114', name: 'SAL INFINITY ELECTRIC LTDA', tradeName: 'SAL INFINITY ELECTRIC' }]
);
check('uma empresa por raiz, em ordem de nome', opcoes.map((e) => e.raiz).join(',') === '46877837,43792899', JSON.stringify(opcoes.map((e) => e.nome)));
check('  nome curto, sem "COMERCIO LTDA"', opcoes[1].nome === 'SAL INFINITY PLUS' && opcoes[0].nome === 'SAL INFINITY ELECTRIC');
check('  a matriz primeiro, e a filial pelo nome da unidade', opcoes[1].filiais.map((f) => f.nome).join(',') === 'MATRIZ,TIMBO', JSON.stringify(opcoes[1].filiais));
check('vão no meta do Financeiro', /empresas: empresasParaOFiltro\(estabelecimentosMeta, data\.companies\),/.test(servidor));

console.log('\n--- a tela ---');
check('Empresa e Filial nos filtros e na consulta', /empresa: '', filial: ''/.test(tela) && /'amountMin', 'amountMax', 'empresa', 'filial'\]/.test(tela));
check('o campo Empresa na barra de busca', /<span>Empresa<\/span>\s*<select id="financeEmpresaRapida">\$\{opcoesDeEmpresa\(\)\}<\/select>/.test(tela));
check('  a Filial só com empresa de mais de um CNPJ', /\$\{filiaisDaEmpresa\(\)\.length > 1 \? `<label class="cadastro-field">\s*<span>Filial<\/span>/.test(tela));
check('  trocar a empresa recomeça a filial', /mudarFiltro\(\{ empresa: event\.target\.value, filial: '' \}\)/.test(tela));
check('  as empresas entram quando o meta chega', /metaPronto\.then\(\(\) => \{\s*const campo = document\.getElementById\('financeEmpresaRapida'\);/.test(tela));
check('a barra de busca cabe os campos', /repeat\(var\(--campos, 2\), minmax\(150px, 1fr\)\)/.test(ler('public/app.css')));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
