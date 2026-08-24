# Backup do Supabase na VPS (Portainer + Docker)

## As duas camadas, e por que são duas

| | onde roda | o que cobre | quem consegue rodar |
|---|---|---|---|
| `npm run backup` | máquina de desenvolvimento | **dados** de todas as tabelas + arquivos do Storage | qualquer um com a chave de serviço |
| esta stack | VPS, via Portainer | **estrutura + dados** — pg_dump de verdade | quem tiver a senha do banco |

A primeira existe porque a máquina de desenvolvimento **não tem** pg_dump, psql,
PostgreSQL nem Docker — verificado. Ela exporta pelo PostgREST e não traz
funções, gatilhos, índices nem políticas.

A segunda existe porque a VPS tem Docker, e aí dá para rodar pg_dump.

Manter as duas não é redundância boba: a de dados é a única que **eu consigo
rodar e verificar** de onde trabalho, e a restauração dela já foi testada
(`node scripts/test-backup-restauracao.js`). A de estrutura é a completa.

## Subir

1. **Descubra a versão do Postgres.** No SQL Editor do Supabase:
   ```sql
   select version();
   ```
   Ajuste a tag da imagem no `docker-compose.yml` (`postgres:15`, `:16`, `:17`).
   pg_dump mais **velho** que o servidor recusa a conexão — e o erro só aparece
   na primeira execução.

2. **Pegue a string de conexão.** Painel → *Project Settings* → *Database* →
   *Connection string*. Três portas, duas servem:

   | endereço | serve? |
   |---|---|
   | `db.<ref>.supabase.co:5432` | sim, mas em muitos projetos só responde em **IPv6** |
   | `...pooler.supabase.com:5432` (sessão) | **sim**, e responde em IPv4 — normalmente é a certa numa VPS |
   | `...pooler.supabase.com:6543` (transação) | **não** — pg_dump precisa de sessão e o dump quebra no meio |

   Se der `network unreachable`, é o IPv6: use o pooler em modo sessão.

3. **Portainer → Stacks → Add stack**, cole o `docker-compose.yml` e defina as
   variáveis **na tela do Portainer**, não no corpo do arquivo:

   ```
   PGDUMP_URL      = postgresql://postgres.<ref>:<SENHA>@<host>:5432/postgres
   RETENCAO_DIAS   = 30
   HORA            = 03
   TZ              = America/Sao_Paulo
   ```

   Senha no corpo do compose fica salva em texto e aparece para quem abrir a
   stack. Nas variáveis, ao menos não vai junto com o arquivo.

4. **Confira na primeira noite.** Nos logs do container tem de aparecer
   `[backup] ok — <tamanho>`. Se aparecer `FALHOU`, o erro do pg_dump está na
   linha de cima.

## Restaurar

```bash
gunzip -c supabase-AAAAMMDD-HHMMSS.sql.gz | psql "$PGDUMP_URL"
```

Restaure **num banco vazio**. Por cima de um banco com dados, o dump tenta
recriar o que já existe e para na primeira colisão.

> **O gatilho da fase-AJ pode recusar.** `orders` e `quotes` têm gatilho de
> transição de status. Restaurando por cima de linhas mais novas, o UPDATE pode
> ser barrado — comportamento correto. Num banco vazio é INSERT, e passa livre.

## O que esta stack NÃO faz

**Não tira o arquivo da VPS.** Se a VPS morrer, o backup morre junto. Backup na
mesma máquina protege contra erro humano — apagar o que não devia —, não contra
perda de máquina.

Para resolver, aponte o volume para um destino externo:

```yaml
volumes:
  backups:
    driver: local
    driver_opts: { type: none, o: bind, device: /mnt/backups }
```

...onde `/mnt/backups` seja um disco montado, um rclone para nuvem ou um S3.

## O que ainda não foi verificado

Escrevi isto **sem acesso à VPS** — não tenho ferramenta que a alcance daqui.
Então:

- a versão da imagem é um chute conservador até você rodar `select version()`;
- a escolha entre conexão direta e pooler depende de a VPS ter IPv6, o que eu
  não consigo testar;
- o `--exclude-schema` cobre os schemas internos que o Supabase mantinha quando
  isto foi escrito; se a plataforma acrescentar outro, aparece como ruído no
  dump — não quebra, mas suja.

Rode uma vez à mão antes de confiar no agendamento:

```bash
docker run --rm postgres:17-alpine \
  pg_dump "postgresql://..." --no-owner --no-privileges --schema-only | head -40
```

Se essas 40 linhas saírem, a conexão e a versão estão certas.

## Uma observação sobre o resto do deploy

O `ecosystem.config.js` na raiz configura o app com **PM2**, não com Docker. Ou
seja: o ERP roda direto na VPS sob PM2, e o Portainer administra outros
contêineres na mesma máquina. Esta stack não muda isso — ela é só mais um
contêiner ao lado. Se a intenção for containerizar o ERP também, é outro
trabalho, e a decisão sobre as sessões em memória (`exec_mode: fork`, uma
instância só) precisa ser revista antes.
