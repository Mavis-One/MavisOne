#!/usr/bin/env node
/**
 * FINANCEIRO: CAMPOS DIGITÁVEIS E BUSCA POR CPF/CNPJ (14/10/2026).
 *
 * Dois pedidos do usuário:
 *   1. No Novo Lançamento, Conta bancária, Plano de Contas e Centro de custo
 *      (e as contas da transferência) viram campos de busca digitáveis.
 *   2. Lançamentos, Contas a Pagar e Contas a Receber buscam por CPF/CNPJ.
 *
 * Provado no servidor local:
 *   busca "55.932.227/0001-67" e "55932227" (raiz) -> os 896 lançamentos do
 *     fornecedor, igual ao banco; "559322" (6 dígitos) não vira documento
 *   Novo Lançamento: fornecedor achado pelo CNPJ (aparece ao lado do nome),
 *     conta "sic", plano "alug"; o "+" do centro cria e já deixa escolhido sem
 *     apagar o resto; texto sem escolher -> aviso ao salvar. Console limpo.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const novo = ler('public/modules/finance/subs/novo_lancamento.js');
const lista = ler('public/modules/finance/subs/lancamentos.js');
const servidor = ler('server.js');

console.log('--- 1. campos digitáveis no Novo Lançamento ---');
check('nenhum <select> de conta, plano ou centro sobrou',
  !/<select name="(bankAccountId|sourceBankAccountId|targetBankAccountId|category|costCenter)"/.test(novo));
['financeSourceAccount', 'financeTargetAccount', 'financeBankAccount', 'financeCategory', 'financeCostCenter'].forEach((id) => {
  check(`${id} é campo de busca com o "+" apontando para ele`,
    novo.includes(`\${campoDeBusca('${id}')}`) && novo.includes(`data-inline-alvo="${id}"`));
});
check('mesmos nomes no envio (o servidor não muda)',
  /name: 'bankAccountId'/.test(novo) && /name: 'category'/.test(novo) && /name: 'costCenter'/.test(novo)
  && /name: 'sourceBankAccountId'/.test(novo) && /name: 'targetBankAccountId'/.test(novo));
check('o cadastro novo volta escolhido no campo do "+" clicado',
  novo.includes("const valor = id === r.alvo && r.criadoId ? r.criadoId : (r.campos || {})[CAMPOS_DE_BUSCA[id].name] || '';"));
check('trocar a empresa refaz conta e centro sem redesenhar o formulário',
  novo.includes("refazerCampoDeBusca(id, aindaVale ? escolhida : '');")
  && novo.includes("refazerCampoDeBusca('financeCostCenter', aindaVale && escolhido ? escolhido : centroUnicoAqui());"));
check('texto digitado sem escolher não vai calado no envio',
  novo.includes('o texto digitado não foi escolhido na lista. Clique numa das opções.'));
check('transferência exige as duas contas',
  novo.includes("const obrigatorio = id === 'financeSourceAccount' || id === 'financeTargetAccount';"));
check('o campo de busca ocupa a coluna ao lado do "+"',
  ler('public/app.css').includes('.finance-inline-select .searchable-select { flex: 1; min-width: 0; }'));

console.log('\n--- 2. CPF/CNPJ ---');
check('o diretório resumido leva o documento',
  servidor.includes('return diretorio.map(({ id, name, code, document, tradeName }) => (tradeName && tradeName !== name')
  && servidor.includes(': { id, name, code, document }));'));
check('a busca rápida da lista acha pelo CPF/CNPJ da pessoa (8 dígitos ou mais)',
  servidor.includes("const documentoBuscado = digitosDaBusca.length >= 8 ? digitosDaBusca : '';")
  && servidor.includes("resolveFinanceCounterpartyDocument(entry, data).replace(/\\D/g, '').includes(documentoBuscado)"));
check('Novo Lançamento: a pessoa se busca pelo documento',
  /documento: c\.document \|\| ''/.test(novo) && novo.includes("placeholder: 'Buscar por nome, código ou CPF/CNPJ...'"));
check('filtro das listas: idem', /documento: item\.document \|\| ''/.test(lista) && lista.includes('buscar por nome, código ou CPF/CNPJ'));
check('a busca rápida diz que aceita CPF/CNPJ', lista.includes('cliente/fornecedor, CPF/CNPJ ou valor'));

console.log('\n--- 3. nome fantasia ---');
// Provado no navegador: "alemao bikes" acha FABIANO SCHRULL LTDA e "levmed" a
// ASSOCIACAO DE SAUDE DO VALE, com o fantasia ao lado do nome.
check('o diretório leva o nome fantasia (só quando difere do nome)',
  servidor.includes("tradeName: record.tradeName || '',") && servidor.includes('(tradeName && tradeName !== name'));
check('o campo de busca acha por texto extra fora do rótulo',
  ler('public/app.js').includes('const busca = textoDeBusca(o.buscaExtra ? `${o.label} ${o.buscaExtra}` : o.label);'));
check('Novo Lançamento e filtro das listas buscam pelo fantasia',
  novo.includes("buscaExtra: c.tradeName || ''") && lista.includes("buscaExtra: item.tradeName || ''"));

console.log('\n--- 4. o "+" leva à tela de cadastro de verdade (14/10/2026) ---');
check('cada "+" tem a sua tela', novo.includes("bankAccount: { modulo: 'cadastros', tela: 'nova_conta_bancaria'")
  && novo.includes("category: { modulo: 'finance', tela: 'plano_de_contas'")
  && novo.includes("costCenter: { modulo: 'finance', tela: 'centros_de_custo'"));
check('o lançamento em digitação fica guardado e volta', novo.includes('state.financeRascunhoLancamento = {') && novo.includes('restaurarRascunho();'));
check('sem o módulo da tela, avisa em vez de levar a uma tela fechada', novo.includes('que não está liberado para você.'));
const plano = ler('public/modules/finance/subs/plano_de_contas.js');
const centros = ler('public/modules/finance/subs/centros_de_custo.js');
const cadastros = ler('public/modules/cadastros/shared.js');
check('Plano de Contas existe no menu, no módulo e na página',
  ler('public/app.js').includes("{ key: 'plano_de_contas', label: 'Plano de Contas'")
  && ler('public/modules/finance/index.js').includes("'plano_de_contas'")
  && ler('public/index.html').includes('/modules/finance/subs/plano_de_contas.js'));
check('  e edita nome e tipo pela rota nova', plano.includes("method: 'PUT'") && servidor.includes("if (/^\\/api\\/finance\\/categories\\/[^/]+$/.test(pathname) && req.method === 'PUT') {"));
check('as três telas devolvem ao lançamento ao salvar o novo',
  plano.includes("window.MavisRascunhoLancamento.voltar(ctx, criado.id)")
  && centros.includes("window.MavisRascunhoLancamento.voltar(ctx, criado.id)")
  && cadastros.includes('if (voltaAoLancamento(criado && criado.id)) return;'));

console.log('\n--- 5. Edição de Título (14/10/2026) ---');
// Provado no navegador: em Contas a Pagar, abrir o LF27362 e clicar Editar leva
// a "Financeiro / Edição de Título", com data, vencimento, valor, descrição,
// documento, fornecedor e plano do título; "Novo Lançamento" segue vazio.
check('é a mesma tela, com outro nome',
  novo.includes('window.MavisSubscreenRegistry.finance.edicao_titulo = window.MavisSubscreenRegistry.finance.novo_lancamento;')
  && ler('public/modules/finance/index.js').includes("'edicao_titulo'")
  && ler('public/app.js').includes("(state.activeModule === 'finance' && activeSubKey === 'edicao_titulo')\n      ? 'Edição de Título'"));
check('o Editar do título e o faturamento do pedido abrem a Edição de Título',
  lista.includes("state.activeSub = 'edicao_titulo';") && ler('public/app.js').includes("state.financeEditEntryId = gerados[0];\n                  state.activeSub = 'edicao_titulo';"));
check('sem título escolhido ela volta a ser Novo Lançamento',
  novo.includes("if (state.activeSub === 'edicao_titulo' && !idEmEdicao) {"));
check('o cabeçalho do formulário diz Edição de Título', novo.includes("rotulo(editEntry.code, 'Edição de Título')"));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
