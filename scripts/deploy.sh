#!/usr/bin/env bash
#
# Deploy no VPS: puxa o código, instala dependências se preciso e reinicia o PM2.
# Rodar DENTRO do diretório do projeto no servidor:
#
#   ./scripts/deploy.sh
#
# Aborta se algo der errado, em vez de reiniciar com o app quebrado.
set -euo pipefail

cd "$(dirname "$0")/.."
echo "==> Diretório: $(pwd)"

# Mudança local não commitada faria o pull falhar no meio. Melhor parar antes.
if [ -n "$(git status --porcelain)" ]; then
  echo "!! Há alterações locais não commitadas no servidor:"
  git status --short
  echo "!! Resolva antes de continuar (git stash / git checkout)."
  exit 1
fi

ANTES=$(git rev-parse HEAD)
echo "==> Puxando $(git rev-parse --abbrev-ref HEAD)..."
git pull --ff-only
DEPOIS=$(git rev-parse HEAD)

# A MARCA DO ÚLTIMO DEPLOY QUE CHEGOU ATÉ O FIM.
#
# "Não veio commit novo" NÃO é o mesmo que "não há nada a fazer", e a diferença
# já mordeu: um deploy que falha na migração para DEPOIS do git pull. O código
# novo fica no disco, o PM2 continua no antigo e o banco não foi migrado.
# Rodando de novo, `git pull` não traz nada, ANTES == DEPOIS, e o script saía
# com "Nada novo. Nenhum restart necessário." e código 0 — anunciando sucesso
# exatamente no estado quebrado. Reproduzido num repositório de ensaio, com pm2
# e npm falsos: na segunda rodada, migração aplicada 0 vezes e app reiniciado 0
# vezes, saída 0.
#
# Esta marca só é escrita na última linha do script, depois de o app responder
# online. Enquanto ela não for igual ao commit atual, há trabalho pendente.
MARCA=".deploy-concluido"
ULTIMO_OK=$(cat "$MARCA" 2>/dev/null || true)
# Commit que não existe mais (rebase, force push) não serve de base para nada.
if [ -n "$ULTIMO_OK" ] && ! git cat-file -e "${ULTIMO_OK}^{commit}" 2>/dev/null; then
  echo "==> A marca do último deploy aponta para um commit que não existe mais; ignorando."
  ULTIMO_OK=""
fi

if [ "$ANTES" = "$DEPOIS" ] && [ "$DEPOIS" = "$ULTIMO_OK" ]; then
  echo "==> Nada novo, e o último deploy concluiu. Nenhum restart necessário."
  exit 0
fi

# A base da comparação é o último deploy CONCLUÍDO, e não o HEAD de antes do
# pull: numa retomada, o pull não traz nada e `git diff ANTES DEPOIS` seria
# vazio — o npm install ficaria de fora mesmo que a dependência nova seja
# justamente o que faltou instalar na tentativa que falhou.
BASE="${ULTIMO_OK:-$ANTES}"

if [ "$BASE" = "$DEPOIS" ]; then
  echo "==> Sem commit novo, mas o último deploy não concluiu. Retomando."
else
  echo "==> $(git log --oneline "$BASE..$DEPOIS" | wc -l) commit(s) desde o último deploy concluído:"
  git log --oneline "$BASE..$DEPOIS"
fi

# npm install só quando as dependências mudaram — economiza tempo no deploy.
if ! git diff --quiet "$BASE" "$DEPOIS" -- package.json package-lock.json; then
  echo "==> Dependências mudaram, rodando npm install..."
  npm install --omit=dev
fi

# Variável nova no .env.example que não existe no .env do servidor derruba o
# app depois do restart. Avisa antes.
if [ -f .env ] && [ -f .env.example ]; then
  FALTANDO=$(comm -23 \
    <(grep -oE '^[A-Z_]+=' .env.example | tr -d '=' | sort) \
    <(grep -oE '^[A-Z_]+=' .env | tr -d '=' | sort) || true)
  if [ -n "$FALTANDO" ]; then
    echo "!! Variáveis no .env.example que faltam no .env do servidor:"
    echo "$FALTANDO" | sed 's/^/     /'
    echo "!! Adicione ao .env antes de continuar."
    exit 1
  fi
fi

# MIGRAÇÃO ANTES DO RESTART, E NÃO DEPOIS.
#
# O código novo espera colunas que a migração cria. Reiniciar primeiro deixaria
# o app no ar contra um banco velho por alguns segundos — e o modo de falhar
# aqui não é erro visível, é gravação em silêncio: o formulário de Pedidos já
# ficou semanas perdendo campo porque a coluna não existia.
#
# Aplicar só quando algum arquivo de migração mudou seria uma economia falsa: a
# rodada anterior pode ter parado no meio (é por isso que existe a marca lá em
# cima), e o aplicador sai em um segundo quando não há nada a fazer.
echo "==> Aplicando migrações do banco..."
npm run --silent migracoes:aplicar

echo "==> Reiniciando PM2..."
mkdir -p logs   # o PM2 não cria o diretório dos logs sozinho
pm2 reload ecosystem.config.js --update-env

# Confirma que subiu de verdade, em vez de assumir.
sleep 3
if pm2 describe mavisone | grep -q "status.*online"; then
  echo "==> OK: mavisone online"
  pm2 describe mavisone | grep -E "status|restarts|uptime" || true
  # ÚLTIMA LINHA DO CAMINHO FELIZ, e só aqui: a marca significa "este commit
  # foi migrado, reiniciado e respondeu online". Escrevê-la antes tornaria a
  # próxima rodada cega para a falha que acabou de acontecer.
  echo "$DEPOIS" > "$MARCA"
else
  echo "!! O app NÃO está online. Últimas linhas do log:"
  pm2 logs mavisone --lines 30 --nostream
  exit 1
fi
