#!/usr/bin/env node
/**
 * A DESCRIÇÃO, O MOTIVO DO CANCELAMENTO E O CAMPO DOCUMENTO (fases AX e AY).
 *
 * Roda no `npm test`: o catálogo é função pura, e o resto se mede lendo a
 * fonte — o comportamento de rede tem verificação contra a API quando há
 * servidor no ar.
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * 1. AS QUATRO ORIGENS ESCREVEM A MESMA FRASE. Pedido faturado, ordem de
 *    compra, entrada de NF-e e NF-e avulsa escreviam cada uma o seu formato,
 *    com três separadores diferentes e duas grafias de parcela. Nenhuma dizia
 *    se a linha era dinheiro entrando ou saindo.
 *
 * 2. A DISPENSA APARECE ONDE O DINHEIRO ESTÁ. A fase AV passou a registrar o
 *    motivo da dispensa no PEDIDO; quem concilia o recebimento abre o
 *    Financeiro. Sem "Sem NF-e (dispensada)" na descrição, a parcela sem nota é
 *    idêntica à que ainda não teve a nota resolvida.
 *
 * 3. CANCELAR EXIGE MOTIVO. Era um clique e um "confirma?". Um lançamento
 *    cancelado de R$ 8.400 sem explicação é indistinguível de erro, de venda
 *    desfeita e de cobrança abandonada.
 *
 * 4. A COLUNA "CÓDIGO" MOSTRA O NÚMERO. Ela mostrava os oito últimos caracteres
 *    do id interno — o erro que este teste encontrou. Ver a seção 4.
 *
 * 5. O CAMPO DOCUMENTO COMEÇA COM LF{número} (fase AY) E NÃO PERDE o documento
 *    externo que já estava lá. O número da NF-e e a chave de acesso de 44
 *    dígitos são o único lugar onde a ligação com a nota do fornecedor está
 *    escrita; substituí-los pelo LF apagaria essa ligação. Ver as seções 10-13.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const descricao = require('../public/modules/shared/descricao_lancamento');
const { parcelasDoPedido } = require('../lib/vendas-financeiro');

console.log('--- 1. o catálogo monta a frase ---');
check('receita de venda com pedido e nota',
  descricao.montar({ qual: 'receita', tipo: 'venda', pedido: '1042', nota: '123' })
    === 'Receita de venda · Pedido 1042 · NF-e 123',
  descricao.montar({ qual: 'receita', tipo: 'venda', pedido: '1042', nota: '123' }));
check('despesa de compra com ordem',
  descricao.montar({ qual: 'despesa', tipo: 'compra', ordem: 'OC0007' })
    === 'Despesa de compra · Ordem OC0007',
  descricao.montar({ qual: 'despesa', tipo: 'compra', ordem: 'OC0007' }));
// "Transferencia de transferencia" e' o que sairia com o complemento.
check('transferência não ganha complemento',
  descricao.montar({ qual: 'transferencia', tipo: 'transferência' }) === 'Transferência',
  descricao.montar({ qual: 'transferencia', tipo: 'transferência' }));
check('o que não vem não aparece',
  descricao.montar({ qual: 'receita', tipo: 'venda' }) === 'Receita de venda',
  descricao.montar({ qual: 'receita', tipo: 'venda' }));
check('nada em branco vira string vazia', descricao.montar({}) === '');

console.log('\n--- 2. parcela só quando é parcelamento ---');
// "Parcela 1/1" e' ruido: uma parcela so nao e' parcelamento.
check('1/1 não aparece',
  !/Parcela/.test(descricao.montar({ qual: 'receita', parcela: 1, parcelas: 1 })));
check('1/3 aparece',
  /Parcela 1\/3/.test(descricao.montar({ qual: 'receita', parcela: 1, parcelas: 3 })));

console.log('\n--- 3. a dispensa aparece no financeiro ---');
const pedidoDispensado = {
  code: '1042',
  date: '2026-09-03',
  totalAmount: 500,
  dispensaDocumentoFiscal: true,
  payments: []
};
const semNota = parcelasDoPedido(pedidoDispensado, new Map());
check('pedido faturado sem nota diz que foi dispensada',
  /Sem NF-e \(dispensada\)/.test(semNota[0].description), semNota[0].description);
const comNota = parcelasDoPedido(pedidoDispensado, new Map(), { nfeNumero: '77' });
// A nota VENCE a dispensa: existindo numero, e' o numero que importa.
check('  e some quando a nota chega',
  /NF-e 77/.test(comNota[0].description) && !/dispensada/.test(comNota[0].description),
  comNota[0].description);

console.log('\n--- 4. as parcelas do pedido usam o catálogo ---');
const pedido = {
  code: '1042',
  date: '2026-09-03',
  totalAmount: 300,
  payments: [
    { amount: 100, methodName: 'Dinheiro' },
    { amount: 100, methodName: 'Boleto' },
    { amount: 100, methodName: 'Boleto' }
  ]
};
const tres = parcelasDoPedido(pedido, new Map(), { nfeNumero: '000000123' });
check('a primeira parcela diz tudo',
  tres[0].description === 'Receita de venda · Pedido 1042 · NF-e 000000123 · Parcela 1/3 · Dinheiro',
  tres[0].description);
check('  e as três somam o total',
  tres.reduce((s, p) => s + p.amount, 0) === 300);
// A diferenca continua existindo — e agora tambem diz de onde veio.
const faltando = parcelasDoPedido(
  { code: '9', date: '2026-09-03', totalAmount: 300, payments: [{ amount: 100 }] },
  new Map()
);
check('a linha de diferença mantém o complemento',
  faltando.some((p) => /Diferença não coberta/.test(p.description) && /Receita de venda/.test(p.description)),
  faltando.map((p) => p.description).join(' | '));

console.log('\n--- 5. as quatro origens passam pelo catálogo ---');
const servidor = ler('server.js');
const usos = (servidor.match(/descricaoLancamento\.montar\(/g) || []).length;
check('server.js monta descrição pelo catálogo em 3 origens', usos === 3, `${usos} usos`);
check('  nenhuma origem escreve "Ordem de Compra " + code na descrição',
  !/description: 'Ordem de Compra ' \+/.test(servidor));
check('  nem "NF-e ${nota.numero} — "',
  !/description: `NF-e \$\{nota\.numero\} —/.test(servidor));
const vendas = ler('lib/vendas-financeiro.js');
check('as parcelas do pedido também', /descricao\.montar\(/.test(vendas));

console.log('\n--- 6. cancelar exige motivo ---');
check('a rota cobra o mínimo de 10 caracteres',
  /motivo\.length < 10/.test(servidor) && /Informe o motivo do cancelamento/.test(servidor));
check('  e grava as três colunas',
  /cancelReason: motivo/.test(servidor)
  && /cancelledAt: agora/.test(servidor)
  && /cancelledByName: user\.name/.test(servidor));
// Cancelar duas vezes sobrescreveria o motivo do primeiro cancelamento.
check('  e recusa cancelar o que já está cancelado',
  /Este lançamento já está cancelado/.test(servidor));
check('o motivo volta para a tela', /cancelReason: entry\.cancelReason/.test(servidor));

const dadosFin = ler('lib/db/financeiro.js');
check('o mapper lê cancel_reason', /cancelReason: row\.cancel_reason/.test(dadosFin));
check('o update grava cancel_reason', /row\.cancel_reason = payload\.cancelReason/.test(dadosFin));
const migracao = ler('banco/migrations/fase-ax-motivo-do-cancelamento.sql');
check('a migração cria as três colunas',
  /add column if not exists cancel_reason text/.test(migracao)
  && /add column if not exists cancelled_at timestamptz/.test(migracao)
  && /add column if not exists cancelled_by_name text/.test(migracao));

console.log('\n--- 7. a tela ---');
const telaLanc = ler('public/modules/finance/subs/lancamentos.js');
// O CHECK QUE ENCONTROU UM ERRO REAL: a coluna "Codigo" mostrava
// String(entry.id).slice(-8) — pedaco de uuid. A fase AT criou o numero do
// lancamento e ligou so o titulo da tela de edicao.
check('a coluna Código mostra o número do lançamento',
  /<td>\$\{escapeHtml\(entry\.codigo \|\| '-'\)\}<\/td>/.test(telaLanc));
check('  e não mais um pedaço do id interno',
  !/escapeHtml\(String\(entry\.id\)\.slice\(-8\)\)/.test(telaLanc));
check('cancelar abre o promptModal com mínimo 10',
  /promptModal\(\{[\s\S]*?minimo: 10/.test(telaLanc));
check('  e manda o motivo no corpo',
  /body: JSON\.stringify\(\{ motivo \}\)/.test(telaLanc));
check('o modal mostra o motivo do cancelamento',
  /entry\.cancelReason/.test(telaLanc) && /Motivo não registrado/.test(telaLanc));
check('o catálogo é carregado pelo navegador',
  /modules\/shared\/descricao_lancamento\.js/.test(ler('public/index.html')));

console.log('\n--- 8. a nota que chega depois do faturamento ---');
// Pedido faturado com dispensa (SEFAZ fora) + nota no dia seguinte: as parcelas
// ja existem dizendo "Sem NF-e (dispensada)", que passa a ser mentira.
check('existe o gancho que completa a descrição',
  /async function anotarNotaNoFinanceiroDoPedido/.test(servidor));
check('  chamado quando o pedido já estava faturado',
  /podeTransicionar\(pedido\.status, 'pedido-faturado'\)\) \{[\s\S]*?anotarNotaNoFinanceiroDoPedido/.test(servidor));
// SO REESCREVE O QUE ELE MESMO ESCREVEU: comparar com o texto que este codigo
// produziria e' o que protege a descricao editada a mao.
check('  e só reescreve o texto que ele mesmo gerou',
  /p\.description === entry\.description/.test(servidor));

console.log('\n--- 9. o número da nota chega às parcelas ---');
check('o faturamento resolve o número da nota',
  /nfeNumero: await numeroDaNotaDoPedido\(data, record\)/.test(servidor));
// ERRO CORRIGIDO: syncNfeData so populava data.nfes (manual). O serializer do
// pedido procura em data.nfe (fiscal) primeiro — e ela vinha sempre vazia.
check('syncNfeData popula as DUAS tabelas de NF-e',
  /data\.nfes = manuais;/.test(servidor) && /data\.nfe = fiscais;/.test(servidor));

console.log('\n--- 10. o campo Documento comeca com LF (fase AY) ---');
const codigoLanc = require('../public/modules/shared/lancamento_codigo');
check('prefixa sem apagar o documento externo',
  codigoLanc.documento(42, '000000123') === 'LF0042 \u00b7 000000123',
  codigoLanc.documento(42, '000000123'));
check('sem documento externo, so o numero',
  codigoLanc.documento(42, '') === 'LF0042', codigoLanc.documento(42, ''));
// Reeditar e salvar o texto inteiro nao pode virar "LF0042 . LF0042 . 123".
check('nunca duplica o prefixo',
  codigoLanc.documento(42, 'LF0042 \u00b7 000000123') === 'LF0042 \u00b7 000000123',
  codigoLanc.documento(42, 'LF0042 \u00b7 000000123'));
check('lancamento sem numero devolve so o externo',
  codigoLanc.documento(null, '123') === '123', codigoLanc.documento(null, '123'));
// A chave de acesso tem 44 digitos e e' o que liga a conta a pagar a nota.
const CHAVE = '42260812345678000199550010000001231000001238';
check('a chave de acesso sobrevive inteira',
  codigoLanc.documento(7, CHAVE).endsWith(CHAVE), codigoLanc.documento(7, CHAVE));

console.log('\n--- 11. o caminho de volta (a tela de edicao) ---');
check('tira o prefixo para o campo',
  codigoLanc.referencia(42, 'LF0042 \u00b7 000000123') === '000000123',
  codigoLanc.referencia(42, 'LF0042 \u00b7 000000123'));
check('so o numero vira campo vazio',
  codigoLanc.referencia(42, 'LF0042') === '', `"${codigoLanc.referencia(42, 'LF0042')}"`);
check('ida e volta nao perde nada',
  codigoLanc.referencia(42, codigoLanc.documento(42, CHAVE)) === CHAVE);
// O lpad do Postgres TRUNCA; o padStart do JS nao. Os dois geram o MESMO campo,
// entao a partir de LF10000 eles discordariam — "LF1000" e' outro lancamento.
check('acima de 9999 nao trunca',
  codigoLanc.documento(10000, 'x') === 'LF10000 \u00b7 x', codigoLanc.documento(10000, 'x'));

console.log('\n--- 12. o prefixo e gravado, nao so desenhado ---');
const dadosFin2 = ler('lib/db/financeiro.js');
check('a criacao monta o documento pelo catalogo',
  /document: lancamentoCodigo\.documento\(code, payload\.document/.test(dadosFin2));
// Sem isto, o usuario apagaria o prefixo no campo e ele nao voltaria.
const reaplica = (servidor.match(/entry\.document = lancamentoCodigo\.documento\(entry\.code, body\.document\)/g) || []).length;
check('a edicao reaplica o prefixo nas DUAS metades da rota PUT', reaplica === 2, `${reaplica} lugar(es)`);
const telaNovo = ler('public/modules/finance/subs/novo_lancamento.js');
check('a tela mostra o prefixo ao lado, e nao dentro do campo',
  /finance-documento-prefixo/.test(telaNovo)
  && /MavisLancamentoCodigo\.referencia\(editEntry\.code, editEntry\.document\)/.test(telaNovo));
check('  e o estilo existe', /\.finance-documento-prefixo/.test(ler('public/app.css')));

console.log('\n--- 13. a migracao da fase AY ---');
const migAy = ler('banco/migrations/fase-ay-documento-e-descricao-padronizados.sql');
check('numera quem ficou sem numero', /set code = nextval\('financial_entries_code_seq'\)/.test(migAy));
// lpad(x, 4) TRUNCA no Postgres: LF10000 viraria LF1000.
check('o lpad nao trunca acima de 9999',
  /lpad\(code::text, greatest\(4, length\(code::text\)\), '0'\)/.test(migAy));
check('rodar duas vezes nao duplica o prefixo',
  /not like n\.codigo \|\| ' \u00b7 %'/.test(migAy));
check('  nem a natureza na descricao',
  (migAy.match(/!~ '\^\(Receita\|Despesa\|Transfer\u00eancia\) '/g) || []).length === 2);
// Descricao digitada por gente nao e' do sistema para reescrever.
check('so reescreve descricao de lancamento vinculado',
  (migAy.match(/coalesce\(reference_id, ''\) <> '' or coalesce\(nfe_id, ''\) <> ''/g) || []).length === 2);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
