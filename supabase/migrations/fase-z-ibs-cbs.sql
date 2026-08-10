-- Fase Z — IBS e CBS (Reforma Tributária, LC 214/2025).
--
-- Dois códigos novos, e eles NÃO são independentes:
--
--   CST do IBS/CBS  (3 dígitos)  — a situação tributária, como o CST do ICMS.
--   cClassTrib      (6 dígitos)  — a classificação tributária, que detalha QUAL
--                                  hipótese legal se aplica dentro daquele CST.
--
-- Os três primeiros dígitos do cClassTrib SÃO o CST. 000001 pertence ao CST
-- 000, 011002 ao CST 011, 200003 ao CST 200. Isso não é convenção de nome: é a
-- estrutura do código, e o CHECK abaixo impede que uma linha errada entre.
-- Sem essa amarra, um cClassTrib cadastrado sob o CST errado só apareceria
-- como rejeição da SEFAZ, com a nota já montada.
--
-- Idempotente: pode rodar mais de uma vez.

-- ---------------------------------------------------------------------------
-- CST do IBS/CBS — tabela COMPLETA (19 códigos)
-- ---------------------------------------------------------------------------
create table if not exists cst_ibs_cbs (
  codigo char(3) primary key,
  descricao text not null
);

insert into cst_ibs_cbs (codigo, descricao) values
  ('000', 'Tributação integral'),
  ('010', 'Tributação com alíquotas uniformes — operações setor financeiro'),
  ('011', 'Tributação com alíquotas uniformes reduzidas em 60%'),
  ('200', 'Alíquota reduzida'),
  ('210', 'Alíquota reduzida com redutor de base de cálculo'),
  ('220', 'Alíquota fixa'),
  ('221', 'Alíquota fixa proporcional'),
  ('222', 'Redução de base de cálculo'),
  ('400', 'Isenção'),
  ('410', 'Imunidade e não incidência'),
  ('510', 'Diferimento'),
  ('515', 'Diferimento com redução de alíquota'),
  ('550', 'Suspensão'),
  ('620', 'Tributação monofásica'),
  ('800', 'Transferência de crédito'),
  ('810', 'Ajustes'),
  ('811', 'Anulação de crédito'),
  ('820', 'Tributação em declaração de regime específico'),
  ('830', 'Exclusão de base de cálculo')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- cClassTrib — classificação tributária
-- ---------------------------------------------------------------------------
-- ATENÇÃO: esta tabela está PARCIAL de propósito.
--
-- A tabela oficial da LC 214/2025 tem centenas de códigos. Aqui entraram
-- apenas os que foram conferidos um a um contra a listagem do ERP em uso
-- (2026-08-10) — as faixas 000xxx, 010xxx, 011xxx e 200xxx até 200008.
--
-- Preferi a lista curta e correta à lista longa e chutada: um cClassTrib
-- inventado não é recusado no cadastro, vai para a nota e volta como rejeição
-- da SEFAZ — ou pior, passa e classifica a operação sob uma hipótese legal que
-- não é a dela.
--
-- Enquanto estiver incompleta, a tela de regra fiscal aceita digitar o código
-- à mão (o mesmo comportamento que já existe quando a tabela não existe).
-- Para completar: exportar a lista do ERP atual e dar INSERT aqui.
create table if not exists classificacao_tributaria (
  codigo char(6) primary key,
  -- Os 3 primeiros dígitos do código SÃO o CST. Guardar separado é redundante
  -- de propósito: é o que permite filtrar o select por CST escolhido.
  cst char(3) not null references cst_ibs_cbs(codigo),
  descricao text not null,
  constraint classificacao_tributaria_cst_coerente
    check (cst = substring(codigo from 1 for 3))
);

create index if not exists idx_classificacao_tributaria_cst on classificacao_tributaria (cst);

insert into classificacao_tributaria (codigo, cst, descricao) values
  ('000001', '000', 'Situações tributadas integralmente pelo IBS e CBS'),
  ('000002', '000', 'Exploração de via, observado o art. 11 da LC 214/2025'),
  ('000003', '000', 'Regime automotivo — projetos incentivados, observado o art. 311 da LC 214/2025'),
  ('000004', '000', 'Regime automotivo — projetos incentivados, observado o art. 312 da LC 214/2025'),
  ('010001', '010', 'Operações do FGTS não realizadas pela Caixa Econômica Federal, observado o art. 212 da LC 214/2025'),
  ('010002', '010', 'Operações do serviço financeiro'),
  ('011001', '011', 'Planos de assistência funerária, observado o art. 236 da LC 214/2025'),
  ('011002', '011', 'Planos de assistência à saúde, observado o art. 237 da LC 214/2025'),
  ('011003', '011', 'Intermediação de planos de assistência à saúde, observado o art. 240 da LC 214/2025'),
  ('011004', '011', 'Concursos e prognósticos, observado o art. 246 da LC 214/2025'),
  ('011005', '011', 'Planos de assistência à saúde de animais domésticos, observado o art. 243 da LC 214/2025'),
  ('200001', '200', 'Aquisições de máquinas, aparelhos, instrumentos, equipamentos, matérias-primas, produtos intermediários e materiais de embalagem realizadas entre empresas autorizadas a operar em zonas de processamento de exportação, observado o art. 103 da LC 214/2025'),
  ('200002', '200', 'Fornecimento ou importação de tratores, máquinas e implementos agrícolas destinados a produtor rural não contribuinte, e de veículos de transporte de carga destinados a transportador autônomo de carga pessoa física não contribuinte, observado o art. 110 da LC 214/2025'),
  ('200003', '200', 'Vendas de produtos destinados à alimentação humana relacionados no Anexo I da LC 214/2025, que compõem a Cesta Básica Nacional de Alimentos, observado o art. 125 da LC 214/2025'),
  ('200004', '200', 'Venda de dispositivos médicos com as classificações da NCM/SH previstas no Anexo XII da LC 214/2025, observado o art. 144 da LC 214/2025'),
  ('200005', '200', 'Venda de dispositivos médicos com as classificações da NCM/SH previstas no Anexo IV da LC 214/2025, quando adquiridos por órgãos da administração pública direta, autarquias e fundações públicas, observado o art. 144 da LC 214/2025'),
  ('200006', '200', 'Situação de emergência de saúde pública reconhecida pelo Poder Legislativo federal, estadual, distrital ou municipal competente, para incluir dispositivos não listados no Anexo XII da LC 214/2025'),
  ('200007', '200', 'Fornecimento de dispositivos de acessibilidade próprios para pessoas com deficiência relacionados no Anexo XIII da LC 214/2025, observado o art. 145 da LC 214/2025'),
  ('200008', '200', 'Fornecimento de dispositivos de acessibilidade próprios para pessoas com deficiência relacionados no Anexo V da LC 214/2025, quando adquiridos por órgãos da administração pública direta, autarquias, fundações públicas e entidades imunes, observado o art. 145 da LC 214/2025')
on conflict (codigo) do update set cst = excluded.cst, descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- Regra fiscal — colunas de IBS/CBS
-- ---------------------------------------------------------------------------
-- As alíquotas ficam na regra, não no código: são definidas por lei e mudam a
-- cada ano da transição. Em 2026 (fase de teste) valem CBS 0,9% e IBS 0,1%,
-- compensáveis com PIS/COFINS — mas quem preenche é o contador, do mesmo jeito
-- que as alíquotas de ICMS.
alter table regra_fiscal add column if not exists cst_ibs_cbs char(3);
alter table regra_fiscal add column if not exists class_trib char(6);
alter table regra_fiscal add column if not exists aliquota_ibs numeric(7,4);
alter table regra_fiscal add column if not exists aliquota_cbs numeric(7,4);

comment on column regra_fiscal.cst_ibs_cbs is 'CST do IBS/CBS (LC 214/2025). Os 3 primeiros dígitos de class_trib.';
comment on column regra_fiscal.class_trib is 'cClassTrib — classificação tributária de 6 dígitos. Começa pelo cst_ibs_cbs.';
