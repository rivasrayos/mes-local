const { query } = require('./db');

async function ensureSchema() {
  await query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

  await query(`
    ALTER TABLE IF EXISTS inspections
      ADD COLUMN IF NOT EXISTS leg_mapping TEXT
  `);

  // Legacy flat EOL table (kept for historical rows / old installs)
  await query(`
    CREATE TABLE IF NOT EXISTS eol_inspections (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      line_number          TEXT,
      station_name         TEXT,
      stage_name           TEXT,
      work_station_code    TEXT,
      sn                   TEXT,
      inspection_time      TIMESTAMP WITHOUT TIME ZONE,
      inspection_time_raw  TEXT,
      pass_fail            TEXT,
      defect_type          TEXT,
      image_urls           JSONB NOT NULL DEFAULT '[]'::jsonb,
      raw_payload          JSONB NOT NULL,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_eol_line_number ON eol_inspections (line_number)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_eol_pass_fail ON eol_inspections (pass_fail)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_eol_sn ON eol_inspections (sn)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_eol_inspection_time ON eol_inspections (inspection_time)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_eol_created_at ON eol_inspections (created_at)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_eol_station_name ON eol_inspections (station_name)`);

  // Cycle-based EOL (5 cameras × positions → cables by SN)
  await query(`
    CREATE TABLE IF NOT EXISTS eol_cycles (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cycle_timestamp  TIMESTAMPTZ,
      line_number      TEXT,
      station_name     TEXT,
      stage_name       TEXT,
      record_count     INTEGER NOT NULL DEFAULT 0,
      raw_payload      JSONB NOT NULL,
      received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS eol_cables (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cycle_id            UUID NOT NULL REFERENCES eol_cycles(id) ON DELETE CASCADE,
      sn                  TEXT,
      line_number         TEXT,
      station_name        TEXT,
      stage_name          TEXT,
      positions           JSONB NOT NULL DEFAULT '[]'::jsonb,
      pass_fail           TEXT,
      defect_type         TEXT,
      camera_count        INTEGER NOT NULL DEFAULT 0,
      fail_camera_count   INTEGER NOT NULL DEFAULT 0,
      inspection_time     TIMESTAMP WITHOUT TIME ZONE,
      inspection_time_raw TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS eol_records (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cycle_id            UUID NOT NULL REFERENCES eol_cycles(id) ON DELETE CASCADE,
      cable_id            UUID NOT NULL REFERENCES eol_cables(id) ON DELETE CASCADE,
      sn                  TEXT,
      position            INTEGER,
      camera_id           TEXT,
      view_name           TEXT,
      pass_fail           TEXT,
      defects             JSONB NOT NULL DEFAULT '[]'::jsonb,
      capture_id          TEXT,
      inspection_time     TIMESTAMP WITHOUT TIME ZONE,
      inspection_time_raw TEXT,
      image_url           TEXT,
      marked_image_url    TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_eol_cycles_received ON eol_cycles (received_at)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_eol_cycles_line ON eol_cycles (line_number)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_eol_cables_cycle ON eol_cables (cycle_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_eol_cables_line ON eol_cables (line_number)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_eol_cables_sn ON eol_cables (sn)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_eol_cables_pass ON eol_cables (pass_fail)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_eol_cables_time ON eol_cables (inspection_time)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_eol_records_cable ON eol_records (cable_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_eol_records_cycle ON eol_records (cycle_id)`);

  // Prefer DB arrival time (created_at) over machine ISO payloads for display.
  // Safe to re-run: only touches rows whose raw time is still an ISO/Z string.
  await query(`
    UPDATE eol_cables
    SET inspection_time = (created_at AT TIME ZONE 'America/Los_Angeles')
    WHERE inspection_time_raw ~* 'T.*Z$'
  `).catch(() => {});

  await query(`
    UPDATE eol_records
    SET inspection_time = (created_at AT TIME ZONE 'America/Los_Angeles')
    WHERE inspection_time_raw ~* 'T.*Z$'
  `).catch(() => {});

  await query(`
    UPDATE inspections
    SET inspection_time = (created_at AT TIME ZONE 'America/Los_Angeles')
    WHERE inspection_time_raw ~* 'T.*Z$'
  `).catch(() => {});

  // Backfill empty view labels from known cameraId → EOL1..EOL5 map
  const { eolCameraMap } = require('./config');
  for (const [key, label] of Object.entries(eolCameraMap || {})) {
    if (!key || !label || !key.startsWith('ov80i')) continue;
    await query(
      `UPDATE eol_records
       SET view_name = $1
       WHERE camera_id = $2
         AND (view_name IS NULL OR view_name = '')`,
      [label, key]
    ).catch(() => {});
  }
}

module.exports = { ensureSchema };
