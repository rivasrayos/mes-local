-- MES IMLA inspection schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS inspection_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  record_count    INTEGER NOT NULL DEFAULT 0,
  raw_payload     JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS inspections (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id                UUID NOT NULL REFERENCES inspection_batches(id) ON DELETE CASCADE,
  carrier_sn              TEXT,
  slot                    TEXT,
  software_version        TEXT,
  recipe_version          TEXT,
  leg_mapping             TEXT,
  line_number             TEXT,
  station_name            TEXT,
  stage_name              TEXT,
  work_station_code       TEXT,
  sn                      TEXT,
  inspection_time         TIMESTAMP WITHOUT TIME ZONE,
  inspection_time_raw     TEXT,
  pass_fail               TEXT,
  defect_type             TEXT,
  image_urls              JSONB NOT NULL DEFAULT '[]'::jsonb,
  welding_position        TEXT,
  weld_left_top_gap       TEXT,
  weld_right_top_gap      TEXT,
  imla_to_insulation_gap  TEXT,
  imla_to_foil_gap        TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspections_line_number ON inspections (line_number);
CREATE INDEX IF NOT EXISTS idx_inspections_pass_fail ON inspections (pass_fail);
CREATE INDEX IF NOT EXISTS idx_inspections_sn ON inspections (sn);
CREATE INDEX IF NOT EXISTS idx_inspections_carrier_sn ON inspections (carrier_sn);
CREATE INDEX IF NOT EXISTS idx_inspections_inspection_time ON inspections (inspection_time);
CREATE INDEX IF NOT EXISTS idx_inspections_created_at ON inspections (created_at);
CREATE INDEX IF NOT EXISTS idx_inspections_station_name ON inspections (station_name);
CREATE INDEX IF NOT EXISTS idx_batches_received_at ON inspection_batches (received_at);

-- MES EOL legacy flat inspections (kept for old installs / history)
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
);

CREATE INDEX IF NOT EXISTS idx_eol_line_number ON eol_inspections (line_number);
CREATE INDEX IF NOT EXISTS idx_eol_pass_fail ON eol_inspections (pass_fail);
CREATE INDEX IF NOT EXISTS idx_eol_sn ON eol_inspections (sn);
CREATE INDEX IF NOT EXISTS idx_eol_inspection_time ON eol_inspections (inspection_time);
CREATE INDEX IF NOT EXISTS idx_eol_created_at ON eol_inspections (created_at);
CREATE INDEX IF NOT EXISTS idx_eol_station_name ON eol_inspections (station_name);

-- MES EOL cycle model: cycle → cables (by SN) → camera/position records
CREATE TABLE IF NOT EXISTS eol_cycles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_timestamp  TIMESTAMPTZ,
  line_number      TEXT,
  station_name     TEXT,
  stage_name       TEXT,
  record_count     INTEGER NOT NULL DEFAULT 0,
  raw_payload      JSONB NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
);

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
);

CREATE INDEX IF NOT EXISTS idx_eol_cycles_received ON eol_cycles (received_at);
CREATE INDEX IF NOT EXISTS idx_eol_cycles_line ON eol_cycles (line_number);
CREATE INDEX IF NOT EXISTS idx_eol_cables_cycle ON eol_cables (cycle_id);
CREATE INDEX IF NOT EXISTS idx_eol_cables_line ON eol_cables (line_number);
CREATE INDEX IF NOT EXISTS idx_eol_cables_sn ON eol_cables (sn);
CREATE INDEX IF NOT EXISTS idx_eol_cables_pass ON eol_cables (pass_fail);
CREATE INDEX IF NOT EXISTS idx_eol_cables_time ON eol_cables (inspection_time);
CREATE INDEX IF NOT EXISTS idx_eol_records_cable ON eol_records (cable_id);
CREATE INDEX IF NOT EXISTS idx_eol_records_cycle ON eol_records (cycle_id);
