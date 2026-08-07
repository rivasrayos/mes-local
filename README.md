# MES Local (mes-local)

MES local con home para elegir **IMLA** o **EOL**.

- **IMLA**: `POST /api/inspections` (batch `{ data: [...] }`)
- **EOL**: `POST /api/eol/inspections` (objeto simple o array / `{ data: [...] }`)

Home web: elige IMLA o EOL. Cada producto tiene líneas, dashboard, CSV e historial propios.

## Qué incluye

- `POST /api/inspections` — mismo contrato que el nodo Node-RED
- PostgreSQL: batch completo + una fila por slot
- UI: dashboard (KPIs, tendencias, defectos, soldadura, parámetros), lista, detalle completo, filtros, CSV
- Turnos: día `06:00–18:00`, noche `18:00–06:00` (`America/Los_Angeles`)
- Borrado de histórico por fecha / rango
- Dos Docker Compose separados: DB y App

## Requisitos (Linux producción)

- Docker + Docker Compose plugin
- Puerto `3100` libre (API/UI)
- Puerto `5432` libre (Postgres), o cámbialo en `.env`

## Instalación rápida

```bash
git clone https://github.com/rivasrayos/mes-local.git
cd mes-local
cp .env.example .env
# edita POSTGRES_PASSWORD si quieres

# 1) Base de datos
docker compose -f docker-compose.db.yml --env-file .env up -d

# 2) App (API + UI)
docker compose -f docker-compose.app.yml --env-file .env up -d --build
```

Abre: `http://<IP-DEL-SERVIDOR>:3100`

Node-RED debe apuntar a:

```text
http://<IP-DEL-SERVIDOR>:3100/api/inspections
```

## Actualizar desde GitHub

```bash
cd mes-local
git pull
docker compose -f docker-compose.app.yml --env-file .env up -d --build
```

## API útil

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/inspections` | Ingest del payload `{ "data": [ ... ] }` |
| GET | `/api/inspections` | Lista + filtros |
| GET | `/api/inspections/:id` | Detalle |
| GET | `/api/inspections/export.csv` | Export CSV |
| GET | `/api/dashboard` | KPIs y series |
| GET | `/api/lines` | Líneas vistas (`lineNumber`) |
| DELETE | `/api/history` | Borrar histórico |

### Filtros comunes (query)

`range=shift|24h|8h|7d` · `from` · `to` · `lineNumber` · `passFail` · `sn` · `carrierSn` · `slot` · `stationName` · `defectType` · `weldingPosition`

### Respuesta a Node-RED

En `.env`:

```env
RESPONSE_ENABLED=true
RESPONSE_BODY={"ok":true,"received":{{received}}}
```

Si `RESPONSE_ENABLED=false`, responde `204 No Content`.

### Borrar histórico

```bash
# Todo anterior a una fecha (ISO)
curl -X DELETE 'http://localhost:3100/api/history' \
  -H 'Content-Type: application/json' \
  -d '{"before":"2026-01-01T00:00:00.000Z"}'

# Rango por inspection_time local
curl -X DELETE 'http://localhost:3100/api/history' \
  -H 'Content-Type: application/json' \
  -d '{"from":"2026-01-01 00:00:00","to":"2026-02-01 00:00:00"}'
```

También disponible en la pestaña **Historial** de la UI.

## Estructura

```text
db/init.sql                 # schema Postgres
docker-compose.db.yml       # solo Postgres
docker-compose.app.yml      # API + UI
app/                        # Node.js Express + frontend estático
.env.example
```

## Notas

- Duplicados: siempre se insertan (no upsert).
- Parámetros fijos: `Weld_Left_Top_Gap`, `Weld_Right_Top_Gap`, `IMLA_to_Insulation_Gap`, `IMLA_to_Foil_Gap`.
- `imageUrls` se guardan solo como URL (texto).
- Datos Postgres persisten en `./data/postgres`.
