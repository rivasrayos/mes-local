#!/usr/bin/env bash
# Keep MES Local containers healthy after Docker Desktop / WSL reboots.
# - Starts DB + app compose stacks
# - Detects broken host port publish (container OK, host curl fails)
# - Force-recreates when needed
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/data/backups/mes-watchdog.log"
mkdir -p "$(dirname "$LOG")"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "$(ts) $*" | tee -a "$LOG"; }

cd "$ROOT"

for i in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
if ! docker info >/dev/null 2>&1; then
  log "ERROR: Docker daemon not ready"
  exit 1
fi

docker network create mes-imla-net >/dev/null 2>&1 || true
docker compose -f docker-compose.db.yml --env-file .env up -d >/dev/null
docker compose -f docker-compose.app.yml --env-file .env up -d >/dev/null

ok=0
for i in $(seq 1 30); do
  if docker exec mes-imla-app wget -qO- http://127.0.0.1:3100/api/health 2>/dev/null | grep -q '"ok":true'; then
    ok=1
    break
  fi
  sleep 2
done

if [[ "$ok" -ne 1 ]]; then
  log "ERROR: app not healthy inside container; recreating"
  docker compose -f docker-compose.app.yml --env-file .env up -d --force-recreate >/dev/null
  sleep 5
fi

inside=$(docker exec mes-imla-app wget -qO- http://127.0.0.1:3100/api/health 2>/dev/null || true)
outside=$(curl -s -m 3 http://127.0.0.1:3100/api/health || true)
if echo "$inside" | grep -q '"ok":true' && ! echo "$outside" | grep -q '"ok":true'; then
  # On Docker Desktop, Windows localhost often still works even when WSL loopback proxy is broken.
  log "WARN: WSL loopback publish flaky; ensuring stacks are up (Windows :3100 may still work)"
  docker compose -f docker-compose.db.yml --env-file .env up -d >/dev/null
  docker compose -f docker-compose.app.yml --env-file .env up -d >/dev/null
fi

inside=$(docker exec mes-imla-app wget -qO- http://127.0.0.1:3100/api/health 2>/dev/null || true)
if echo "$inside" | grep -q '"ok":true'; then
  log "OK: MES healthy inside container"
  exit 0
fi
log "ERROR: MES still unhealthy"
exit 1
