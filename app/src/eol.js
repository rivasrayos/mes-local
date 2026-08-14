const { query, withTransaction } = require('./db');
const { parseInspectionTime, formatInTz } = require('./time');
const config = require('./config');

const DEFAULT_LEG_MAPPING = '1a2a3a4a1b2b3b4b';

function parseIsoOrLocal(raw) {
  if (!raw) return { raw: '', local: null };
  const asString = String(raw);
  // Already plant-local wall clock (IMLA style)
  const local = parseInspectionTime(asString);
  if (local) return { raw: asString, local };

  // ISO with Z / offset → convert to plant TZ so dashboard windows match
  const d = new Date(asString);
  if (!Number.isNaN(d.getTime())) {
    return { raw: asString, local: formatInTz(d) };
  }
  return { raw: asString, local: null };
}

function hostFromUrl(url) {
  const m = String(url || '').match(/^https?:\/\/([^/:]+)/i);
  return m ? m[1] : '';
}

/** Prefer payload view/cameraName; else map cameraId / image host → EOL1..EOL5 */
function resolveCameraView(rec = {}) {
  const explicit = rec.view || rec.cameraName || rec.camName || rec.cam;
  if (explicit && String(explicit).trim()) return String(explicit).trim();

  const map = config.eolCameraMap || {};
  const cameraId = String(rec.cameraId || '').trim();
  if (cameraId && map[cameraId]) return map[cameraId];

  const host = hostFromUrl(rec.imageUrl) || hostFromUrl(rec.markedImageUrl);
  if (host && map[host]) return map[host];

  return '';
}

function isFail(value) {
  return String(value || '').toLowerCase() === 'fail';
}

function mapCable(row) {
  if (!row) return null;
  return {
    id: row.id,
    cycleId: row.cycle_id,
    sn: row.sn,
    lineNumber: row.line_number,
    stationName: row.station_name,
    stageName: row.stage_name || '',
    positions: row.positions || [],
    passFail: row.pass_fail,
    defectType: row.defect_type || '',
    cameraCount: row.camera_count || 0,
    failCameraCount: row.fail_camera_count || 0,
    inspectionTime: row.inspection_time_raw || (row.inspection_time
      ? String(row.inspection_time).replace('T', ' ').slice(0, 19)
      : null),
    cycleTimestamp: row.cycle_timestamp,
    createdAt: row.created_at,
    unit: 'cable',
  };
}

function mapRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    cycleId: row.cycle_id,
    cableId: row.cable_id,
    sn: row.sn,
    lineNumber: row.line_number || '',
    stationName: row.station_name || '',
    position: row.position,
    cameraId: row.camera_id,
    view: row.view_name || config.eolCameraMap[row.camera_id] || config.eolCameraMap[hostFromUrl(row.image_url)] || '',
    passFail: row.pass_fail,
    defects: row.defects || [],
    defectType: Array.isArray(row.defects) ? row.defects.join(', ') : (row.defect_type || ''),
    captureId: row.capture_id || '',
    inspectionTime: row.inspection_time_raw || (row.inspection_time
      ? String(row.inspection_time).replace('T', ' ').slice(0, 19)
      : null),
    imageUrl: row.image_url || '',
    markedImageUrl: row.marked_image_url || '',
    imageUrls: [row.image_url, row.marked_image_url].filter(Boolean),
    unit: 'camera',
  };
}

function buildRecordFilters(q) {
  const where = ['1=1'];
  const params = [];
  let i = 1;
  const add = (sql, value) => {
    where.push(sql.replace('?', `$${i++}`));
    params.push(value);
  };

  if (q.lineNumber) add('c.line_number = ?', q.lineNumber);
  if (q.passFail) add('r.pass_fail = ?', q.passFail);
  if (q.sn) add('r.sn ILIKE ?', `%${q.sn}%`);
  if (q.stationName) add('c.station_name ILIKE ?', `%${q.stationName}%`);
  if (q.defectType) add('r.defects::text ILIKE ?', `%${q.defectType}%`);
  if (q.captureId) add('r.capture_id ILIKE ?', `%${q.captureId}%`);
  if (q.view) add('r.view_name ILIKE ?', `%${q.view}%`);
  if (q.from) add('COALESCE(r.inspection_time, r.created_at::timestamp) >= ?::timestamp', q.from);
  if (q.to) add('COALESCE(r.inspection_time, r.created_at::timestamp) < ?::timestamp', q.to);

  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

function buildCableFilters(q) {
  const where = ['1=1'];
  const params = [];
  let i = 1;
  const add = (sql, value) => {
    where.push(sql.replace('?', `$${i++}`));
    params.push(value);
  };

  if (q.lineNumber) add('c.line_number = ?', q.lineNumber);
  if (q.passFail) add('c.pass_fail = ?', q.passFail);
  if (q.sn) add('c.sn ILIKE ?', `%${q.sn}%`);
  if (q.stationName) add('c.station_name ILIKE ?', `%${q.stationName}%`);
  if (q.defectType) add('c.defect_type ILIKE ?', `%${q.defectType}%`);
  if (q.from) add('COALESCE(c.inspection_time, c.created_at::timestamp) >= ?::timestamp', q.from);
  if (q.to) add('COALESCE(c.inspection_time, c.created_at::timestamp) < ?::timestamp', q.to);

  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

function isCyclePayload(body) {
  return body && typeof body === 'object' && Array.isArray(body.records);
}

function isLegacyFlat(body) {
  return body && typeof body === 'object' && !Array.isArray(body.records)
    && (body.SN != null || body.sn != null || body.passFail != null);
}

async function insertCycleWithRecords(client, {
  cycleTimestamp,
  lineNumber,
  stationName,
  stageName,
  rawPayload,
  records,
}) {
  const cycleRes = await client.query(
    `INSERT INTO eol_cycles (
      cycle_timestamp, line_number, station_name, stage_name, record_count, raw_payload
    ) VALUES ($1::timestamptz, $2, $3, $4, $5, $6::jsonb)
    RETURNING *`,
    [
      cycleTimestamp || new Date().toISOString(),
      lineNumber || '',
      stationName || '',
      stageName || '',
      records.length,
      JSON.stringify(rawPayload),
    ]
  );
  const cycle = cycleRes.rows[0];

  // Group by SN => one physical cable (same SN on a/b ends)
  const bySn = new Map();
  for (const rec of records) {
    const sn = String(rec.sn || rec.SN || '').trim();
    if (!sn) continue;
    if (!bySn.has(sn)) bySn.set(sn, []);
    bySn.get(sn).push(rec);
  }

  const cables = [];
  for (const [sn, recs] of bySn.entries()) {
    const positions = [...new Set(recs.map((r) => Number(r.position)).filter((n) => !Number.isNaN(n)))].sort((a, b) => a - b);
    const anyFail = recs.some((r) => isFail(r.passFail));
    const defects = [...new Set(recs.flatMap((r) => (Array.isArray(r.defects) ? r.defects : [])))];
    const failCameraCount = recs.filter((r) => isFail(r.passFail)).length;
    const times = recs.map((r) => parseIsoOrLocal(r.inspectionTime)).filter((t) => t.local);
    times.sort((a, b) => String(a.local).localeCompare(String(b.local)));
    const first = times[0] || { raw: '', local: null };

    const cableRes = await client.query(
      `INSERT INTO eol_cables (
        cycle_id, sn, line_number, station_name, stage_name,
        positions, pass_fail, defect_type, camera_count, fail_camera_count,
        inspection_time, inspection_time_raw
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6::jsonb,$7,$8,$9,$10,
        $11::timestamp,$12
      ) RETURNING *`,
      [
        cycle.id,
        sn,
        lineNumber || '',
        stationName || '',
        stageName || '',
        JSON.stringify(positions),
        anyFail ? 'Fail' : 'Pass',
        defects.join(', '),
        recs.length,
        failCameraCount,
        first.local,
        first.raw,
      ]
    );
    const cable = cableRes.rows[0];
    cables.push(cable);

    for (const rec of recs) {
      const t = parseIsoOrLocal(rec.inspectionTime);
      const imageUrl = rec.imageUrl || '';
      const markedImageUrl = rec.markedImageUrl || '';
      await client.query(
        `INSERT INTO eol_records (
          cycle_id, cable_id, sn, position, camera_id, view_name,
          pass_fail, defects, capture_id,
          inspection_time, inspection_time_raw,
          image_url, marked_image_url
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8::jsonb,$9,
          $10::timestamp,$11,
          $12,$13
        )`,
        [
          cycle.id,
          cable.id,
          sn,
          rec.position != null ? Number(rec.position) : null,
          rec.cameraId || '',
          resolveCameraView(rec),
          isFail(rec.passFail) ? 'Fail' : 'Pass',
          JSON.stringify(Array.isArray(rec.defects) ? rec.defects : []),
          rec.captureId != null ? String(rec.captureId) : '',
          t.local,
          t.raw,
          imageUrl,
          markedImageUrl,
        ]
      );
    }
  }

  return { cycle, cables, received: cables.length, recordCount: records.length };
}

async function ingestEol(body) {
  // New cycle format
  if (isCyclePayload(body)) {
    const records = body.records;
    if (!records.length) {
      const err = new Error('records[] cannot be empty');
      err.status = 400;
      throw err;
    }
    return withTransaction((client) => insertCycleWithRecords(client, {
      cycleTimestamp: body.cycleTimestamp,
      lineNumber: body.lineNumber || '',
      stationName: body.stationName || '',
      stageName: body.stageName || '',
      rawPayload: body,
      records,
    }));
  }

  // Legacy flat object / array / { data: [] }
  let flats = [];
  if (Array.isArray(body)) flats = body;
  else if (Array.isArray(body?.data)) flats = body.data;
  else if (isLegacyFlat(body)) flats = [body];
  else {
    const err = new Error('Body must be a cycle { records: [...] } or a legacy EOL object');
    err.status = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    let totalCables = 0;
    let totalRecords = 0;
    const cycles = [];
    for (const item of flats) {
      const defects = item.defectType
        ? String(item.defectType).split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      const imageUrls = Array.isArray(item.imageUrls) ? item.imageUrls : [];
      const records = [{
        sn: item.SN || item.sn || '',
        position: item.position != null ? item.position : null,
        cameraId: item.cameraId || item.view || 'legacy',
        view: item.view || '',
        passFail: item.passFail || 'Pass',
        defects,
        captureId: item.captureId || '',
        inspectionTime: item.inspectionTime || '',
        imageUrl: imageUrls[0] || '',
        markedImageUrl: imageUrls[1] || imageUrls[0] || '',
      }];
      const result = await insertCycleWithRecords(client, {
        cycleTimestamp: item.inspectionTime || new Date().toISOString(),
        lineNumber: item.lineNumber || '',
        stationName: item.stationName || '',
        stageName: item.stageName || '',
        rawPayload: item,
        records,
      });
      totalCables += result.received;
      totalRecords += result.recordCount;
      cycles.push(result.cycle.id);
    }
    return { received: totalCables, recordCount: totalRecords, cycleIds: cycles };
  });
}

async function listEol(q = {}) {
  const { whereSql, params } = buildRecordFilters(q);
  const limit = Math.min(Number(q.limit) || 100, 1000);
  const offset = Math.max(Number(q.offset) || 0, 0);

  const countRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM eol_records r
     JOIN eol_cables c ON c.id = r.cable_id
     ${whereSql}`,
    params
  );

  const listRes = await query(
    `SELECT r.*, c.line_number, c.station_name
     FROM eol_records r
     JOIN eol_cables c ON c.id = r.cable_id
     ${whereSql}
     ORDER BY COALESCE(r.inspection_time, r.created_at::timestamp) DESC, r.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return {
    total: countRes.rows[0].total,
    limit,
    offset,
    items: listRes.rows.map(mapRecord),
  };
}

async function getEol(id) {
  const cableRes = await query(
    `SELECT c.*, cy.cycle_timestamp, cy.raw_payload
     FROM eol_cables c
     JOIN eol_cycles cy ON cy.id = c.cycle_id
     WHERE c.id = $1`,
    [id]
  );
  const cable = mapCable(cableRes.rows[0]);
  if (!cable) return null;

  const recRes = await query(
    `SELECT * FROM eol_records
     WHERE cable_id = $1
     ORDER BY position NULLS LAST, camera_id`,
    [id]
  );
  const records = recRes.rows.map(mapRecord);
  const imageUrls = [...new Set(records.flatMap((r) => r.imageUrls))];

  return {
    ...cable,
    SN: cable.sn,
    records,
    imageUrls,
  };
}

async function listEolLines() {
  const res = await query(
    `SELECT DISTINCT line_number
     FROM eol_cables
     WHERE line_number IS NOT NULL AND line_number <> ''
     ORDER BY line_number`
  );
  return res.rows.map((r) => r.line_number);
}

async function getEolDashboard(q = {}) {
  const { whereSql, params } = buildCableFilters(q);

  const summaryRes = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE LOWER(c.pass_fail) = 'pass')::int AS pass_count,
       COUNT(*) FILTER (WHERE LOWER(c.pass_fail) = 'fail')::int AS fail_count,
       COUNT(DISTINCT c.sn) FILTER (WHERE c.sn IS NOT NULL AND c.sn <> '')::int AS unique_sns,
       COUNT(DISTINCT c.cycle_id)::int AS cycle_passes
     FROM eol_cables c
     ${whereSql}`,
    params
  );

  const trendRes = await query(
    `SELECT
       date_trunc('hour', COALESCE(c.inspection_time, c.created_at::timestamp)) AS bucket,
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE LOWER(c.pass_fail) = 'pass')::int AS pass_count,
       COUNT(*) FILTER (WHERE LOWER(c.pass_fail) = 'fail')::int AS fail_count
     FROM eol_cables c
     ${whereSql}
     GROUP BY 1
     ORDER BY 1`,
    params
  );

  const defectRes = await query(
    `SELECT trim(d) AS defect, COUNT(*)::int AS count
     FROM eol_cables c,
          LATERAL unnest(string_to_array(COALESCE(c.defect_type, ''), ',')) AS d
     ${whereSql} AND trim(d) <> ''
     GROUP BY 1
     ORDER BY count DESC
     LIMIT 30`,
    params
  );

  const lineRes = await query(
    `SELECT COALESCE(NULLIF(c.line_number, ''), '(blank)') AS line_number,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE LOWER(c.pass_fail) = 'pass')::int AS pass_count,
            COUNT(*) FILTER (WHERE LOWER(c.pass_fail) = 'fail')::int AS fail_count,
            COUNT(DISTINCT c.cycle_id)::int AS cycle_passes
     FROM eol_cables c
     ${whereSql}
     GROUP BY 1
     ORDER BY 1`,
    params
  );

  const summary = summaryRes.rows[0];
  const total = summary.total || 0;
  const passCount = summary.pass_count || 0;
  const failCount = summary.fail_count || 0;

  return {
    summary: {
      total,
      passCount,
      failCount,
      passRate: total ? (passCount / total) * 100 : 0,
      failRate: total ? (failCount / total) * 100 : 0,
      uniqueSns: summary.unique_sns || 0,
      carrierPasses: summary.cycle_passes || 0,
      uniqueCarriers: summary.cycle_passes || 0,
      unit: 'cable',
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
        uniqueSns: 0,
        carrierPasses: r.cycle_passes || 0,
        uniqueCarriers: r.cycle_passes || 0,
        unit: 'cable',
      };
    }),
  };
}

async function deleteEolByDateRange({ from, to, before }) {
  if (before) {
    const res = await query(
      `WITH deleted AS (
         DELETE FROM eol_cycles
         WHERE received_at < $1::timestamptz
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
    `WITH target AS (
       SELECT DISTINCT cycle_id
       FROM eol_cables
       WHERE COALESCE(inspection_time, created_at::timestamp) >= $1::timestamp
         AND COALESCE(inspection_time, created_at::timestamp) < $2::timestamp
     ),
     deleted AS (
       DELETE FROM eol_cycles cy
       USING target t
       WHERE cy.id = t.cycle_id
       RETURNING cy.id
     )
     SELECT COUNT(*)::int AS deleted FROM deleted`,
    [from, to]
  );

  return { mode: 'range', from, to, deleted: res.rows[0].deleted };
}

function toEolCsv(items) {
  const headers = [
    'id', 'cableId', 'cycleId', 'sn', 'lineNumber', 'stationName',
    'position', 'cameraId', 'view', 'captureId',
    'passFail', 'defects', 'inspectionTime',
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
      item.cableId,
      item.cycleId,
      item.sn,
      item.lineNumber,
      item.stationName,
      item.position,
      item.cameraId,
      item.view,
      item.captureId,
      item.passFail,
      Array.isArray(item.defects) ? item.defects.join('|') : (item.defectType || ''),
      item.inspectionTime,
    ].map(escape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  DEFAULT_LEG_MAPPING,
  ingestEol,
  listEol,
  getEol,
  listEolLines,
  getEolDashboard,
  deleteEolByDateRange,
  toEolCsv,
};
