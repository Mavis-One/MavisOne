// CONTAS A PAGAR / A RECEBER COM A EMPRESA, SEM A DESCRIÇÃO (20/10/2026).
//
// Pedido do usuário, no PDF impresso: "retire a descrição dos relatórios de
// contas a pagar e receber, coloque o fornecedor com um campo maior na coluna
// da atual descrição, e antes do fornecedor coloque a empresa de qual se trata
// o título: vencimento/cod/empresa/fornecedor/categoria/conta/banco/situação/
// valor/pago/aberto".
//
// A empresa sai pela regra da coluna Empresa de Contas a Pagar
// (resolvedorDeEmpresas, passada pelo servidor em ctx.empresaDosTitulos), com
// o nome curto ("SAL INFINITY PLUS", sem "COMERCIO LTDA"). No PDF, a Empresa
// cabe numa linha (`inteira`) e o fornecedor fica com a maior parte do que
// sobra (`larga`). Provado no banco local (20/10/2026, 13 títulos): Empresa
// em uma linha, fornecedor a coluna de texto mais larga.
const fs = require('fs');
const path = require('path');
const catalogo = require('../lib/relatorios');
const motor = require('../lib/relatorios/motor');
const R = require('../public/modules/shared/pdf_relatorio');
const motorPdf = require('../public/modules/shared/pdf_pedido');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const pagar = catalogo.relatorio('contas-a-pagar');
const receber = catalogo.relatorio('contas-a-receber');

console.log('--- as colunas ---');
const ordem = (def) => def.colunas.map((c) => c.campo).join('/');
check('a pagar: vencimento/código/empresa/fornecedor/categoria/conta/banco/situação/valor/pago/aberto',
  ordem(pagar) === 'vencimento/codigo/empresa/pessoa/categoria/conta/banco/situacao/valor/pago/emAberto', ordem(pagar));
check('a receber: a mesma ordem, com o cliente', ordem(receber) === ordem(pagar) && receber.colunas.find((c) => c.campo === 'pessoa').rotulo === 'Cliente');
check('sem a descrição', !pagar.colunas.some((c) => c.campo === 'descricao') && !receber.colunas.some((c) => c.campo === 'descricao'));
check('Títulos Pagos herda (sem descrição, com a empresa)', (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib/relatorios/financeiro.js'), 'utf8');
  return /const saida = await base\.executar\(\{ \.\.\.ctx, f:/.test(src);
})());

console.log('\n--- a empresa de cada título ---');
const CONTAS = [{ id: 'c1', name: 'ITAU PLUS', bank: 'Itaú', bankCode: '341' }];
const LINHAS = [
  { id: 'e1', codigo: 1, vencimento: '2026-10-20', emissao: '2026-10-01', pessoa: 'CLARO', categoria: 'TELEFONE', conta_id: 'c1', conta: 'ITAU PLUS', status: 'pending', vencida: false, valor: '57.89', pago_total: '0', pago_periodo: '0', data_pagamento: null, estabelecimento_id: null, nfe_id: null, reference_id: null, conta_do_lancamento: 'c1' },
  { id: 'e2', codigo: 2, vencimento: '2026-10-20', emissao: '2026-10-01', pessoa: 'FGTS', categoria: 'FGTS', conta_id: 'c1', conta: 'ITAU PLUS', status: 'pending', vencida: false, valor: '100', pago_total: '0', pago_periodo: '0', data_pagamento: null, estabelecimento_id: 'est-1', nfe_id: null, reference_id: null, conta_do_lancamento: 'c1' }
];
(async () => {
  const pedidos = [];
  const empresaDosTitulos = async (titulos) => {
    pedidos.push(titulos);
    return (t) => (t.estabelecimentoId === 'est-1'
      ? { nome: 'SAL INFINITY ELECTRIC LTDA', cnpj: '46877837000114' }
      : { nome: 'SAL INFINITY PLUS COMERCIO LTDA', cnpj: '43792899' });
  };
  const sql = async (texto) => (/from bank_accounts$/.test(texto.trim()) ? CONTAS : LINHAS);
  const r = await motor.executar(pagar, motor.normalizarFiltros(pagar, {}, '2026-10-20T10:00:00Z'), { sql, empresaDosTitulos });
  check('a regra recebe os títulos com estabelecimento, nota, pedido e conta',
    pedidos.length === 1 && JSON.stringify(pedidos[0][1]) === JSON.stringify({ id: 'e2', estabelecimentoId: 'est-1', nfeId: '', referenceId: '', bankAccountId: 'c1' }));
  check('a empresa na linha, com o nome curto', r.linhas.map((l) => l.empresa).join(' | ') === 'SAL INFINITY PLUS | SAL INFINITY ELECTRIC', r.linhas.map((l) => l.empresa).join(' | '));
  const semRegra = await motor.executar(pagar, motor.normalizarFiltros(pagar, {}, '2026-10-20T10:00:00Z'), { sql });
  check('sem a regra (outro chamador), a coluna sai vazia, sem erro', semRegra.linhas.every((l) => l.empresa === ''));

  console.log('\n--- o PDF ---');
  const empresa = pagar.colunas.find((c) => c.campo === 'empresa');
  const pessoa = pagar.colunas.find((c) => c.campo === 'pessoa');
  check('a Empresa é inteira e o fornecedor é largo', empresa.inteira === true && pessoa.larga === true);
  // A tabela do print do usuário (20/10/2026), no papel deitado.
  const nomes = ['MINISTERIO DA FAZENDA', 'COOPERATIVA DE CREDITO VALE DO ITAJAI VIACREDI', 'CAIXA ECONOMICA FEDERAL - FGTS', 'SARAH C. ZANGHELLINI RUCKL'];
  const linhasTexto = nomes.map((nome, i) => pagar.colunas.map((c) => ({
    vencimento: '20/10/2026', codigo: String(26346 + i), empresa: 'SAL INFINITY ELECTRIC', pessoa: nome,
    categoria: 'FGTS EMPRESTIMO CONSIGNADO', conta: 'SICOOB ELECTRIC 01 (MAXI CREDITO)', banco: 'Ailos (Viacredi)',
    situacao: 'Em aberto', valor: 'R$ 50.000,00', pago: 'R$ 0,00', emAberto: 'R$ 50.000,00'
  })[c.campo]));
  const larguraUtil = motorPdf.novoDocumento({ paisagem: true }).larguraUtil;
  const plano = R.planejarColunas(pagar.colunas, linhasTexto, larguraUtil);
  const largura = (campo) => plano.fracoes[pagar.colunas.findIndex((c) => c.campo === campo)] * larguraUtil;
  const textoDaEmpresa = motorPdf.largura('SAL INFINITY ELECTRIC', plano.tamanho, false);
  check('a Empresa cabe numa linha', largura('empresa') >= textoDaEmpresa, `${largura('empresa').toFixed(0)} >= ${textoDaEmpresa.toFixed(0)}`);
  check('o fornecedor é a coluna de texto mais larga', ['empresa', 'categoria', 'conta'].every((c) => largura('pessoa') > largura(c)),
    ['pessoa', 'empresa', 'categoria', 'conta'].map((c) => `${c} ${largura(c).toFixed(0)}`).join(', '));

  const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  check('o servidor passa a regra aos relatórios, com as contas bancárias', /empresaDosTitulos: async \(titulos\) => \{\s*const dados = loadData\(\);\s*await syncFinanceCadastroData\(dados\);\s*return resolvedorDeEmpresas\(titulos, dados\);/.test(servidor));

  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
