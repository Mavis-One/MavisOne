#!/usr/bin/env node
/**
 * NOTA SÓ SAI COM ESTOQUE NO DEPÓSITO DO PEDIDO (15/10/2026). Pedido do
 * usuário: "verifique o motivo de estar permitindo gerar NFe NFCe, com o
 * estoque em 0, o pedido pode ser salvo mas nunca faturado!"
 *
 * O motivo: a trava antes da nota (itensSemEstoqueParaFaturar) conferia o
 * saldo do PRODUTO, e o faturamento baixa do DEPÓSITO do pedido — a guarda do
 * razão recusa depósito negativo. No banco local, "ACABAMENTO CHASSI | PEZINHO
 * | INDY 01" tem 20 no total e 0 no Depósito Marcolla: a nota de uma venda
 * dele pela Marcolla passava, era autorizada, e o faturamento era recusado
 * depois. A NFC-e tinha uma cópia da mesma conta e passa a usar a função.
 *
 * Aqui a função de verdade (recortada do server.js) roda com o banco simulado.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falhas = 0;
const check = (nome, cond, extra) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${!cond && extra ? ` -> ${extra}` : ''}`);
  if (!cond) falhas += 1;
};
const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const fonte = (servidor.match(/async function itensSemEstoqueParaFaturar\(pedido\) \{[\s\S]*?\n\}/) || [''])[0];
check('a função existe no servidor', fonte.length > 0);

// Banco simulado: produto, saldo total, saldo da cor, saldo por depósito.
const produtos = {
  P1: { id: 'P1', name: 'PEZINHO', stockQuantity: 20 },
  P2: { id: 'P2', name: 'CAPACETE', stockQuantity: 10 },
  SV: { id: 'SV', name: 'MAO DE OBRA', stockQuantity: 0, movimentaEstoque: false }
};
const porDeposito = { 'P1|LOJA-A|': 20, 'P1|LOJA-B|': 0, 'P2|LOJA-A|': 10, 'P2|LOJA-A|PRETO': 1 };
const naoAlocado = { P1: 0, P2: 5 };
const contexto = {
  Map, Set, Number, String, Math, Promise,
  regraDaCategoriaDoPedido: async (cat) => ({ alteraEstoque: cat !== 'BONIFICACAO' }),
  loadData: () => ({}),
  sincronizarRazao: async () => {},
  db: { getProductById: async (id) => produtos[id] || null },
  stockCore: { classValueBalance: (_d, id, cor) => (id === 'P2' && cor === 'PRETO' ? 6 : 0) },
  consultarBanco: async (sql, params) => ({ rows: /from deposits/.test(sql) ? [{ name: params[0] === 'LOJA-B' ? 'Depósito Marcolla' : 'Loja A' }] : [] }),
  razaoEstoque: {
    saldosPorDeposito: async (_c, pares) => new Map(pares.map((p) => {
      const chave = `${p.produtoId}|${p.depositoId}|${p.classValueId || ''}`;
      return [chave, porDeposito[chave] || 0];
    })),
    naoAlocadoDoProduto: async (_c, id) => naoAlocado[id] || 0
  }
};
vm.createContext(contexto);
vm.runInContext(`${fonte}; this.itensSemEstoqueParaFaturar = itensSemEstoqueParaFaturar;`, contexto);
const faltando = contexto.itensSemEstoqueParaFaturar;

(async () => {
  const item = (productId, quantity, extra = {}) => ({ productId, quantity, name: produtos[productId].name, ...extra });

  const loja = await faltando({ depositId: 'LOJA-B', category: 'VENDA', items: [item('P1', 1)] });
  check('saldo no produto (20) e zero no depósito do pedido: recusa', loja.length === 1, JSON.stringify(loja));
  check('  dizendo o depósito', loja[0] && loja[0].nome === 'PEZINHO em Depósito Marcolla' && loja[0].disponivel === 0 && loja[0].quantidade === 1, JSON.stringify(loja));

  check('com saldo no depósito do pedido: passa', (await faltando({ depositId: 'LOJA-A', category: 'VENDA', items: [item('P1', 2)] })).length === 0);

  const linhas = await faltando({ depositId: 'LOJA-A', category: 'VENDA', items: [item('P1', 15), item('P1', 6)] });
  check('linhas repetidas somam (15 + 6 contra 20)', linhas.length === 1 && linhas[0].quantidade === 21, JSON.stringify(linhas));

  const cor = await faltando({ depositId: 'LOJA-A', category: 'VENDA', items: [item('P2', 2, { classValueId: 'PRETO', classValueName: 'PRETO' })] });
  check('cor: 6 no total da cor, 1 no depósito: recusa pela cor no depósito', cor.length === 1 && cor[0].nome === 'CAPACETE (PRETO) em Loja A' && cor[0].disponivel === 1, JSON.stringify(cor));

  const semDep = await faltando({ depositId: '', category: 'VENDA', items: [item('P1', 1)] });
  check('pedido sem depósito: confere o não alocado (0) e recusa', semDep.length === 1 && /fora de depósito/.test(semDep[0].nome), JSON.stringify(semDep));
  check('  com não alocado suficiente: passa', (await faltando({ depositId: '', category: 'VENDA', items: [item('P2', 3)] })).length === 0);

  const total = await faltando({ depositId: 'LOJA-A', category: 'VENDA', items: [item('P1', 30)] });
  check('sem saldo nem no produto: recusa uma vez só (não repete pelo depósito)', total.length === 1 && total[0].nome === 'PEZINHO', JSON.stringify(total));

  check('serviço não confere estoque', (await faltando({ depositId: 'LOJA-B', category: 'VENDA', items: [item('SV', 1)] })).length === 0);
  check('pedido que já baixou estoque não confere de novo', (await faltando({ stockApplied: true, depositId: 'LOJA-B', category: 'VENDA', items: [item('P1', 1)] })).length === 0);
  check('categoria que não altera estoque não confere', (await faltando({ depositId: 'LOJA-B', category: 'BONIFICACAO', items: [item('P1', 1)] })).length === 0);

  const nfce = servidor.slice(servidor.indexOf('async function emitirNfceDoPedido'), servidor.indexOf('return emitirNfeFiscal(montarNfeDoPedido(pedido, estabelecimentoId, data), user, { modelo: 65 });'));
  check('NFC-e usa a mesma trava da NF-e', nfce.includes('const faltando = await itensSemEstoqueParaFaturar(pedido);') && !nfce.includes('Number(produto.stockQuantity || 0)'));
  const nfe = servidor.slice(servidor.indexOf('async function prepararNfeParaTransmitir'));
  check('NF-e do pedido recusa antes de transmitir', /const faltando = pedido \? await itensSemEstoqueParaFaturar\(pedido\) : \[\];\s*if \(faltando\.length\)/.test(nfe));

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
  process.exit(falhas ? 1 : 0);
})();
