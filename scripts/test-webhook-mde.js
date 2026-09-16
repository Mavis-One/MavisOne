#!/usr/bin/env node
// O WEBHOOK DA AUTOMAÇÃO MD-e (ciência automática) da Focus NFe.
//
// A Focus dá ciência na SEFAZ pelas notas emitidas contra o nosso CNPJ e avisa
// por POST. O payload usado aqui é o da documentação dela, campo por campo —
// não um exemplo inventado. É esse o ponto do teste: com integração que a gente
// não controla, o perigo não é o erro que estoura, é o campo que chega vazio.
//
// O que se protege, em ordem de estrago:
//
//   1. `documento_emitente`. O código adivinhava 'cnpj_emitente' e a Focus manda
//      outro nome — a nota entrava com o emitente EM BRANCO, sem erro nenhum.
//   2. A chave vem prefixada ('NFe...') e a coluna é character(44): chave curta
//      seria completada com espaços pelo Postgres e nunca mais casaria.
//   3. `nfe_completa: true` NÃO é o XML. Prometer 'completo' sem o documento
//      faria a tela oferecer ações que dependem dele.
//   4. A manifestação registrada foi feita pela Focus, não por alguém daqui — e
//      um reenvio do aviso não pode apagar a que uma pessoa fez.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const focus = require('../lib/focusnfe');
const manifestacao = require('../public/modules/shared/manifestacao');

// Payload da documentação da Focus, com uma chave de 44 dígitos de verdade no
// lugar do placeholder (o exemplo da doc traz 39 zeros — ver o caso 2).
const CHAVE_44 = '42260843792899000135550010000000011580908821';
const PAYLOAD_MDE = {
  nome_emitente: 'Nome do Emitente',
  documento_emitente: '12345678000199',
  chave_nfe: `NFe${CHAVE_44}`,
  valor_total: '1.00',
  data_emissao: '2023-01-01T00:00:00-03:00',
  situacao: 'autorizada',
  manifestacao_destinatario: 'ciencia',
  nfe_completa: true,
  tipo_nfe: '1',
  versao: 1,
  digest_value: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  cnpj_destinatario: '11222333000181',
  cpf_destinatario: ''
};

console.log('--- 1. o payload da Focus é traduzido inteiro ---');
const aviso = focus.normalizarMdeAutomacao(PAYLOAD_MDE);
check('o CNPJ do emitente NÃO chega vazio', aviso.documento.emitenteDocumento === '12345678000199', aviso.documento.emitenteDocumento);
check('o nome do emitente vem junto', aviso.documento.emitenteNome === 'Nome do Emitente');
check('a chave perde o prefixo NFe e fica com 44 dígitos',
  aviso.documento.chave === CHAVE_44 && aviso.documento.chave.length === 44, aviso.documento.chave.length);
check('o valor vira número', aviso.documento.valorTotal === 1);
check('a data é preservada', aviso.documento.dataEmissao === '2023-01-01T00:00:00-03:00');
check('o destinatário é o nosso CNPJ', aviso.destinatarioDocumento === '11222333000181');
check('a manifestação da Focus é relatada', aviso.manifestacao === 'ciencia');
check('e a situação também', aviso.situacao === 'autorizada');

console.log('\n--- 2. o que a doc NÃO garante não é inventado ---');
check('sem XML no payload, o documento é resumo', aviso.documento.tipoDocumento === 'resumo', aviso.documento.tipoDocumento);
check('nfe_completa é relatado à parte, sem virar "completo"', aviso.notaCompletaDisponivel === true);
check('o XML fica nulo', aviso.documento.xml === null);
// O aviso não traz NSU. Zero é "chegou por aviso, não pela varredura" — e o
// ponteiro de NSU não pode ser movido por ele.
check('NSU é 0 (o aviso não tem NSU)', aviso.documento.nsu === 0);
check('o payload cru viaja junto, para o resumo jsonb', aviso.documento.bruto === PAYLOAD_MDE);

console.log('\n--- 3. o catálogo traduz a ciência da Focus ---');
check("'ciencia' vira o código 210210", manifestacao.codigoDe(aviso.manifestacao) === '210210');
check('e ciência NÃO dá entrada no estoque', manifestacao.geraEntrada('ciencia') === false);

console.log('\n--- 4. o alias confirmado entrou sem derrubar os palpites ---');
check('documento_emitente é o primeiro da lista', focus.CAMPOS_DFE.emitenteDocumento[0] === 'documento_emitente');
check('cnpj_emitente continua aceito (o GET /dfe pode falar diferente)',
  focus.CAMPOS_DFE.emitenteDocumento.includes('cnpj_emitente'));
check('o normalizador da varredura também enxerga o nome novo',
  focus.normalizarDocumento({ documento_emitente: '99888777000166', chave_nfe: CHAVE_44 }).emitenteDocumento === '99888777000166');

console.log('\n--- 5. a porta: autenticada, separada e fora do gate de sessão ---');
const serverSrc = ler('server.js');
const permissoes = require('../lib/permissoes');
check('a rota é pública para o portão (quem autentica é o segredo)',
  permissoes.rotaPublica('/api/fiscal/webhooks/focus/mde') === true);
check('e não exige sessão', permissoes.exigeSessao('/api/fiscal/webhooks/focus/mde') === false);
check('rota própria, sem tocar na do webhook de emissão',
  /pathname === '\/api\/fiscal\/webhooks\/focus\/mde' && req\.method === 'POST'/.test(serverSrc)
  && /pathname === '\/api\/fiscal\/webhooks\/focus' && req\.method === 'POST'/.test(serverSrc));
check('aceita o header Authorization que a automação usa', /req\.headers\.authorization/.test(serverSrc));
check('e continua aceitando o X-Fiscal-Webhook-Secret do outro hook', /x-fiscal-webhook-secret'\] \|\| authorization/.test(serverSrc));
check('a comparação do segredo é a de tempo constante', /segredosIguais\(recebido, secretEsperado\)/.test(serverSrc));

console.log('\n--- 6. o que não dá para resolver não vira retentativa eterna ---');
check('CNPJ desconhecido responde sucesso, não erro', /ignorado: true, motivo: 'CNPJ destinat/.test(serverSrc));
check('chave fora de 44 dígitos é recusada antes de gravar', /aviso\.documento\.chave\.length !== 44/.test(serverSrc));

console.log('\n--- 7. a manifestação registrada diz a verdade sobre quem manifestou ---');
check('o nome gravado é o da automação', /usuarioNome: 'Ciência automática \(Focus NFe\)'/.test(serverSrc));
check('sem usuário, porque não houve pessoa', /usuarioId: null/.test(serverSrc));
check('não sobrescreve manifestação existente', /!atual\.manifestacaoCodigo/.test(serverSrc));
check('evento fora do catálogo não vira código inventado na coluna', /if \(!conhecido\)/.test(serverSrc));

console.log('\n--- 8. a busca manual da mesma tela não usa variável inexistente ---');
// A rota /api/fiscal/dfe/buscar lia `empresa.cnpj` num escopo onde só existe
// `estabelecimento` — ReferenceError antes de qualquer consulta, e um 500 mudo
// na tela. O webhook alimenta a MESMA lista, então os dois caminhos precisam
// funcionar para a tela contar a mesma história.
check('a busca usa o estabelecimento encontrado', !/String\(empresa\.cnpj/.test(serverSrc));
check('e o nome da empresa vem dele também', !/empresa\.razaoSocial \|\| empresa\.nomeFantasia/.test(serverSrc));

console.log('\n--- 9. o webhook de NF-e emitida continua como estava ---');
// O outro payload da Focus, o da nota que NÓS emitimos. Ele já era tratado; o
// que este teste garante é que a porta nova não mexeu nele.
check('a chave prefixada da emissão continua sendo limpa', /chaveAcesso: String\(resposta\.chave_nfe \|\| ''\)\.replace\(\/\\D\/g, ''\)/.test(serverSrc));
check('e o status "autorizado" continua mapeado', /autorizado: 'AUTORIZADO'/.test(serverSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
