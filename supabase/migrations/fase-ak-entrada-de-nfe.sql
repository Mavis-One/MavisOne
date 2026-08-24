-- ---------------------------------------------------------------------------
-- Fase AK -- Entrada de NF-e (a nota que o FORNECEDOR emitiu contra nos)
--
-- O QUE MUDA DE MAO AQUI
-- ----------------------
-- Todo o resto do modulo fiscal trata de nota que EU emito: `nfe` tem
-- `referencia` unica para a Focus, `payload_enviado`, `resposta_focus`,
-- `estabelecimento_id`. Nada disso existe numa nota recebida -- ela ja veio
-- pronta e autorizada, eu nao transmiti nada. Encaixar entrada naquela tabela
-- deixaria metade das colunas nulas para sempre e, pior, misturaria na mesma
-- lista o que eu emiti com o que me emitiram: a primeira consulta de "minhas
-- notas" que alguem escrevesse sem filtrar traria as duas coisas.
--
-- Por isso duas tabelas proprias.
--
-- POR QUE O XML FICA NA LINHA (E NAO NO STORAGE)
-- ----------------------------------------------
-- O XML *e* o documento fiscal -- o resto e leitura minha dele. Guardado na
-- linha, ele entra no backup de dados junto com tudo (scripts/backup-supabase.js
-- exporta tabelas; Storage e outra passada, com outro modo de falhar). Uma nota
-- tem entre 20 KB e 200 KB; a coluna so e lida quando alguem abre a nota, nunca
-- na listagem, porque nenhuma consulta de lista faz `select *`.
--
-- NAO EXISTE ROTA DE EXCLUSAO, E ISSO E DE PROPOSITO
-- --------------------------------------------------
-- Vale para documento recebido a mesma regra que vale para documento emitido:
-- nota fiscal nao se apaga. Uma entrada lancada por engano se corrige com
-- devolucao ou com a escrituracao, nunca sumindo com a linha. O `on delete
-- cascade` dos itens existe para o dia em que alguem precisar limpar dado de
-- teste direto no banco -- nao ha caminho para isso pelo aplicativo.
--
-- O DE-PARA QUE APRENDE SOZINHO
-- -----------------------------
-- `codigo_fornecedor` guarda o cProd -- o codigo do produto NA CASA DO
-- FORNECEDOR. Quando alguem vincula o item a um produto meu, o par
-- (fornecedor, cProd) -> product_id fica registrado aqui, e a proxima nota do
-- mesmo fornecedor ja chega com o vinculo sugerido. E um de-para construido
-- pelo uso, sem tabela de cadastro que ninguem preencheria.
--
-- DEPOIS DE RODAR ESTA MIGRACAO
-- ------------------------------
-- `node scripts/prova-entrada-nfe.js` grava uma nota de prova, tenta lancar a
-- mesma chave duas vezes, confere o CHECK do status e apaga tudo no fim. E o
-- unico caminho que prova que as colunas do INSERT existem AQUI -- a suite de
-- `npm test` le arquivo, e arquivo nao sabe o que foi aplicado no banco.
-- ---------------------------------------------------------------------------

create table if not exists nfe_entrada (
  id text primary key,

  -- A chave e a identidade da nota no Brasil inteiro. UNIQUE aqui e o que
  -- impede lancar a mesma nota duas vezes -- e a defesa que nao depende de a
  -- tela lembrar de conferir.
  chave char(44) not null unique,

  modelo text,
  serie text,
  numero text,
  data_emissao date,
  natureza_operacao text,

  -- Emitente = fornecedor. O documento fica gravado mesmo quando ha cadastro,
  -- porque e por ele que a proxima nota reencontra o fornecedor, e porque
  -- cadastro pode ser editado depois.
  emitente_documento text not null,
  emitente_nome text not null,
  emitente_ie text,

  -- people.id OU cnpjs.id. Polimorfico e sem FK, igual a
  -- financial_entries.client_supplier_id -- as duas tabelas de contraparte
  -- vivem separadas desde a Fase A.
  cadastro_id text,

  destinatario_documento text,

  valor_produtos numeric(15,2) not null default 0,
  valor_total numeric(15,2) not null default 0,

  -- LANCADA: conferida e aceita. REVISAR: gravada com pendencia conhecida
  -- (item sem produto, por exemplo) para nao obrigar a resolver tudo na hora.
  status text not null default 'LANCADA' check (status in ('LANCADA', 'REVISAR')),

  movimentou_estoque boolean not null default false,
  gerou_financeiro boolean not null default false,

  xml text not null,

  -- A nota inteira ja lida (emitente, itens, totais, duplicatas, protocolo).
  -- Existe para a tela nao precisar reprocessar o XML a cada abertura, e para
  -- o dia em que o layout mudar: o que foi lido no dia do lancamento fica
  -- congelado como estava.
  resumo jsonb not null default '{}'::jsonb,

  criado_por text references users(id),
  criado_por_nome text,
  criado_em timestamptz not null default now()
);

create index if not exists idx_nfe_entrada_emitente on nfe_entrada (emitente_documento, criado_em desc);
create index if not exists idx_nfe_entrada_data on nfe_entrada (data_emissao desc);

create table if not exists nfe_entrada_item (
  id text primary key,
  entrada_id text not null references nfe_entrada(id) on delete cascade,

  numero integer not null default 0,
  codigo_fornecedor text,
  ean text,
  descricao text not null,
  ncm text,
  cfop text,
  unidade text,
  quantidade numeric(15,4) not null default 0,
  valor_unitario numeric(15,10) not null default 0,
  valor_total numeric(15,2) not null default 0,

  product_id text references products(id),

  -- Como o vinculo foi feito: historico, gtin, codigo, descricao ou manual.
  -- Fica gravado porque muda o quanto se pode confiar nele: casado por GTIN e
  -- fato, casado por descricao e palpite. Numa auditoria de estoque, saber
  -- qual foi qual e a diferenca entre achar o erro e procurar no escuro.
  vinculo_origem text,

  movimentou_estoque boolean not null default false,

  -- ICMS/IPI/PIS/COFINS do item, como vieram na nota. Guardados porque a
  -- apuracao de credito nasce daqui -- e nao daria para reconstruir depois sem
  -- reprocessar o XML item a item.
  imposto jsonb not null default '{}'::jsonb
);

create index if not exists idx_nfe_entrada_item_entrada on nfe_entrada_item (entrada_id);
-- O indice do de-para: so as linhas que tem produto vinculado interessam.
create index if not exists idx_nfe_entrada_item_depara on nfe_entrada_item (codigo_fornecedor) where product_id is not null;

-- RLS: mesma decisao da fase-af. O aplicativo usa service_role, que IGNORA
-- RLS; ligar aqui fecha a porta do PostgREST com a chave `anon`, que e publica.
-- Sem policy nenhuma de proposito -- ninguem alem do servidor le estas tabelas.
alter table if exists nfe_entrada enable row level security;
alter table if exists nfe_entrada_item enable row level security;

comment on table nfe_entrada is
  'NF-e recebida de fornecedor (entrada). Documento de terceiro: nao tem referencia da Focus nem protocolo meu. Nunca e excluida -- correcao se faz por devolucao.';
comment on column nfe_entrada.chave is
  'Chave de acesso de 44 digitos. UNIQUE: e o que impede a mesma nota entrar duas vezes.';
comment on column nfe_entrada_item.codigo_fornecedor is
  'cProd -- codigo do produto na casa do FORNECEDOR, nao no meu estoque. Com product_id preenchido, forma o de-para reaproveitado na proxima nota do mesmo fornecedor.';
