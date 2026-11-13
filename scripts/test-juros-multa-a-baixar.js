/**
 * JUROS, MULTA E DESCONTO SALVOS NO TÍTULO, BAIXADOS COM A CONCILIAÇÃO (fase FK,
 * 13/11/2026).
 *
 * Pedido do usuário: "preciso de um botão de salvar sem precisar especificamente
 * lançar o título ou editá-lo, pois o juros e ou a multa precisam ser baixados
 * com a conciliação também".
 *
 * Provado pela API na porta 3999 (títulos e extrato de teste apagados depois):
 * título de 2.990,00 + juros 104,65 salvos sem baixa; o crédito de 3.094,65
 * concilia sozinho com os juros na baixa; desconciliar e estornar devolvem os
 * juros; 3.000,00 (entre o saldo e o saldo com juros) é recusado.
 *
 *   node scripts/test-juros-multa-a-baixar.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const servidor = ler('server.js');
const tela = ler('public/modules/finance/subs/lancamentos.js');
const banco = ler('lib/db/financeiro.js');
const migracao = ler('banco/migrations/fase-fk-juros-multa-e-desconto-a-baixar.sql');
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const extrair = (fonte, nome) => {
  const inicio = fonte.indexOf(`function ${nome}(`);
  if (inicio < 0) throw new Error(`função ${nome} não encontrada`);
  let profundidade = 0;
  for (let i = fonte.indexOf('{', inicio); i < fonte.length; i++) {
    if (fonte[i] === '{') profundidade++;
    else if (fonte[i] === '}' && --profundidade === 0) return fonte.slice(inicio, i + 1);
  }
  return '';
};

console.log('--- 1. as contas ---');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(['sumBy', 'isFinanceEntryRealized', 'isFinanceEntryCancelled', 'financeEntryEffectiveDue', 'financeEntryPaidTotal',
  'ajusteABaixar', 'temCombinadoABaixar', 'valorCabeNoTitulo', 'esperadoNoExtrato'].map((n) => extrair(servidor, n)).join('\n')
  + '\nthis.f = { ajusteABaixar, temCombinadoABaixar, valorCabeNoTitulo, esperadoNoExtrato };', ctx);
const { f } = ctx;
const titulo = (extra) => ({ id: 't', amount: 2990, status: 'pending', jurosABaixar: 0, multaABaixar: 0, descontoABaixar: 0, ...extra });
const comJuros = titulo({ jurosABaixar: 104.65 });
check('juros + multa − desconto', f.ajusteABaixar(titulo({ jurosABaixar: 10, multaABaixar: 5, descontoABaixar: 3 })) === 12);
check('  título pago ou cancelado não tem nada a baixar', f.ajusteABaixar(titulo({ jurosABaixar: 10, status: 'paid' })) === 0
  && f.ajusteABaixar(titulo({ jurosABaixar: 10, status: 'cancelado' })) === 0);
check('o extrato espera o saldo com os juros', f.esperadoNoExtrato(comJuros, 2990, 0) === 3094.65);
check('  sem combinado, o de sempre (o líquido do cartão)', f.esperadoNoExtrato(titulo({ netAmount: 2900 }), 2990, 0) === 2900
  && f.esperadoNoExtrato(titulo(), 2990, 0) === 2990);
check('cabe: até o saldo, ou exatamente o saldo com o combinado',
  f.valorCabeNoTitulo(comJuros, [], 2990) && f.valorCabeNoTitulo(comJuros, [], 1000) && f.valorCabeNoTitulo(comJuros, [], 3094.65));
check('  entre os dois, não (juros que ninguém combinou)', !f.valorCabeNoTitulo(comJuros, [], 3000) && !f.valorCabeNoTitulo(comJuros, [], 3100));
check('  sem combinado, nada acima do saldo', !f.valorCabeNoTitulo(titulo(), [], 3094.65));

console.log('\n--- 2. o banco ---');
check('migração: três colunas no título, não negativas, e a marca na baixa',
  /add column if not exists juros_a_baixar numeric\(14,2\) not null default 0/.test(migracao)
  && /multa_a_baixar/.test(migracao) && /desconto_a_baixar/.test(migracao)
  && /check \(juros_a_baixar >= 0 and multa_a_baixar >= 0 and desconto_a_baixar >= 0\)/.test(migracao)
  && /alter table financial_payments\s+add column if not exists ajuste_combinado boolean not null default false/.test(migracao));
check('  na recriação do zero também', ler('banco/RECRIAR-DO-ZERO.sql').includes('fase-fk-juros-multa-e-desconto-a-baixar.sql'));
check('lê e grava os três e a marca', /jurosABaixar: Number\(row\.juros_a_baixar \|\| 0\)/.test(banco)
  && /if \(payload\.jurosABaixar !== undefined\) row\.juros_a_baixar/.test(banco)
  && /ajusteCombinado: row\.ajuste_combinado === true/.test(banco) && /ajuste_combinado: payload\.ajusteCombinado === true/.test(banco));

console.log('\n--- 3. o servidor ---');
const rota = servidor.slice(servidor.indexOf("entries\\/[^/]+\\/combinado$/"), servidor.indexOf("entries\\/[^/]+\\/payments$/"));
check('rota de salvar sem baixar: só título em aberto, sem negativos, com auditoria',
  rota.length > 500 && /\['pending', 'parcial'\]\.includes/.test(rota) && /juros < 0 \|\| multa < 0 \|\| desconto < 0/.test(rota)
  && /action: 'combinadoDoTitulo'/.test(rota) && !/createFinancialPayment/.test(rota));
check('a baixa da conciliação leva o combinado quando o valor é o saldo com ele',
  /const comCombinado = temCombinadoABaixar\(entry\)\s*&& Math\.abs\(valor - \(financeEntryEmAberto\(entry, anteriores\) \+ ajusteABaixar\(entry\)\)\) < 0\.005;/.test(servidor)
  && /interest: comCombinado \? Number\(entry\.jurosABaixar \|\| 0\) : 0,/.test(servidor) && /ajusteCombinado: comCombinado,/.test(servidor));
check('  e zera o combinado depois', /if \(payment\.ajusteCombinado \|\| isFinanceEntryRealized\(entry\)\) await zerarCombinadoABaixar\(entry\);/.test(servidor));
check('a automática, a manual e a sugestão usam a mesma conta do "cabe"',
  /!valorCabeNoTitulo\(entry, getFinanceEntryPayments\(data, entry\.id\), Number\(tx\.amount \|\| 0\)\)\) continue;/.test(servidor)
  && /if \(!valorCabeNoTitulo\(entry, existingPayments, pedido\.valor\)\) \{/.test(servidor)
  && /if \(!valorCabeNoTitulo\(entry, payments, Number\(tx\.amount \|\| 0\)\)\) \{ recusar/.test(servidor));
check('Registrar recebimento com juros leva o combinado',
  /const levaCombinado = !soEncerrar && temCombinadoABaixar\(entry\) && \(interest > 0 \|\| fine > 0 \|\| discount > 0\);/.test(servidor)
  && /if \(levaCombinado \|\| isFinanceEntryRealized\(entry\)\) await zerarCombinadoABaixar\(entry\);/.test(servidor));
check('estorno e desconciliar devolvem o combinado ao título',
  /await devolverCombinadoAoTitulo\(entry, last\);/.test(servidor) && /await devolverCombinadoAoTitulo\(entry, baixa\);/.test(servidor));
check('a resposta leva o combinado e o saldo com ele', /emAbertoComCombinado: Math\.max\(0,/.test(servidor) && /jurosABaixar: Number\(entry\.jurosABaixar \|\| 0\),/.test(servidor));

console.log('\n--- 4. a tela ---');
check('botão "Salvar juros, multa e desconto (sem baixar)" no recebimento/pagamento',
  /id="financeSalvarCombinado"/.test(tela) && /Salvar juros, multa e desconto \(sem baixar\)/.test(tela));
check('  manda só juros, multa e desconto, e reabre o título',
  /api\(`\/api\/finance\/entries\/\$\{entry\.id\}\/combinado`/.test(tela)
  && /JSON\.stringify\(\{ interest: ler\('interest'\), fine: ler\('fine'\), discount: ler\('discount'\) \}\)/.test(tela)
  && /await openEntryModal\(entry\.id, options\);/.test(tela));
check('os campos já vêm com o combinado, e o valor sugerido é o saldo com ele',
  /name="interest" value="\$\{combinado\.juros\.toFixed\(2\)\}"/.test(tela) && /name="fine" value="\$\{combinado\.multa\.toFixed\(2\)\}"/.test(tela)
  && /temCombinado && entry\.emAbertoComCombinado != null\s*\? entry\.emAbertoComCombinado/.test(tela));
check('a auditoria tem nome para a ação', /combinadoDoTitulo: 'Juros, multa e desconto a baixar'/.test(ler('public/modules/settings/subs/access_logs.js')));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
