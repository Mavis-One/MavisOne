// Lançamento gerado por PEDIDO ou por NF-e: o que dá e o que não dá para mudar.
//
// O sistema se contradizia. Ao FATURAR um pedido, o app leva o usuário à tela
// de edição do lançamento gerado, com o comentário explícito de que o próximo
// passo é "ajustar forma de pagamento e vencimento". E o servidor recusava
// QUALQUER edição de lançamento com referenceId. A pessoa preenchia tudo e
// levava "não podem ser editados aqui" — um beco sem saída que o próprio
// sistema criava. Relatado em 22/08/2026, no recebível do Pedido 1009.
//
// A saída não foi liberar tudo: valor, data, descrição e cliente PERTENCEM à
// origem, e mudá-los aqui faria o Financeiro divergir da venda — divergência
// que só apareceria na conferência, muito depois.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const serverSrc = ler('server.js');
const telaSrc = ler('public/modules/finance/subs/novo_lancamento.js');
const listaSrc = ler('public/modules/finance/subs/lancamentos.js');
const appSrc = ler('public/app.js');

console.log('--- a contradição que originou o bug continua visível ---');
// Se o desvio automático sumir um dia, o resto perde a razão de ser — e quem
// mexer precisa saber que os dois lados conversam.
check('faturar um pedido ainda leva ao lançamento gerado',
  /state\.financeEditEntryId = gerados\[0\]/.test(appSrc));

console.log('\n--- o servidor aceita o que a venda NÃO possui ---');
const put = serverSrc.slice(
  serverSrc.indexOf("if (pathname.startsWith('/api/finance/entries/') && req.method === 'PUT')"),
  serverSrc.indexOf("return sendJson(res, { error: 'Erro ao editar lançamento' }, 400)"));
check('achei o trecho do PUT', put.length > 500, `${put.length} caracteres`);
check('reconhece vínculo com pedido', /const vinculadoAoPedido = Boolean\(entry\.referenceId\)/.test(put));
check('e vínculo com NF-e', /const vinculadoANfe = Boolean\(entry\.nfeId\)/.test(put));
// Estes seis eram o passo seguinte do faturamento e estavam bloqueados.
['dueDate', 'document', 'note', 'category', 'costCenter', 'bankAccountId'].forEach((campo) => {
  check(`  ${campo} é gravado no lançamento vinculado`, new RegExp(`if \\(body\\.${campo} !== undefined\\) entry\\.${campo} = body\\.${campo}`).test(put));
});

console.log('\n--- e recusa o que ela possui, em vez de ignorar calado ---');
// Aceitar e manter o valor antigo seria pior do que negar: a tela diria
// "salvo" e o número continuaria o outro.
check('valor é protegido', /\['valor', mudou\('amount'/.test(put));
check('data é protegida', /\['data', mudou\('date'/.test(put));
check('descrição é protegida', /\['descrição', mudou\('description'/.test(put));
check('cliente é protegido', /\['cliente', mudou\('clientSupplierId'/.test(put));
check('tipo é protegido', /\['tipo', mudou\('type'/.test(put));
check('recusa nomeando os campos', /Neste lançamento não dá para alterar: \$\{protegidos\.join/.test(put));
// Botão desligado sem caminho a seguir é beco sem saída — a mensagem diz onde
// corrigir de verdade.
check('e diz ONDE corrigir', /corrija por lá e o financeiro acompanha/.test(put) && /cancelar a nota e emitir outra/.test(put));
// Só recusa quando o valor REALMENTE muda: reenviar igual não pode travar.
check('reenviar o mesmo valor não é recusado', /body\[campo\] !== undefined && comparar\(body\[campo\]\)/.test(put));
check('a gravação passa pelo mesmo caminho da edição livre', /await db\.updateFinancialEntry\(entry\.id, entry\)[\s\S]{0,400}editarLancamentoVinculado/.test(put));

console.log('\n--- a tela avisa ANTES, em vez de recusar no fim ---');
check('o servidor informa o vínculo', /vinculo: entry\.nfeId \? 'nfe' : \(entry\.referenceId \? 'pedido' : ''\)/.test(serverSrc));
check('e quais campos estão travados', /camposTravados: \(entry\.referenceId \|\| entry\.nfeId\)/.test(serverSrc));
check('a tela sabe se é vinculado', /const vinculado = Boolean\(editEntry && editEntry\.vinculo\)/.test(telaSrc));
check('mostra o aviso no topo', /Lançamento gerado \$\{editEntry\.vinculo === 'nfe' \? 'por uma NF-e' : 'por um pedido'\}/.test(telaSrc));
['amount', 'date', 'description'].forEach((campo) => {
  check(`  ${campo} sai travado no formulário`, new RegExp(`\\$\\{travado\\('${campo}'\\)\\}`).test(telaSrc));
});
// <select> não aceita readonly.
check('o cliente sai desabilitado', /financePartySelect" \$\{vinculado \? 'disabled/.test(telaSrc));
// Reenviar valor e data iguais é pedir para divergir por formato de data ou
// arredondamento — melhor não mandar.
check('o envio omite os campos travados', /const payload = vinculado[\s\S]{0,400}dueDate: formData\.get\('dueDate'\)/.test(telaSrc));
check('e não manda cliente quando vinculado', /if \(!vinculado\) \{[\s\S]{0,200}clientSupplierId/.test(telaSrc));

console.log('\n--- a lista oferece a edição possível, com o nome certo ---');
// Antes o botão simplesmente sumia para lançamento vinculado, e a única porta
// de entrada era o desvio do faturamento — que terminava em erro.
check('o botão aparece para qualquer pendente', /entry\.rawStatus === 'pending' \? /.test(listaSrc));
check('e o rótulo diz o que dá para mudar', /Editar vencimento e classificação/.test(listaSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
