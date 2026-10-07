-- ============================================================================
-- FASE DT — AS ORIGENS DA VENDA QUE A LOJA USA
-- ============================================================================
--
-- O pedido do usuário (07/10/2026): no campo Origem da Venda, só estas oito, e
-- nesta ordem — LOJA, INDICAÇÃO, WHATSAPP, INSTAGRAM, FACEBOOK, GOOGLE, SITE,
-- CLIENTE ANTIGO. As seis que a fase AZ semeou (Venda Direta, Televendas,
-- E-commerce, Marketplace, Representante, Balcão) respondiam "por onde a venda
-- chegou" com canais que a loja não usa.
--
-- AS ANTIGAS SÃO INATIVADAS, NÃO APAGADAS
-- ---------------------------------------
-- `sale_origin` guarda o NOME (ver a fase AZ), e 14.860 pedidos importados do
-- Viper dizem "Venda Direta". Apagar a origem não muda esses pedidos, mas tira
-- o nome da tela de manutenção e do filtro da Busca Avançada — e aí ninguém
-- consegue mais filtrar o histórico por ela. Inativa, ela some do formulário
-- (onde só entram as ativas) e continua no filtro e no cadastro.
--
-- A ORDEM VEM DO CÓDIGO
-- ---------------------
-- O cadastro ordenava por nome, o que punha CLIENTE ANTIGO em primeiro e LOJA
-- no meio — e a primeira da lista é a que o pedido novo traz marcada. O código
-- 01-08 guarda a ordem pedida; lib/db/origens-venda.js ordena por ele (quem não
-- tem código vai depois, por nome).
--
-- Idempotente: rodar de novo não duplica nem reativa o que alguém inativar
-- depois à mão — só garante as oito, com código, e inativa as que não são elas.
-- ============================================================================

insert into sales_origins (id, name, code, status, notes)
values
  ('orig-loja',           'LOJA',           '01', 'ativo', 'Origem pedida pela loja (fase DT).'),
  ('orig-indicacao',      'INDICAÇÃO',      '02', 'ativo', 'Origem pedida pela loja (fase DT).'),
  ('orig-whatsapp',       'WHATSAPP',       '03', 'ativo', 'Origem pedida pela loja (fase DT).'),
  ('orig-instagram',      'INSTAGRAM',      '04', 'ativo', 'Origem pedida pela loja (fase DT).'),
  ('orig-facebook',       'FACEBOOK',       '05', 'ativo', 'Origem pedida pela loja (fase DT).'),
  ('orig-google',         'GOOGLE',         '06', 'ativo', 'Origem pedida pela loja (fase DT).'),
  ('orig-site',           'SITE',           '07', 'ativo', 'Origem pedida pela loja (fase DT).'),
  ('orig-cliente-antigo', 'CLIENTE ANTIGO', '08', 'ativo', 'Origem pedida pela loja (fase DT).')
-- O índice único é por lower(name): se alguém já cadastrou "Loja" à mão, o
-- insert desta linha é ignorado e o update abaixo dá o código a ela.
on conflict do nothing;

update sales_origins o
set code = n.code, updated_at = now()
from (values
  ('loja', '01'), ('indicação', '02'), ('whatsapp', '03'), ('instagram', '04'),
  ('facebook', '05'), ('google', '06'), ('site', '07'), ('cliente antigo', '08')
) as n(nome, code)
where lower(o.name) = n.nome and o.code is distinct from n.code;

update sales_origins
set status = 'inativo', updated_at = now()
where status = 'ativo'
  and lower(name) not in ('loja', 'indicação', 'whatsapp', 'instagram', 'facebook', 'google', 'site', 'cliente antigo');
