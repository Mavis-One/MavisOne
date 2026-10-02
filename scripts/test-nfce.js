#!/usr/bin/env node
/**
 * NFC-e (MODELO 65) — o montador, o cliente da Focus e o caminho no servidor.
 *
 * Sem banco e sem rede: o montador é puro, o cliente da Focus fala por um
 * `fetch` de mentira, e o servidor é conferido no fonte. A emissão de verdade
 * só se prova emitindo, e em homologação (ver o fim deste arquivo).
 */
const fs = require('fs');
const path = require('path');
const { buildNfcePayload, conferirPagamentosDaNota } = require('../lib/nfePayloadBuilder');
const focus = require('../lib/focusnfe');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const ESTAB = {
  cnpj: '43792899000135', razaoSocial: 'Loja Teste', logradouro: 'Rua A', numero: '1',
  bairro: 'Centro', municipio: 'Jaraguá do Sul', uf: 'SC', cep: '89251000', codigoMunicipio: '4208906'
};
const item = (extra = {}) => ({
  descricao: 'Bicicleta elétrica', codigoProduto: 'SKU1', ncm: '87116000', quantidade: 2, valorUnitario: 1500,
  unidadeComercial: 'UN', origem: 0, regraFiscal: { cfop: '5102', cstIcms: '00', aliquotaIcms: 17 }, ...extra
});
const montar = (extra = {}) => buildNfcePayload({
  estabelecimento: ESTAB, destinatario: {}, itens: [item()], naturezaOperacao: 'VENDA AO CONSUMIDOR',
  dataEmissao: '2026-10-02T15:00:00-03:00', ambiente: 'producao', ...extra
});

console.log('\n--- 1. o cabeçalho é o da NFC-e (doc emitir_nfce) ---');
const p = montar();
check('presencial, consumidor final, operação interna, sem frete',
  p.presenca_comprador === '1' && p.consumidor_final === '1' && p.local_destino === '1' && p.modalidade_frete === '9');
check('consumidor não contribuinte', p.indicador_inscricao_estadual_destinatario === '9');
check('emitente pelo CNPJ (o resto a Focus tem no cadastro)', p.cnpj_emitente === ESTAB.cnpj && p.logradouro_emitente === undefined && p.regime_tributario_emitente === undefined);
check('não leva o que é só da NF-e', p.tipo_documento === undefined && p.finalidade_emissao === undefined && p.notas_referenciadas === undefined);
check('nem endereço de destinatário', !Object.keys(p).some((k) => /_destinatario$/.test(k) && !['indicador_inscricao_estadual_destinatario'].includes(k)));
check('nem frete, seguro ou outras despesas', p.valor_frete === undefined && p.valor_seguro === undefined && p.valor_outras_despesas === undefined);

console.log('\n--- 2. o consumidor é opcional ---');
const comCpf = montar({ destinatario: { nome: 'Maria', documento: '123.456.789-09' } });
check('com CPF, vai CPF e nome', comCpf.cpf_destinatario === '12345678909' && comCpf.nome_destinatario === 'Maria' && comCpf.cnpj_destinatario === undefined);
const comCnpj = montar({ destinatario: { nome: 'Oficina', documento: '11.222.333/0001-81' } });
check('com CNPJ (não contribuinte), vai CNPJ', comCnpj.cnpj_destinatario === '11222333000181' && comCnpj.cpf_destinatario === undefined);
check('documento torto não vira consumidor', montar({ destinatario: { nome: 'X', documento: '123' } }).nome_destinatario === undefined);

console.log('\n--- 3. itens e totais ---');
check('os itens são os da NF-e (tributação incluída)', p.items.length === 1 && p.items[0].cfop === '5102' && p.items[0].icms_situacao_tributaria === '00' && p.items[0].codigo_ncm === '87116000');
check('produtos = soma dos itens', p.valor_produtos === 3000);
const comDesconto = montar({ desconto: 100 });
check('total = produtos − desconto', comDesconto.valor_total === 2900 && comDesconto.valor_desconto === 100);
check('sem pagamento informado, uma parcela "Outros" no total', p.formas_pagamento.length === 1 && p.formas_pagamento[0].forma_pagamento === '99' && p.formas_pagamento[0].valor_pagamento === 3000);
const cartao = montar({ pagamentos: [{ forma: '03', valor: 3000, bandeira: '02', autorizacao: 'R07242' }] });
check('cartão leva o grupo card (o mesmo da NF-e)', cartao.formas_pagamento[0].bandeira_operadora === '02' && cartao.formas_pagamento[0].numero_autorizacao === 'R07242' && cartao.formas_pagamento[0].tipo_integracao === 2);
check('a conferência de pagamento x total vale para a NFC-e', /faltam 2990\.00/.test(conferirPagamentosDaNota(montar({ pagamentos: [{ forma: '01', valor: 10 }] }))) && conferirPagamentosDaNota(p) === '');

console.log('\n--- 4. homologação ---');
const teste = montar({ ambiente: 'homologacao', destinatario: { nome: 'Maria', documento: '12345678909' } });
check('o primeiro item leva o texto obrigatório (rejeição 373)', teste.items[0].descricao === 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL');
check('o nome do consumidor também', teste.nome_destinatario === 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL');
check('o nome real não se perde: vai para as observações', /Maria/.test(teste.informacoes_adicionais_contribuinte || ''));
check('em produção, a descrição é a do produto', p.items[0].descricao === 'Bicicleta elétrica');
check('sem ambiente informado, monta como teste', buildNfcePayload({ estabelecimento: ESTAB, itens: [item()], naturezaOperacao: 'V', dataEmissao: 'x' }).items[0].descricao.startsWith('NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO'));

console.log('\n--- 5. o cliente da Focus fala com /nfce ---');
(async () => {
  const chamadas = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opcoes) => {
    chamadas.push({ url, method: opcoes.method });
    return { ok: true, status: 201, headers: { get: () => 'application/json' }, json: async () => ({ status: 'autorizado' }), text: async () => '{"status":"autorizado"}' };
  };
  const creds = { token: 'a'.repeat(32), ambiente: 'homologacao' };
  try {
    await focus.emitirNfce('ref-1', { a: 1 }, creds);
    await focus.consultarNfce('ref-1', creds);
    await focus.cancelarNfce('ref-1', 'justificativa longa o bastante', creds);
  } catch (erro) {
    check('as chamadas responderam', false, erro.message);
  }
  check('emitir = POST /v2/nfce?ref=', chamadas[0] && chamadas[0].method === 'POST' && /homologacao\.focusnfe\.com\.br\/v2\/nfce\?ref=ref-1$/.test(chamadas[0].url), chamadas[0] && chamadas[0].url);
  check('consultar = GET /v2/nfce/{ref}', chamadas[1] && chamadas[1].method === 'GET' && /\/v2\/nfce\/ref-1$/.test(chamadas[1].url));
  check('cancelar = DELETE /v2/nfce/{ref}', chamadas[2] && chamadas[2].method === 'DELETE' && /\/v2\/nfce\/ref-1$/.test(chamadas[2].url));

  // A MESMA TRAVA DA NF-e: produção sob FOCUS_NFE_SOMENTE_HOMOLOGACAO ligada é recusada.
  const antes = process.env.FOCUS_NFE_SOMENTE_HOMOLOGACAO;
  process.env.FOCUS_NFE_SOMENTE_HOMOLOGACAO = '1';
  let recusou = false;
  try { await focus.emitirNfce('ref-2', {}, { token: 'a'.repeat(32), ambiente: 'producao' }); } catch (erro) { recusou = erro.status === 409; }
  check('produção com a trava ligada é recusada (409), como na NF-e', recusou);
  if (antes === undefined) delete process.env.FOCUS_NFE_SOMENTE_HOMOLOGACAO; else process.env.FOCUS_NFE_SOMENTE_HOMOLOGACAO = antes;
  global.fetch = fetchOriginal;

  console.log('\n--- 6. o servidor ---');
  const servidor = ler('server.js');
  const preparar = servidor.slice(servidor.indexOf('async function prepararNfeParaTransmitir'), servidor.indexOf('async function emitirNfeFiscal'));
  const emitir = servidor.slice(servidor.indexOf('async function emitirNfeFiscal'), servidor.indexOf('async function emitirNfceDoPedido'));
  const doPedido = servidor.slice(servidor.indexOf('async function emitirNfceDoPedido'), servidor.indexOf('// Usado tanto pela resposta síncrona da emissão'));
  check('a rota existe e pede a permissão de emitir', /pathname === '\/api\/fiscal\/nfce\/emitir'\) return 'emitir'/.test(servidor) && /pathname === '\/api\/fiscal\/nfce\/emitir' && req\.method === 'POST'/.test(servidor));
  check('o modelo vem da ROTA: a rota de NF-e não passa modelo', /const nfe = await emitirNfeFiscal\(body, user\);/.test(servidor));
  check('a NFC-e sai do pedido salvo, com modelo 65', /emitirNfeFiscal\(montarNfeDoPedido\(pedido, estabelecimentoId, data\), user, \{ modelo: 65 \}\)/.test(doPedido));
  check('transferência e remessa são recusadas', /ehMovimentacaoInterna\(pedido\.category\)/.test(doPedido));
  // A autorização fatura o pedido, e faturar recusa estoque insuficiente: sem
  // conferir ANTES, a nota sairia e o pedido ficaria sem faturar.
  const doPedidoInteiro = servidor.slice(servidor.indexOf('async function emitirNfceDoPedido'), servidor.indexOf('async function emitirNfceDoPedido') + 4000);
  check('o estoque é conferido ANTES de transmitir',
    /if \(!salesStatus\.baixaEstoque\(pedido\.status\)\)[\s\S]{0,1600}Estoque insuficiente[\s\S]{0,600}return emitirNfeFiscal\(/.test(doPedidoInteiro));
  check('o estabelecimento precisa ter "Emite NFC-e"', /nfce \? estabelecimento\.emiteNfce : estabelecimento\.emiteNfe/.test(preparar));
  check('contribuinte é recusado (vai em NF-e)', /if \(nfce\) \{[\s\S]{0,400}destinatario\.contribuinte/.test(preparar));
  check('frete, seguro e despesa acessória são recusados', /nfce && \(Number\(body\.frete/.test(preparar));
  check('a regra fiscal é a de dentro do estado, sem contribuinte', /const dentroDoEstado = nfce \|\|/.test(preparar) && /destinatarioContribuinte: nfce \? false/.test(preparar));
  check('o endereço do consumidor não é cobrado', /nfce \? null : conferirDestinatarioDaNota\(payload\)/.test(preparar));
  check('o rascunho grava o modelo', /createNfeRascunho\(\{[\s\S]{0,120}modelo,/.test(emitir));
  check('transmite por /nfce', /nfce \? await client\.emitirNfce\(referencia, payload\)/.test(emitir));
  check('a falta de CSC vira instrução, não só o código da Focus', /explicarErroDaNfce\(erroDaFocus\)/.test(emitir) && /SEF\/SC/.test(servidor));
  check('NFC-e não tem Carta de Correção', /String\(nfe\.modelo\) === '65'\) \{\s*const err = new Error\('NFC-e não tem Carta de Correção/.test(servidor));
  check('a reconsulta usa o endpoint da NFC-e', /client\.consultarNfce\(nfe\.referencia\)/.test(servidor));
  check('o DANFCe (HTML) é servido isolado', /'Content-Security-Policy': 'sandbox/.test(servidor));
  check('a lista diz o modelo de cada nota', /modelo: Number\(nfe\.modelo \|\| 55\)/.test(servidor));

  console.log('\n--- 7. a tela ---');
  const acoes = ler('public/modules/shared/sales_record_actions.js');
  check('o pedido tem a ação "Emitir NFC-e"', /id: 'emitir_nfce', label: 'Emitir NFC-e'/.test(acoes) && /run: \(ctx\) => ctx\.emitirNfce\(\)/.test(acoes));
  check('  sem exigir faturamento antes (a NFC-e é que fatura)', !/emitir_nfce[\s\S]{0,700}jaBaixouEstoque/.test(acoes.slice(acoes.indexOf("id: 'emitir_nfce'"), acoes.indexOf("id: 'emitir_nfce'") + 700)));
  const app = ler('public/app.js');
  check('a tela chama a rota da NFC-e com o pedido e a loja', /'\/api\/fiscal\/nfce\/emitir'[\s\S]{0,200}orderId: editRecord\.id, estabelecimentoId/.test(app));
  check('  e só oferece loja marcada "Emite NFC-e"', /lojas = \(r\.estabelecimentos \|\| \[\]\)\.filter\(\(e\) => e\.ativo && e\.emiteNfce\)/.test(app));
  check('o DANFCe abre pelo visualizador isolado', /window\.MavisDanfe\.mostrar\(janela/.test(app) && /sandbox', 'allow-same-origin allow-modals'/.test(ler('public/modules/shared/abrir_danfe.js')));
  check('o visualizador está na página', /\/modules\/shared\/abrir_danfe\.js/.test(ler('public/index.html')));
  const acoesNota = ler('public/modules/finance/nfe_actions.js');
  check('na lista de notas, o cancelamento usa o prazo do modelo', /regra\.avaliar\(ctx\.nfe\.autorizadoEm, null, ctx\.nfe\.modelo\)/.test(acoesNota));
  check('  e a NFC-e não oferece extemporâneo nem Carta de Correção', /NFC-e não tem cancelamento extemporâneo/.test(acoesNota) && /NFC-e não tem Carta de Correção/.test(acoesNota));

  // A EMISSÃO DE VERDADE não é provada aqui. Ela depende do CSC cadastrado na
  // Focus para o estabelecimento, e o caminho é emitir em HOMOLOGAÇÃO: o
  // estabelecimento em "Homologação", com o token de homologação, e o pedido
  // de teste — como foi feito com a primeira NF-e em 14/08/2026.
  console.log(falhas ? `\n===== ${falhas} CHECK(S) FALHARAM =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})();
