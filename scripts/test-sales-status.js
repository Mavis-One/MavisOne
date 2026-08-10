#!/usr/bin/env node
// Catálogo de status de Pedido/Orçamento — public/modules/shared/sales_status.js
//
// O que este teste protege:
//   1. Só "Orçamento" e "Pedido" são escolhidos à mão. Se alguém marcar outro
//      como selecionável, a tela volta a deixar o usuário faturar no dedo.
//   2. O status decide o TIPO do documento. É o eixo da tela única.
//   3. Baixa de estoque e geração de financeiro são efeitos SEPARADOS —
//      "Pedido Aprovado Sem Faturamento" faz um sem o outro (transferência de
//      mercadoria, remessa, bonificação). Era impossível antes.
//   4. Status gravados antes da unificação continuam legíveis.
const path = require('path');
const S = require(path.join(__dirname, '..', 'public/modules/shared/sales_status'));

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log(`catálogo: ${S.CATALOGO.length} status\n`);

console.log('--- os status pedidos existem, com o rótulo exato ---');
[
  'Orçamento', 'Pedido', 'Pedido Não Faturado', 'Pedido Pré-Faturado', 'Pedido Faturado',
  'Pedido Aprovado Sem Faturamento', 'Pedido Cancelado', 'Pedido Parcialmente Faturado'
].forEach((label) => {
  check(label, S.CATALOGO.some((item) => item.label === label));
});
// Combinação que o sistema não trabalha — não pode voltar por descuido.
check('"Aprovado Parcialmente Sem Faturamento" NÃO está no catálogo',
  !S.CATALOGO.some((item) => /parcialmente sem faturamento/i.test(item.label)));

console.log('\n--- só dois são selecionáveis à mão ---');
const selecionaveis = S.CATALOGO.filter((item) => item.selecionavel).map((item) => item.value);
check('exatamente [orcamento, pedido]', JSON.stringify(selecionaveis) === JSON.stringify(['orcamento', 'pedido']), selecionaveis.join(', '));

const opcoes = S.opcoesSelect('pedido');
check('select mostra o catálogo inteiro', opcoes.length === S.CATALOGO.length, String(opcoes.length));
check('os não-selecionáveis vêm desabilitados', opcoes.filter((o) => o.disabled).length === S.CATALOGO.length - 2);
check('o status atual nunca vem desabilitado', opcoes.find((o) => o.value === 'pedido').disabled === false);
const opcoesFaturado = S.opcoesSelect('pedido-faturado');
check('registro faturado consegue exibir o próprio status', opcoesFaturado.find((o) => o.value === 'pedido-faturado').disabled === false);
check('e ele vem marcado como selecionado', opcoesFaturado.find((o) => o.value === 'pedido-faturado').selected === true);

console.log('\n--- o status decide o tipo do documento ---');
check('orcamento -> quote', S.tipoDoStatus('orcamento') === 'quote');
check('pedido -> order', S.tipoDoStatus('pedido') === 'order');
check('todo "pedido-*" é order', S.CATALOGO.filter((i) => i.value.startsWith('pedido')).every((i) => i.tipo === 'order'));
check('todo "orcamento-*" é quote', S.CATALOGO.filter((i) => i.value.startsWith('orcamento')).every((i) => i.tipo === 'quote'));

console.log('\n--- estoque e financeiro são efeitos independentes ---');
check('Pedido Faturado baixa estoque', S.baixaEstoque('pedido-faturado') === true);
check('Pedido Faturado gera financeiro', S.geraFinanceiro('pedido-faturado') === true);
check('Aprovado Sem Faturamento BAIXA estoque', S.baixaEstoque('pedido-aprovado-sem-faturamento') === true);
check('Aprovado Sem Faturamento NÃO gera financeiro', S.geraFinanceiro('pedido-aprovado-sem-faturamento') === false);
check('Pedido (novo) não mexe em nada', !S.baixaEstoque('pedido') && !S.geraFinanceiro('pedido'));
check('Não Faturado não mexe em nada', !S.baixaEstoque('pedido-nao-faturado') && !S.geraFinanceiro('pedido-nao-faturado'));
check('Pré-Faturado não mexe em nada', !S.baixaEstoque('pedido-pre-faturado') && !S.geraFinanceiro('pedido-pre-faturado'));
check('Cancelado não mexe em nada', !S.baixaEstoque('pedido-cancelado') && !S.geraFinanceiro('pedido-cancelado'));
check('nenhum orçamento baixa estoque', S.CATALOGO.filter((i) => i.tipo === 'quote').every((i) => !i.baixaEstoque));
check('nenhum orçamento gera financeiro', S.CATALOGO.filter((i) => i.tipo === 'quote').every((i) => !i.geraFinanceiro));
check('parcialmente faturado baixa estoque mas não gera financeiro automático',
  S.baixaEstoque('pedido-parcialmente-faturado') && !S.geraFinanceiro('pedido-parcialmente-faturado'));

console.log('\n--- cancelados ---');
check('Pedido Cancelado', S.ehCancelado('pedido-cancelado') === true);
check('Orçamento Reprovado', S.ehCancelado('orcamento-reprovado') === true);
check('Pedido comum não é cancelado', S.ehCancelado('pedido') === false);

console.log('\n--- status antigos continuam legíveis (sem migração no banco) ---');
[
  ['pendente', 'pedido'],
  ['faturado', 'pedido-faturado'],
  ['cancelado', 'pedido-cancelado'],
  ['em aberto', 'orcamento'],
  ['aprovado', 'orcamento-aprovado'],
  ['reprovado', 'orcamento-reprovado']
].forEach(([antigo, novo]) => {
  check(`"${antigo}" -> ${novo}`, S.normalizar(antigo) === novo, S.normalizar(antigo));
});
check('pedido antigo "faturado" continua faturando', S.geraFinanceiro('faturado') === true);
check('orçamento antigo "em aberto" continua orçamento', S.tipoDoStatus('em aberto') === 'quote');

console.log('\n--- entrada inválida nunca escapa do catálogo ---');
check('vazio vira pedido', S.normalizar('') === 'pedido');
check('lixo vira pedido', S.normalizar('qualquer coisa') === 'pedido');
check('lixo com tipo quote vira orcamento', S.normalizar('qualquer coisa', 'quote') === 'orcamento');
check('maiúsculas e espaços', S.normalizar('  Pedido Faturado  '.toLowerCase().trim().replace(/ /g, '-')) === 'pedido-faturado');
check('status do outro tipo cai no padrão do tipo', S.normalizar('orcamento', 'order') === 'pedido', S.normalizar('orcamento', 'order'));
check('meta() sempre devolve algo', Boolean(S.meta('inexistente').label));
check('todo status tem tom de badge', S.CATALOGO.every((i) => typeof i.tom === 'string' && i.tom.length > 0));
check('nenhum value repetido', new Set(S.CATALOGO.map((i) => i.value)).size === S.CATALOGO.length);

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
