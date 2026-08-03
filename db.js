// Camada de acesso a dados via Supabase.
//
// Este arquivo existe neste caminho/nome porque é o que o fluxo de conexão
// "Node.js + Supabase" da Hostinger espera encontrar. As funções em si vivem
// organizadas por domínio em lib/db/*.js — este arquivo só agrupa e reexporta.
//
// Nada em server.js usa este arquivo ainda (Fase A da migração é só a
// fundação: schema + camada de dados). A ligação com as rotas acontece nas
// próximas fases.
const auth = require('./lib/db/auth');
const settings = require('./lib/db/settings');
const estoque = require('./lib/db/estoque');
const vendasCompras = require('./lib/db/vendas-compras');
const cadastros = require('./lib/db/cadastros');
const financeiro = require('./lib/db/financeiro');

module.exports = {
  ...auth,
  ...settings,
  ...estoque,
  ...vendasCompras,
  ...cadastros,
  ...financeiro
};
