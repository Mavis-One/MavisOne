#!/usr/bin/env node
/**
 * A NF-E COM ERRO: MOTIVO EM POPUP E CORREÇÃO (fase EO, 14/10/2026). Pedido do
 * usuário: "quando uma nota fiscal der erro, mostrar o motivo do erro em pop up
 * e me permita entrar dentro dela pra conseguir editar o que já foi feito".
 *
 * Provado no navegador (servidor local, nota de teste com ERRO depois apagada):
 *   - NF-e Emitidas, clique no "Erro": popup "NF-e com erro — <cliente>",
 *     "Código SEFAZ 598", a mensagem e a lista `erros` da Focus;
 *   - "Corrigir nota" abriu a emissão com emitente, destinatário (IE, CEP,
 *     endereço), itens (ligados ao cadastro pelo código), observação, e o aviso
 *     "Corrigindo a NF-e com erro (...)"; na lista ela ficou "Em edição";
 *   - corrigir de novo pergunta antes de substituir a nota em edição;
 *   - nota com estado da tela guardado volta exatamente como estava (frete e
 *     observação editados); nota que não está com erro é recusada.
 *
 * A Focus não documenta reenvio com a mesma referência (doc consultar_nfe e
 * emitir_nfe lidas em 14/10/2026): a correção sai como emissão nova, e a nota
 * com erro fica no histórico (nunca excluir documento fiscal).
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
const fiscal = ler('lib/db/fiscal.js');
const migracao = ler('banco/migrations/fase-eo-estado-da-tela-na-nfe.sql');
const lista = ler('public/modules/finance/subs/nfe_emitidas.js');
const emissao = ler('public/modules/finance/subs/emitir_nfe_focus.js');
const html = ler('public/index.html');

console.log('--- o estado da tela fica na nota ---');
check('coluna nova, sem apagar nada', migracao.includes('add column if not exists estado_da_tela jsonb;') && !/\b(delete|drop)\b/i.test(migracao.replace(/--.*$/gm, '')));
check('a emissão manda o estado da tela', emissao.includes('body.estadoDaTela = estadoDaTela();'));
check('  e o servidor grava (só objeto)', servidor.includes("estadoDaTela: body.estadoDaTela && typeof body.estadoDaTela === 'object' && !Array.isArray(body.estadoDaTela)")
  && fiscal.includes('estado_da_tela: payload.estadoDaTela || null'));

console.log('\n--- o motivo ---');
// O mesmo motivo nos dois lados: servidor (detalhe) e tela (resposta da emissão).
global.window = {};
require('../public/modules/shared/erro_nfe.js');
const { motivosDaNota } = global.window.MavisErroNfe;
const m = motivosDaNota({
  mensagemSefaz: 'Rejeição: Total da NF difere',
  respostaFocus: { status_sefaz: '598', mensagem_sefaz: 'Rejeição: Total da NF difere', erros: [{ codigo: '598', mensagem: 'Total difere' }] }
});
check('mensagem + lista da Focus, sem repetir', m.motivos.length === 2 && m.motivos[1] === '598 — Total difere' && m.statusSefaz === '598');
check('o detalhe da nota devolve o motivo', servidor.includes("return sendJson(res, { nfe, erro: nfe.status === 'ERRO' ? motivosDoErroDaNfe(nfe) : null });"));
check('a lista abre o popup pelo "Erro" e pela linha', lista.includes('data-erro-nfe="${escapeHtml(nfe.id)}"') && lista.includes('abrirErroDaNota(row.dataset.id);'));
check('a emissão mostra o motivo quando a SEFAZ recusa na hora', emissao.includes("titulo: 'A SEFAZ recusou a NF-e'"));
check('o script carrega na página', html.includes('<script src="/modules/shared/erro_nfe.js"></script>'));

console.log('\n--- a correção ---');
check('só nota com ERRO', servidor.includes("if (nfe.status !== 'ERRO') recusar('Só nota com erro pode ser corrigida e reenviada.');"));
check('vira nota em edição (do pedido ou avulsa de quem corrige)', servidor.includes('const chave = rascunhoEmissaoDb.chaveDoRascunho({ pedidoId, userId: user.id });'));
check('  sem passar por cima de outra nota em edição sem perguntar', servidor.includes('if (existente && !substituir) {') && servidor.includes("if (resultado.jaHaNotaEmEdicao) return sendJson(res, { error: resultado.pergunta, jaHaNotaEmEdicao: true }, 409);"));
check('nota antiga sem estado da tela: remonta pelo payload', servidor.includes(': await estadoDaNotaPeloPayload(nfe);'));
check('  com o nome da coluna, não o texto de homologação', servidor.includes("destNome: nfe.destinatarioNome || p.nome_destinatario || '',"));
check('permissão de emitir', servidor.includes("if (pathname.startsWith('/api/fiscal/nfe/') && pathname.endsWith('/corrigir')) return 'emitir';"));
check('NFC-e com erro leva ao pedido (ela sai do pedido)', lista.includes("rotuloCorrigir: nfce ? 'Abrir pedido' : 'Corrigir nota'"));
check('"ir para a venda" abre o pedido de verdade', lista.includes("state.salesDraft.editRecord = res.record || res;") && !lista.includes('state.salesOpenRecordId = '));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
