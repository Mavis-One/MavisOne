-- ============================================================================
-- FASE FC — O NOME DO CLIENTE/FORNECEDOR GRAVADO NO TÍTULO
-- ============================================================================
--
-- Pedido do usuário (23/10/2026): no relatório de contas, "o fornecedor de dois
-- títulos não foi puxado por mais que ele já estivesse cadastrado".
--
-- O formulário do título (Novo Lançamento / Edição de Título) manda o CÓDIGO
-- do cadastro escolhido e deixa client_supplier_name vazio — esse campo é o
-- "Nome livre", de quem não tem cadastro. As telas do Financeiro acham o nome
-- pelo cadastro inteiro (pessoas e CNPJs); os relatórios liam só `people` e o
-- nome gravado. Fornecedor cadastrado em `cnpjs` saía em branco.
--
-- Desde esta fase o título grava o nome do cadastro (lib/db/financeiro.js,
-- nomeDoCadastro). Aqui, os que já existem: só os sem nome, e só com o
-- cadastro achado. O nome livre de quem não tem cadastro não é tocado.
-- ============================================================================

update financial_entries e set client_supplier_name = p.name
  from people p
 where p.id = e.client_supplier_id
   and coalesce(e.client_supplier_name, '') = ''
   and coalesce(p.name, '') <> '';

update financial_entries e set client_supplier_name = c.name
  from cnpjs c
 where c.id = e.client_supplier_id
   and coalesce(e.client_supplier_name, '') = ''
   and coalesce(c.name, '') <> '';
