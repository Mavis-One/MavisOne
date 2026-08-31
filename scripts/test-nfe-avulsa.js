#!/usr/bin/env node
// NF-e AVULSA: nota emitida SEM pedido de origem.
//
// O QUE ISTO GUARDA
// -----------------
// Existiam duas telas com o mesmo propósito, e a que tinha o nome certo era a
// que NÃO emitia: "Nova NF-e Avulsa" gravava um registro local e nunca chegava
// à SEFAZ. Quem a usasse acharia que emitiu. Pior: o "Gerar NF-e" a partir de
// um pedido caía nela também — o pedido ficava faturado e a nota não existia
// para o fisco.
//
// E o risco que a correção introduz: RECEBÍVEL EM DOBRO. Quando a nota vem de
// um pedido, quem gerou o contas a receber foi o pedido. Gerar de novo na
// autorização da nota duplicaria o valor, e ninguém percebe até a conciliação
// não fechar.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

const serverSrc = ler('server.js');
const focusSrc = ler('public/modules/finance/subs/emitir_nfe_focus.js');
const listaSrc = ler('public/modules/finance/subs/nfe_emitidas.js');
const migracao = ler('banco/migrations/fase-aa-nfe-lista-unificada.sql');
const appSrc = ler('public/app.js');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log('--- "Nova NF-e Avulsa" é a tela que EMITE ---');
// Aliás, não cópia: uma cópia divergiria na primeira correção feita só de um lado.
check('avulsa aponta para a tela de emissão',
  /finance\.nova_nfe_avulsa\s*=\s*\n?\s*window\.MavisSubscreenRegistry\.finance\.emitir_nfe_focus/.test(focusSrc));
// Antes, quem vencia era decidido pela ORDEM DE CARGA: a tela que não emitia
// registrava primeiro e o apelido sobrescrevia logo depois. Funcionava, mas
// dependia de duas linhas do index.html continuarem nessa ordem — e deixava um
// arquivo inteiro carregando para nunca ser usado. O arquivo foi apagado; o
// que o teste cobra agora é mais forte que ordem: registro ÚNICO.
const indexSrc = ler('public/index.html');
check('o arquivo da tela que não emitia não existe mais',
  !fs.existsSync(path.join(RAIZ, 'public/modules/finance/subs/nova_nfe_avulsa.js')));
check('e não é mais carregado no index', !indexSrc.includes('subs/nova_nfe_avulsa.js'));
const registros = [...fs.readdirSync(path.join(RAIZ, 'public/modules/finance/subs'))]
  .filter((n) => n.endsWith('.js'))
  .map((n) => fs.readFileSync(path.join(RAIZ, 'public/modules/finance/subs', n), 'utf8'))
  .join('\n')
  .match(/MavisSubscreenRegistry\.finance\.nova_nfe_avulsa\s*=/g) || [];
check('só existe UM registro de finance.nova_nfe_avulsa', registros.length === 1, `${registros.length} registro(s)`);
check('a tela de emissão chama a rota fiscal', /api\('\/api\/fiscal\/nfe\/emitir'/.test(focusSrc));

console.log('\n--- emitir sem pedido é o caso normal, não a exceção ---');
// A rota nunca exigiu pedido: só destinatário e itens. Se um dia passar a
// exigir, a NF-e avulsa morre em silêncio.
// Termina no gerador, que fica logo antes de aplicarRespostaFocusNaNfe: sem
// isso o recorte engoliria a definição dele e o teste abaixo se enganaria.
const emissao = serverSrc.slice(serverSrc.indexOf('async function emitirNfeFiscal'), serverSrc.indexOf('async function gerarFinanceiroDaNfeAvulsa'));
check('a emissão não exige orderId', !/if \(!body\.orderId/.test(emissao) && !/orderId.*obrigat/i.test(emissao));
check('exige destinatário', /Preencha os dados do destinatário/.test(emissao));
check('exige ao menos um item', /Adicione ao menos um item/.test(emissao));

console.log('\n--- o financeiro NÃO pode sair em dobro ---');
// Duas razões para NÃO gravar a condição: a nota veio de um pedido (o
// financeiro é dele) ou a operação não gera financeiro nenhum (complemento de
// ICMS, transferência, bonificação).
check('condição de pagamento só é gravada sem pedido',
  /condicaoPagamento: \(body\.orderId \|\| body\.saleId\) \|\| !operacaoFiscal\.deveGerarFinanceiro\(\{ tipoOperacao \}\)/.test(serverSrc));
check('e só em operação que gera financeiro',
  /!operacaoFiscal\.deveGerarFinanceiro\(\{ tipoOperacao \}\)[\s\S]{0,60}\? null[\s\S]{0,60}: condicaoPagamentoDoBody\(body\)/.test(serverSrc));
const gerador = serverSrc.slice(serverSrc.indexOf('async function gerarFinanceiroDaNfeAvulsa'), serverSrc.indexOf('async function aplicarRespostaFocusNaNfe'));
check('o gerador desiste se a nota tem pedido', /if \(!nfe \|\| nfe\.orderId\) return 0;/.test(gerador));
check('e desiste sem condição de pagamento', /if \(!condicao\) return 0;/.test(gerador));
// A Focus reenvia webhook. Sem idempotência, cada reenvio criaria as parcelas de novo.
check('idempotente: não cria se já existe lançamento da nota',
  /some\(\(entry\) => entry\.nfeId === nfe\.id\)\) return 0/.test(gerador));
check('a tela avisa quando o financeiro é do pedido', /o contas a receber já é dele/.test(focusSrc));

console.log('\n--- o recebível só nasce quando a SEFAZ autoriza ---');
// Gerar na emissão deixaria contas a receber de nota rejeitada.
const aplicar = serverSrc.slice(serverSrc.indexOf('async function aplicarRespostaFocusNaNfe'), serverSrc.indexOf('async function baixarEGuardarArquivosNfe'));
check('a geração está dentro do bloco de AUTORIZADO', /novoStatus === 'AUTORIZADO'/.test(aplicar) && /gerarFinanceiroDaNfeAvulsa/.test(aplicar));
check('não é chamada na emissão', !/gerarFinanceiroDaNfeAvulsa/.test(emissao));
// Falhar ao gerar não pode desautorizar uma nota que já existe para a SEFAZ.
check('falha ao gerar não derruba a autorização', /catch \(error\) \{[\s\S]{0,120}Falha ao gerar o financeiro/.test(aplicar));
// A autorização pode chegar por webhook, sem usuário na tela.
check('funciona sem usuário (webhook)', /createdByName: user\?\.name \|\| 'Sistema \(webhook fiscal\)'/.test(serverSrc));
check('a condição fica gravada para o webhook montar as parcelas depois',
  /add column if not exists condicao_pagamento jsonb/.test(migracao));

console.log('\n--- a condição de pagamento é saneada ---');
const cond = serverSrc.slice(serverSrc.indexOf('function condicaoPagamentoDoBody'), serverSrc.indexOf('async function emitirNfeFiscal'));
check('parcelas entre 2 e 60', /Math\.min\(60, Math\.max\(2,/.test(cond));
check('intervalo mínimo de 1 dia', /Math\.max\(1, Number\(body\.installmentIntervalDays \|\| 30\)\)/.test(cond));
check('à vista é 1 parcela', /parcelado \? .* : 1/.test(cond));

console.log('\n--- o grupo de pagamento vai na nota ---');
// Obrigatório no layout 4.0: nota sem ele é rejeitada, e é a rejeição mais
// provável de uma primeira integração.
check('a tela envia pagamentos', /pagamentos: \[\{ forma: formData\.get\('formaPagamento'\)/.test(focusSrc));
check('tem aba de pagamento', /data-tab="pagamento"/.test(focusSrc));
check('formas oficiais declaradas', /const NFE_FORMAS_PAGAMENTO/.test(focusSrc));
// Códigos que o builder aceita; qualquer outro vira '99' sem ninguém saber.
const builderSrc = ler('lib/nfePayloadBuilder.js');
const daTela = [...focusSrc.matchAll(/\{ value: '(\d{2})', label:/g)].map((m) => m[1]);
check('a tela oferece ao menos 10 formas', daTela.length >= 10, daTela.join(','));
daTela.forEach((codigo) => {
  check(`  forma ${codigo} existe no builder`, new RegExp(`'${codigo}':`).test(builderSrc));
});

console.log('\n--- o pedido também passa a emitir de verdade ---');
// "Gerar NF-e" do pedido apontava para a tela que não emite.
check('o pedido continua mandando para nova_nfe_avulsa', /state\.activeSub = 'nova_nfe_avulsa'/.test(appSrc));
check('e a tela de emissão consome o pedido', /const doPedido = state\.nfeFromOrder \|\| null/.test(focusSrc));
// Sem o delete, o pedido reapareceria na próxima abertura da tela — seria a
// nota errada, com os itens de um pedido antigo.
check('o pedido é consumido para não reaparecer', /if \(doPedido\) delete state\.nfeFromOrder/.test(focusSrc));
check('e o orderId é enviado na emissão', /orderId: orderIdOrigem \|\| undefined/.test(focusSrc));
// NCM vem do cadastro do produto, no servidor: preencher com palpite faria a
// nota sair com classificação diferente da do produto.
check('não chuta NCM ao trazer os itens do pedido', /ncm: '',/.test(focusSrc));

console.log('\n--- duplicar deixou de ser um botão morto ---');
// state.financeDuplicateNfe era gravado e não era lido por tela nenhuma.
// Só o comentário que explica a troca pode citar o nome antigo — atribuição, não.
check('não grava mais o state morto', !/state\.financeDuplicateNfe\s*=/.test(listaSrc));
check('e nenhuma tela lê o nome antigo',
  !/state\.financeDuplicateNfe/.test(focusSrc) && !/state\.financeDuplicateNfe/.test(appSrc));
check('usa o canal de pré-preenchimento real', /state\.nfeFromOrder = \{/.test(listaSrc));
// Herdar o pedido da original faria a cópia não gerar contas a receber.
check('a duplicata nasce sem pedido', /orderId: '',/.test(listaSrc));
check('lê os itens do payload da nota original', /payloadEnviado \|\| \{\}\)\.items/.test(listaSrc));


console.log('\n--- nota autorizada consegue ser GRAVADA ---');
// A Focus devolve a chave prefixada: "NFe4226084379..." = 47 caracteres, numa
// coluna character(44). A gravação estourava com "value too long" e derrubava
// a atualização INTEIRA — nota AUTORIZADA pela SEFAZ, com protocolo e DANFE
// prontos, e o sistema preso em "Processando" para sempre. Valia pelo webhook
// e pela consulta manual, porque as duas passam pela mesma função.
// Encontrado emitindo em homologação em 14/08/2026.
check('a chave é normalizada para só dígitos antes de gravar',
  /chaveAcesso: String\(resposta\.chave_nfe[\s\S]{0,40}replace\(/.test(serverSrc)
  && /chave_nfe[\s\S]{0,60}\D/.test(serverSrc));
check('e o motivo está escrito', /value too long for type character\(44\)/.test(serverSrc));

console.log('\n--- "Consultar Status" consulta de verdade ---');
// A tela chama GET /api/fiscal/nfe/:id para destravar nota parada quando o
// webhook não chega. A rota só relia o banco: o botão respondia "Nenhuma
// mudança de status" e parecia confirmar que estava tudo bem.
const rotaGet = serverSrc.slice(
  serverSrc.indexOf("if (pathname.startsWith('/api/fiscal/nfe/') && req.method === 'GET')"),
  serverSrc.indexOf("if (pathname.startsWith('/api/fiscal/nfe/') && req.method === 'GET')") + 1600);
check('a rota reconsulta a Focus', /client\.consultarNfe\(nfe\.referencia\)/.test(rotaGet));
check('e aplica a resposta no registro', /aplicarRespostaFocusNaNfe\(nfe, resposta, user\)/.test(rotaGet));
// Consultar toda nota de toda listagem seria uma ida à Focus por linha.
check('só reconsulta quem está em trânsito', /nfe\.status === 'PROCESSANDO'/.test(rotaGet));
check('e só quem foi mesmo transmitida', /nfe\.referencia && nfe\.estabelecimentoId/.test(rotaGet));
// Instabilidade de rede não pode esconder a nota inteira.
check('falha ao consultar não derruba a leitura', /Falha ao reconsultar NF-e/.test(rotaGet));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
