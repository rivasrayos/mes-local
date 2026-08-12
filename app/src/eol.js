const { query, withTransaction } = require('./db');
const { parseInspectionTime } = require('./time');

function normalizeView(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    return String(value.name || value.view || value.camera || JSON.stringify(value));
  }
  return String(value);
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    lineNumber: row.line_number,
    stationName: row.station_name,
    stageName: row.stage_name,
    workStationCode: row.work_station_code,
    SN: row.sn,
    view: row.view_name || '',
    inspectionTime: row.inspection_time_raw || (row.inspection_time
      ? String(row.inspection_time).replace('T', ' ').slice(0, 19)
      : null),
    passFail: row.pass_fail,
    defectType: row.defect_type,
    imageUrls: row.image_urls || [],
    createdAt: row.created_at,
  };
}

function normalizeIncoming(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (body && typeof body === 'object') return [body];
  return null;
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
  if (q.view) add('view_name ILIKE ?', `%${q.view}%`);
  if (q.stationName) add('station_name ILIKE ?', `%${q.stationName}%`);
  if (q.stageName) add('stage_name ILIKE ?', `%${q.stageName}%`);
  if (q.defectType) add('defect_type ILIKE ?', `%${q.defectType}%`);
  if (q.from) add('COALESCE(inspection_time, created_at::timestamp) >= ?::timestamp', q.from);
  if (q.to) add('COALESCE(inspection_time, created_at::timestamp) < ?::timestamp', q.to);

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

async function ingestEol(body) {
  const records = normalizeIncoming(body);
  if (!records || !records.length) {
    const err = new Error('Body must be one EOL object, an array, or { "data": [ ... ] }');
    err.status = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    const inserted = [];

    for (const item of records) {
      const inspectionTimeRaw = item.inspectionTime != null ? String(item.inspectionTime) : '';
      const inspectionTime = parseInspectionTime(inspectionTimeRaw);

      const viewName = normalizeView(item.view ?? item.VIEW ?? item.viewName);

      const res = await client.query(
        `INSERT INTO eol_inspections (
          line_number, station_name, stage_name, work_station_code, sn, view_name,
          inspection_time, inspection_time_raw, pass_fail, defect_type,
          image_urls, raw_payload
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7::timestamp,$8,$9,$10,
          $11::jsonb,$12::jsonb
        ) RETURNING *`,
        [
          item.lineNumber ?? '',
          item.stationName ?? '',
          item.stageName ?? '',
          item.workStationCode ?? '',
          item.SN ?? item.sn ?? '',
          viewName,
          inspectionTime,
          inspectionTimeRaw,
          item.passFail ?? '',
          item.defectType ?? '',
          JSON.stringify(Array.isArray(item.imageUrls) ? item.imageUrls : []),
          JSON.stringify(item),
        ]
      );
      inserted.push(mapRow(res.rows[0]));
    }

    return {
      received: inserted.length,
      data: inserted,
    };
  });
}

async function listEol(q = {}) {
  const { whereSql, params } = buildFilters(q);
  const limit = Math.min(Number(q.limit) || 100, 1000);
  const offset = Math.max(Number(q.offset) || 0, 0);

  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM eol_inspections ${whereSql}`,
    params
  );

  const listRes = await query(
    `SELECT * FROM eol_inspections
     ${whereSql}
     ORDER BY COALESCE(inspection_time, created_at::timestamp) DESC, created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return {
    total: countRes.rows[0].total,
    limit,
    offset,
    items: listRes.rows.map(mapRow),
  };
}

async function getEol(id) {
  const res = await query('SELECT * FROM eol_inspections WHERE id = $1', [id]);
  return mapRow(res.rows[0]);
}

async function listEolLines() {
  const res = await query(
    `SELECT DISTINCT line_number
     FROM eol_inspections
     WHERE line_number IS NOT NULL AND line_number <> ''
     ORDER BY line_number`
  );
  return res.rows.map((r) => r.line_number);
}

async function getEolDashboard(q = {}) {
  const { whereSql, params } = buildFilters(q);

  const summaryRes = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE LOWER(pass_fail) = 'pass')::int AS pass_count,
       COUNT(*) FILTER (WHERE LOWER(pass_fail) = 'fail')::int AS fail_count,
       COUNT(DISTINCT sn) FILTER (WHERE sn IS NOT NULL AND sn <> '')::int AS unique_sns
     FROM eol_inspections
     ${whereSql}`,
    params
  );

  const trendRes = await query(
    `SELECT
       date_trunc('hour', COALESCE(inspection_time, created_at::timestamp)) AS bucket,
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE LOWER(pass_fail) = 'pass')::int AS pass_count,
       COUNT(*) FILTER (WHERE LOWER(pass_fail) = 'fail')::int AS fail_count
     FROM eol_inspections
     ${whereSql}
     GROUP BY 1
     ORDER BY 1`,
    params
  );

  const defectRes = await query(
    `SELECT trim(d) AS defect, COUNT(*)::int AS count
     FROM eol_inspections,
          LATERAL unnest(string_to_array(COALESCE(defect_type, ''), ',')) AS d
     ${whereSql ? `${whereSql} AND` : 'WHERE'} trim(d) <> ''
     GROUP BY 1
     ORDER BY count DESC
     LIMIT 30`,
    params
  );

  const lineRes = await query(
    `SELECT COALESCE(NULLIF(line_number, ''), '(blank)') AS line_number,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE LOWER(pass_fail) = 'pass')::int AS pass_count,
            COUNT(*) FILTER (WHERE LOWER(pass_fail) = 'fail')::int AS fail_count,
            COUNT(DISTINCT sn) FILTER (WHERE sn IS NOT NULL AND sn <> '')::int AS unique_sns
     FROM eol_inspections
     ${whereSql}
     GROUP BY 1
     ORDER BY 1`,
    params
  );

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
    },
    trend: trendRes.rows.map((r) => ({
      bucket: r.bucket,
      total: r.total,
      passCount: r.pass_count,
      failCount: r.fail_count,
    })),
    defects: defectRes.rows,
    byLine: lineRes.rows.map((r) => {
      const t = r.total || 0;
      const p = r.pass_count || 0;
      const f = r.fail_count || 0;
      return {
        lineNumber: r.line_number,
        total: t,
        passCount: p,
        failCount: f,
        passRate: t ? (p / t) * 100 : 0,
        failRate: t ? (f / t) * 100 : 0,
        uniqueSns: r.unique_sns || 0,
      };
    }),
  };
}

async function deleteEolByDateRange({ from, to, before }) {
  if (before) {
    const res = await query(
      `WITH deleted AS (
         DELETE FROM eol_inspections
         WHERE created_at < $1::timestamptz
         RETURNING id
       )
       SELECT COUNT(*)::int AS deleted FROM deleted`,
      [before]
    );
    return { mode: 'before', before, deleted: res.rows[0].deleted };
  }

  if (!from || !to) {
    const err = new Error('Provide before=ISO/date OR from + to');
    err.status = 400;
    throw err;
  }

  const res = await query(
    `WITH deleted AS (
       DELETE FROM eol_inspections
       WHERE COALESCE(inspection_time, created_at::timestamp) >= $1::timestamp
         AND COALESCE(inspection_time, created_at::timestamp) < $2::timestamp
       RETURNING id
     )
     SELECT COUNT(*)::int AS deleted FROM deleted`,
    [from, to]
  );

  return { mode: 'range', from, to, deleted: res.rows[0].deleted };
}

function toEolCsv(items) {
  const headers = [
    'id', 'lineNumber', 'view', 'stationName', 'stageName', 'workStationCode', 'SN',
    'inspectionTime', 'passFail', 'defectType', 'imageUrls', 'createdAt',
  ];

  const escape = (v) => {
    const s = v == null ? '' : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines = [headers.join(',')];
  for (const item of items) {
    lines.push([
      item.id,
      item.lineNumber,
      item.view,
      item.stationName,
      item.stageName,
      item.workStationCode,
      item.SN,
      item.inspectionTime,
      item.passFail,
      item.defectType,
      (item.imageUrls || []).join(' | '),
      item.createdAt,
    ].map(escape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  ingestEol,
  listEol,
  getEol,
  listEolLines,
  getEolDashboard,
  deleteEolByDateRange,
  toEolCsv,
};
