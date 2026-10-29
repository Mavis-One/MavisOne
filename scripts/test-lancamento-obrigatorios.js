#!/usr/bin/env node
// CONTA BANCÁRIA E CENTRO DE CUSTO OBRIGATÓRIOS NO LANÇAMENTO (23/10/2026).
//
// O usuário: "deixe os campos de centro de custo, conta bancária e banco em
// lançamentos e títulos financeiros como obrigatórios". O banco é o da conta.
// Logo depois: "a obrigatoriedade de centro de custo fique apenas na raiz do
// CNPJ 43.792.899, pois os demais não têm; deixe como opcional".
//
// Provado no servidor local (com um centro de custo de teste): sem os dois, o
// POST deu 400 "Informe a conta bancária e o centro de custo do lançamento.";
// com os dois, 200; tirar o centro na edição, 400; editar só o vencimento de
// um título que já os tem, 200; transferência sem centro, 200. Na tela, os
// rótulos "Conta bancária *" e "Centro de custo *", e salvar sem eles avisou e
// pôs o cursor na conta bancária. Depois da regra da raiz: título da Electric
// (46.877.837) sem centro, 200; da Plus (43.792.899) sem centro, 400; e o
// asterisco do centro some e volta ao trocar a empresa na tela. Tudo apagado.
'use strict';
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');
const ler = (a) => fs.readFileSync(path.join(RAIZ, a), 'utf8');

console.log('\n--- 1. a regra (shared/lancamento_obrigatorios.js) ---');
const R = require('../public/modules/shared/lancamento_obrigatorios');
const PLUS = '43.792.899/0001-35';
const campos = (l) => R.faltando(l).map((c) => c.campo).join();
check('despesa da raiz 43.792.899 sem conta e sem centro: os dois faltam', campos({ type: 'DESPESA', cnpjDoEstabelecimento: PLUS }) === 'bankAccountId,costCenter');
check('receita também', campos({ type: 'RECEITA', bankAccountId: 'b1', cnpjDoEstabelecimento: PLUS }) === 'costCenter');
check('outra raiz (Electric 46.877.837): só a conta', campos({ type: 'DESPESA', cnpjDoEstabelecimento: '46877837000114' }) === 'bankAccountId');
check('sem estabelecimento conhecido: só a conta', campos({ type: 'DESPESA' }) === 'bankAccountId');
check('a raiz é conferida com ou sem máscara', R.exigeCentroDeCusto('43792899000216') && R.exigeCentroDeCusto('43.792.899/0005-69') && !R.exigeCentroDeCusto('4379289'));
check('com os dois, nada falta', R.faltando({ type: 'DESPESA', bankAccountId: 'b1', costCenter: 'c1', cnpjDoEstabelecimento: PLUS }).length === 0);
// 24/10/2026, "não estou conseguindo mais faturar": sem nenhum centro liberado
// para a empresa, exigir travava o título. Provado no servidor local: sem
// centro cadastrado, e com centro só de outra loja, o título da matriz sem
// centro gravou; com um centro válido para todas, foi recusado; e na tela,
// escolher a matriz trouxe o único centro dela preenchido, com o asterisco.
check('raiz 43.792.899 sem nenhum centro liberado: o centro fica opcional', campos({ type: 'DESPESA', bankAccountId: 'b1', cnpjDoEstabelecimento: PLUS, centroDisponivel: false }) === '');
check('transferência fica fora (tem origem e destino, não tem centro)', R.faltando({ type: 'transferencia', cnpjDoEstabelecimento: PLUS }).length === 0);
check('espaço em branco não conta como preenchido', R.faltando({ type: 'DESPESA', bankAccountId: ' ', costCenter: 'c1', cnpjDoEstabelecimento: PLUS }).length === 1);
check('a mensagem junta os que faltam', R.mensagem(R.faltando({ type: 'DESPESA', cnpjDoEstabelecimento: PLUS })) === 'Informe a conta bancária e o centro de custo do lançamento.'
  && R.mensagem([]) === '');
// 28/10/2026, "quando houver um lançamento da Kaccau, By Blumenau e Electric,
// não pode ter centro de custos": pelo estabelecimento ou pela conta.
const sem = (l) => (R.empresaSemCentro(l) || {}).nome || '';
check('Electric, Kaccau e By Blumenau não levam centro: pelo CNPJ do estabelecimento',
  sem({ cnpjDoEstabelecimento: '46.877.837/0001-14' }) === 'ELECTRIC' && sem({ cnpjDoEstabelecimento: '51638084000124' }) === 'KACCAU'
  && sem({ cnpjDoEstabelecimento: '53812831000124' }) === 'BY BLUMENAU');
check('  pela empresa da conta (regra da coluna Empresa) ou pelo nome da conta',
  sem({ cnpjDaConta: '51638084000124' }) === 'KACCAU' && sem({ nomeDaConta: 'SICOOB KACCAU (MAXICREDITO)' }) === 'KACCAU'
  && sem({ nomeDaConta: 'Itaú By Blumenau' }) === 'BY BLUMENAU' && sem({ nomeDaConta: 'SICOOB ELECTRICS' }) === 'ELECTRIC');
check('  a Plus e uma conta qualquer seguem com centro', !R.empresaSemCentro({ cnpjDoEstabelecimento: PLUS, nomeDaConta: 'SICREDI MATRIZ' })
  && !R.empresaSemCentro({ nomeDaConta: 'BLUMENAU' }));
check('  título da matriz na conta da Kaccau: o centro não falta', campos({ type: 'DESPESA', bankAccountId: 'b1', cnpjDoEstabelecimento: PLUS, nomeDaConta: 'VIACREDI KACCAU' }) === '');
// 28/10/2026, "crédito puxe receita e débito puxe despesa".
const plano = (name, type) => ({ name, type });
check('transferência entre portadores: CREDITO é receita, DEBITO é despesa',
  R.tipoPeloPlano(plano('TRANSFERENCIA ENTRE PORTADORES CREDITO', 'receita'), 'DESPESA') === 'RECEITA'
  && R.tipoPeloPlano(plano('Transferência entre portadores débito', 'despesa'), 'RECEITA') === 'DESPESA');
check('  sem a palavra, vale o tipo do plano; outro plano não muda nada',
  R.tipoPeloPlano(plano('TRANSFERENCIA ENTRE PORTADORES', 'despesa'), 'RECEITA') === 'DESPESA'
  && R.tipoPeloPlano(plano('ALUGUEL', 'despesa'), 'RECEITA') === 'RECEITA' && R.tipoPeloPlano(null, 'despesa') === 'DESPESA');
check('  a transferência entre contas fica como está', R.tipoPeloPlano(plano('TRANSFERENCIA ENTRE PORTADORES CREDITO', 'receita'), 'TRANSFERENCIA') === 'TRANSFERENCIA');
// 29/10/2026, print do usuário: a parcela do empréstimo com "...DEBITO"
// (cadastrado Despesa) saía como Receita pela regra de 28/10. Vale o cadastro.
check('empréstimos / financiamentos: vale o tipo cadastrado no plano (o print: DEBITO despesa)',
  R.tipoPeloPlano(plano('EMPRESTIMOS / FINANCIAMENTOS - DEBITO', 'despesa'), 'DESPESA') === 'DESPESA'
  && R.tipoPeloPlano(plano('Empréstimos / Financiamentos - Débito', 'despesa'), 'RECEITA') === 'DESPESA'
  && R.tipoPeloPlano(plano('EMPRESTIMOS / FINANCIAMENTOS - CREDITO', 'receita'), 'DESPESA') === 'RECEITA');
check('  cadastrado ao contrário, vale o cadastro; "ambos" deixa o do lançamento',
  R.tipoPeloPlano(plano('EMPRESTIMOS / FINANCIAMENTOS - CREDITO', 'despesa'), 'RECEITA') === 'DESPESA'
  && R.tipoPeloPlano(plano('EMPRESTIMOS / FINANCIAMENTOS - DEBITO', 'ambos'), 'RECEITA') === 'RECEITA');
check('  só os de CREDITO/DEBITO decidem pelo cadastro',
  R.planoDecidePeloCadastro(plano('EMPRESTIMOS / FINANCIAMENTOS - DEBITO', 'despesa'))
  && !R.planoDecidePeloCadastro(plano('EMPRESTIMOS / FINANCIAMENTOS', 'despesa'))
  && !R.planoDecidePeloCadastro(plano('TRANSFERENCIA ENTRE PORTADORES CREDITO', 'receita')));
check('  sem a palavra (o plano do Viper), vale o tipo do lançamento; os outros empréstimos não mudam',
  R.tipoPeloPlano(plano('EMPRESTIMOS / FINANCIAMENTOS', 'despesa'), 'RECEITA') === 'RECEITA'
  && R.tipoPeloPlano(plano('EMPRESTIMO CONCEDIDO A ELECTRIC', 'despesa'), 'RECEITA') === 'RECEITA'
  && R.tipoPeloPlano(plano('DESPESAS COM FINANCIAMENTOS', 'despesa'), 'RECEITA') === 'RECEITA');
check('  a transferência entre contas fica como está', R.tipoPeloPlano(plano('EMPRESTIMOS / FINANCIAMENTOS - CREDITO', 'receita'), 'TRANSFERENCIA') === 'TRANSFERENCIA');

console.log('\n--- 2. o servidor ---');
const servidor = semComentarios(ler('server.js'));
const validar = servidor.slice(servidor.indexOf('function validarLancamentoFinanceiro('), servidor.indexOf('function recomputeFinanceEntryStatus('));
check('o validador de sempre confere, com o CNPJ do estabelecimento e a empresa da conta',
  validar.includes('const faltam = lancamentoObrigatorios.faltando({ type, bankAccountId, costCenter, cnpjDoEstabelecimento: cnpj, centroDisponivel, cnpjDaConta, nomeDaConta });')
  && validar.includes('if (faltam.length) return lancamentoObrigatorios.mensagem(faltam);'));
check('  criar e editar resolvem o estabelecimento e a conta antes e mandam os dois',
  servidor.includes('const regraDoCentro = await regraDoCentroDeCusto(escolha.id, body.bankAccountId, data);')
  && servidor.includes('validarLancamentoFinanceiro({ ...body, type, amount, ...regraDoCentro })')
  && servidor.includes('const regraDoCentro = await regraDoCentroDeCusto(escolhaPut.id, proposto.bankAccountId, data);')
  && servidor.includes('validarLancamentoFinanceiro({ ...proposto, ...regraDoCentro })'));
check('  da Kaccau, By Blumenau ou Electric, criar e editar gravam sem centro',
  (servidor.match(/if \(lancamentoObrigatorios\.empresaSemCentro\(regraDoCentro\)\) body\.costCenter = '';/g) || []).length === 2);
check('  a empresa da conta é a da coluna Empresa (resolvedorDeEmpresas)', /async function empresaDaContaBancaria\(bankAccountId, data\) \{[\s\S]{0,400}resolvedorDeEmpresas\(\[\], data\)/.test(servidor));
check('  o tipo segue o plano ao criar e na edição livre', servidor.includes("const type = lancamentoObrigatorios.tipoPeloPlano(\n        (data.financialCategories || []).find((c) => c.id === body.category),")
  && servidor.includes('entry.type = lancamentoObrigatorios.tipoPeloPlano(')
  && /\['RECEITA', 'DESPESA'\]\.includes\(tipoDoLancamento\(payload\.type\)\)\) row\.type = tipoDoLancamento\(payload\.type\)/.test(ler('lib/db/financeiro.js')));
check('  a tela recebe a empresa de cada conta', servidor.includes('cnpjDaEmpresaDaConta: Object.fromEntries((data.bankAccounts || [])'));
check('  e a migração FE corrige os já gravados', /nome ~ '\\mCREDITO\\M' then 'RECEITA'/.test(ler('banco/migrations/fase-fe-transferencia-entre-portadores.sql'))
  && /nome ~ '\\mDEBITO\\M' then 'DESPESA'/.test(ler('banco/migrations/fase-fe-transferencia-entre-portadores.sql')));
// A FG (28/10) inverteu os de empréstimo; a FH (29/10) os devolve ao tipo do
// plano. As duas rodam em ordem, e o resultado é o da FH.
const fh = ler('banco/migrations/fase-fh-emprestimos-pelo-tipo-do-plano.sql');
check('  e a FH devolve os de empréstimos ao tipo do plano (desfaz a FG)',
  /case lower\(coalesce\(type, ''\)\) when 'receita' then 'RECEITA' when 'despesa' then 'DESPESA' end as tipo/.test(fh)
  && /nome ~ '\\m\(CREDITO\|DEBITO\)\\M'/.test(fh) && /set type = c\.tipo,/.test(fh));
const rotaDoPlano = servidor.slice(servidor.indexOf("/^\\/api\\/finance\\/categories\\/[^/]+$/.test(pathname) && req.method === 'PUT'"));
check('trocar o tipo do plano de empréstimo troca o dos lançamentos dele',
  /if \(tipoNovo && lancamentoObrigatorios\.planoDecidePeloCadastro\(category\)\) \{/.test(rotaDoPlano)
  && /where category_id = \$2 and type in \('RECEITA', 'DESPESA'\) and type <> \$1/.test(rotaDoPlano)
  && /return sendJson\(res, \{ success: true, category, lancamentosAjustados \}\);/.test(rotaDoPlano));
check('  e consulta CNPJ e centro liberado em uma ida ao banco', servidor.includes('from estabelecimento e')
  && servidor.includes('or $1 = any(estabelecimento_ids)')
  && servidor.includes('return {\n      cnpjDoEstabelecimento: cnpj,')
  && servidor.includes('lancamentoObrigatorios.RAIZES_COM_CENTRO'));
check('  editar (PUT) confere o resultado: o que veio, senão o gravado', /costCenter: body\.costCenter !== undefined \? body\.costCenter : entry\.costCenter/.test(servidor)
  && /bankAccountId: body\.bankAccountId !== undefined \? body\.bankAccountId : entry\.bankAccountId/.test(servidor));
check('  o CNPJ e disponibilidade do centro vêm da mesma consulta', /async function regraDoCentroPeloEstabelecimento\(estabelecimentoId\) \{[\s\S]{0,1200}from estabelecimento e[\s\S]{0,500}centro_disponivel/.test(servidor)
  && !servidor.includes('async function cnpjDoEstabelecimento('));
check('  e a tela recebe o CNPJ de cada estabelecimento', servidor.includes('razaoSocial: e.razaoSocial, nomeFantasia: e.nomeFantasia, cnpj: e.cnpj }'));

console.log('\n--- 3. a tela (Novo Lançamento / Edição de Título) ---');
const tela = semComentarios(ler('public/modules/finance/subs/novo_lancamento.js'));
check('conta com asterisco; o do centro conforme a empresa', tela.includes('<label>Conta bancária *')
  && tela.includes("<label><span>Centro de custo<span data-centro-asterisco>${centroObrigatorioAqui() ? ' *' : ''}</span></span>")
  && tela.includes("asterisco.textContent = centroObrigatorioAqui() ? ' *' : '';"));
check('salvar sem eles avisa, leva ao campo e não envia',
  tela.includes('window.MavisLancamentoObrigatorios.faltando({ ...payload, type: formType, ...regraDaEmpresaAqui(), centroDisponivel: centroDisponivelAqui() })')
  && tela.includes('document.getElementById(faltamNoLancamento[0].foco)?.focus();'));
check('da Kaccau, By Blumenau ou Electric o centro esvazia, trava e não vai no envio',
  tela.includes("payload.costCenter = empresaSemCentroAqui() ? '' : (formData.get('costCenter') || '');")
  && tela.includes('if (campo) campo.disabled = semCentro;')
  && tela.includes('Lançamento da ${semCentro.nome} não leva centro de custo.')
  && tela.includes("aoEscolher: () => atualizarCentroDaEmpresa()")
  && tela.includes('onSelect: CAMPOS_DE_BUSCA[id].aoEscolher'));
check('o plano de transferência entre portadores decide o tipo do envio, e a tela avisa',
  tela.includes('payload.type = window.MavisLancamentoObrigatorios.tipoPeloPlano((meta.categories || []).find((c) => c.id === payload.category), payload.type);')
  && tela.includes("aoEscolher: (valor) => avisarTipoDoPlano(valor)"));
check('parcelas até 240 (28/10/2026) no lançamento, no Parcelar e na entrada de NF-e',
  tela.includes('name="parcelasQtd" min="1" max="240"') && tela.includes('Math.min(240, Math.max(1,')
  && ler('public/modules/finance/subs/lancamentos.js').includes('Math.min(240, Math.max(2,')
  && ler('public/modules/purchases/subs/entrada_nfe.js').includes('max="240" step="1" id="entradaParcelasQtd"')
  && ler('lib/entradaNfe.js').includes("if (lista.length > 240) throw recusa('No máximo 240 parcelas.');"));
check('um centro só liberado já vem escolhido', tela.includes("financeCostCenter: () => (empresaSemCentroAqui() ? '' : (editEntry && editEntry.costCenter) || centroUnicoAqui()),")
  && tela.includes("refazerCampoDeBusca('financeCostCenter', aindaVale && escolhido ? escolhido : centroUnicoAqui());"));
// 24/10/2026, "não está buscando": a busca só traz os centros liberados para a
// empresa; sem nenhum, o campo diz isso e onde liberar (provado: título da
// Barra só com centro da Vila Lalau mostrou o aviso; com um da Barra, achou).
check('sem centro liberado para a empresa, o aviso diz onde liberar', tela.includes('Nenhum centro de custo liberado para ${nome}. Libere em Financeiro › Centros de Custo (ou crie pelo +).')
  && tela.includes("avisoCentro.hidden = !avisoCentro.textContent;"));
check('index.html carrega a regra', /shared\/lancamento_obrigatorios\.js/.test(ler('public/index.html')));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
