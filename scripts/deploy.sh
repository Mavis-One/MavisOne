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

if [ "$ANTES" = "$DEPOIS" ]; then
  echo "==> Nada novo. Nenhum restart necessário."
  exit 0
fi

echo "==> $(git log --oneline "$ANTES..$DEPOIS" | wc -l) commit(s) novo(s):"
git log --oneline "$ANTES..$DEPOIS"

# npm install só quando as dependências mudaram — economiza tempo no deploy.
if ! git diff --quiet "$ANTES" "$DEPOIS" -- package.json package-lock.json; then
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

echo "==> Reiniciando PM2..."
mkdir -p logs   # o PM2 não cria o diretório dos logs sozinho
pm2 reload ecosystem.config.js --update-env

# Confirma que subiu de verdade, em vez de assumir.
sleep 3
if pm2 describe mavisone | grep -q "status.*online"; then
  echo "==> OK: mavisone online"
  pm2 describe mavisone | grep -E "status|restarts|uptime" || true
else
  echo "!! O app NÃO está online. Últimas linhas do log:"
  pm2 logs mavisone --lines 30 --nostream
  exit 1
fi
