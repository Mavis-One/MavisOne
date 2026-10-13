#!/usr/bin/env node
/**
 * NOVO LANÇAMENTO: AS OITO CORREÇÕES DA FASE EI.
 *
 *   node scripts/test-novo-lancamento-correcoes.js
 *
 * Não precisa de servidor nem de banco: lê o código e roda as duas funções
 * pequenas que dá para rodar fora do navegador. Cada bloco é um defeito que
 * chegou a acontecer, com o cenário no título.
 *
 * 1. Editar um lançamento trocava o estabelecimento dele em silêncio: o
 *    servidor não devolvia `estabelecimentoId`, o campo abria em "Nenhum" (ou
 *    no primeiro da lista) e o PUT gravava o estabelecimento de quem salvou.
 * 2. Faturar venda à vista levava a um formulário editável de lançamento já
 *    pago, e salvar era recusado.
 * 3. "Novo Lançamento" depois de editar um lançamento vinculado não fazia nada
 *    (TypeError: editEntry nulo com `vinculado` ainda verdadeiro).
 * 4. Enter no cadastro rápido (Plano de Contas/Centro/Conta) salvava o
 *    lançamento inteiro.
 * 5. Data e vencimento padrão em UTC: depois das 21h nasciam com amanhã.
 * 6. Cliente/fornecedor digitado e não escolhido na lista era descartado, com
 *    o nome ainda na tela.
 * 7. Trocar Receita/Despesa/Transferência apagava o que já tinha sido digitado.
 * 8. "Voltar ao pedido" aparecia em lançamento sem relação com o pedido.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const semComentarios = (js) => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const servidor = ler('server.js');
const telaBruta = ler('public/modules/finance/subs/novo_lancamento.js');
const tela = semComentarios(telaBruta);

// O corpo de uma função de primeiro nível do server.js, até a próxima.
function corpoDaFuncao(src, nome) {
  const inicio = src.indexOf(`function ${nome}(`);
  if (inicio < 0) return '';
  const fim = src.indexOf('\nfunction ', inicio + 10);
  return src.slice(inicio, fim < 0 ? undefined : fim);
}

console.log('--- 1. o estabelecimento do lançamento não muda sozinho na edição ---');
const serializa = corpoDaFuncao(servidor, 'serializeFinanceEntry');
check('achei serializeFinanceEntry', serializa.length > 500, `${serializa.length} caracteres`);
check('devolve o estabelecimento do lançamento', /estabelecimentoId: entry\.estabelecimentoId \|\| ''/.test(serializa));
// A lista de Lançamentos lê este mesmo objeto: acrescentar campo é seguro,
// tirar ou renomear não. Estes três ela já usava.
check('  sem tirar o que a lista já lê',
  /vinculo: entry\.nfeId/.test(serializa) && /rawStatus: entry\.status/.test(serializa) && /amountPrevisto:/.test(serializa));
check('a tela parte do estabelecimento do lançamento',
  /estabelecimentoAtual = editEntry\s*\?\s*\(editEntry\.estabelecimentoId \|\| ''\)/.test(tela));
// Desabilitado, o FormData deixa o campo de fora e iria '', que o servidor lê
// como "o estabelecimento de quem salva".
check('o campo travado não vai no envio',
  /const campoEstab = mostrarEstab \? document\.getElementById\('financeEstabSelect'\) : null;\s*if \(campoEstab && !campoEstab\.disabled\) \{\s*payload\.estabelecimentoId = formData\.get\('estabelecimentoId'\)/.test(tela));
check('  e não sobrou o envio pelo mostrarEstab sozinho', !/if \(mostrarEstab\) \{\s*payload\.estabelecimentoId/.test(tela));
// Fora do corpo, o PUT mantém o que o lançamento já tem.
check('o PUT, sem o campo, usa o estabelecimento que o lançamento já tem',
  /body\.estabelecimentoId !== undefined \? body\.estabelecimentoId : entry\.estabelecimentoId/.test(servidor));

console.log('\n--- 2. lançamento já baixado ou cancelado não abre formulário ---');
check('a tela decide pelo rawStatus antes de desenhar',
  /if \(editEntry && String\(editEntry\.rawStatus \|\| 'pending'\) !== 'pending'\) \{\s*renderSomenteLeitura\(editEntry\);\s*\} else \{\s*renderForm\(\);\s*\}\s*\};\s*$/.test(tela));
const leitura = tela.slice(tela.indexOf('function renderSomenteLeitura('), tela.indexOf('function acoesDeSaida('));
check('o aviso só de leitura não tem formulário nem botão de salvar', leitura.length > 200
  && !/<form/.test(leitura) && !/type="submit"/.test(leitura));
check('  diz o que fazer (estornar a baixa) e o motivo do cancelamento',
  /estorne as baixas/.test(leitura) && /escapeHtml\(entry\.cancelReason\)/.test(leitura));
check('  e oferece as mesmas saídas da tela de sucesso', /\$\{acoesDeSaida\(\)\}/.test(leitura) && /ligarAcoesDeSaida\(entry\)/.test(leitura));
check('o servidor continua recusando editar o que não está pendente',
  /if \(entry\.status !== 'pending'\) \{\s*return sendJson\(res, \{ error: 'Só é possível editar lançamentos ainda pendentes/.test(servidor));

console.log('\n--- 3. "Novo Lançamento" depois de editar um vinculado ---');
const botaoNovo = tela.slice(tela.indexOf("getElementById('financeSuccessNew')"), tela.indexOf('let inlineAddKind'));
check('a tela nasce de novo, com todo o estado recalculado', /renderFinanceNovoLancamento\(ctx\);/.test(botaoNovo));
check('  e não redesenha o formulário com o estado da edição', !/editEntry = null/.test(botaoNovo) && !/renderForm\(\)/.test(botaoNovo));
check('  a função tem nome para chamar a si mesma',
  /finance\.novo_lancamento = async function renderFinanceNovoLancamento\(ctx\)/.test(tela));
check('  e o pedido de origem fica para trás', /state\.financeReturnTo = null;\s*renderFinanceNovoLancamento/.test(botaoNovo));

console.log('\n--- 4. Enter no cadastro rápido ---');
check('Enter cadastra o nome, e não envia o lançamento',
  /getElementById\('financeInlineAddInput'\)\?\.addEventListener\('keydown', \(evento\) => \{\s*if \(evento\.key === 'Enter'[^)]*\) \{\s*evento\.preventDefault\(\);\s*document\.getElementById\('financeInlineAddConfirm'\)\?\.click\(\);/.test(tela));

console.log('\n--- 5. a data de hoje é a local ---');
check('nada de toISOString().slice(0, 10) na tela', !/toISOString\(\)\.slice\(0, 10\)/.test(tela));
check('o padrão de Data e Vencimento vem de hojeLocal()', /const today = hojeLocal\(\);/.test(tela));
// Roda a função de verdade com um relógio às 22h de 13/10 em UTC-3, quando a
// data UTC já é 14/10.
const fonteHoje = /function hojeLocal\(\) \{[\s\S]*?\n  \}/.exec(telaBruta);
check('achei hojeLocal', Boolean(fonteHoje));
if (fonteHoje) {
  class RelogioDasVinteEDuas {
    getFullYear() { return 2026; }
    getMonth() { return 9; }
    getDate() { return 13; }
    toISOString() { return '2026-10-14T01:00:00.000Z'; }
  }
  // eslint-disable-next-line no-new-func
  const hoje = new Function('Date', `${fonteHoje[0]}\nreturn hojeLocal();`)(RelogioDasVinteEDuas);
  check('às 22h em SC, hoje ainda é hoje', hoje === '2026-10-13', hoje);
}

console.log('\n--- 6. cliente/fornecedor digitado e não escolhido ---');
const envio = tela.slice(tela.indexOf("getElementById('financeEntryForm')?.addEventListener('submit'"));
const posAviso = envio.indexOf('não foi escolhido na lista');
const posTrava = envio.indexOf('submitBtn.disabled = true');
check('o envio confere o texto contra o valor escolhido',
  /buscaDaParte\.value\.trim\(\) && !parteEscolhida\.value/.test(envio)
  && /getElementById\('financePartyInput'\)/.test(envio) && /getElementById\('financePartyValue'\)/.test(envio));
check('  e recusa antes de travar o botão (senão ele ficaria travado)', posAviso > 0 && posTrava > posAviso);
check('  só quando o campo é editável (nem vinculado, nem transferência)',
  /if \(!vinculado && formType !== 'TRANSFERENCIA'\) \{\s*const buscaDaParte/.test(envio));

console.log('\n--- 7. trocar o tipo não apaga o que foi digitado ---');
const alternador = tela.slice(tela.indexOf("content.querySelectorAll('[data-type]')"), tela.indexOf('if (vinculado) {'));
const posGuarda = alternador.indexOf('rascunho[nome] = campo.value');
const posRedesenha = alternador.indexOf('renderForm();');
const posDevolve = alternador.indexOf('campo.value = valor');
check('guarda antes de redesenhar e devolve depois', posGuarda > 0 && posRedesenha > posGuarda && posDevolve > posRedesenha);
check('  valor, datas, descrição, documento e observação',
  /const CAMPOS_DO_RASCUNHO = \['date', 'dueDate', 'amount', 'description', 'document', 'note'\];/.test(tela));

console.log('\n--- 8. "Voltar ao pedido" só no lançamento daquele pedido ---');
check('o servidor diz de qual pedido é o lançamento', /referenceId: entry\.referenceId \|\| ''/.test(serializa));
check('a tela confere o pedido do lançamento',
  /const voltaAoPedido = state\.financeReturnTo && editEntry && editEntry\.referenceId\s*&& editEntry\.referenceId === state\.financeReturnTo\.recordId/.test(tela));
check('  e o botão segue essa conferência, e não o estado solto',
  /\$\{voltaAoPedido \? '<button type="button" id="financeSuccessBack">Voltar ao pedido<\/button>' : ''\}/.test(tela)
  && !/\$\{state\.financeReturnTo \?/.test(tela));
check('  o clique volta ao pedido conferido', /const volta = voltaAoPedido;/.test(tela));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
