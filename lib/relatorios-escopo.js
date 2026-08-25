// QUEM PODE VER QUAIS VENDAS — a regra, sem banco e sem rede.
//
// Mesma escolha de lib/permissoes.js: função pura, decidida a partir de um
// objeto de usuário. Assim ela roda no teste sem subir servidor, e existe UM
// lugar onde a pergunta "este usuário pode ver a venda de quem?" é respondida.
// Espalhada por rota, ela viraria cinco respostas ligeiramente diferentes — e a
// que ficasse para trás seria a porta aberta.
//
// A REGRA DE HOJE
// ---------------
//   ADMINISTRADOR  -> todas as vendas.
//   QUALQUER OUTRO -> só as vendas do vendedor vinculado ao seu usuário.
//   SEM VÍNCULO    -> NENHUMA venda.
//
// O terceiro caso é o que separa esta regra de um enfeite. Um usuário comum sem
// vendedor vinculado poderia, por descuido, cair no ramo "sem filtro" e ver
// tudo. Aqui ele cai em `nenhum`: a lista volta vazia com o motivo escrito na
// tela ("peça para vincular seu usuário a um vendedor"). Falhar fechado é a
// única opção defensável quando a dúvida é sobre quem vê o quê.
//
// POR QUE O VÍNCULO É UM CAMPO, E NÃO O NOME
// ------------------------------------------
// O vendedor de um pedido é uma PESSOA do Cadastros (people.id, com o papel
// "Vendedor"); quem faz login é uma linha de `users`. São tabelas diferentes e
// sempre foram: vendedor não precisa ter login, e usuário não precisa vender.
// `users.seller_id` (fase AL) é a ponte, preenchida na tela de Usuários.
//
// Casar por NOME seria mais barato e é a armadilha: dois "João Silva" no
// cadastro, ou um acento a menos, e o relatório passa a mostrar as vendas de
// outra pessoa — ou nenhuma — sem erro nenhum aparecer. Regra de acesso que
// erra em silêncio é pior do que regra de acesso nenhuma, porque ninguém
// procura o defeito.
//
// COMO ISTO CRESCE (gerente, supervisor, financeiro)
// --------------------------------------------------
// A saída desta função é um CONJUNTO DE VENDEDORES (`sellerIds`), não um
// booleano "é admin". Escopo novo é uma entrada nova em REGRAS, e nada mais:
//
//   { papel: 'gerente',    resolver: (u, ctx) => ids da equipe dele }
//   { papel: 'supervisor', resolver: (u, ctx) => ids da filial dele }
//
// Quem consome já sabe filtrar por lista de vendedores — nenhuma rota, nenhum
// indicador e nenhuma exportação precisa mudar para o papel novo existir. Foi
// por isso que a função devolve lista mesmo no caso de um vendedor só.

const TODOS = 'todos';
const PROPRIO = 'proprio';
const NENHUM = 'nenhum';

/**
 * As regras, na ordem em que são consultadas. A PRIMEIRA que responder vence.
 *
 * `resolver` devolve null quando a regra não se aplica àquele usuário, e um
 * escopo quando se aplica. Papel novo entra aqui em cima do fallback — nunca
 * dentro de um `if` espalhado por aí.
 */
const REGRAS = [
  {
    papel: 'admin',
    resolver: (usuario, ctx) => (ctx.ehAdmin ? {
      tipo: TODOS,
      // null (e não lista vazia) = sem restrição. Lista vazia é o oposto:
      // restrito a ninguém. Confundir os dois é o jeito mais fácil de abrir
      // tudo por engano, então os dois valores são deliberadamente distintos.
      sellerIds: null,
      rotulo: 'Todas as vendas',
      podeEscolherVendedor: true,
      motivo: ''
    } : null)
  },
  {
    papel: 'vendedor',
    resolver: (usuario) => {
      const vinculo = String((usuario && usuario.sellerId) || '').trim();
      if (!vinculo) return null;
      return {
        tipo: PROPRIO,
        sellerIds: [vinculo],
        rotulo: 'Minhas vendas',
        // Um vendedor comum não escolhe vendedor: o filtro não aparece na tela,
        // e o servidor ignora o que vier no lugar dele.
        podeEscolherVendedor: false,
        motivo: ''
      };
    }
  }
];

// Último caso, e de propósito o mais restritivo de todos.
const SEM_ACESSO = {
  tipo: NENHUM,
  sellerIds: [],
  rotulo: 'Nenhuma venda',
  podeEscolherVendedor: false,
  motivo: 'Seu usuário ainda não está vinculado a um vendedor. Peça a um administrador para fazer o vínculo em Configurações › Usuários.'
};

/**
 * O escopo de vendas de um usuário.
 *
 * @param usuario  objeto do usuário autenticado (precisa de `sellerId`)
 * @param ctx      { ehAdmin: boolean } — vem de fora porque descobrir se
 *                 alguém é admin envolve o RBAC no banco, e esta função não
 *                 fala com banco nenhum.
 */
function escopoDeVendas(usuario, ctx = {}) {
  if (!usuario || usuario.active === false) return { ...SEM_ACESSO, motivo: 'Sessão inválida.' };
  for (const regra of REGRAS) {
    const escopo = regra.resolver(usuario, ctx);
    if (escopo) return { ...escopo, papel: regra.papel };
  }
  return { ...SEM_ACESSO, papel: 'sem-vinculo' };
}

/**
 * A venda entra no escopo?
 *
 * É a função que decide de verdade — a tabela, os indicadores, o agrupamento e
 * o CSV passam TODOS por aqui, e é isso que garante que os quatro mostrem o
 * mesmo universo. Um card somando o que a tabela não lista é justamente o
 * defeito que dividir esta decisão em quatro lugares produz.
 */
function vendaVisivel(escopo, sellerIdDaVenda) {
  if (!escopo) return false;
  if (escopo.sellerIds === null) return true;
  if (!escopo.sellerIds.length) return false;
  return escopo.sellerIds.includes(String(sellerIdDaVenda || '').trim());
}

/**
 * O filtro de vendedor que vale, dado o que a TELA pediu.
 *
 * Aqui mora a regra que o documento pede em letras maiúsculas: quem não pode
 * escolher vendedor tem o parâmetro IGNORADO. Não é rejeitado com erro — é
 * ignorado, e a consulta segue restrita ao próprio usuário. Rejeitar com erro
 * contaria a quem sondasse que existe algo ali; ignorar simplesmente devolve o
 * que a pessoa sempre pôde ver.
 *
 * @param pedido  o `vendedorId` que veio da query string / do corpo
 * @returns lista de sellerIds a aplicar, ou null para "sem restrição"
 */
function vendedoresPermitidos(escopo, pedido) {
  const escolhido = String(pedido || '').trim();
  if (!escopo) return [];
  if (!escopo.podeEscolherVendedor) return escopo.sellerIds;
  if (!escolhido || escolhido === 'todos') return escopo.sellerIds;
  // Admin pediu um vendedor específico: aí sim o filtro da tela vale.
  return [escolhido];
}

module.exports = {
  TODOS,
  PROPRIO,
  NENHUM,
  REGRAS,
  escopoDeVendas,
  vendaVisivel,
  vendedoresPermitidos
};
