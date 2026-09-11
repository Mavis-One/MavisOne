-- ============================================================================
-- FASE CE — o código de cadastro parava de crescer no centésimo
-- ============================================================================
--
-- O QUE ISTO CONSERTA
-- -------------------
-- `next_cadastro_code()` formatava o número com `lpad(n, 2, '0')`. O comentário
-- escrito logo acima dela, no schema, sempre disse a intenção certa:
--
--   "mesma regra de formatCadastroCode() em server.js: zero-padded com no
--    mínimo 2 dígitos"
--
-- E o `formatCadastroCode()` do server.js é `String(n).padStart(2, '0')`. O
-- `padStart` do JavaScript NUNCA corta: se o texto já tem o tamanho pedido ou
-- mais, ele volta inteiro.
--
-- O `lpad` do Postgres CORTA. Medido neste banco:
--
--   lpad('9',    2, '0')  ->  '09'    certo
--   lpad('100',  2, '0')  ->  '10'    o cadastro 100 vira o código 10
--   lpad('6493', 2, '0')  ->  '64'    o 6493 vira 64
--
-- A partir do centésimo cadastro, portanto, o código deixava de identificar
-- qualquer coisa: '10' passava a valer para o cadastro 10 e para o 100, '64'
-- para o 64, o 640, o 641 e o 6493. E como o código é o que a pessoa dita ao
-- telefone e usa para procurar na tela, dois cadastros com o mesmo código não
-- dão erro em lugar nenhum — só entregam o registro errado, calado.
--
-- POR QUE NUNCA APARECEU
-- ----------------------
-- O sistema nunca tinha passado de 99 cadastros. A importação do ViperERP, de
-- 6.492 pessoas, levaria a sequência para 6493 — e o PRÓXIMO cadastro feito
-- pela tela nasceria com o código '64', repetindo o de alguém.
--
-- É uma classe de bug que só existe depois de um volume, e o volume chegou de
-- uma vez, por importação, em vez de ir subindo aos poucos.
--
-- NADA A CORRIGIR PARA TRÁS: nenhum código de três dígitos ou mais chegou a ser
-- gerado por esta função. Os 6.492 da importação vieram numerados pelo próprio
-- arquivo de carga, que já usava a regra certa.
-- ============================================================================

create or replace function next_cadastro_code()
returns text
language sql
as $$
  -- `case` em vez de `lpad`: completa com zero quando falta, e não mexe quando
  -- já passa. É o que `padStart` faz do lado do JavaScript.
  select case when n < 10 then '0' || n::text else n::text end
    from nextval('cadastro_code_seq') as n;
$$;

comment on function next_cadastro_code() is
  'Próximo código de cadastro, com no MÍNIMO 2 dígitos — nunca truncado. '
  'Espelha formatCadastroCode() do server.js (padStart). Usar lpad aqui corta '
  'o número a partir de 100 e repete códigos (fase CE).';
