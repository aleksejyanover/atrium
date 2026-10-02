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
if [ -n "$URL" ]; then
  echo ""
  echo "=========================================="
  echo "  Приложение доступно по ссылке:"
  echo "  $URL"
  echo "=========================================="
else
  echo "    URL не найден, смотрите лог: /tmp/atrium-tunnel.log"
fi
