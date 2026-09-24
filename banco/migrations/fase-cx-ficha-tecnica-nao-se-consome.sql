-- ---------------------------------------------------------------------------
-- Fase CX — a ficha técnica não pode consumir o próprio produto
--
-- `pcp_bom` só tinha uma restrição: `pcp_bom_unico (product_id, component_id)`,
-- que impede o MESMO componente aparecer duas vezes na mesma ficha. Nada
-- impedia o componente de ser o PRÓPRIO produto final, e os dois selects do
-- formulário ("Produto final" e "Componente") saem da mesma lista de produtos —
-- é um clique de distância.
--
-- O QUE ACONTECIA, MEDIDO POR HTTP EM 24/09/2026
-- ----------------------------------------------
-- `aplicarConsumoDeProducao` monta o efeito de cada produto num Map por id:
-- soma +quantidade no produto final e -quantidade×(1+perda) em cada componente.
-- Quando o componente É o produto final, as duas somas caem na MESMA chave e se
-- cancelam. O apontamento é aceito, `quantity_done` sobe, a lista de Ordens
-- passa a exibir "Produzido: 10" — e NENHUM movimento de estoque é gravado:
--
--     ficha: PRODUTO consome PRODUTO, 1 por unidade
--     estoque antes 50 -> apontar 10 -> estoque depois 50, 0 movimentos
--
-- Silencioso é a parte ruim. Ninguém procura o erro numa tela que mostra a
-- produção lançada e o estoque parado; procura-se na contagem, meses depois.
--
-- E COM QUANTIDADE FRACIONÁRIA, CRIA ESTOQUE DO NADA
-- --------------------------------------------------
-- As duas somas só se anulam quando a quantidade por unidade é exatamente 1.
-- Com 0,5 o saldo do Map dá +quantidade/2, e o movimento gravado é uma ENTRADA
-- que não consumiu nada:
--
--     ficha: PRODUTO consome PRODUTO, 0,5 por unidade
--     estoque antes 50 -> apontar 10 -> estoque depois 55
--
-- Dez unidades produzidas, cinco unidades a mais no estoque, e um movimento de
-- entrada no razão que parece legítimo.
--
-- POR QUE A RECUSA VEM DO BANCO, E TAMBÉM DA ROTA
-- -----------------------------------------------
-- O CHECK aqui é a verdade: nenhuma linha entra por nenhum caminho — rota,
-- importação, psql. A rota confere antes só para a mensagem ser em português e
-- dizer o que fazer, em vez de o usuário receber o texto cru do Postgres.
-- Mesma divisão do código repetido de depósito.
--
-- O CICLO INDIRETO CONTINUA POSSÍVEL, E É PROPOSITAL
-- --------------------------------------------------
-- A → B e B → A passa por aqui, porque nenhuma das duas linhas viola o CHECK.
-- Hoje isso não corrompe nada: `aplicarConsumoDeProducao` lê UM nível de ficha
-- (a do produto da ordem) e não desce nos componentes, então produzir A consome
-- B e produzir B consome A — duas operações válidas, uma modelagem estranha.
--
-- Fica registrado porque no dia em que a explosão passar a ser multinível (para
-- o custo rolar de baixo para cima, ou para um MRP), esse mesmo par vira
-- recursão infinita. A hora de barrar o ciclo é junto com o código que desce
-- nos níveis, não antes: barrar agora exigiria varrer o grafo a cada gravação
-- para proteger de um caminho que ninguém percorre.
-- ---------------------------------------------------------------------------

-- Nenhuma linha é apagada daqui. Se existir ficha assim em produção, é dado do
-- usuário e a decisão é dele — o que esta migração faz é PARAR com o motivo na
-- tela, em vez de deixar o ALTER falhar com o texto cru da constraint.
do $$
declare
  quantas integer;
begin
  select count(*) into quantas from pcp_bom where product_id = component_id;
  if quantas > 0 then
    raise exception
      'Existem % linha(s) em pcp_bom com component_id = product_id (produto que consome a si mesmo). '
      'Apontar produção nessas fichas não movimenta estoque, ou cria estoque do nada. '
      'Corrija ou exclua essas linhas e rode a migração de novo: '
      'select * from pcp_bom where product_id = component_id;', quantas;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pcp_bom_nao_consome_a_si_mesmo'
  ) then
    alter table pcp_bom add constraint pcp_bom_nao_consome_a_si_mesmo
      check (product_id <> component_id);
  end if;
end $$;
