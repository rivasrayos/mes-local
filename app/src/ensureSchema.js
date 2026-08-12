const { query } = require('./db');

async function ensureSchema() {
  await query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

  await query(`
    ALTER TABLE IF EXISTS inspections
      ADD COLUMN IF NOT EXISTS leg_mapping TEXT
  `);

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
}

module.exports = { ensureSchema };
