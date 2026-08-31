#!/usr/bin/env node
// NF-e COMPLEMENTAR EXCLUSIVA DE ICMS.
//
// O CENÁRIO
// ---------
// Uma nota saiu com ICMS a menor. O complemento não corresponde a mercadoria
// nenhuma: não há o que entregar, o que dar baixa nem o que receber. O que
// existe é imposto a destacar.
//
// A GAMBIARRA QUE ISTO IMPEDE
// ---------------------------
// Lançar o complemento como venda de 1 unidade a R$ 0,01 para "caber" na
// estrutura de item. Isso baixa estoque de produto que não saiu, cria
// recebível de um centavo que ninguém cobra e suja o custo médio. A SEF/SC
// prevê o caminho certo: item ESCRITURAL com CFOP 5.949, quantidade e valor
// zerados, e o ICMS destacado sozinho.
//
// Os cinco testes obrigatórios da especificação estão marcados como TESTE 01..05.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

const O = require('../lib/operacaoFiscal');
const { buildNfePayload } = require('../lib/nfePayloadBuilder');
const serverSrc = ler('server.js');
const migracao = ler('banco/migrations/fase-ab-nfe-complementar-icms.sql');
const telaSrc = ler('public/modules/finance/subs/emitir_nfe_focus.js');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const itemEscritural = (over = {}) => ({
  escritural: true, quantidade: 0, valorUnitario: 0,
  descricao: 'COMPLEMENTO DE ICMS - NF-E COMPLEMENTAR', codigoProduto: 'CFOP5.949',
  ncm: '00000000', unidadeComercial: 'UN', origem: 0,
  baseIcms: 1000, aliquotaIcms: 17, valorIcms: 170,
  regraFiscal: { cfop: '5949', cstIcms: '00', modalidadeBcIcms: 3, aliquotaIcms: 17, cstPis: '01', cstCofins: '01' },
  ...over
});
const validar = (over = {}) => O.validarOperacao({
  tipoOperacao: 'COMPLEMENTO_ICMS', finalidade: 2,
  referencias: [{ chaveAcesso: '4'.repeat(44) }],
  itens: [itemEscritural()],
  valorIcmsComplementar: 170,
  ...over
});

console.log('=== OS CINCO TESTES OBRIGATÓRIOS ===\n');

console.log('TESTE 01 — escritural, qtd 0, valor 0, ICMS > 0 → PERMITIR');
check('sem erros', validar().length === 0, validar().join(' | ') || 'ok');

console.log('\nTESTE 02 — escritural, qtd 0, valor 0, ICMS = 0 → BLOQUEAR');
// Complemento de ICMS com ICMS zero não complementa nada.
const semIcms = validar({ valorIcmsComplementar: 0 });
check('bloqueado', semIcms.length > 0);
check('e o motivo é o ICMS', semIcms.some((e) => /ICMS a complementar/.test(e)), semIcms.join(' | '));

console.log('\nTESTE 03 — complementar sem NF-e original → BLOQUEAR');
// A SEFAZ recusa; gravar o rascunho deixaria uma nota impossível de transmitir.
const semRef = validar({ referencias: [] });
check('bloqueado', semRef.length > 0);
check('e o motivo é a chave', semRef.some((e) => /chave de acesso da NF-e original/.test(e)), semRef.join(' | '));
// Chave truncada é tão inútil quanto chave ausente.
const chaveCurta = validar({ referencias: [{ chaveAcesso: '123' }] });
check('chave com menos de 44 dígitos também bloqueia', chaveCurta.length > 0);

console.log('\nTESTE 04 — complementar não movimenta estoque nem gera financeiro');
check('não movimenta estoque', O.deveMovimentarEstoque({ tipoOperacao: 'COMPLEMENTO_ICMS' }) === false);
check('não gera financeiro', O.deveGerarFinanceiro({ tipoOperacao: 'COMPLEMENTO_ICMS' }) === false);
// A OPERAÇÃO manda no produto: nem um produto marcado como "movimenta" pode
// movimentar aqui, porque não houve saída física.
check('a operação vence o produto (estoque)',
  O.deveMovimentarEstoque({ tipoOperacao: 'COMPLEMENTO_ICMS', produto: { movimentaEstoque: true } }) === false);
check('a operação vence o produto (financeiro)',
  O.deveGerarFinanceiro({ tipoOperacao: 'COMPLEMENTO_ICMS', produto: { geraFinanceiro: true } }) === false);

console.log('\nTESTE 05 — NF-e normal com quantidade 0 → BLOQUEAR');
// A exceção de zero existe só onde a operação permite. Sem isto, a correção
// abriria um buraco na venda comum.
const vendaZero = O.validarOperacao({
  tipoOperacao: 'VENDA', finalidade: 1, itens: [{ quantidade: 0, valorUnitario: 10 }]
});
check('bloqueado', vendaZero.length > 0);
check('e o motivo é a quantidade', vendaZero.some((e) => /quantidade deve ser maior que zero/.test(e)), vendaZero.join(' | '));
const vendaValorZero = O.validarOperacao({
  tipoOperacao: 'VENDA', finalidade: 1, itens: [{ quantidade: 1, valorUnitario: 0 }]
});
check('venda com valor zero também bloqueia', vendaValorZero.length > 0);
// Venda normal continua passando: a mudança não pode ter apertado o caso comum.
check('venda normal continua passando',
  O.validarOperacao({ tipoOperacao: 'VENDA', finalidade: 1, itens: [{ quantidade: 2, valorUnitario: 50 }] }).length === 0);

console.log('\n=== REGRAS DA OPERAÇÃO ===\n');

console.log('--- a operação decide a finalidade, não a tela ---');
// Complementar com finalidade 1 é recusada pela SEFAZ.
check('COMPLEMENTO_ICMS força finalidade 2', O.finalidadeDaOperacao('COMPLEMENTO_ICMS', 1) === 2);
check('VENDA é finalidade 1', O.finalidadeDaOperacao('VENDA', 2) === 1);
check('DEVOLUCAO é finalidade 4', O.finalidadeDaOperacao('DEVOLUCAO') === 4);
check('finalidade divergente é acusada', validar({ finalidade: 1 }).some((e) => /finalidade de emissão 2/.test(e)));
check('o servidor usa a finalidade da operação',
  /const finalidadeEmissao = operacaoFiscal\.finalidadeDaOperacao\(tipoOperacao, body\.finalidadeEmissao\)/.test(serverSrc));

console.log('\n--- item físico é recusado no complemento ---');
const comFisico = validar({ itens: [itemEscritural({ escritural: false, quantidade: 1, valorUnitario: 10 })] });
check('bloqueado', comFisico.length > 0);
check('e diz para não usar mercadoria', comFisico.some((e) => /produto escritural/.test(e)), comFisico.join(' | '));
// O flag vem do CADASTRO, não do corpo da requisição — senão bastaria mandar
// escritural:true para uma mercadoria sair sem baixar estoque.
check('escritural vem do cadastro do produto', /escritural: produto\.escritural === true/.test(serverSrc));
check('e o servidor confere ao resolver pelo SKU', /todos\.find\(\(p\) => p\.escritural && String\(p\.sku \|\| ''\) === String\(bruto\.produtoEscritural\)\)/.test(serverSrc));

console.log('\n--- negativo é sempre erro, zero depende da operação ---');
check('quantidade negativa bloqueia no complemento', validar({ itens: [itemEscritural({ quantidade: -1 })] }).length > 0);
check('valor negativo bloqueia no complemento', validar({ itens: [itemEscritural({ valorUnitario: -1 })] }).length > 0);
check('nota sem item nenhum bloqueia', validar({ itens: [] }).length > 0);

console.log('\n--- cálculo do ICMS ---');
check('1000 x 17% = 170', O.calcularIcms(1000, 17) === 170, String(O.calcularIcms(1000, 17)));
check('arredonda em 2 casas', O.calcularIcms(333.33, 17) === 56.67, String(O.calcularIcms(333.33, 17)));
// Sem Number.EPSILON, 1000*17/100 cai em 169.99999999999997 e a nota sai com
// um centavo a menos.
check('sem erro de ponto flutuante', O.calcularIcms(1000, 17).toFixed(2) === '170.00');
check('base zero dá ICMS zero', O.calcularIcms(0, 17) === 0);

console.log('\n--- CFOP é sugestão, não imposição ---');
// Fixar 5.949 ignoraria a parametrização e quebraria na primeira empresa com
// CFOP diferente. Quem decide é a regra fiscal.
check('interno sugere 5949', O.cfopSugeridoComplemento(true) === '5949');
check('interestadual sugere 6949', O.cfopSugeridoComplemento(false) === '6949');
check('o payload usa o CFOP da REGRA, não o sugerido', /cfop: regra\.cfop/.test(ler('lib/nfePayloadBuilder.js')));
// CST/CSOSN também não podem ser fixados: dependem do regime do emitente.
const builderSrc = ler('lib/nfePayloadBuilder.js');
check('CSOSN vem da regra', /base\.icms_situacao_tributaria = regra\.csosn/.test(builderSrc));
check('CST vem da regra', /base\.icms_situacao_tributaria = regra\.cstIcms/.test(builderSrc));

console.log('\n=== PAYLOAD DA NOTA ===\n');
const base = {
  estabelecimento: { cnpj: '11222333000181', razaoSocial: 'Emitente SC', logradouro: 'R B', numero: '1', bairro: 'C', municipio: 'Joinville', uf: 'SC', cep: '89201000', codigoMunicipio: '4209102', inscricaoEstadual: '123' },
  empresa: { crt: 3 },
  destinatario: { nome: 'Cliente Ltda', documento: '12345678000199', contribuinte: true, logradouro: 'R A', numero: '9', bairro: 'C', municipio: 'Joinville', uf: 'SC', cep: '89201000' },
  naturezaOperacao: 'Complemento de ICMS', tipoDocumento: 1, finalidadeEmissao: 2,
  dataEmissao: '2026-08-11T10:00:00-03:00', ambiente: 'homologacao',
  referencias: [{ chaveAcesso: '4'.repeat(44) }]
};
const payload = buildNfePayload({ ...base, itens: [itemEscritural()] });
const item = payload.items[0];

console.log('--- o item sai escritural ---');
check('quantidade 0', item.quantidade_comercial === 0);
check('valor unitário 0', item.valor_unitario_comercial === 0);
check('valor bruto 0', item.valor_bruto === 0);
check('código do produto', item.codigo_produto === 'CFOP5.949');
check('CFOP da regra', item.cfop === '5949');
// indTot=0: o item não compõe o total de mercadorias. Sem isso a SEFAZ soma o
// item ao total e acusa divergência.
check('declara que não entra no total (indTot 0)', item.item_valor_total === 0);

console.log('\n--- o ICMS existe apesar do valor zero ---');
// É o ponto inteiro da nota: valor de produto 0, imposto > 0.
check('base de cálculo é a INFORMADA, não o valor do item', item.icms_base_calculo === 1000, String(item.icms_base_calculo));
check('alíquota', item.icms_aliquota === 17);
check('valor do ICMS', item.icms_valor === 170, String(item.icms_valor));
check('e o valor do produto continua zero', item.valor_bruto === 0);

// Valor informado tem precedência: o complemento pode ser uma diferença
// apurada, que não é base × alíquota.
const comValorProprio = buildNfePayload({ ...base, itens: [itemEscritural({ valorIcms: 123.45 })] });
check('valor informado vence o calculado', comValorProprio.items[0].icms_valor === 123.45);

console.log('\n--- total da nota separa comercial de fiscal ---');
// O ICMS complementar NÃO é valor de venda.
check('total de produtos é zero', payload.valor_produtos === 0, String(payload.valor_produtos));
check('o servidor não soma item escritural ao valor comercial',
  /item\.escritural\s*\n?\s*\? sum/.test(serverSrc));
check('e soma o ICMS num campo próprio', /const valorIcmsComplementar = Math\.round\(itens\.reduce\(/.test(serverSrc));

console.log('\n--- a nota original é referenciada ---');
check('grupo de notas referenciadas', Array.isArray(payload.notas_referenciadas));
check('com a chave', payload.notas_referenciadas[0].chave_nfe === '4'.repeat(44));
// Chave truncada faz a SEFAZ rejeitar a nota inteira sem dizer qual está errada.
const chaveRuim = buildNfePayload({ ...base, referencias: [{ chaveAcesso: '123' }], itens: [itemEscritural()] });
check('chave inválida não entra no payload', chaveRuim.notas_referenciadas === undefined);
const semReferencia = buildNfePayload({ ...base, referencias: [], itens: [itemEscritural()] });
check('sem referência, o grupo nem aparece', semReferencia.notas_referenciadas === undefined);

console.log('\n=== BANCO E TELA ===\n');
console.log('--- migração ---');
// Sem estender o CHECK, nenhuma regra fiscal poderia ser cadastrada para a
// operação — e sem regra, a emissão para em "Nenhuma regra fiscal encontrada".
check('CHECK de tipo_operacao aceita COMPLEMENTO_ICMS', /'COMPLEMENTO_ICMS'\)\)/.test(migracao));
check('products ganha tipo_produto_fiscal', /add column if not exists tipo_produto_fiscal/.test(migracao));
check('products ganha movimenta_estoque', /add column if not exists movimenta_estoque/.test(migracao));
check('products ganha gera_financeiro', /add column if not exists gera_financeiro/.test(migracao));
check('nfe ganha tipo_operacao_fiscal', /add column if not exists tipo_operacao_fiscal/.test(migracao));
check('nfe ganha valor_icms_complementar', /add column if not exists valor_icms_complementar/.test(migracao));
check('nfe ganha nfe_original_chave', /add column if not exists nfe_original_chave/.test(migracao));
check('o produto escritural é cadastrado', /'CFOP5\.949'/.test(migracao) && /'ESCRITURAL'/.test(migracao));
// Regra no BANCO, não só na aplicação.
check('constraint exige original na complementar', /finalidade_emissao <> 2 or nfe_original_chave is not null/.test(migracao));
// Rodar duas vezes não pode estourar por constraint duplicada. Dois padrões
// servem: recriar (drop if exists + add) ou criar só se não existir.
const guardas = (migracao.match(/from pg_constraint where conname/g) || []).length;
const recriadas = (migracao.match(/drop constraint if exists/g) || []).length;
check('constraints são idempotentes', guardas >= 2 && recriadas >= 1, `${guardas} guardadas, ${recriadas} recriada(s)`);
// Toda constraint adicionada tem que estar coberta por um dos dois padrões.
const adicionadas = (migracao.match(/add constraint/g) || []).length;
check('nenhuma constraint sem proteção', adicionadas <= guardas + recriadas, `${adicionadas} add constraint`);
check('inserts são idempotentes', /on conflict \(id\) do update/.test(migracao));
// A especificação pedia nfe_itens, que não existe neste sistema.
check('explica por que não criou nfe_itens', /Essa tabela NÃO existe/.test(migracao));

console.log('\n--- a tela muda de forma ---');
check('a operação está na lista', /value: 'COMPLEMENTO_ICMS', label: 'Complemento de ICMS'/.test(telaSrc));
// Esconder por CSS deixaria campos `required` invisíveis travando o submit
// sem dizer onde.
check('itens e pagamento somem do DOM', /\$\{ehComplemento\(\) \? '' : `/.test(telaSrc));
check('aba própria do complemento', /data-tab="complemento"/.test(telaSrc));
check('pede a chave da original', /name="complementoChave"/.test(telaSrc));
check('pede base, alíquota e valor', /name="complementoBase"/.test(telaSrc) && /name="complementoAliquota"/.test(telaSrc) && /name="complementoValor"/.test(telaSrc));
check('informações complementares obrigatórias', /name="complementoInformacoes"[\s\S]{0,80}required/.test(telaSrc));
check('trocar de operação redesenha', /tipoOperacao = evento\.target\.value;\s*\n\s*renderForm\(\)/.test(telaSrc));
// O texto sugerido para de se atualizar depois de editado à mão.
check('texto sugerido respeita a edição', /if \(!campo \|\| informacoesEditadas\) return;/.test(telaSrc));
check('o texto cita a nota original', /NF-E COMPLEMENTAR DE ICMS REFERENTE À NF-E/.test(telaSrc));
check('não manda itens da tabela no complemento', /produtoEscritural: 'CFOP5\.949'/.test(telaSrc));

console.log('\n--- o texto padrão também existe no servidor ---');
const texto = O.textoComplementoIcms({ numero: '12345', serie: '1', chave: '4'.repeat(44) });
check('cita número, série e chave', /Nº 12345/.test(texto) && /SÉRIE 1/.test(texto) && /CHAVE DE ACESSO 4{44}/.test(texto));
check('e explica o motivo', /COMPLEMENTO DO VALOR DO ICMS NÃO DESTACADO/.test(texto));
check('sem dados, ainda produz texto válido', O.textoComplementoIcms({}).length > 30);

console.log('\n=== O ESCRITURAL NÃO É MERCADORIA ===\n');
const estoqueSrc = ler('lib/db/estoque.js');

console.log('--- fora das listas por padrão ---');
// Apareceria no Estoque com saldo zero que nunca muda, entraria no seletor de
// item de um pedido, contaria na valorização e poderia ser vendido por engano.
check('getProducts filtra escriturais', /return incluirEscriturais \? lista : lista\.filter\(\(p\) => !p\.escritural\)/.test(estoqueSrc));
// Padrão FECHADO: são treze pontos que listam produto, e esquecer um deixaria
// o escritural vazando exatamente onde ninguém olhou.
check('o padrão é excluir', /incluirEscriturais = false/.test(estoqueSrc));
check('e a decisão está explicada', /Nunca é mercadoria/.test(estoqueSrc));

console.log('\n--- mas a resolução por id continua completa ---');
// Filtrar o índice junto faria qualquer registro histórico apontando para um
// escritural responder "produto não encontrado".
check('getProductById não filtra', !/escritural/.test(
  estoqueSrc.slice(estoqueSrc.indexOf('async function getProductById'), estoqueSrc.indexOf('async function upsertProduct'))));
check('loadStockContext separa lista de índice',
  /products: todos\.filter\(\(p\) => !p\.escritural\)/.test(serverSrc)
  && /productsById: new Map\(todos\.map\(\(p\) => \[p\.id, p\]\)\)/.test(serverSrc));
check('o índice de cadastros também é completo',
  /getProducts\(\{ incluirEscriturais: true \}\)\)\.map\(\(p\) => \[p\.id, p\]\)/.test(serverSrc));

console.log('\n--- só a emissão pede escriturais ---');
const pedidos = (serverSrc.match(/getProducts\(\{ incluirEscriturais: true \}\)/g) || []).length;
// Três: a resolução do item escritural, o contexto de estoque e o índice de
// cadastros. Qualquer outro é uma lista vazando.
check('poucos pontos pedem escriturais', pedidos === 3, `${pedidos} ponto(s)`);
check('a resolução do item escritural pede', /O ÚNICO lugar que pede escriturais/.test(serverSrc));
// A lista de mercadoria nunca pode pedir.
const metaVenda = serverSrc.slice(serverSrc.indexOf("pathname === '/api/sales/meta'"), serverSrc.indexOf("pathname === '/api/sales/dashboard'"));
check('o meta de vendas NÃO pede escriturais', !/incluirEscriturais/.test(metaVenda));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
