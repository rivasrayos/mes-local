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
