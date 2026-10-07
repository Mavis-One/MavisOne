-- ============================================================================
-- FASE DU — O ENDEREÇO DOS CLIENTES CRIADOS PELO ATALHO
-- ============================================================================
--
-- A janela "Novo Cliente" do botão Atalhos mandava o endereço com nomes
-- próprios — `address`, `number`, `complement` — e o cadastro de pessoas, o
-- pedido e a NF-e leem `street`, `streetNumber` e `addressComplement` (é o que
-- as 6.492 pessoas da base usam). O logradouro ainda se salvava, porque a rota
-- aceita os dois nomes para ele; o NÚMERO e o COMPLEMENTO iam para chaves que
-- ninguém lê, e o cliente aparecia sem número em todo lugar.
--
-- A janela foi corrigida em 07/10/2026. Esta fase conserta os clientes que ela
-- já tinha criado: copia para a chave certa SÓ quando a certa está vazia — o
-- que alguém já acertou à mão no cadastro fica como está. As chaves velhas não
-- são apagadas (não atrapalham ninguém, e apagar não devolveria nada).
--
-- Idempotente: na segunda vez não há o que copiar.
-- ============================================================================

update people
set extra = extra || jsonb_build_object('streetNumber', extra->>'number')
where coalesce(btrim(extra->>'number'), '') <> ''
  and coalesce(btrim(extra->>'streetNumber'), '') = '';

update people
set extra = extra || jsonb_build_object('addressComplement', extra->>'complement')
where coalesce(btrim(extra->>'complement'), '') <> ''
  and coalesce(btrim(extra->>'addressComplement'), '') = '';

update people
set extra = extra || jsonb_build_object('street', extra->>'address')
where coalesce(btrim(extra->>'address'), '') <> ''
  and coalesce(btrim(extra->>'street'), '') = '';
