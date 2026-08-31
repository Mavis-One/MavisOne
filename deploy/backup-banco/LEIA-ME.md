# Backup do banco na VPS (Portainer + Docker)

## As duas formas de tirar backup, e por que as duas existem

| | onde roda | quando | o que cobre |
|---|---|---|---|
| `npm run backup` | sua máquina | quando você manda | estrutura + dados |
| esta stack | VPS, via Portainer | sozinha, todo dia | estrutura + dados |

**As duas cobrem a mesma coisa agora.** Antes da saída do Supabase não era
assim: o backup da máquina de desenvolvimento exportava dados pelo PostgREST e
deixava de fora função, gatilho, índice e sequência, porque não havia `pg_dump`
instalado ali. Com o banco em Docker, o `pg_dump` está dentro do container, e
`npm run backup` o usa — o backup incompleto deixou de existir.

A diferença que sobrou é **quem se lembra de rodar**: a stack não se esquece.

## Os anexos vêm juntos

Isso mudou na fase AM e importa mais do que parece. O binário dos anexos de
pedido morava no Supabase Storage, fora do alcance do `pg_dump`: eram duas
coisas para restaurar no mesmo ponto no tempo, e a segunda é sempre a que
alguém esquece. Hoje o anexo é a tabela `pedido_anexo`, então **um arquivo de
dump é o sistema inteiro**.

## Subir

1. **Descubra como este container vai alcançar o banco.** O banco prende a porta
   em `127.0.0.1`, e cada container tem o próprio `localhost` — então
   `localhost` **não** funciona aqui. Veja o bloco *QUAL PGDUMP_URL USAR* no
   `docker-compose.yml`: ou você compartilha a rede da stack do banco e usa
   `@banco:5432`, ou usa o IP do gateway do Docker (`172.17.0.1`).

2. **Portainer → Stacks → Add stack**, cole o `docker-compose.yml`.

3. Em *Environment variables*, defina:
   - `PGDUMP_URL` — a string do passo 1, com a senha real;
   - `RETENCAO_DIAS` (padrão 30);
   - `HORA` (padrão 03) e `TZ` (padrão America/Sao_Paulo).

   Não escreva a senha dentro do compose: ela ficaria salva no Portainer em
   texto, visível para quem abrisse a stack.

4. Suba e **confira o log**. Ele diz de cara a que horas vai rodar. Não espere
   até amanhã para descobrir que a conexão está errada — mude `HORA` para o
   próximo horário cheio, veja o backup sair, e depois volte para 03.

## Restaurar

```
node scripts/restaurar-banco.js data/backup/mavisone-....sql.gz --confirmo
```

Funciona com o arquivo desta stack também: os dois usam as mesmas opções de
`pg_dump` (`--clean --if-exists`), de propósito, para que exista **um** caminho
de restauração e não dois.

O `--confirmo` é obrigatório porque a restauração apaga o banco de destino, e o
script mostra qual é o destino (sem a senha) antes de aceitar.

## Prove que o backup volta

Um backup que nunca foi restaurado não é um backup, é um arquivo.

```
node scripts/test-backup-restauracao.js --confirmo
```

Ele tira um backup, apaga uma linha marcada, restaura e confere que o dado
voltou **e que a estrutura voltou junto** — a função `next_cadastro_code`, o
gatilho de transição de status e a contagem de índices e tabelas. É o gatilho
que mais importa nessa lista: sem ele, um banco restaurado passaria a aceitar
transição de status inválida em silêncio.

## O que isto não faz

Não manda o arquivo para fora da VPS. Se a VPS morrer, o backup morre junto.
Aponte o volume para um disco que saia da máquina, ou acrescente um passo de
envio. Backup na mesma máquina protege contra erro humano, não contra perda de
máquina.
