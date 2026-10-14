#!/usr/bin/env node
/**
 * EXCLUIR NF-e COM ERRO (14/10/2026). Pedido do usuário: "permita o admin
 * excluir nfe's com erro". Exceção estreita à regra de nunca excluir documento
 * fiscal: nota com erro foi RECUSADA e não existe para o fisco. Autorizada,
 * cancelada ou em processamento continua sem exclusão.
 *
 * Provado (servidor local, nota de teste ligada a um pedido):
 *   - nota AUTORIZADA: recusado ("Só NF-e com erro pode ser excluída...");
 *   - popup do erro com "Excluir nota | Fechar | Corrigir nota" (admin);
 *     confirmação com cliente e valor; a Focus respondeu que não conhece a
 *     referência (404) e a nota foi excluída; o pedido ficou sem o vínculo;
 *     a auditoria registrou nfe.excluirComErro com o valor.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const servidor = ler('server.js');
const lista = ler('public/modules/finance/subs/nfe_emitidas.js');
const popup = ler('public/modules/shared/erro_nfe.js');
const funcao = servidor.slice(servidor.indexOf('async function excluirNfeComErro'), servidor.indexOf('// `opcoes.modelo` é decidido pela ROTA'));

check('só administrador', funcao.includes("if (!(await ehAdmin(user))) recusar('Só um administrador exclui NF-e com erro.', 403);"));
check('só nota com ERRO', funcao.includes("if (nfe.status !== 'ERRO') recusar("));
check('confere na Focus antes: 404 libera, sem resposta não exclui',
  funcao.includes('if (Number(erroDaConsulta.status) !== 404) {') && funcao.includes('Não consegui confirmar na Focus NFe'));
check('  autorizada/processando lá: atualiza aqui e recusa', funcao.includes("if (naFocus && naFocus !== 'erro_autorizacao') {") && funcao.includes('await aplicarRespostaFocusNaNfe(nfe, resposta, user)'));
check('nota já escriturada (SPED) não sai', funcao.includes('select count(*)::int as n from fiscal_documentos where nfe_id = $1'));
check('o pedido solta o vínculo, na mesma transação', funcao.includes("await cliente.query('update orders set nfe_id = null where nfe_id = $1', [id]);")
  && funcao.includes(`await cliente.query("delete from nfe where id = $1 and status = 'ERRO'", [id]);`));
check('fica na auditoria, com os dados da nota', funcao.includes("action: 'nfe.excluirComErro'") && funcao.includes('valorTotal: nfe.valorTotal'));
check('rota DELETE só para o id da nota', /if \(req\.method === 'DELETE' && \/\^\\\/api\\\/fiscal\\\/nfe\\\/\[0-9a-f-\]\{36\}\$\/i\.test\(pathname\)\) \{/.test(servidor));
check('botão no popup do erro, só para administrador', popup.includes('data-acao="excluir">Excluir nota</button>')
  && lista.includes("const podeExcluir = typeof usuarioEhAdmin === 'function' && usuarioEhAdmin();"));
check('  com confirmação', lista.includes("if (!await confirmModal(`Excluir a ${rotulo}?"));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
