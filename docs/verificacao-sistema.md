# Verificação do sistema — estado da migração para Supabase

> Última atualização: 2026-08-05 · branch `feat/supabase-migration`

Documento de continuidade: onde a migração está, o que já foi corrigido e o que
falta. Escrito para ser retomado em outra máquina sem contexto prévio.

---

## Como subir o projeto em outra máquina

```bash
git clone https://github.com/HaasEduardo/SalERP.git
cd SalERP
git checkout feat/supabase-migration
npm install
# copiar o .env manualmente — ele é gitignored e NÃO vem no clone
node server.js          # http://localhost:3000
```

O `.env` precisa das 14 variáveis listadas em `.env.example`. As duas
indispensáveis para o sistema sequer subir são `SUPABASE_URL` e
`SUPABASE_SERVICE_ROLE_KEY` — sem elas `lib/db/client.js` lança erro já no
`require`, antes de o servidor abrir a porta.

Os dados operacionais estão no Supabase (nuvem), então são os mesmos em qualquer
máquina. A exceção é o módulo Financeiro, que ainda vive no `data/db.json`
versionado — ver "Dívida técnica" abaixo.

### Verificar que está tudo de pé

```bash
SMOKE_USER=admin SMOKE_PASS=suasenha node scripts/smoke-api.js
```

Bate nos 28 endpoints GET da API e reporta status + tamanho das coleções.
Última execução: **28/28 OK**.

---

## Arquitetura de dados: duas camadas convivendo

| Camada | Onde | Papel |
|---|---|---|
| **Supabase (Postgres)** | `lib/db/*.js` via `@supabase/supabase-js` | Único banco real. Sem fallback. |
| **JSON legado** | `data/db.json` via `loadData()`/`saveData()` em `server.js` | Ainda é a fonte de verdade do Financeiro |

Não existe SQLite nem lowdb no código — `test.sqlite` e `data/db.sqlite` são
arquivos mortos, resíduo de um modelo anterior.

A ponte entre as camadas são três funções em `server.js` que reidratam o objeto
`data` do JSON com dados do Supabase logo após o `loadData()`:

- `syncCadastroData(data)` → `data.people`, `data.cnpjs`, `data.deposits`
- `syncSalesData(data)` → `data.orders`, `data.quotes`, `data.importLogs`
- `syncPurchasesData(data)` → `data.purchases`

**Regra de ouro:** qualquer rota que leia `data.people`, `data.orders`,
`data.quotes` ou `data.purchases` **precisa** chamar o sync correspondente antes.
Esquecer isso foi exatamente a causa do bug do dashboard descrito abaixo.

### Status por módulo

| Módulo | Camada | Observação |
|---|---|---|
| Auth | Supabase | `users.password_hash` bcrypt |
| Cadastros (pessoas/CNPJs/depósitos) | Supabase | RPC `next_cadastro_code` para numeração |
| Estoque (produtos) | Supabase | ledger de movimentação ainda em JSON |
| Vendas (orders/quotes) | Supabase | |
| Compras | Supabase | |
| Fiscal (NF-e, certificados, regras) | Supabase | token Focus NFe cifrado em repouso |
| Open Finance | Supabase (parcial) | contas/transações sincronizadas caem no JSON |
| **Financeiro** | **JSON** | código Supabase pronto e não plugado |
| Auditoria | JSON | tabela `audit_logs` existe e está vazia |
| Empresas de cadastro | JSON | sem tabela equivalente no schema |

---

## Corrigido nesta rodada

### 1. Senhas em texto puro versionadas

`data/db.json` carregava um array `users` com `"password"` em claro para dois
admins, e o `initialData` de `server.js` recriava esse array em qualquer máquina
nova. O campo **nunca foi lido por nenhuma rota** — a autenticação real é
bcrypt no Supabase desde a migração. Removido de ambos, e `normalizeData()`
agora faz `delete data.users` para limpar arquivos antigos no primeiro save.

> ⚠️ **Pendente e importante:** as senhas continuam no histórico do git (9
> commits já publicados no GitHub). Remover exige reescrever o histórico
> (`git filter-repo`) e force-push. Independente disso, **as senhas desses dois
> usuários devem ser trocadas**, porque a que estava no arquivo ainda é válida
> no Supabase.

### 2. Dashboard Geral permanentemente zerado

`GET /api/dashboard` somava `data.sales` e `data.purchases` — duas coleções JSON
que ninguém mais alimenta:

- `data.sales` só recebia escrita em `POST /api/sales`, rota que o frontend não
  chama mais (as vendas viraram `orders`/`quotes` no Supabase)
- `data.purchases` só é populado por `syncPurchasesData()`, que não era chamado
  nessa rota

Resultado: o painel exibia **R$ 0,00 em Vendas e Compras para sempre**,
independente do volume operado. Mesmo defeito em `GET /api/settings` e
`GET /api/finance`.

Correção: os syncs passaram a ser chamados, o total de vendas agora reusa
`buildSalesDashboardSummary()` (o mesmo cálculo do Painel de Vendas, para os dois
baterem), e compras canceladas são excluídas do total — mesmo critério do
Histórico de Compras.

Verificado end-to-end: compra de 3 × R$ 100 → dashboard passou de R$ 0,00 para
R$ 300,00; ao cancelar, voltou para R$ 0,00.

---

## Dívida técnica conhecida (em ordem sugerida de ataque)

### 1. Financeiro inteiro roda no JSON

`lib/db/financeiro.js` tem 485 linhas escritas contra Supabase e **nenhuma das 23
funções exportadas é chamada em lugar nenhum**. Todo o módulo em produção
(lançamentos, pagamentos, NF-e comercial, extrato, conciliação) usa
`data/db.json`, com `saveData()` reescrevendo o arquivo inteiro a cada operação —
sem transação e sem proteção contra escrita concorrente.

Consequência: 8 tabelas do Supabase estão garantidamente vazias
(`financial_entries`, `financial_payments`, `financial_categories`,
`cost_centers`, `bank_accounts`, `bank_transactions`, `nfes`, `nfe_items`).

Também órfãos: `getSales`/`createSale` em `lib/db/vendas-compras.js` e
`addAuditLog`/`getAuditLogs` em `lib/db/settings.js`.

### 2. Trilha de auditoria fragmentada

A tabela `audit_logs` existe e `lib/db/settings.js` implementa o acesso, mas os 8
pontos de escrita de auditoria em `server.js` gravam em `data.auditLogs` do JSON
— incluindo a auditoria de **emissão e cancelamento de NF-e**. Auditoria fiscal
real num arquivo local não versionado é um risco de conformidade.

### 3. Ledger de estoque sem tabela

`data.stockMovements` não tem equivalente no `supabase/schema.sql`. Falta criar
uma tabela `stock_movements` e migrar `registrarMovimentoEstoque()`.

### 4. Empresas de cadastro sem tabela

`data.companies` (rotas `/api/cadastros/empresas`) também não tem equivalente. A
tabela `empresa` do schema é a entidade **fiscal**, com estrutura totalmente
diferente (`cnpj_raiz`, `regime_tributario`, `crt`) — migrar exige criar tabela
nova, não dá para reaproveitar.

### 5. Open Finance com integridade quebrada

`account_balances.account_id` no Supabase aponta para IDs de conta que só existem
no `data/db.json`. A sincronização grava contas e transações no JSON e o
histórico de saldo no Supabase — referência sem integridade real.

### 6. Campos fiscais de produto são somente-leitura

`products.ncm`, `cest`, `unidade_comercial`, `unidade_tributavel`, `ean` e
`origem` são lidos em `lib/db/estoque.js` mas **não são gravados** por
`upsertProduct()` nem pela rota `POST /api/stock`. Não há caminho de escrita pela
API. `numero_fci` nem sequer é mapeado.

### 7. Rota morta com dados obsoletos

`GET /api/cadastros` (sem sufixo) lê `data.people`/`data.cnpjs` sem chamar
`syncCadastroData()`, devolvendo dados congelados. Nenhuma tela do frontend a
consome hoje, mas é uma armadilha — deve ser removida ou corrigida.

### 8. Tabelas do schema sem nenhum código

`grupo_economico`, `serie_nfe`, `declaracao_importacao` e `di_adicao` estão
definidas em `supabase/schema.sql` e não têm CRUD algum. `serie_nfe` em
particular era para controlar numeração de série, mas a numeração real vem da
resposta da Focus NFe.

---

## Notas de operação

- Sessões são **em memória** (`sessions` em `server.js`): reiniciar o servidor
  desloga todo mundo.
- Autenticação da API usa o header `x-auth-token`, não cookie nem Bearer.
- `saveData()` reescreve `data/db.json` inteiro a cada chamada. Rodar testes que
  criam registros suja o arquivo versionado — confira `git status` depois.
