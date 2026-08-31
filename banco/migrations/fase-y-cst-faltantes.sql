-- Fase Y — códigos CST que faltavam nas tabelas de referência.
--
-- Origem: conferência contra as listas do ERP que o usuário usa hoje
-- (2026-08-10). A tabela de CST de ICMS estava sem o 61, e a de PIS/COFINS
-- sem onze códigos da faixa de crédito presumido (60 a 67) e da faixa de
-- crédito vinculado (52, 54, 55).
--
-- Por que isso importa mesmo sendo revenda: a tela de regra fiscal monta os
-- selects a partir DESTAS tabelas. Um código ausente não é só um item a menos
-- na lista — é uma operação que não tem como ser cadastrada. E quando o
-- contador pedir um CST que não está aqui, o caminho fácil vira digitar
-- errado o que está.
--
-- Idempotente: pode rodar mais de uma vez.

-- ---------------------------------------------------------------------------
-- CST de ICMS — 61
-- ---------------------------------------------------------------------------
-- Criado pela NT 2016.002 (monofasia de combustíveis, EC 33/2001 + LC 192/2022).
-- Não se aplica a revenda comum; entra para a lista ficar completa.
insert into cst_icms (codigo, descricao) values
  ('61', 'Tributação monofásica sobre combustíveis cobrada anteriormente')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- CST de PIS/COFINS — faixas de crédito que faltavam
-- ---------------------------------------------------------------------------
-- ATENÇÃO: estes códigos são de regime NÃO-CUMULATIVO (Lucro Real). No Lucro
-- Presumido, que é cumulativo, a saída é CST 01 e não há crédito a apropriar;
-- no Simples Nacional, CST 49. Estarem disponíveis na lista não significa que
-- possam ser usados nos regimes desta empresa — ver a regra fiscal.
insert into cst_pis_cofins (codigo, descricao, grupo) values
  ('52', 'Operação com direito a crédito — vinculada exclusivamente a receita de exportação', 'ENTRADA'),
  ('54', 'Operação com direito a crédito — vinculada a receitas tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('55', 'Operação com direito a crédito — vinculada a receitas não-tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('60', 'Crédito presumido — operação de aquisição vinculada exclusivamente a receita tributada no mercado interno', 'ENTRADA'),
  ('61', 'Crédito presumido — operação de aquisição vinculada exclusivamente a receita não-tributada no mercado interno', 'ENTRADA'),
  ('62', 'Crédito presumido — operação de aquisição vinculada exclusivamente a receita de exportação', 'ENTRADA'),
  ('63', 'Crédito presumido — operação de aquisição vinculada a receitas tributadas e não-tributadas no mercado interno', 'ENTRADA'),
  ('64', 'Crédito presumido — operação de aquisição vinculada a receitas tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('65', 'Crédito presumido — operação de aquisição vinculada a receitas não-tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('66', 'Crédito presumido — operação de aquisição vinculada a receitas tributadas e não-tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('67', 'Crédito presumido — outras operações', 'ENTRADA')
on conflict (codigo) do update set descricao = excluded.descricao, grupo = excluded.grupo;
