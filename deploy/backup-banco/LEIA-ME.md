# Backup do banco na VPS (Portainer + Docker)

## Antes de tudo: você provavelmente não precisa desta stack

O `docker-compose.yml` da raiz **já sobe um serviço `backup` junto com o
banco**. Quem subiu o banco por ele está com backup automático desde o primeiro
`docker compose up -d`, e subir esta stack por cima só faria duas cópias do
mesmo banco em dois lugares diferentes.

Esta stack é para o caso contrário: um Postgres que **não** subiu por aquele
compose — um banco que já estava na VPS, ou que roda em outra máquina.

## As três formas, e o que cada uma resolve

| | onde roda | quando | o que cobre |
|---|---|---|---|
| serviço `backup` da stack principal | junto com o banco | sozinho, a cada 24h | estrutura + dados |
| `npm run backup` | sua máquina | quando você manda | estrutura + dados |
| esta stack | VPS, via Portainer | sozinha, na hora marcada | estrutura + dados |

**As três cobrem a mesma coisa.** Antes da saída do Supabase não era assim: o
backup da máquina de desenvolvimento exportava dados pelo PostgREST e deixava de
fora função, gatilho, índice e sequência, porque não havia `pg_dump` instalado
ali. Com o banco em Docker, o `pg_dump` está dentro do container — o backup
incompleto deixou de existir.

A diferença que sobrou é **quem se lembra de rodar**, e as automações não se
esquecem.

### Por que a agenda das duas automações é diferente

Na stack principal o gatilho é *"não existe cópia das últimas 24h? tire uma
agora"*. Aqui é *"deu a hora marcada"*.

Não é inconsistência, é o ambiente. A máquina de desenvolvimento é desligada às
18h: um laço esperando dar 03:00 nunca rodaria nela — e isso não aparece como
erro, aparece como uma pasta que parou de crescer. Numa VPS ligada 24h a hora
fixa é melhor, porque a cópia cai sempre no horário mais vazio, e não no horário
em que alguém reiniciou a stack.

Esta stack tem as duas coisas: a hora marcada e um `LIMITE_HORAS` que dispara
fora de hora se passar tempo demais sem cópia nenhuma — para o dia em que a VPS
estiver reiniciando exatamente às 03:00.

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
   - `RETENCAO_DIAS` (padrão 30) e `MINIMO_ARQUIVOS` (padrão 3, o piso que a
     poda nunca ultrapassa);
   - `HORA` (padrão 03), `LIMITE_HORAS` (padrão 36) e `TZ` (padrão
     America/Sao_Paulo).

   Não escreva a senha dentro do compose: ela ficaria salva no Portainer em
   texto, visível para quem abrisse a stack.

4. Suba e **confira o log**. Ele diz de cara a que horas vai rodar. Não espere
   até amanhã para descobrir que a conexão está errada — mude `HORA` para o
   próximo horário cheio, veja o backup sair, e depois volte para 03.

## Como saber se ainda está funcionando

Backup não falha com barulho: o container fica "Up", e a pasta parou de crescer
há três semanas. Por isso o container tem um **healthcheck que não pergunta se
ele está vivo** — um laço preso num erro continua vivo — e sim **se existe
arquivo recente**. Quando as cópias param, ele fica `unhealthy` no Portainer.

Na stack principal, a mesma pergunta em forma de comando:

```
npm run backup:estado
```

Ele mostra a idade do backup mais novo, quantos existem, se o container está de
pé e saudável, e distingue o que veio da automação (sufixo `-auto`) do que foi
tirado à mão — porque uma pasta cheia de backups manuais é exatamente o disfarce
de uma automação morta.

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

Não manda o arquivo para fora da VPS. Se a VPS morrer, o backup morre junto —
backup na mesma máquina protege contra erro humano, não contra perda de máquina.

Quem resolve isso é o serviço `envio` do `docker-compose.yml` da raiz, que sobe
os arquivos para um remoto do rclone e **confere** que chegaram. Para usá-lo com
esta stack, aponte o `BACKUP_DESTINO` do repositório para o mesmo lugar em que
esta stack grava, ou troque o volume `backups` daqui por um bind mount para essa
pasta. As duas coisas escrevem o mesmo formato de arquivo, de propósito.
