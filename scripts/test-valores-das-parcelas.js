// OS VALORES DAS PARCELAS PARA QUEM ACESSA O FINANCEIRO (20/10/2026, queixa
// do usuário: "verifique a página de entrada via busca de NF-e por CNPJ, pois
// os valores das parcelas não estão aparecendo mais!").
//
// Desde 14/10 (valor pago só para administrador) a conferência da entrada
// mostrava as parcelas sem valor a quem não é administrador. Decisão do
// usuário: quem acessa o Financeiro volta a ver o valor de cada parcela e o
// total da nota — os mesmos números que vê em Contas a Pagar logo depois. O
// custo e o unitário dos itens continuam só do administrador.
//
// Provado com o servidor no ar (porta 3099) e dois usuários comuns
// temporários: com Financeiro, duplicatas 306,25 + 306,25 e total 612,50, os
// itens sem valorUnitario/valorTotal, e na tela a coluna Valor, os campos e a
// Soma (3 parcelas: 204,18 + 204,16 + 204,16); sem Financeiro, nada disso.
const fs = require('fs');
const path = require('path');
const custoOculto = require('../lib/custo-oculto');

const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas++;
};

console.log('\n--- 1. o filtro ---');
const resposta = {
  nota: {
    numero: '12345',
    totais: { produtos: 600, icms: 42.5, nota: 612.5 },
    duplicatas: [{ numero: '001', vencimento: '2026-09-19', valor: 306.25 }, { numero: '002', vencimento: '2026-10-19', valor: 306.25 }]
  },
  itens: [{ numero: 1, valorUnitario: 6, valorTotal: 600, quantidade: 100 }],
  titulosDoViper: [{ id: 't1', codigo: 'LF1', vencimento: '2026-09-19', valor: 612.5 }],
  permissoes: { valoresDasParcelas: true }
};
const semValor = custoOculto.semValorPago(resposta);
check('sem o Financeiro: nem parcela, nem total, nem item',
  !('valor' in semValor.nota.duplicatas[0]) && !('nota' in semValor.nota.totais) && !('valorUnitario' in semValor.itens[0])
  && !('valor' in semValor.titulosDoViper[0]));
const comParcelas = custoOculto.comValoresDasParcelas(resposta, semValor);
check('com o Financeiro: o valor de cada parcela volta',
  comParcelas.nota.duplicatas.map((d) => d.valor).join(',') === '306.25,306.25'
  && comParcelas.nota.duplicatas[1].vencimento === '2026-10-19');
check('  e o total da nota, que as parcelas somam', comParcelas.nota.totais.nota === 612.5);
check('  e o dos títulos já lançados no Viper', comParcelas.titulosDoViper[0].valor === 612.5);
check('  mas o resto dos totais e os itens seguem sem valor',
  !('produtos' in comParcelas.nota.totais) && !('icms' in comParcelas.nota.totais)
  && !('valorUnitario' in comParcelas.itens[0]) && !('valorTotal' in comParcelas.itens[0]) && comParcelas.itens[0].quantidade === 100);
check('  sem nota na resposta (erro, outra rota), passa como veio',
  custoOculto.comValoresDasParcelas({ error: 'x' }, { error: 'x' }).error === 'x');

console.log('\n--- 2. o servidor ---');
const servidor = ler('server.js');
check('o sendJson devolve as parcelas quando a rota pede',
  /payload = res\.__valoresDasParcelas \? custoOculto\.comValoresDasParcelas\(payload, semValor\) : semValor;/.test(servidor));
const analisar = servidor.slice(servidor.indexOf("pathname === '/api/purchases/entrada-nfe/analisar'"));
check('só a análise da entrada pede, e só para quem tem o Financeiro',
  /const valoresDasParcelas = user\.allowedModules\.includes\('finance'\);\s*if \(valoresDasParcelas\) res\.__valoresDasParcelas = true;/.test(analisar.slice(0, 1500))
  && (servidor.match(/res\.__valoresDasParcelas = true/g) || []).length === 1);
check('  e conta à tela', /cadastrarProduto: user\.allowedModules\.includes\('stock'\),\s*valoresDasParcelas\s*\}/.test(analisar));

console.log('\n--- 3. a tela ---');
const tela = ler('public/modules/purchases/subs/entrada_nfe.js');
check('veParcelas: administrador ou quem o servidor liberou',
  /function veParcelas\(\) \{\s*return veValores \|\| Boolean\(tela\.permissoes && tela\.permissoes\.valoresDasParcelas\);\s*\}/.test(tela));
// Desde 21/10/2026 a tabela das duplicatas mora em areaDoParcelamento, logo
// acima de blocoFinanceiro ("Parcelar diferente da nota").
const financeiro = tela.slice(tela.indexOf('function areaDoParcelamento()'), tela.indexOf('function blocoFinanceiro()') + 2500);
check('as duplicatas do XML e os títulos do Viper com a coluna Valor',
  (financeiro.match(/\$\{veParcelas\(\) \? '<th class="entrada-col-num">Valor<\/th>' : ''\}/g) || []).length === 2
  && /veParcelas\(\) \? `<td class="entrada-col-num">\$\{moeda\(d\.valor\)\}<\/td>`/.test(financeiro)
  && /veParcelas\(\) \? `<td class="entrada-col-num">\$\{moeda\(t\.valor\)\}<\/td>`/.test(financeiro));
const bloco = tela.slice(tela.indexOf('function blocoParcelas('), tela.indexOf('function ligarParcelas('));
check('as parcelas da conferência com o campo de valor e a soma',
  /veParcelas\(\) \? `<td class="entrada-col-num"><input type="number"/.test(bloco) && /veParcelas\(\) \? `<tfoot>/.test(bloco)
  && !/veValores/.test(bloco));
check('o unitário e o total dos itens seguem só do administrador',
  /\$\{veValores \? `<th class="entrada-col-num">Unitário<\/th>/.test(tela));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
