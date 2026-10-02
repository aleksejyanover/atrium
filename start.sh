#!/usr/bin/env bash
# Atrium — быстрый запуск: сервер + публичная ссылка (туннель serveo).
# Использование: ./start.sh
set -e
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
cd "$(dirname "$0")"

echo "==> Проверка сервера..."
if curl -s -m 3 http://localhost:4000/api/health | grep -q '"ok":true'; then
  echo "    сервер уже запущен: http://localhost:4000"
else
  echo "    запускаю сервер Atrium..."
  (cd server && [ -d node_modules ] || npm install --silent)
  # SPEC v4 §23: панель создателя + smoke (§23–25) требуют ATRIUM_ADMIN
  export ATRIUM_ADMIN="${ATRIUM_ADMIN:-alex,smoke_admin}"
  (cd server && nohup node src/index.js > /tmp/atrium-server.log 2>&1 & disown)
  sleep 2
  echo "    лог: /tmp/atrium-server.log"
fi

echo "==> Проверка публичного туннеля..."
if pgrep -f "serveo.net" > /dev/null; then
  echo "    туннель уже запущен"
else
  # watchdog: если ssh оборвётся — переподключаемся автоматически
  nohup bash -c 'while true; do ssh -o StrictHostKeyChecking=accept-new \
      -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -o LogLevel=ERROR \
      -i "$HOME/.ssh/serveo_key" -R 80:localhost:4000 serveo.net \
      >> /tmp/atrium-tunnel.log 2>&1; sleep 5; done' \
    > /dev/null 2>&1 & disown
  sleep 8
fi

URL=$(grep -Eo "https://[a-z0-9.-]+\.serveo[a-z]*\.[a-z]+" /tmp/atrium-tunnel.log | tail -1)

# GitHub Pages: фронт на Pages, API — через туннель (config.js).
# Синхронизируем свежую сборку и подставляем актуальный адрес туннеля.
PAGES="https://aleksejyanover.github.io/atrium/"
if [ -d docs ] && [ -d web/dist ]; then
  rsync -a --delete --exclude 'screenshot-register.png' web/dist/ docs/ > /dev/null 2>&1 || true
fi
if [ -n "$URL" ]; then
  CFG="window.__ATRIUM_API__ = '$URL';"
  if [ "$(cat docs/config.js 2>/dev/null)" != "$CFG" ]; then
    echo "==> Обновляю адрес API на GitHub Pages..."
    printf '%s\n' "$CFG" > docs/config.js
    git add -A docs > /dev/null 2>&1 || true
    git commit -m "deploy: API $URL" -- docs > /dev/null 2>&1 || true
    git push origin main > /dev/null 2>&1 || echo "    (push не удался — повторит при следующем запуске)"
    echo "    Pages подхватит изменения через ~1 минуту"
  fi
fi

echo ""
echo "=========================================="
echo "  Приложение (постоянная ссылка):"
echo "  $PAGES"
if [ -n "$URL" ]; then
  echo "  API-туннель: $URL"
fi
echo "=========================================="
