const { query, withTransaction } = require('./db');
const { parseInspectionTime } = require('./time');

const PARAM_MAP = {
  Weld_Left_Top_Gap: 'weld_left_top_gap',
  Weld_Right_Top_Gap: 'weld_right_top_gap',
  IMLA_to_Insulation_Gap: 'imla_to_insulation_gap',
  IMLA_to_Foil_Gap: 'imla_to_foil_gap',
};

function extractParams(parameters) {
  const out = {
    weld_left_top_gap: '',
    weld_right_top_gap: '',
    imla_to_insulation_gap: '',
    imla_to_foil_gap: '',
  };
  if (!Array.isArray(parameters)) return out;
  for (const p of parameters) {
    const col = PARAM_MAP[p?.parameterName];
    if (col) out[col] = p?.parameterValue != null ? String(p.parameterValue) : '';
  }
  return out;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    batchId: row.batch_id,
    carrierSn: row.carrier_sn,
    slot: row.slot,
    softwareVersion: row.software_version,
    recipeVersion: row.recipe_version,
    lineNumber: row.line_number,
    stationName: row.station_name,
    stageName: row.stage_name,
    workStationCode: row.work_station_code,
    SN: row.sn,
    inspectionTime: row.inspection_time_raw || (row.inspection_time
      ? String(row.inspection_time).replace('T', ' ').slice(0, 19)
      : null),
    passFail: row.pass_fail,
    defectType: row.defect_type,
    imageUrls: row.image_urls || [],
    WeldingPosition: row.welding_position,
    parameters: [
      { parameterName: 'Weld_Left_Top_Gap', parameterValue: row.weld_left_top_gap || '' },
      { parameterName: 'Weld_Right_Top_Gap', parameterValue: row.weld_right_top_gap || '' },
      { parameterName: 'IMLA_to_Insulation_Gap', parameterValue: row.imla_to_insulation_gap || '' },
      { parameterName: 'IMLA_to_Foil_Gap', parameterValue: row.imla_to_foil_gap || '' },
    ],
    createdAt: row.created_at,
  };
}

function buildFilters(q) {
  const where = [];
  const params = [];
  let i = 1;

  const add = (sql, value) => {
    where.push(sql.replace('?', `$${i++}`));
    params.push(value);
  };

  if (q.lineNumber) add('line_number = ?', q.lineNumber);
  if (q.passFail) add('pass_fail = ?', q.passFail);
  if (q.sn) add('sn ILIKE ?', `%${q.sn}%`);
  if (q.carrierSn) add('carrier_sn ILIKE ?', `%${q.carrierSn}%`);
  if (q.slot) add('slot = ?', String(q.slot));
  if (q.stationName) add('station_name ILIKE ?', `%${q.stationName}%`);
  if (q.weldingPosition) add('welding_position = ?', q.weldingPosition);
  if (q.defectType) add('defect_type ILIKE ?', `%${q.defectType}%`);
  if (q.from) add('COALESCE(inspection_time, created_at::timestamp) >= ?::timestamp', q.from);
  if (q.to) add('COALESCE(inspection_time, created_at::timestamp) < ?::timestamp', q.to);

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

async function ingestBatch(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : null;
  if (!data) {
    const err = new Error('Body must be { "data": [ ... ] }');
    err.status = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    const batchRes = await client.query(
      `INSERT INTO inspection_batches (record_count, raw_payload)
       VALUES ($1, $2::jsonb)
       RETURNING id, received_at, record_count`,
      [data.length, JSON.stringify(payload)]
    );
    const batch = batchRes.rows[0];
    const inserted = [];

    for (const item of data) {
      const params = extractParams(item.parameters);
      const inspectionTimeRaw = item.inspectionTime != null ? String(item.inspectionTime) : '';
      const inspectionTime = parseInspectionTime(inspectionTimeRaw);

      const res = await client.query(
        `INSERT INTO inspections (
          batch_id, carrier_sn, slot, software_version, recipe_version,
          line_number, station_name, stage_name, work_station_code, sn,
          inspection_time, inspection_time_raw, pass_fail, defect_type,
          image_urls, welding_position,
          weld_left_top_gap, weld_right_top_gap, imla_to_insulation_gap, imla_to_foil_gap
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,$10,
          $11::timestamp,$12,$13,$14,
          $15::jsonb,$16,
          $17,$18,$19,$20
        ) RETURNING *`,
        [
          batch.id,
          item.carrierSn ?? '',
          item.slot != null ? String(item.slot) : '',
          item.softwareVersion ?? '',
          item.recipeVersion ?? '',
          item.lineNumber ?? '',
          item.stationName ?? '',
          item.stageName ?? '',
          item.workStationCode ?? '',
          item.SN ?? item.sn ?? '',
          inspectionTime,
          inspectionTimeRaw,
          item.passFail ?? '',
          item.defectType ?? '',
          JSON.stringify(Array.isArray(item.imageUrls) ? item.imageUrls : []),
          item.WeldingPosition ?? item.weldingPosition ?? '',
          params.weld_left_top_gap,
          params.weld_right_top_gap,
          params.imla_to_insulation_gap,
          params.imla_to_foil_gap,
        ]
      );
      inserted.push(mapRow(res.rows[0]));
    }

    return {
      batchId: batch.id,
      receivedAt: batch.received_at,
      received: inserted.length,
      data: inserted,
    };
  });
}

async function listInspections(q = {}) {
  const { whereSql, params } = buildFilters(q);
  const limit = Math.min(Number(q.limit) || 100, 1000);
  const offset = Math.max(Number(q.offset) || 0, 0);

  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM inspections ${whereSql}`,
    params
  );

  const listParams = [...params, limit, offset];
  const listRes = await query(
    `SELECT * FROM inspections
     ${whereSql}
     ORDER BY COALESCE(inspection_time, created_at::timestamp) DESC, created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    listParams
  );

  return {
    total: countRes.rows[0].total,
    limit,
    offset,
    items: listRes.rows.map(mapRow),
  };
}

async function getInspection(id) {
  const res = await query('SELECT * FROM inspections WHERE id = $1', [id]);
  return mapRow(res.rows[0]);
}

async function listLines() {
  const res = await query(
    `SELECT DISTINCT line_number
     FROM inspections
     WHERE line_number IS NOT NULL AND line_number <> ''
     ORDER BY line_number`
  );
  return res.rows.map((r) => r.line_number);
}

async function getDashboard(q = {}) {
  const { whereSql, params } = buildFilters(q);

  const summaryRes = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE LOWER(pass_fail) = 'pass')::int AS pass_count,
       COUNT(*) FILTER (WHERE LOWER(pass_fail) = 'fail')::int AS fail_count,
       COUNT(DISTINCT sn) FILTER (WHERE sn IS NOT NULL AND sn <> '')::int AS unique_sns,
       COUNT(DISTINCT carrier_sn) FILTER (WHERE carrier_sn IS NOT NULL AND carrier_sn <> '')::int AS unique_carriers
     FROM inspections
     ${whereSql}`,
    params
  );

  const trendRes = await query(
    `SELECT
       date_trunc('hour', COALESCE(inspection_time, created_at::timestamp)) AS bucket,
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE LOWER(pass_fail) = 'pass')::int AS pass_count,
       COUNT(*) FILTER (WHERE LOWER(pass_fail) = 'fail')::int AS fail_count
     FROM inspections
     ${whereSql}
     GROUP BY 1
     ORDER BY 1`,
    params
  );

  const defectRes = await query(
    `SELECT trim(d) AS defect, COUNT(*)::int AS count
     FROM inspections,
          LATERAL unnest(string_to_array(COALESCE(defect_type, ''), ',')) AS d
     ${whereSql ? `${whereSql} AND` : 'WHERE'} trim(d) <> ''
     GROUP BY 1
     ORDER BY count DESC
     LIMIT 30`,
    params
  );

  const weldRes = await query(
    `SELECT COALESCE(NULLIF(welding_position, ''), 'NA') AS welding_position,
            COUNT(*)::int AS count
     FROM inspections
     ${whereSql ? `${whereSql} AND` : 'WHERE'} LOWER(pass_fail) = 'fail'
     GROUP BY 1
     ORDER BY count DESC`,
    params
  );

  const lineRes = await query(
    `SELECT COALESCE(NULLIF(line_number, ''), '(blank)') AS line_number,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE LOWER(pass_fail) = 'pass')::int AS pass_count,
            COUNT(*) FILTER (WHERE LOWER(pass_fail) = 'fail')::int AS fail_count,
            COUNT(DISTINCT sn) FILTER (WHERE sn IS NOT NULL AND sn <> '')::int AS unique_sns,
            COUNT(DISTINCT carrier_sn) FILTER (WHERE carrier_sn IS NOT NULL AND carrier_sn <> '')::int AS unique_carriers
     FROM inspections
     ${whereSql}
     GROUP BY 1
     ORDER BY 1`,
    params
  );

  const paramSeries = {};
  for (const [name, col] of Object.entries(PARAM_MAP)) {
    const res = await query(
      `SELECT
         date_trunc('hour', COALESCE(inspection_time, created_at::timestamp)) AS bucket,
         AVG(CASE WHEN ${col} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ${col}::float END) AS avg_value,
         COUNT(*) FILTER (WHERE ${col} ~ '^-?[0-9]+(\\.[0-9]+)?$')::int AS samples
       FROM inspections
       ${whereSql}
       GROUP BY 1
       ORDER BY 1`,
      params
    );
    paramSeries[name] = res.rows.map((r) => ({
      bucket: r.bucket,
      avg: r.avg_value != null ? Number(r.avg_value) : null,
      samples: r.samples,
    }));
  }

  const summary = summaryRes.rows[0];
  const total = summary.total || 0;
  const failCount = summary.fail_count || 0;
  const passCount = summary.pass_count || 0;

  return {
    summary: {
      total,
      passCount,
      failCount,
      passRate: total ? (passCount / total) * 100 : 0,
      failRate: total ? (failCount / total) * 100 : 0,
      uniqueSns: summary.unique_sns,
      uniqueCarriers: summary.unique_carriers,
    },
    trend: trendRes.rows.map((r) => ({
      bucket: r.bucket,
      total: r.total,
      passCount: r.pass_count,
      failCount: r.fail_count,
    })),
    defects: defectRes.rows,
    weldingOnFail: weldRes.rows,
    byLine: lineRes.rows.map((r) => {
      const total = r.total || 0;
      const passCount = r.pass_count || 0;
      const failCount = r.fail_count || 0;
      return {
        lineNumber: r.line_number,
        total,
        passCount,
        failCount,
        passRate: total ? (passCount / total) * 100 : 0,
        failRate: total ? (failCount / total) * 100 : 0,
        uniqueSns: r.unique_sns || 0,
        uniqueCarriers: r.unique_carriers || 0,
      };
    }),
    parameters: paramSeries,
  };
}

async function deleteByDateRange({ from, to, before }) {
  if (before) {
    const res = await query(
      `WITH deleted AS (
         DELETE FROM inspection_batches b
         WHERE b.received_at < $1::timestamptz
         RETURNING b.id
       )
       SELECT COUNT(*)::int AS batches_deleted FROM deleted`,
      [before]
    );
    // Cascades delete inspections. Also delete orphan-less is automatic.
    // Additionally allow deleting by inspection_time window via from/to below.
    return {
      mode: 'before',
      before,
      batchesDeleted: res.rows[0].batches_deleted,
    };
  }

  if (!from || !to) {
    const err = new Error('Provide before=ISO/date OR from + to');
    err.status = 400;
    throw err;
  }

  const res = await query(
    `WITH target AS (
       SELECT DISTINCT batch_id
       FROM inspections
       WHERE COALESCE(inspection_time, created_at::timestamp) >= $1::timestamp
         AND COALESCE(inspection_time, created_at::timestamp) < $2::timestamp
     ),
     deleted AS (
       DELETE FROM inspection_batches b
       USING target t
       WHERE b.id = t.batch_id
       RETURNING b.id
     )
     SELECT COUNT(*)::int AS batches_deleted FROM deleted`,
    [from, to]
  );

  return {
    mode: 'range',
    from,
    to,
    batchesDeleted: res.rows[0].batches_deleted,
  };
}

function toCsv(items) {
  const headers = [
    'id', 'batchId', 'carrierSn', 'slot', 'softwareVersion', 'recipeVersion',
    'lineNumber', 'stationName', 'stageName', 'workStationCode', 'SN',
    'inspectionTime', 'passFail', 'defectType', 'WeldingPosition',
    'imageUrls', 'Weld_Left_Top_Gap', 'Weld_Right_Top_Gap',
    'IMLA_to_Insulation_Gap', 'IMLA_to_Foil_Gap', 'createdAt',
  ];

  const escape = (v) => {
    const s = v == null ? '' : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines = [headers.join(',')];
  for (const item of items) {
    const p = Object.fromEntries(item.parameters.map((x) => [x.parameterName, x.parameterValue]));
    lines.push([
      item.id,
      item.batchId,
      item.carrierSn,
      item.slot,
      item.softwareVersion,
      item.recipeVersion,
      item.lineNumber,
      item.stationName,
      item.stageName,
      item.workStationCode,
      item.SN,
      item.inspectionTime,
      item.passFail,
      item.defectType,
      item.WeldingPosition,
      (item.imageUrls || []).join(' | '),
      p.Weld_Left_Top_Gap || '',
      p.Weld_Right_Top_Gap || '',
      p.IMLA_to_Insulation_Gap || '',
      p.IMLA_to_Foil_Gap || '',
      item.createdAt,
    ].map(escape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  ingestBatch,
  listInspections,
  getInspection,
  listLines,
  getDashboard,
  deleteByDateRange,
  toCsv,
  buildFilters,
};
