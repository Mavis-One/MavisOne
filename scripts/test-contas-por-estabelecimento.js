#!/usr/bin/env node
/**
 * QUAL CONTA BANCÁRIA CADA ESTABELECIMENTO PODE USAR (fase CD).
 *
 * O PEDIDO, COM AS PALAVRAS DE QUEM PEDIU
 * ---------------------------------------
 *   "a matriz pode utilizar todas as contas, porém as filiais não podem
 *    utilizar a conta da matriz, porém as filiais podem utilizar as contas
 *    bancárias das filiais livremente"
 *
 * A assimetria não é descuido: a matriz consolida, a filial opera. Quem
 * consolida precisa enxergar o caixa inteiro; quem opera não precisa — e não
 * deve — alcançar a conta de quem consolida.
 *
 * O QUE FALTAVA PARA A REGRA PODER EXISTIR
 * ----------------------------------------
 * Três coisas, e nenhuma delas era a regra:
 *
 *   1. A conta não tinha DONO. A coluna `bank_accounts.estabelecimento_id`
 *      existia (veio do Open Finance), mas a tela de cadastro nunca a
 *      preencheu — toda conta era órfã, e "a conta da matriz" é uma frase
 *      sobre o dono.
 *   2. O lançamento não tinha ESTABELECIMENTO. Sabia a conta, não a unidade.
 *   3. A pessoa não tinha VÍNCULO. Nada dizia de qual unidade ela é.
 *
 * MEDIDO CONTRA A API, num banco descartável com matriz + duas filiais:
 *
 *   Ana (Filial Criciúma), regra padrão, sem ninguém ter configurado nada:
 *     conta da própria filial ....... 200 GRAVOU
 *     conta da OUTRA filial ......... 200 GRAVOU
 *     conta sem dono ................ 200 GRAVOU
 *     conta da MATRIZ ............... 400 "Itau - Matriz é da matriz, e Filial
 *                                          Criciuma não pode usar conta da matriz."
 *     lançar por OUTRO estabelecimento 403 (ela não tem permissão de trocar)
 *     TRANSFERIR da filial PARA a matriz 400 (a porta dos fundos fecha também)
 *
 *   Admin (pode trocar de estabelecimento):
 *     pela MATRIZ, na conta da matriz .. 200 GRAVOU
 *     por TUBARÃO, na conta da matriz .. 400 — a regra é sobre o
 *                                        ESTABELECIMENTO, não sobre a pessoa
 *
 *   Exceção gravada à mão (Criciúma pode usar a conta da matriz):
 *     Ana na conta da matriz ........... 200 GRAVOU
 *     Tubarão na mesma conta ........... 400 (a exceção é de quem foi marcado)
 *   Voltando tudo ao padrão:
 *     Ana na conta da matriz ........... 400 de novo
 *
 * E NUM CHROME DE VERDADE, com as três telas:
 *   tela de configuração, regra padrão:
 *     Itau - Matriz            | X . . |  regra padrão
 *     Sicredi - Criciuma       | X X X |  regra padrão
 *     BB - Tubarao             | X X X |  regra padrão
 *     Caixa interno (sem dono) | X X X |  regra padrão
 *   Novo Lançamento da Ana: campo Estabelecimento = "Filial Criciuma",
 *   travado, e a lista de contas oferece três — a da matriz NÃO aparece.
 *   0 violações de CSP.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const REGRA = require('../public/modules/shared/contas_por_estabelecimento');
const src = ler('server.js');
const srcCodigo = semComentarios(src);

// O cenário do pedido, montado uma vez e usado em tudo abaixo.
const ESTABS = [
  { id: 'm1', tipo: 'MATRIZ', razaoSocial: 'Matriz', nomeFantasia: 'Matriz' },
  { id: 'f1', tipo: 'FILIAL', razaoSocial: 'Filial Criciúma', nomeFantasia: 'Filial Criciúma' },
  { id: 'f2', tipo: 'FILIAL', razaoSocial: 'Filial Tubarão', nomeFantasia: 'Filial Tubarão' }
];
const CONTAS = [
  { id: 'c-matriz', name: 'Itaú Matriz', estabelecimentoId: 'm1' },
  { id: 'c-f1', name: 'Sicredi Criciúma', estabelecimentoId: 'f1' },
  { id: 'c-f2', name: 'BB Tubarão', estabelecimentoId: 'f2' },
  { id: 'c-casa', name: 'Caixa interno', estabelecimentoId: '' }
];
const pode = (contaId, estabId, vinculos = []) => REGRA.podeUsar({
  conta: CONTAS.find((c) => c.id === contaId),
  estabelecimentoId: estabId,
  estabelecimentos: ESTABS,
  vinculos
});
const nomes = (estabId, vinculos = []) => REGRA.contasDoEstabelecimento({
  contas: CONTAS, estabelecimentoId: estabId, estabelecimentos: ESTABS, vinculos
}).map((c) => c.id).sort().join(',');

console.log('--- 1. a regra pedida, sem ninguém ter configurado nada ---');
check('a MATRIZ usa todas as contas', nomes('m1') === 'c-casa,c-f1,c-f2,c-matriz', nomes('m1'));
check('a filial NÃO usa a conta da matriz', !pode('c-matriz', 'f1'));
check('  nem a outra filial', !pode('c-matriz', 'f2'));
check('a filial usa a PRÓPRIA conta', pode('c-f1', 'f1'));
check('a filial usa a conta da OUTRA filial', pode('c-f2', 'f1'), 'Criciúma na conta de Tubarão');
check('  e o contrário também', pode('c-f1', 'f2'));
// Toda conta que existia antes desta fase está sem dono. Se "sem dono" fosse
// lido como "da matriz", elas sumiriam da vista de quem usa o sistema hoje.
check('conta SEM DONO vale para todos', pode('c-casa', 'm1') && pode('c-casa', 'f1') && pode('c-casa', 'f2'));
check('a filial vê três das quatro', nomes('f1') === 'c-casa,c-f1,c-f2', nomes('f1'));

console.log('--- 2. sem estabelecimento não há pergunta a fazer ---');
// O lançamento anterior a esta fase não tem estabelecimento. O que existe antes
// de uma regra não se julga por ela.
check('sem estabelecimento, tudo passa', pode('c-matriz', ''));
check('  e a lista não é filtrada', nomes('') === 'c-casa,c-f1,c-f2,c-matriz');
// Mas um id que não existe não ganha permissão por omissão.
check('estabelecimento inexistente NÃO passa', !pode('c-matriz', 'nao-existe'));

console.log('--- 3. a decisão manual vence, e é por conta ---');
const excecao = [
  { contaId: 'c-matriz', estabelecimentoId: 'm1' },
  { contaId: 'c-matriz', estabelecimentoId: 'f1' }
];
check('a exceção libera quem foi marcado', pode('c-matriz', 'f1', excecao));
check('  e só quem foi marcado', !pode('c-matriz', 'f2', excecao));
// A ausência é lida POR CONTA. Sem isso, a primeira marcação em qualquer conta
// tornaria todas as outras inutilizáveis de uma vez.
check('as outras contas seguem no automático',
  pode('c-f1', 'f1', excecao) && pode('c-f2', 'f1', excecao) && pode('c-casa', 'f2', excecao));
check('quais contas estão configuradas',
  [...REGRA.contasConfiguradas(excecao)].join(',') === 'c-matriz');
// Desmarcar tudo de uma conta volta ao padrão em vez de deixá-la inutilizável —
// "tirar de circulação" tem outra resposta no sistema, que é inativar a conta.
check('desmarcar tudo volta ao padrão', !pode('c-matriz', 'f1', []) && pode('c-f1', 'f1', []));

console.log('--- 4. a regra padrão materializada é a mesma regra ---');
const padrao = REGRA.regraPadrao(ESTABS, CONTAS);
check('o padrão gera 10 dos 12 pares', padrao.length === 10, `${padrao.length} de ${ESTABS.length * CONTAS.length}`);
// Os dois que faltam são exatamente o pedido: a conta da matriz para as duas filiais.
check('  e os 2 que faltam são a conta da matriz nas filiais',
  !padrao.some((p) => p.contaId === 'c-matriz' && p.estabelecimentoId !== 'm1'));
// Materializar o padrão tem de dar o MESMO resultado que não configurar nada —
// senão o botão "voltar ao padrão" significaria outra coisa.
check('aplicar o padrão não muda nada', ESTABS.every((e) => nomes(e.id) === nomes(e.id, padrao)));

console.log('--- 5. o motivo da recusa explica ---');
const motivo = REGRA.motivoDaRecusa({
  conta: CONTAS[0], estabelecimento: ESTABS[2], estabelecimentos: ESTABS
});
check('diz qual conta e qual unidade', /Itaú Matriz/.test(motivo) && /Filial Tubarão/.test(motivo), motivo.slice(0, 68));
check('  e diz que é conta da matriz', /da matriz/.test(motivo));
const motivoManual = REGRA.motivoDaRecusa({
  conta: CONTAS[1], estabelecimento: ESTABS[2], estabelecimentos: ESTABS
});
check('recusa por configuração diz onde ajustar', /Contas por Estabelecimento/.test(motivoManual));

console.log('--- 6. o servidor confere, e a tela não é a trava ---');
check('há uma função que confere', /async function conferirContasDoEstabelecimento\(/.test(srcCodigo));
// Origem E destino: transferir da conta da filial PARA a da matriz seria a
// regra contornada pela porta dos fundos.
check('  conferindo origem E destino da transferência',
  /contaIds: \[body\.bankAccountId, type === 'TRANSFERENCIA' \? body\.targetBankAccountId : ''\]/.test(srcCodigo));
check('o POST do lançamento confere', /await conferirContasDoEstabelecimento\(\{\s*\n\s*estabelecimentoId: escolha\.id,/.test(srcCodigo));
// Sem conferir na edição, a trava se contornaria gravando qualquer coisa e
// trocando a conta depois.
check('o PUT do lançamento também', /await conferirContasDoEstabelecimento\(\{\s*\n\s*estabelecimentoId: escolhaPut\.id,/.test(srcCodigo));
check('  sobre o estado PROPOSTO, e não o gravado',
  /contaIds: \[proposto\.bankAccountId, proposto\.targetBankAccountId\]/.test(srcCodigo));
check('o servidor usa a MESMA regra do navegador',
  /require\('\.\/public\/modules\/shared\/contas_por_estabelecimento'\)/.test(srcCodigo));

console.log('--- 7. quem pode lançar por outro estabelecimento ---');
check('há uma função que decide', /function podeTrocarDeEstabelecimento\(user, ehAdministrador\)/.test(srcCodigo));
// O "ou administrador" é a mesma razão do podeVerRelatorios: quem administra
// precisa poder corrigir o lançamento de qualquer unidade.
check('  admin pode sempre', /ehAdministrador \|\| user\.podeTrocarEstabelecimento === true/.test(srcCodigo));
check('quem não pode é RECUSADO, não redirecionado', /erro\.status = 403;\s*\n\s*return \{ id: doUsuario, erro \};/.test(src));
check('  e o lançamento grava o que a função decidiu, não o que veio no corpo',
  /estabelecimentoId: escolha\.id,/.test(srcCodigo) && /entry\.estabelecimentoId = escolhaPut\.id;/.test(srcCodigo));

console.log('--- 8. a tela de configuração é só de administrador ---');
const rotaGet = srcCodigo.slice(srcCodigo.indexOf("pathname === '/api/settings/contas-por-estabelecimento' && req.method === 'GET'"));
check('o GET exige admin', /if \(!user \|\| !\(await ehAdmin\(user\)\)\)/.test(rotaGet.slice(0, 400)));
const rotaPut = srcCodigo.slice(srcCodigo.indexOf("pathname === '/api/settings/contas-por-estabelecimento' && req.method === 'PUT'"));
check('  o PUT também', /if \(!user \|\| !\(await ehAdmin\(user\)\)\)/.test(rotaPut.slice(0, 400)));
// A rota de DELETE e' um literal de expressao regular dentro do server.js, e
// por isso a busca aqui procura o TRECHO, e nao a linha inteira escapada: uma
// regex procurando outra regex fica ilegivel e quebra ao primeiro `/` a mais.
const rotaDelete = srcCodigo.split(String.fromCharCode(10)).find((l) => l.includes('contas-por-estabelecimento') && l.includes("req.method === 'DELETE'"));
check('  e o DELETE de uma conta', Boolean(rotaDelete));
check('    exigindo admin também',
  /if \(!user \|\| !\(await ehAdmin\(user\)\)\)/.test(
    srcCodigo.slice(srcCodigo.indexOf(rotaDelete || 'x'), srcCodigo.indexOf(rotaDelete || 'x') + 400)));
check('salvar deixa trilha de auditoria', /action: 'salvarContasPorEstabelecimento'/.test(srcCodigo));
// "Voltar tudo ao padrão" APAGA em vez de gravar o padrão: gravado, ele viraria
// uma fotografia de hoje, e a conta criada no mês que vem ficaria de fora.
check('voltar ao padrão APAGA a configuração', /if \(body\.voltarTudoAoPadrao === true\) \{[\s\S]{0,80}pares = \[\];/.test(srcCodigo));

console.log('--- 9. a tela existe e está no menu ---');
const tela = ler('public/modules/settings/subs/contas_por_estabelecimento.js');
check('a tela está registrada',
  /MavisSubscreenRegistry\.settings\.contas_por_estabelecimento = async function/.test(tela));
check('  e o módulo a conhece',
  /'contas_por_estabelecimento'/.test(ler('public/modules/settings/index.js')));
check('  e ela aparece no menu de Configurações',
  /key: 'contas_por_estabelecimento', label: 'Contas por Estabelecimento'/.test(ler('public/app.js')));
const html = ler('public/index.html');
check('a regra carrega ANTES da tela',
  html.indexOf('shared/contas_por_estabelecimento.js') < html.indexOf('settings/subs/contas_por_estabelecimento.js'));
check('  e antes do módulo Financeiro',
  html.indexOf('shared/contas_por_estabelecimento.js') < html.indexOf('finance/subs/novo_lancamento.js'));
// O primeiro clique numa linha do automático parte do que estava VISÍVEL: sem
// isso, marcar uma caixa apagaria as outras cinco daquela linha em silêncio.
check('marcar numa linha do automático preserva o que estava visível',
  /if \(!configuradas\.has\(contaId\)\) \{[\s\S]{0,260}if \(doPadrao\.has\(chave\(contaId, e\.id\)\)\) marcadas\.add/.test(tela));

console.log('--- 10. o lançamento filtra pela mesma regra ---');
const form = ler('public/modules/finance/subs/novo_lancamento.js');
check('o formulário usa a regra compartilhada', /REGRA\.contasDoEstabelecimento\(\{/.test(form));
// Trocar o estabelecimento não pode redesenhar o formulário inteiro: levaria
// junto tudo o que a pessoa já digitou.
check('trocar o estabelecimento refaz só as listas de conta',
  /financeEstabSelect'\)\?\.addEventListener\('change'/.test(form) && !/financeEstabSelect[\s\S]{0,400}renderForm\(\)/.test(form));
check('  e avisa quando a conta escolhida deixa de valer',
  /não está liberada para este estabelecimento/.test(form));
// Conta já gravada continua na lista ao editar: tirá-la faria o select abrir em
// branco e o primeiro salvamento apagaria a conta do lançamento.
check('conta já gravada continua visível na edição',
  /const gravada = selectedId && !lista\.some\(/.test(form));
check('o campo só aparece quando há o que dizer', /const mostrarEstab = Boolean\(REGRA\)/.test(form));

console.log('--- 11. o dono da conta e o vínculo da pessoa ---');
check('o cadastro da conta pergunta o estabelecimento',
  /name: 'estabelecimentoId',\s*\n\s*label: 'Estabelecimento'/.test(ler('public/modules/cadastros/subs/nova_conta_bancaria.js')));
check('  com "sem dono" como opção legítima',
  /empty: 'Sem dono — vale para todos'/.test(ler('public/modules/cadastros/subs/nova_conta_bancaria.js')));
check('  e o build grava o campo', /estabelecimentoId: text\(body\.estabelecimentoId \?\? current\?\.estabelecimentoId\)/.test(ler('lib/cadastros-core.js')));
check('a ficha do usuário pergunta o estabelecimento',
  /<select name="estabelecimentoId">/.test(ler('public/modules/settings/subs/users_form.js')));
check('  e se pode lançar por outro', /name="podeTrocarEstabelecimento"/.test(ler('public/modules/settings/subs/users_form.js')));
// Ausente != vazio: uma tela que não tem o campo não pode desvincular ninguém.
const auth = semComentarios(ler('lib/db/auth.js'));
check('ausente não desvincula ninguém',
  /if \(payload\.estabelecimentoId !== undefined\) \{/.test(auth));
check('o lançamento guarda o estabelecimento',
  /estabelecimento_id: payload\.estabelecimentoId \|\| null/.test(semComentarios(ler('lib/db/financeiro.js'))));

console.log('--- 12. a migração ---');
const sql = ler('banco/migrations/fase-cd-contas-por-estabelecimento.sql');
check('cria a tabela', /create table if not exists conta_estabelecimento/.test(sql));
check('  com chave no PAR', /primary key \(bank_account_id, estabelecimento_id\)/.test(sql));
check('  e índice pela ponta quente', /idx_conta_estab_por_estabelecimento/.test(sql));
check('liga RLS, como toda tabela deste schema',
  /alter table if exists conta_estabelecimento enable row level security/.test(sql));
check('acrescenta o vínculo no usuário',
  /add column if not exists estabelecimento_id uuid references estabelecimento\(id\)/.test(sql));
check('  e no lançamento', /alter table if exists financial_entries\s*\n\s*add column if not exists estabelecimento_id/.test(sql));

console.log('--- o que foi medido contra a API e no navegador ---');
for (const [caso, resultado] of [
  ['Ana (filial) na conta da própria filial', '200 gravou'],
  ['Ana na conta da OUTRA filial', '200 gravou'],
  ['Ana na conta sem dono', '200 gravou'],
  ['Ana na conta da MATRIZ', '400 recusado, com o motivo'],
  ['Ana lançando por outro estabelecimento', '403'],
  ['Ana transferindo da filial para a matriz', '400 (a porta dos fundos)'],
  ['admin pela matriz, conta da matriz', '200'],
  ['admin por Tubarão, conta da matriz', '400 (a regra é do estabelecimento)'],
  ['exceção marcada para Criciúma', '200 só para ela'],
  ['voltando tudo ao padrão', '400 de novo'],
  ['Ana pedindo a tela de configuração', '403'],
  ['no Chrome: contas oferecidas à Ana', '3 de 4 — a da matriz não aparece'],
  ['no Chrome: violações de CSP', '0']
]) console.log(`  ·  ${caso.padEnd(42)} ${resultado}`);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
