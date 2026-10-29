// A VENDA É DO VENDEDOR QUE A FEZ (12/10/2026).
//
// Pedido do usuário: "coloque o usuário de vendedor automático para venda,
// bloqueie os vendedores de editar o pedido de outros vendedores".
//
// Até aqui o campo Vendedor do pedido começava vazio, era escolhido à mão numa
// lista de todos, e o servidor gravava o que viesse — qualquer usuário podia
// lançar venda no nome de outro e editar ou excluir o pedido de qualquer um.
//
// QUEM É "VENDEDOR" AQUI é exatamente quem o escopo de vendas já trata como
// vendedor (lib/relatorios-escopo.js): usuário NÃO administrador com vendedor
// vinculado em Configurações › Usuários. Uma regra só para "o que vejo" e "no
// que mexo" — duas definições de vendedor acabariam discordando.
//
//   ADMINISTRADOR       -> mexe em qualquer venda, escolhe qualquer vendedor.
//   VENDEDOR            -> o vendedor da venda é SEMPRE ele (o servidor troca
//                          o que vier pelo vínculo), e só mexe em venda dele
//                          ou sem vendedor.
//   SEM VÍNCULO         -> como antes: não é vendedor (caixa, financeiro,
//                          expedição faturam e aprovam pedido dos outros).
//
// VENDA SEM VENDEDOR fica liberada para o vendedor de propósito: é pedido
// antigo ou importado sem dono, e quem o salva passa a ser o vendedor dele —
// travar deixaria esse pedido sem ninguém, fora o administrador, que pudesse
// terminá-lo.
'use strict';

const escopoLib = require('./relatorios-escopo');

const MOTIVO_DE_OUTRO_VENDEDOR = 'Este pedido/orçamento é de outro vendedor. Só o vendedor dele ou um administrador pode alterá-lo.';

/** O vendedor que o usuário é obrigado a ser; '' quando não está travado. */
function vendedorTravado(escopo) {
  if (!escopo || escopo.tipo !== escopoLib.PROPRIO) return '';
  return String((escopo.sellerIds || [])[0] || '').trim();
}

// QUANDO UM VENDEDOR PODE MEXER NAS VENDAS DE OUTRO (fase EQ, 15/10/2026,
// pedido do usuário: "uma regra aplicável pela tela de usuários"). A chave
// "Pode alterar vendas de outros vendedores" do usuário libera alterar, excluir
// e anexar nas vendas dos colegas. A venda NÃO passa a ser dele: o vendedor
// dela continua sendo quem a fez (vendedorAoGravar). Venda nova continua no
// nome dele, e o que ele vê nos relatórios não muda.
const podeAlterarDeOutros = (escopo) => Boolean(escopo && escopo.podeAlterarDeOutros === true);

/** Este usuário pode alterar, excluir ou anexar nesta venda? */
function podeMexerNaVenda(escopo, sellerIdDaVenda) {
  const travado = vendedorTravado(escopo);
  if (!travado) return true;
  const daVenda = String(sellerIdDaVenda || '').trim();
  return !daVenda || daVenda === travado || podeAlterarDeOutros(escopo);
}

/**
 * O vendedor que vai gravado: o do vendedor travado, ou o que a tela mandou.
 * `vendedorDaVenda` é o da venda que está sendo ALTERADA: quem pode mexer na
 * venda de um colega não a toma para si.
 */
function vendedorAoGravar(escopo, pedido, vendedorDaVenda = '') {
  const travado = vendedorTravado(escopo);
  if (!travado) return String(pedido || '').trim();
  const daVenda = String(vendedorDaVenda || '').trim();
  if (daVenda && daVenda !== travado && podeAlterarDeOutros(escopo)) return daVenda;
  return travado;
}

// O VENDEDOR SÓ CRIA (16/10/2026, pedido do usuário: "quero que os vendedores
// tenham acesso somente aos pedidos criados por eles, e que eles não consigam
// aprovar nem faturar ou até mesmo excluir, somente criar pedidos/orçamentos").
//
//   VÊ        só as vendas dele. Quem tem "Pode alterar vendas de outros
//             vendedores" (fase EQ) continua vendo as dos colegas — é para
//             isso que a chave existe.
//   GRAVA     só Orçamento e Pedido (o rascunho), e só enquanto a venda está
//             num dos dois: aprovada por alguém, deixa de ser dele para mexer.
//   NÃO FAZ   aprovar, faturar, cancelar, excluir, emitir NF-e/NFC-e — vale
//             também para quem tem a chave da fase EQ.
//
// Quem não tem vendedor vinculado (caixa, financeiro, gerente) e o
// administrador continuam como antes.
const STATUS_DO_VENDEDOR = ['orcamento', 'pedido'];
const MOTIVO_SO_CRIA = 'Vendedor só cria e edita orçamentos e pedidos em aberto: aprovar, faturar, cancelar, excluir e emitir nota ficam com o administrador ou com quem não é vendedor.';
const MOTIVO_APROVADA = 'Este pedido já foi aprovado: o vendedor não altera mais. Peça a um administrador.';

/** O usuário é um vendedor que só cria (não aprova, fatura, cancela nem exclui)? */
const soCria = (escopo) => Boolean(vendedorTravado(escopo));

/** O vendedor que o usuário só pode VER; '' quando vê todas (o escopo dele decide o resto). */
function soVeAsDele(escopo) {
  return podeAlterarDeOutros(escopo) ? '' : vendedorTravado(escopo);
}

/**
 * Este usuário enxerga esta venda? A do vendedor dele, OU a que ele mesmo criou
 * (16/10/2026: o pedido do usuário era "os pedidos CRIADOS por eles", e só o
 * vendedor da venda deixava de fora o que o vendedor lançou antes de a venda
 * passar a nascer no nome dele — a lista dele vinha vazia).
 */
function podeVerVenda(escopo, sellerIdDaVenda, criadoPor = '', idDoUsuario = '') {
  const dele = soVeAsDele(escopo);
  if (!dele) return true;
  if (String(sellerIdDaVenda || '').trim() === dele) return true;
  return Boolean(idDoUsuario) && String(criadoPor || '').trim() === String(idDoUsuario).trim();
}

/** A situação é de rascunho (orçamento ou pedido em aberto)? `normalizar` vem de sales_status. */
const ehRascunho = (status, normalizar = (s) => s) => STATUS_DO_VENDEDOR.includes(normalizar(status));

// O PEDIDO QUE VOLTOU DO FATURAMENTO (29/10/2026, pedido do usuário: "os
// vendedores não conseguem alterar um pedido já faturado que teve a NF
// vinculada cancelada; ajuste para que eles utilizem o mesmo pedido").
// Cancelar a NF-e (ou excluir os títulos do Pré-Faturado) devolve o pedido a
// "Pedido Não Faturado" — só o sistema põe uma venda ali, e é para ela ser
// corrigida e aprovada de novo. O vendedor dela corrige como corrige o
// rascunho: grava mantendo "Pedido Não Faturado" ou volta a "Pedido".
// Aprovar, faturar e emitir continuam fora do vendedor.
const STATUS_QUE_VOLTARAM = ['pedido-nao-faturado'];

/** O vendedor altera a venda nesta situação? O rascunho, ou o pedido que voltou do faturamento. */
const vendedorAltera = (status, normalizar = (s) => s) => ehRascunho(status, normalizar)
  || STATUS_QUE_VOLTARAM.includes(normalizar(status));

/** E grava neste status? Rascunho, ou o pedido que voltou mantido como está. */
const vendedorGrava = (statusNovo, statusAtual, normalizar = (s) => s) => ehRascunho(statusNovo, normalizar)
  || (STATUS_QUE_VOLTARAM.includes(normalizar(statusNovo)) && normalizar(statusNovo) === normalizar(statusAtual));

module.exports = {
  MOTIVO_DE_OUTRO_VENDEDOR,
  MOTIVO_SO_CRIA,
  MOTIVO_APROVADA,
  STATUS_DO_VENDEDOR,
  STATUS_QUE_VOLTARAM,
  vendedorTravado,
  podeMexerNaVenda,
  podeAlterarDeOutros,
  vendedorAoGravar,
  soCria,
  soVeAsDele,
  podeVerVenda,
  ehRascunho,
  vendedorAltera,
  vendedorGrava
};
