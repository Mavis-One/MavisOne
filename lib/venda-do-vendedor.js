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

module.exports = {
  MOTIVO_DE_OUTRO_VENDEDOR,
  vendedorTravado,
  podeMexerNaVenda,
  podeAlterarDeOutros,
  vendedorAoGravar
};
