-- ============================================================================
-- FASE EV — CONTROLE DE MONTAGEM DESLIGADO, POR ENQUANTO
-- ============================================================================
--
-- Pedido do usuário (19/10/2026): "desative essa funcionalidade por enquanto".
-- Depois do deploy da fase ER, o pedido de AUTOPROPELIDO (NCM 8711) passou a
-- exigir Montado/Desmontado, e as lojas pararam de fazer pedido.
--
-- Desliga PELOS DADOS, e não pelo código: a marca "Controla Montagem" sai de
-- todos os produtos, e cada tela e regra do servidor volta a tratá-los como
-- antes (venda, movimentação, transferência, contagem, saldo). A regra continua
-- no código, pronta.
--
-- O QUE NÃO SE PERDE: a lista de quem estava marcado fica em
-- montagem_pausada. Os movimentos já classificados (montado/desmontado)
-- continuam no razão como estão — o razão não se edita.
--
-- PARA RELIGAR: migração nova que volta a marca dos produtos desta tabela. Os
-- movimentos feitos durante a pausa saem sem condição ('') e terão de ser
-- classificados (como a fase ER fez com o saldo antigo: montado), ou o saldo
-- por condição não fecha. Produto marcado à mão no cadastro durante a pausa
-- volta a exigir a escolha — só ele.
-- ============================================================================

create table if not exists montagem_pausada (
  product_id text primary key,
  pausada_em timestamptz not null default now()
);
alter table montagem_pausada enable row level security;

insert into montagem_pausada (product_id)
select id from products where controla_montagem
on conflict (product_id) do nothing;

update products set controla_montagem = false where controla_montagem;
