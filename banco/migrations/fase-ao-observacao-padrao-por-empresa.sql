-- ============================================================================
-- FASE AO — mensagem padrão das observações da nota, POR EMPRESA
-- ============================================================================
--
-- O QUE HAVIA
-- -----------
-- O texto que nasce no campo "Observações adicionais" da NF-e (o infCpl, o
-- bloco livre impresso no DANFE) era UM para o sistema inteiro: uma constante
-- em public/modules/shared/nfe_texto_padrao.js. Isso bastava enquanto havia uma
-- empresa emitindo.
--
-- Com mais de um CNPJ no mesmo sistema, deixa de bastar: ficha técnica, prazo
-- de garantia e instruções são compromisso COMERCIAL de quem assina a nota, e
-- quem assina é o CNPJ. Um texto único faria a nota de uma empresa prometer a
-- garantia da outra — e isso é o que vale numa discussão com o cliente, porque
-- está impresso no papel que ele guardou.
--
-- VAZIO CONTINUA VALENDO
-- ----------------------
-- Coluna nula ou em branco significa "usa o texto padrão do sistema", que é
-- exatamente o comportamento de antes desta fase. Nenhuma empresa existente
-- muda de comportamento ao rodar isto, e quem nunca preencher o campo nunca
-- percebe que ele existe.
--
-- ISTO NÃO É CAMPO FISCAL
-- -----------------------
-- O infCpl não altera imposto, base de cálculo nem CFOP. Errar o texto aqui
-- não faz a SEFAZ recusar a nota — faz a empresa prometer o que não queria.
-- O limite da SEFAZ para o infCpl é 5000 caracteres.
-- ============================================================================

alter table if exists empresa
  add column if not exists observacao_padrao_nfe text;

comment on column empresa.observacao_padrao_nfe is
  'Texto que nasce no campo de observações adicionais (infCpl) das notas deste CNPJ. Vazio = usa o padrão do sistema (modules/shared/nfe_texto_padrao.js). Ver fase-ao.';
