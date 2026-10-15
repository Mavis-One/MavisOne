#!/usr/bin/env node
/**
 * O NÚMERO DO PEDIDO NO RODAPÉ DA NOTA (15/10/2026). Pedido do usuário:
 * "preciso que o número do pedido seja colocado no rodapé da NF
 * automaticamente".
 *
 * Toda nota que sai de um pedido — NF-e e NFC-e, pela tela, pela prévia da
 * DANFE ou reenviada — leva "PEDIDO: <código>" na frente das informações
 * complementares (o quadro "Dados adicionais" da DANFE). Quem põe é o montador
 * do payload, com o código que o servidor lê do próprio pedido. Não repete
 * quando o texto já traz o número: a nota corrigida reaproveita o rodapé da
 * anterior.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const RAIZ = path.join(__dirname, '..');
const T = require(path.join(RAIZ, 'public/modules/shared/nfe_texto_padrao.js'));
const { buildNfePayload, buildNfcePayload, conferirLimitesDeTexto } = require(path.join(RAIZ, 'lib/nfePayloadBuilder'));

console.log('\n--- a linha do pedido ---');
check('código vira "PEDIDO: <código>"', T.linhaDoPedido('14757') === 'PEDIDO: 14757');
check('sem pedido, nada', T.linhaDoPedido('') === '' && T.linhaDoPedido(null) === '');
check('não repete o que o texto já traz',
  ['PEDIDO: 14757 | FABRICANTE: MAVIS', 'Pedido nº 14757', 'PEDIDO N° 14757', 'pedido 14757.'].every((t) => T.linhaDoPedido('14757', t) === ''));
check('  mas outro número não conta', T.linhaDoPedido('14757', 'PEDIDO: 147570') === 'PEDIDO: 14757'
  && T.linhaDoPedido('14757', 'CHASSI: 14757') === 'PEDIDO: 14757');

console.log('\n--- na NF-e ---');
const ESTAB = {
  cnpj: '43792899000135', razaoSocial: 'Loja Teste', logradouro: 'Rua A', numero: '1',
  bairro: 'Centro', municipio: 'Jaraguá do Sul', uf: 'SC', cep: '89251000', codigoMunicipio: '4208906'
};
const item = () => ({
  descricao: 'Bicicleta elétrica', codigoProduto: 'SKU1', ncm: '87116000', quantidade: 1, valorUnitario: 1500,
  unidadeComercial: 'UN', origem: 0, regraFiscal: { cfop: '5102', cstIcms: '00', aliquotaIcms: 17 }
});
const nfe = (extra) => buildNfePayload({
  estabelecimento: ESTAB, empresa: { crt: 1, regimeTributario: 'SIMPLES_NACIONAL' },
  destinatario: { nome: 'Cliente Teste Ltda', documento: '11122233344', uf: 'SC', contribuinte: false },
  itens: [item()], naturezaOperacao: 'Venda', dataEmissao: '2026-10-15T10:00:00-03:00',
  informacoesAdicionais: 'FABRICANTE: MAVIS\nCHASSI: ABC123', ...extra
}).informacoes_adicionais_contribuinte;
check('produção: o pedido vem primeiro', nfe({ ambiente: 'producao', numeroDoPedido: '14757' }) === 'PEDIDO: 14757 | FABRICANTE: MAVIS | CHASSI: ABC123',
  nfe({ ambiente: 'producao', numeroDoPedido: '14757' }));
check('homologação: pedido, texto e o aviso de teste no fim',
  /^PEDIDO: 14757 \| FABRICANTE: MAVIS \| CHASSI: ABC123 \| TESTE EM HOMOLOGACAO/.test(nfe({ ambiente: 'homologacao', numeroDoPedido: '14757' })));
check('nota sem pedido não muda', nfe({ ambiente: 'producao' }) === 'FABRICANTE: MAVIS | CHASSI: ABC123');
check('sem texto, só o pedido', nfe({ ambiente: 'producao', numeroDoPedido: '14757', informacoesAdicionais: '' }) === 'PEDIDO: 14757');
check('nota corrigida (rodapé já com o pedido) não duplica',
  nfe({ ambiente: 'producao', numeroDoPedido: '14757', informacoesAdicionais: 'PEDIDO: 14757 | FABRICANTE: MAVIS' }) === 'PEDIDO: 14757 | FABRICANTE: MAVIS');

console.log('\n--- na NFC-e ---');
const nfce = buildNfcePayload({
  estabelecimento: ESTAB, destinatario: {}, itens: [item()], naturezaOperacao: 'VENDA AO CONSUMIDOR',
  dataEmissao: '2026-10-15T10:00:00-03:00', ambiente: 'producao', informacoesAdicionais: 'OBRIGADO', numeroDoPedido: '16020'
}).informacoes_adicionais_contribuinte;
check('também leva o pedido', nfce === 'PEDIDO: 16020 | OBRIGADO', nfce);

console.log('\n--- o limite de 5000 conta a linha ---');
check('o orçamento desconta a linha e o separador',
  T.orcamentoDoRodape({ ambiente: 'producao', linhaDoPedido: 'PEDIDO: 14757' }) === T.LIMITE_INFCPL - 'PEDIDO: 14757'.length - T.SEPARADOR_RODAPE.length);
check('  e soma com o aviso da homologação',
  T.orcamentoDoRodape({ ambiente: 'homologacao', destinatarioNome: 'A', linhaDoPedido: 'PEDIDO: 1' })
  === T.orcamentoDoRodape({ ambiente: 'homologacao', destinatarioNome: 'A' }) - 'PEDIDO: 1'.length - T.SEPARADOR_RODAPE.length);
const cheio = 'x'.repeat(T.LIMITE_INFCPL - 5);
const payloadCheio = { informacoes_adicionais_contribuinte: nfe({ ambiente: 'producao', numeroDoPedido: '14757', informacoesAdicionais: cheio }), items: [] };
const erro = conferirLimitesDeTexto(payloadCheio, { informacoesAdicionais: cheio });
check('texto que sozinho cabe, mas não com o pedido, é barrado antes de transmitir', /número do pedido/.test(erro), erro);

console.log('\n--- o servidor manda o código do pedido ---');
const server = semComentarios(fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8'));
check('lê o código do pedido da nota', /codigoDoPedido = pedido \? String\(pedido\.code \|\| ''\) : '';/.test(server));
check('  e passa aos dois montadores', (server.match(/numeroDoPedido: codigoDoPedido/g) || []).length === 2);
const tela = semComentarios(fs.readFileSync(path.join(RAIZ, 'public/modules/finance/subs/emitir_nfe_focus.js'), 'utf8'));
check('o contador da tela desconta a linha', /linhaDoPedido: linhaDoPedidoNoRodape\(\)/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
