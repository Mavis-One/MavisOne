-- ============================================================================
-- FASE EJ — O CÓDIGO DO PRODUTO NÃO MUDA
-- ============================================================================
--
-- Pedido do usuário (13/10/2026): "proíba em todo o sistema a modificação dos
-- números de um código de produto". O código (products.sku) é o que está nos
-- pedidos, nas notas, nas contagens e nos relatórios do Viper; trocar o número
-- de um produto cadastrado faz o histórico apontar para outro item — foi assim
-- que o Ayla 500 e o Flic entraram com 9194/9193 no lugar de 9589/9587.
--
-- A trava fica no BANCO, e não só na tela: vale para todo caminho que grava
-- produto (cadastro, gestor de preços, importações, scripts). A tela deixa o
-- campo só de leitura e o servidor responde com a mensagem; isto aqui é o que
-- garante que nenhum caminho esquecido passe.
--
-- Produto SEM código ainda pode receber o primeiro: dar um código não é
-- modificar o que existia.
-- ============================================================================

create or replace function products_sku_imutavel()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sku is not distinct from old.sku then
    return new;
  end if;
  if coalesce(btrim(old.sku), '') = '' then
    return new;
  end if;
  raise exception 'O codigo (SKU) % do produto nao pode ser alterado.', old.sku
    using errcode = '23514';
end;
$$;

drop trigger if exists products_sku_imutavel on products;
create trigger products_sku_imutavel
  before update of sku on products
  for each row execute function products_sku_imutavel();
