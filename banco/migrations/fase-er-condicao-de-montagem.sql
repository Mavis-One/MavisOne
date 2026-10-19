-- ============================================================================
-- FASE ER — CONDIÇÃO DE MONTAGEM (DESMONTADO / MONTADO) NO SALDO
-- ============================================================================
--
-- Pedido do usuário (17/10/2026): o script "MAVIS ONE — 006" (estoque por
-- condição de montagem, ordem de montagem no PCP, venda nos dois estados,
-- movimentos imutáveis), ADAPTADO ao que o sistema já tem — e não rodado como
-- veio: ele recriava stock_movements e supunha products.id uuid. Decidido com
-- ele:
--   - a condição só vale para o produto marcado "Controla montagem" no
--     cadastro; nasce marcada nos de NCM 8711;
--   - TODO o saldo que esses produtos já têm vira MONTADO (lojas e Electric
--     inclusive);
--   - os dois depósitos da matriz (fase EE) viram UM: o saldo do "Depósito
--     Matriz - Montados" passa ao "Depósito Matriz" por transferência
--     registrada, e o de Montados fica inativo;
--   - a localização dentro do depósito fica para uma segunda etapa.
--
-- O que o 006 trazia e o sistema já tinha: a cor (product_classes, gravada em
-- cada movimento), o saldo derivado do razão com a trava do produto e a guarda
-- de saldo negativo (commitStockMovements), a baixa parcial com estorno
-- (pcp_baixas). Fica de fora: SKU/EAN por cor, a tabela de saldos gravados e o
-- "saldo depois" em cada linha.
-- ============================================================================

-- 1. O PRODUTO DIZ SE CONTROLA MONTAGEM ---------------------------------------
alter table if exists products add column if not exists controla_montagem boolean not null default false;

update products set controla_montagem = true
 where controla_montagem = false
   and regexp_replace(coalesce(ncm, ''), '\D', '', 'g') like '8711%';

-- 2. A CONDIÇÃO VIVE NO MOVIMENTO, COMO A COR ---------------------------------
-- '' = produto que não controla montagem. O estorno aponta o movimento que
-- desfaz (estorno_de): o razão deixa de apagar linha (ver o item 6).
alter table if exists stock_movements add column if not exists condicao text not null default ''
  check (condicao in ('', 'desmontado', 'montado'));
alter table if exists stock_movements add column if not exists estorno_de text not null default '';
create index if not exists idx_stock_mov_estorno_de on stock_movements (estorno_de) where estorno_de <> '';
create index if not exists idx_stock_mov_produto_condicao on stock_movements (product_id, condicao) where condicao <> '';

alter table if exists stock_transfers add column if not exists condicao text not null default ''
  check (condicao in ('', 'desmontado', 'montado'));
alter table if exists stock_transfers add column if not exists estornada_em timestamptz;
alter table if exists stock_transfers add column if not exists estornada_por_nome text;
alter table if exists stock_transfers drop constraint if exists stock_transfers_status_check;
alter table if exists stock_transfers add constraint stock_transfers_status_check
  check (status in ('enviada', 'recebida', 'estornada'));

-- A contagem conta cada condição em separado.
alter table if exists stock_count_items add column if not exists condicao text not null default ''
  check (condicao in ('', 'desmontado', 'montado'));
drop index if exists idx_count_items_unico;
create unique index if not exists idx_count_items_unico_condicao
  on stock_count_items (count_id, product_id, class_value_id, condicao);

-- 3. O SALDO QUE JÁ EXISTE É MONTADO (decisão do usuário) ---------------------
update stock_movements m set condicao = 'montado'
  from products p
 where p.id = m.product_id and p.controla_montagem and m.condicao = '';
update stock_transfers t set condicao = 'montado'
  from products p
 where p.id = t.product_id and p.controla_montagem and t.condicao = '';

-- 4. UM DEPÓSITO SÓ NA MATRIZ ------------------------------------------------
-- `unido_a`: o depósito que passou a valer no lugar deste. O servidor manda
-- para lá todo movimento novo que ainda aponte para o antigo (o estorno de uma
-- venda feita do Montados, por exemplo), em vez de encher um depósito inativo.
alter table if exists deposits add column if not exists unido_a text;
alter table if exists deposits drop constraint if exists deposits_classificacao_check;
alter table if exists deposits add constraint deposits_classificacao_check
  check (classificacao is null or classificacao in ('desmontados', 'montados', 'montagem'));

do $$
declare
  v_montados text;
  v_matriz text;
  v_agora timestamptz := now();
  r record;
  v_tra text;
  v_saida text;
  v_entrada text;
  v_de text;
  v_para text;
  v_qtd numeric;
begin
  select id into v_montados from deposits where classificacao = 'montados' limit 1;
  select id into v_matriz from deposits where classificacao = 'desmontados' limit 1;
  if v_montados is null or v_matriz is null then
    return;
  end if;

  -- Cada produto + cor + condição com saldo no Montados vira uma
  -- transferência recebida para o Depósito Matriz. Saldo negativo (se houver)
  -- vai no sentido contrário: o Montados termina zerado nos dois casos.
  for r in
    select m.product_id, max(m.product_name) as product_name, max(m.class_id) as class_id,
           m.class_value_id, m.condicao,
           sum(case when m.type = 'saida' then -m.quantity else m.quantity end) as saldo
      from stock_movements m
     where m.deposit_id = v_montados
     group by m.product_id, m.class_value_id, m.condicao
    having sum(case when m.type = 'saida' then -m.quantity else m.quantity end) <> 0
  loop
    v_qtd := abs(r.saldo);
    if r.saldo > 0 then
      v_de := v_montados; v_para := v_matriz;
    else
      v_de := v_matriz; v_para := v_montados;
    end if;
    v_tra := 'tra-' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 15);
    v_saida := 'mov-' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 15);
    v_entrada := 'mov-' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(random()::text), 1, 15);

    insert into stock_movements (id, code, type, date, product_id, product_name, deposit_id, class_id, class_value_id,
                                 quantity, unit_cost, category_id, document, note, transfer_id, origin, motivo,
                                 reference_type, reference_id, created_by, created_by_name, condicao)
    select v_saida, 'MOV-' || lpad(nextval('stock_movements_code_seq')::text, 4, '0'), 'saida', current_date,
           r.product_id, coalesce(r.product_name, ''), v_de, coalesce(r.class_id, ''), r.class_value_id,
           v_qtd, coalesce(p.cost_price, 0), '', 'Fase ER', 'União dos depósitos da matriz (saída)', v_tra,
           'transferencia', '', 'unificacao-deposito', v_montados, '', 'Sistema (fase ER)', r.condicao
      from (select 1) x left join products p on p.id = r.product_id;

    insert into stock_movements (id, code, type, date, product_id, product_name, deposit_id, class_id, class_value_id,
                                 quantity, unit_cost, category_id, document, note, transfer_id, origin, motivo,
                                 reference_type, reference_id, created_by, created_by_name, condicao)
    select v_entrada, 'MOV-' || lpad(nextval('stock_movements_code_seq')::text, 4, '0'), 'entrada', current_date,
           r.product_id, coalesce(r.product_name, ''), v_para, coalesce(r.class_id, ''), r.class_value_id,
           v_qtd, coalesce(p.cost_price, 0), '', 'Fase ER', 'União dos depósitos da matriz (entrada)', v_tra,
           'transferencia', '', 'unificacao-deposito', v_montados, '', 'Sistema (fase ER)', r.condicao
      from (select 1) x left join products p on p.id = r.product_id;

    insert into stock_transfers (id, code, batch_id, date, product_id, origin_deposit_id, destination_deposit_id,
                                 class_id, class_value_id, quantity, note, movement_out_id, movement_in_id,
                                 created_by, created_by_name, status, received_quantity, sent_at, received_at,
                                 received_by_name, condicao)
    values (v_tra, 'TRA-' || lpad(nextval('stock_transfers_code_seq')::text, 4, '0'), 'lot-fase-er', current_date,
            r.product_id, v_de, v_para, coalesce(r.class_id, ''), r.class_value_id, v_qtd,
            'União dos depósitos da matriz (fase ER)', v_saida, v_entrada, '', 'Sistema (fase ER)',
            'recebida', v_qtd, v_agora, v_agora, 'Sistema (fase ER)', r.condicao);
  end loop;

  -- O que ainda aponta para o Montados passa ao Depósito Matriz. O razão e as
  -- baixas antigas ficam como estão (história); o resto é ponteiro.
  update orders set deposit_id = v_matriz where deposit_id = v_montados;
  update quotes set deposit_id = v_matriz where deposit_id = v_montados;
  update purchase_orders set deposit_id = v_matriz where deposit_id = v_montados;
  update equipments set deposit_id = v_matriz where deposit_id = v_montados;
  update stock_counts set deposit_id = v_matriz where deposit_id = v_montados and status = 'aberta';

  update deposits set classificacao = null, status = 'inativo', unido_a = v_matriz,
         notes = trim(both ' ' from coalesce(notes, '') || ' Unido ao Depósito Matriz na fase ER (17/10/2026).')
   where id = v_montados;
  -- O depósito da matriz passa a ser o DE MONTAGEM: os dois estados no mesmo lugar.
  update deposits set classificacao = 'montagem' where id = v_matriz;
end $$;

-- Daqui em diante só existe o depósito de montagem: o de desmontadas que
-- sobrou sem par (banco sem o de montadas) também vira o de montagem.
update deposits set classificacao = 'montagem'
 where classificacao = 'desmontados'
   and not exists (select 1 from deposits where classificacao = 'montagem');
update deposits set classificacao = null where classificacao in ('desmontados', 'montados');
alter table if exists deposits drop constraint if exists deposits_classificacao_check;
alter table if exists deposits add constraint deposits_classificacao_check
  check (classificacao is null or classificacao = 'montagem');

-- 5. ORDEM DE MONTAGEM NO PCP -------------------------------------------------
-- É uma OP de tipo 'montagem': não consome a ficha técnica, só troca a
-- condição (desmontado -> montado) no depósito e na cor da ordem. Cada
-- apontamento é uma baixa de montagem (pcp_baixas.ordem_id).
alter table if exists pcp_orders add column if not exists tipo text not null default 'producao'
  check (tipo in ('producao', 'montagem'));
alter table if exists pcp_orders add column if not exists deposit_id text;
alter table if exists pcp_orders add column if not exists class_value_id text;
alter table if exists pcp_baixas add column if not exists ordem_id text references pcp_orders(id) on delete set null;
create index if not exists idx_pcp_baixas_ordem on pcp_baixas (ordem_id) where ordem_id is not null;

-- 6. O RAZÃO NÃO APAGA LINHA --------------------------------------------------
-- O estorno de movimentação e de transferência passa a gravar o movimento
-- contrário (como a baixa de montagem e a contagem já faziam). O banco recusa
-- DELETE e UPDATE; a única mudança aceita é classificar a condição de um
-- movimento que não tinha (produto que passou a controlar montagem).
-- Manutenção consciente (limpar dado de teste) liga, dentro da transação:
--   set local mavisone.manutencao_do_razao = 'sim';
create or replace function trg_stock_movements_imutavel()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('mavisone.manutencao_do_razao', true), '') = 'sim' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Movimentação de estoque não se apaga: estorne (o estorno grava o movimento contrário).';
  end if;
  if (to_jsonb(new) - 'condicao') is distinct from (to_jsonb(old) - 'condicao')
     or (old.condicao <> '' and new.condicao is distinct from old.condicao) then
    raise exception 'Movimentação de estoque % não se altera: estorne e lance de novo.', old.code;
  end if;
  return new;
end $$;

drop trigger if exists stock_movements_imutavel on stock_movements;
create trigger stock_movements_imutavel
  before update or delete on stock_movements
  for each row execute function trg_stock_movements_imutavel();
