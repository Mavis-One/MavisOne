-- ---------------------------------------------------------------------------
-- Fase Q — tabelas fiscais de referência (CFOP, CST, CSOSN, origem)
--
-- Hoje CFOP e NCM são texto livre digitado à mão na emissão da NF-e. Errar um
-- dígito num documento fiscal não dá erro na tela: dá problema na apuração,
-- meses depois. Com as tabelas, o campo vira seleção com descrição ao lado.
--
-- SÃO CÓDIGOS OFICIAIS, não interpretação: o conteúdo abaixo é o texto da
-- legislação (Convênio S/Nº 1970 para CFOP; Anexos do Convênio 4/81 e da Lei
-- do Simples para CST/CSOSN). Nada aqui decide QUAL código se aplica ao seu
-- caso — isso é a regra_fiscal, e continua sendo assunto do seu contador.
--
-- ÚNICA EXCEÇÃO: a descrição do CFOP vem com a categoria na frente, separada
-- por ' · ' — "Vendas · Venda de produção do estabelecimento". O que vem ANTES
-- do ' · ' é agrupamento nosso, para o usuário achar o código numa lista de
-- 58 opções; o que vem DEPOIS é o texto da lei, sem alteração. A categoria não
-- virou coluna porque isso exigiria DDL, e a tela separa no ' · ' para montar
-- os grupos do select — mudar o separador quebra esse agrupamento.
--
-- SOBRE O CFOP: o primeiro dígito é o âmbito da operação e os três últimos
-- identificam a natureza:
--     1/2/3 = ENTRADA  (estadual / interestadual / exterior)
--     5/6/7 = SAÍDA    (estadual / interestadual / exterior)
-- Os três últimos dígitos NÃO significam a mesma coisa na entrada e na saída
-- (102 na saída é "venda de mercadoria de terceiros"; na entrada é "compra
-- para comercialização"), por isso as duas listas são separadas e cada código
-- é gravado por extenso — nada é gerado por combinação.
--
-- A lista é o subconjunto usado em comércio/revenda, incluindo substituição
-- tributária, conserto e ativo imobilizado. A tabela completa tem centenas de
-- códigos; acrescentar os que faltarem é um insert, sem mexer em código.
-- ---------------------------------------------------------------------------

create table if not exists cfop (
  codigo char(4) primary key,
  descricao text not null,
  -- ENTRADA ou SAIDA, derivado do primeiro dígito
  tipo text not null check (tipo in ('ENTRADA', 'SAIDA')),
  -- ESTADUAL (1/5), INTERESTADUAL (2/6) ou EXTERIOR (3/7)
  ambito text not null check (ambito in ('ESTADUAL', 'INTERESTADUAL', 'EXTERIOR')),
  ativo boolean not null default true
);
create index if not exists idx_cfop_tipo on cfop (tipo, ambito);

create table if not exists cst_icms (
  codigo char(2) primary key,
  descricao text not null
);

create table if not exists csosn (
  codigo char(3) primary key,
  descricao text not null
);

create table if not exists cst_pis_cofins (
  codigo char(2) primary key,
  descricao text not null,
  -- ENTRADA (créditos) ou SAIDA (débitos): a mesma tabela atende os dois
  grupo text not null check (grupo in ('ENTRADA', 'SAIDA'))
);

create table if not exists cst_ipi (
  codigo char(2) primary key,
  descricao text not null,
  grupo text not null check (grupo in ('ENTRADA', 'SAIDA'))
);

create table if not exists origem_mercadoria (
  codigo char(1) primary key,
  descricao text not null
);

-- ---------------------------------------------------------------------------
-- CFOP — SAÍDAS (5 = dentro do estado, 6 = interestadual)
-- ---------------------------------------------------------------------------
insert into cfop (codigo, descricao, tipo, ambito) values
  ('5101', 'Vendas · Venda de produção do estabelecimento', 'SAIDA', 'ESTADUAL'),
  ('5102', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros', 'SAIDA', 'ESTADUAL'),
  ('5103', 'Vendas · Venda de produção do estabelecimento, efetuada fora do estabelecimento', 'SAIDA', 'ESTADUAL'),
  ('5104', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros, efetuada fora do estabelecimento', 'SAIDA', 'ESTADUAL'),
  ('5109', 'Vendas · Venda de produção do estabelecimento destinada à Zona Franca de Manaus ou Áreas de Livre Comércio', 'SAIDA', 'ESTADUAL'),
  ('5110', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros destinada à Zona Franca de Manaus ou Áreas de Livre Comércio', 'SAIDA', 'ESTADUAL'),
  ('5114', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros, remetida anteriormente em consignação mercantil', 'SAIDA', 'ESTADUAL'),
  ('5152', 'Transferência · Transferência de mercadoria adquirida ou recebida de terceiros', 'SAIDA', 'ESTADUAL'),
  ('5201', 'Devolução · Devolução de compra para industrialização ou produção rural', 'SAIDA', 'ESTADUAL'),
  ('5202', 'Devolução · Devolução de compra para comercialização', 'SAIDA', 'ESTADUAL'),
  ('5401', 'Vendas · Venda de produção do estabelecimento em operação com produto sujeito ao regime de substituição tributária, na condição de contribuinte substituto', 'SAIDA', 'ESTADUAL'),
  ('5403', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituto', 'SAIDA', 'ESTADUAL'),
  ('5405', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituído', 'SAIDA', 'ESTADUAL'),
  ('5409', 'Transferência · Transferência de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária', 'SAIDA', 'ESTADUAL'),
  ('5411', 'Devolução · Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 'SAIDA', 'ESTADUAL'),
  ('5551', 'Vendas · Venda de bem do ativo imobilizado', 'SAIDA', 'ESTADUAL'),
  ('5552', 'Transferência · Transferência de bem do ativo imobilizado', 'SAIDA', 'ESTADUAL'),
  ('5556', 'Devolução · Devolução de compra de material de uso ou consumo', 'SAIDA', 'ESTADUAL'),
  ('5901', 'Remessas · Remessa para industrialização por encomenda', 'SAIDA', 'ESTADUAL'),
  ('5902', 'Remessas · Retorno de mercadoria utilizada na industrialização por encomenda', 'SAIDA', 'ESTADUAL'),
  ('5910', 'Remessas · Remessa em bonificação, doação ou brinde', 'SAIDA', 'ESTADUAL'),
  ('5911', 'Remessas · Remessa de amostra grátis', 'SAIDA', 'ESTADUAL'),
  ('5912', 'Remessas · Remessa de mercadoria ou bem para demonstração, mostruário ou treinamento', 'SAIDA', 'ESTADUAL'),
  ('5913', 'Remessas · Retorno de mercadoria ou bem recebido para demonstração ou mostruário', 'SAIDA', 'ESTADUAL'),
  ('5915', 'Remessas · Remessa de mercadoria ou bem para conserto ou reparo', 'SAIDA', 'ESTADUAL'),
  ('5916', 'Remessas · Retorno de mercadoria ou bem recebido para conserto ou reparo', 'SAIDA', 'ESTADUAL'),
  ('5917', 'Remessas · Remessa de mercadoria em consignação mercantil ou industrial', 'SAIDA', 'ESTADUAL'),
  ('5920', 'Remessas · Remessa de vasilhame ou sacaria', 'SAIDA', 'ESTADUAL'),
  ('5927', 'Estoque · Lançamento efetuado a título de baixa de estoque decorrente de perda, roubo ou deterioração', 'SAIDA', 'ESTADUAL'),
  ('5949', 'Outros · Outra saída de mercadoria ou prestação de serviço não especificado', 'SAIDA', 'ESTADUAL'),
  ('6101', 'Vendas · Venda de produção do estabelecimento', 'SAIDA', 'INTERESTADUAL'),
  ('6102', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros', 'SAIDA', 'INTERESTADUAL'),
  ('6103', 'Vendas · Venda de produção do estabelecimento, efetuada fora do estabelecimento', 'SAIDA', 'INTERESTADUAL'),
  ('6104', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros, efetuada fora do estabelecimento', 'SAIDA', 'INTERESTADUAL'),
  ('6107', 'Vendas · Venda de produção do estabelecimento, destinada a não contribuinte', 'SAIDA', 'INTERESTADUAL'),
  ('6108', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros, destinada a não contribuinte', 'SAIDA', 'INTERESTADUAL'),
  ('6109', 'Vendas · Venda de produção do estabelecimento destinada à Zona Franca de Manaus ou Áreas de Livre Comércio', 'SAIDA', 'INTERESTADUAL'),
  ('6110', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros destinada à Zona Franca de Manaus ou Áreas de Livre Comércio', 'SAIDA', 'INTERESTADUAL'),
  ('6201', 'Devolução · Devolução de compra para industrialização ou produção rural', 'SAIDA', 'INTERESTADUAL'),
  ('6202', 'Devolução · Devolução de compra para comercialização', 'SAIDA', 'INTERESTADUAL'),
  ('6401', 'Vendas · Venda de produção do estabelecimento em operação com produto sujeito ao regime de substituição tributária, na condição de contribuinte substituto', 'SAIDA', 'INTERESTADUAL'),
  ('6403', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituto', 'SAIDA', 'INTERESTADUAL'),
  ('6404', 'Vendas · Venda de mercadoria sujeita ao regime de substituição tributária, cujo imposto já tenha sido retido anteriormente', 'SAIDA', 'INTERESTADUAL'),
  ('6409', 'Transferência · Transferência de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária', 'SAIDA', 'INTERESTADUAL'),
  ('6411', 'Devolução · Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 'SAIDA', 'INTERESTADUAL'),
  ('6551', 'Vendas · Venda de bem do ativo imobilizado', 'SAIDA', 'INTERESTADUAL'),
  ('6552', 'Transferência · Transferência de bem do ativo imobilizado', 'SAIDA', 'INTERESTADUAL'),
  ('6556', 'Devolução · Devolução de compra de material de uso ou consumo', 'SAIDA', 'INTERESTADUAL'),
  ('6901', 'Remessas · Remessa para industrialização por encomenda', 'SAIDA', 'INTERESTADUAL'),
  ('6902', 'Remessas · Retorno de mercadoria utilizada na industrialização por encomenda', 'SAIDA', 'INTERESTADUAL'),
  ('6910', 'Remessas · Remessa em bonificação, doação ou brinde', 'SAIDA', 'INTERESTADUAL'),
  ('6913', 'Remessas · Retorno de mercadoria ou bem recebido para demonstração ou mostruário', 'SAIDA', 'INTERESTADUAL'),
  ('6915', 'Remessas · Remessa de mercadoria ou bem para conserto ou reparo', 'SAIDA', 'INTERESTADUAL'),
  ('6916', 'Remessas · Retorno de mercadoria ou bem recebido para conserto ou reparo', 'SAIDA', 'INTERESTADUAL'),
  ('6917', 'Remessas · Remessa de mercadoria em consignação mercantil ou industrial', 'SAIDA', 'INTERESTADUAL'),
  ('6949', 'Outros · Outra saída de mercadoria ou prestação de serviço não especificado', 'SAIDA', 'INTERESTADUAL'),
  ('7102', 'Vendas · Venda de mercadoria adquirida ou recebida de terceiros', 'SAIDA', 'EXTERIOR'),
  ('7949', 'Outros · Outra saída de mercadoria ou prestação de serviço não especificado', 'SAIDA', 'EXTERIOR')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- CFOP — ENTRADAS (1 = dentro do estado, 2 = interestadual, 3 = exterior)
-- ---------------------------------------------------------------------------
insert into cfop (codigo, descricao, tipo, ambito) values
  ('1101', 'Compras · Compra para industrialização ou produção rural', 'ENTRADA', 'ESTADUAL'),
  ('1102', 'Compras · Compra para comercialização', 'ENTRADA', 'ESTADUAL'),
  ('1201', 'Compras · Devolução de venda de produção do estabelecimento', 'ENTRADA', 'ESTADUAL'),
  ('1202', 'Compras · Devolução de venda de mercadoria adquirida ou recebida de terceiros', 'ENTRADA', 'ESTADUAL'),
  ('1401', 'Compras · Compra para industrialização em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'ESTADUAL'),
  ('1403', 'Compras · Compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'ESTADUAL'),
  ('1409', 'Compras · Transferência para industrialização em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'ESTADUAL'),
  ('1411', 'Compras · Devolução de venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'ESTADUAL'),
  ('1551', 'Compras · Compra de bem para o ativo imobilizado', 'ENTRADA', 'ESTADUAL'),
  ('1556', 'Compras · Compra de material para uso ou consumo', 'ENTRADA', 'ESTADUAL'),
  ('1902', 'Compras · Retorno de mercadoria remetida para industrialização por encomenda', 'ENTRADA', 'ESTADUAL'),
  ('1912', 'Compras · Entrada de mercadoria ou bem recebido para demonstração ou mostruário', 'ENTRADA', 'ESTADUAL'),
  ('1915', 'Compras · Entrada de mercadoria ou bem recebido para conserto ou reparo', 'ENTRADA', 'ESTADUAL'),
  ('1916', 'Compras · Retorno de mercadoria ou bem remetido para conserto ou reparo', 'ENTRADA', 'ESTADUAL'),
  ('1949', 'Compras · Outra entrada de mercadoria ou prestação de serviço não especificado', 'ENTRADA', 'ESTADUAL'),
  ('2101', 'Compras · Compra para industrialização ou produção rural', 'ENTRADA', 'INTERESTADUAL'),
  ('2102', 'Compras · Compra para comercialização', 'ENTRADA', 'INTERESTADUAL'),
  ('2201', 'Compras · Devolução de venda de produção do estabelecimento', 'ENTRADA', 'INTERESTADUAL'),
  ('2202', 'Compras · Devolução de venda de mercadoria adquirida ou recebida de terceiros', 'ENTRADA', 'INTERESTADUAL'),
  ('2401', 'Compras · Compra para industrialização em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'INTERESTADUAL'),
  ('2403', 'Compras · Compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'INTERESTADUAL'),
  ('2411', 'Compras · Devolução de venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária', 'ENTRADA', 'INTERESTADUAL'),
  ('2551', 'Compras · Compra de bem para o ativo imobilizado', 'ENTRADA', 'INTERESTADUAL'),
  ('2556', 'Compras · Compra de material para uso ou consumo', 'ENTRADA', 'INTERESTADUAL'),
  ('2902', 'Compras · Retorno de mercadoria remetida para industrialização por encomenda', 'ENTRADA', 'INTERESTADUAL'),
  ('2915', 'Compras · Entrada de mercadoria ou bem recebido para conserto ou reparo', 'ENTRADA', 'INTERESTADUAL'),
  ('2916', 'Compras · Retorno de mercadoria ou bem remetido para conserto ou reparo', 'ENTRADA', 'INTERESTADUAL'),
  ('2949', 'Compras · Outra entrada de mercadoria ou prestação de serviço não especificado', 'ENTRADA', 'INTERESTADUAL'),
  ('3102', 'Compras · Compra para comercialização', 'ENTRADA', 'EXTERIOR'),
  ('3949', 'Compras · Outra entrada de mercadoria ou prestação de serviço não especificado', 'ENTRADA', 'EXTERIOR')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- CST de ICMS — Tabela B (regime normal: Lucro Presumido e Lucro Real)
-- ---------------------------------------------------------------------------
insert into cst_icms (codigo, descricao) values
  ('00', 'Tributada integralmente'),
  ('10', 'Tributada e com cobrança do ICMS por substituição tributária'),
  ('20', 'Com redução de base de cálculo'),
  ('30', 'Isenta ou não tributada e com cobrança do ICMS por substituição tributária'),
  ('40', 'Isenta'),
  ('41', 'Não tributada'),
  ('50', 'Suspensão'),
  ('51', 'Diferimento'),
  ('60', 'ICMS cobrado anteriormente por substituição tributária'),
  ('70', 'Com redução de base de cálculo e cobrança do ICMS por substituição tributária'),
  ('90', 'Outras')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- CSOSN — Simples Nacional (substitui o CST de ICMS quando CRT é 1 ou 2)
-- ---------------------------------------------------------------------------
insert into csosn (codigo, descricao) values
  ('101', 'Tributada pelo Simples Nacional com permissão de crédito'),
  ('102', 'Tributada pelo Simples Nacional sem permissão de crédito'),
  ('103', 'Isenção do ICMS no Simples Nacional para faixa de receita bruta'),
  ('201', 'Tributada pelo Simples Nacional com permissão de crédito e com cobrança do ICMS por substituição tributária'),
  ('202', 'Tributada pelo Simples Nacional sem permissão de crédito e com cobrança do ICMS por substituição tributária'),
  ('203', 'Isenção do ICMS no Simples Nacional para faixa de receita bruta e com cobrança do ICMS por substituição tributária'),
  ('300', 'Imune'),
  ('400', 'Não tributada pelo Simples Nacional'),
  ('500', 'ICMS cobrado anteriormente por substituição tributária ou por antecipação'),
  ('900', 'Outros')
on conflict (codigo) do update set descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- CST de PIS/COFINS
-- ---------------------------------------------------------------------------
insert into cst_pis_cofins (codigo, descricao, grupo) values
  ('01', 'Operação tributável com alíquota básica', 'SAIDA'),
  ('02', 'Operação tributável com alíquota diferenciada', 'SAIDA'),
  ('03', 'Operação tributável com alíquota por unidade de medida de produto', 'SAIDA'),
  ('04', 'Operação tributável monofásica — revenda a alíquota zero', 'SAIDA'),
  ('05', 'Operação tributável por substituição tributária', 'SAIDA'),
  ('06', 'Operação tributável a alíquota zero', 'SAIDA'),
  ('07', 'Operação isenta da contribuição', 'SAIDA'),
  ('08', 'Operação sem incidência da contribuição', 'SAIDA'),
  ('09', 'Operação com suspensão da contribuição', 'SAIDA'),
  ('49', 'Outras operações de saída', 'SAIDA'),
  ('50', 'Operação com direito a crédito — vinculada exclusivamente a receita tributada no mercado interno', 'ENTRADA'),
  ('51', 'Operação com direito a crédito — vinculada exclusivamente a receita não tributada no mercado interno', 'ENTRADA'),
  ('53', 'Operação com direito a crédito — vinculada a receitas tributadas e não tributadas no mercado interno', 'ENTRADA'),
  ('56', 'Operação com direito a crédito — vinculada a receitas tributadas e não tributadas no mercado interno e de exportação', 'ENTRADA'),
  ('70', 'Operação de aquisição sem direito a crédito', 'ENTRADA'),
  ('71', 'Operação de aquisição com isenção', 'ENTRADA'),
  ('72', 'Operação de aquisição com suspensão', 'ENTRADA'),
  ('73', 'Operação de aquisição a alíquota zero', 'ENTRADA'),
  ('74', 'Operação de aquisição sem incidência da contribuição', 'ENTRADA'),
  ('75', 'Operação de aquisição por substituição tributária', 'ENTRADA'),
  ('98', 'Outras operações de entrada', 'ENTRADA'),
  ('99', 'Outras operações', 'SAIDA')
on conflict (codigo) do update set descricao = excluded.descricao, grupo = excluded.grupo;

-- ---------------------------------------------------------------------------
-- CST de IPI
-- ---------------------------------------------------------------------------
insert into cst_ipi (codigo, descricao, grupo) values
  ('00', 'Entrada com recuperação de crédito', 'ENTRADA'),
  ('01', 'Entrada tributada com alíquota zero', 'ENTRADA'),
  ('02', 'Entrada isenta', 'ENTRADA'),
  ('03', 'Entrada não tributada', 'ENTRADA'),
  ('04', 'Entrada imune', 'ENTRADA'),
  ('05', 'Entrada com suspensão', 'ENTRADA'),
  ('49', 'Outras entradas', 'ENTRADA'),
  ('50', 'Saída tributada', 'SAIDA'),
  ('51', 'Saída tributada com alíquota zero', 'SAIDA'),
  ('52', 'Saída isenta', 'SAIDA'),
  ('53', 'Saída não tributada', 'SAIDA'),
  ('54', 'Saída imune', 'SAIDA'),
  ('55', 'Saída com suspensão', 'SAIDA'),
  ('99', 'Outras saídas', 'SAIDA')
on conflict (codigo) do update set descricao = excluded.descricao, grupo = excluded.grupo;

-- ---------------------------------------------------------------------------
-- Origem da mercadoria — Tabela A (primeiro dígito do CST/CSOSN na NF-e)
-- ---------------------------------------------------------------------------
insert into origem_mercadoria (codigo, descricao) values
  ('0', 'Nacional, exceto as indicadas nos códigos 3 a 5'),
  ('1', 'Estrangeira — importação direta, exceto a indicada no código 6'),
  ('2', 'Estrangeira — adquirida no mercado interno, exceto a indicada no código 7'),
  ('3', 'Nacional, com conteúdo de importação superior a 40% e inferior ou igual a 70%'),
  ('4', 'Nacional, produzida com processos produtivos básicos (Decreto-Lei 288/67 e leis correlatas)'),
  ('5', 'Nacional, com conteúdo de importação inferior ou igual a 40%'),
  ('6', 'Estrangeira — importação direta, sem similar nacional, constante em lista CAMEX'),
  ('7', 'Estrangeira — adquirida no mercado interno, sem similar nacional, constante em lista CAMEX'),
  ('8', 'Nacional, com conteúdo de importação superior a 70%')
on conflict (codigo) do update set descricao = excluded.descricao;
