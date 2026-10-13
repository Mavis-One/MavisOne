// O QUE O MÓDULO MARCADO NA FICHA JÁ DÁ, SOZINHO — FONTE ÚNICA (fase EF).
//
// Mora em public/ pelo mesmo motivo de fiscal_permissoes.js: o navegador
// carrega por <script> (a ficha do usuário mostra estas permissões como vindas
// do módulo) e lib/permissoes.js faz require() dele (o portão as concede).
//
// O PROBLEMA QUE ISTO RESOLVE
// ---------------------------
// Marcar "Financeiro" em Restrições de Acesso só fazia o menu aparecer. O tipo
// Usuário não traz permissão nenhuma de finance (fase L, de propósito), e só
// quem já existia naquela migração ganhou as permissões diretas. Todo usuário
// cadastrado depois entrava no Financeiro e levava 403 "finance.ler" — medido
// em 13/10/2026 com um usuário de teste: módulo marcado, tela vazia.
//
// A decisão do usuário (13/10/2026): módulo Financeiro marcado = ver, lançar e
// editar. EXCLUIR continua fora: é do Gerente, ou liberado à parte na aba
// Permissões — o mesmo recorte que o tipo Usuário já tem em Vendas.
//
// NEGAR explícito continua vencendo (ver usuarioPode): desmarcar na aba
// Permissões uma destas grava NEGAR, e a pessoa fica sem ela mesmo com o
// módulo marcado.

(function (raiz) {
  const ACOES_POR_MODULO = {
    finance: ['ler', 'criar', 'editar']
  };

  /** As permissões (slugs) que os módulos marcados dão por si. */
  function permissoesDosModulos(modulos) {
    const lista = Array.isArray(modulos) ? modulos : [];
    return lista.flatMap((modulo) => (ACOES_POR_MODULO[modulo] || []).map((acao) => `${modulo}.${acao}`));
  }

  /** O módulo marcado, sozinho, dá esta permissão a este usuário? */
  function moduloConcede(usuario, permissao) {
    if (!usuario || !permissao) return false;
    return permissoesDosModulos(usuario.allowedModules).includes(String(permissao));
  }

  const api = { ACOES_POR_MODULO, permissoesDosModulos, moduloConcede };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisPermissoesDoModulo = api;
})(typeof window !== 'undefined' ? window : null);
