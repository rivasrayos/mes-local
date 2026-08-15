const { query, withTransaction } = require('./db');
const { formatInTz, formatWallClock } = require('./time');
const config = require('./config');

const DEFAULT_LEG_MAPPING = '1a2a3a4a1b2b3b4b';

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

function resolveViewLabel(viewName, cameraId, imageUrl) {
  const map = config.eolCameraMap || {};
  if (viewName && String(viewName).trim()) {
    const v = String(viewName).trim();
    if (map[v]) return map[v];
    if (/^EOL\d+/i.test(v)) return v;
    return v;
  }
  if (cameraId && map[cameraId]) return map[cameraId];
  const host = hostFromUrl(imageUrl);
  if (host && map[host]) return map[host];
  return cameraId || '';
}

function mapCable(row) {
  if (!row) return null;
  const failCamsRaw = Array.isArray(row.fail_cameras) ? row.fail_cameras : [];
  const failCameras = [...new Set(
    failCamsRaw
      .map((f) => {
        if (!f || typeof f !== 'object') return resolveViewLabel(f, '', '');
        return resolveViewLabel(f.view_name, f.camera_id, f.image_url);
      })
      .filter(Boolean)
  )].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));

  const byCamRaw = Array.isArray(row.captures_by_camera) ? row.captures_by_camera : [];
  const capturesByCamera = {};
  for (const item of byCamRaw) {
    const label = resolveViewLabel(item.view_name, item.camera_id, item.image_url) || '—';
    if (!capturesByCamera[label]) capturesByCamera[label] = [];
    capturesByCamera[label].push({
      captureId: item.capture_id != null ? String(item.capture_id) : '',
      passFail: item.pass_fail || '',
      position: item.position,
      imageUrl: item.image_url || '',
      markedImageUrl: item.marked_image_url || '',
    });
  }
  for (const key of Object.keys(capturesByCamera)) {
    capturesByCamera[key].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  }

  return {
    id: row.id,
    cycleId: row.cycle_id,
    sn: row.sn,
    lineNumber: row.line_number,
    stationName: row.station_name,
    stageName: row.stage_name || '',
    positions: row.positions || [],
    captureIds: row.capture_ids || [],
    failCameras,
    failCaptureIds: [...new Set(
      (Array.isArray(row.fail_capture_ids) ? row.fail_capture_ids : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    )],
    capturesByCamera,
    cameraViews: Object.keys(capturesByCamera).sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true })
    ),
    passFail: row.pass_fail,
    defectType: row.defect_type || '',
    cameraCount: row.camera_count || 0,
    failCameraCount: row.fail_camera_count || failCameras.length || 0,
    inspectionTime: formatWallClock(row.inspection_time)
      || formatInTz(row.created_at instanceof Date ? row.created_at : new Date(row.created_at)),
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
    inspectionTime: formatWallClock(row.inspection_time)
      || (row.created_at
        ? formatInTz(row.created_at instanceof Date ? row.created_at : new Date(row.created_at))
        : null),
    imageUrl: row.image_url || '',
    markedImageUrl: row.marked_image_url || '',
    imageUrls: [row.image_url, row.marked_image_url].filter(Boolean),
    unit: 'camera',
  };
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
  if (q.defectType) add('c.defect_type ILIKE ?', `%${q.defectType}%`);
  if (q.captureId) {
    add(
      `EXISTS (SELECT 1 FROM eol_records r WHERE r.cable_id = c.id AND r.capture_id ILIKE ?)`,
      `%${q.captureId}%`
    );
  }
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
  // Fecha/hora = llegada del ciclo al MES (no la del payload)
  const receivedAt = formatInTz(new Date());

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
    const firstRaw = recs.map((r) => (r.inspectionTime != null ? String(r.inspectionTime) : '')).find(Boolean) || '';

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
        receivedAt,
        firstRaw,
      ]
    );
    const cable = cableRes.rows[0];
    cables.push(cable);

    for (const rec of recs) {
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
          receivedAt,
          rec.inspectionTime != null ? String(rec.inspectionTime) : '',
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
      cycleTimestamp: new Date().toISOString(),
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
        cycleTimestamp: new Date().toISOString(),
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
  const { whereSql, params } = buildCableFilters(q);
  const limit = Math.min(Number(q.limit) || 100, 1000);
  const offset = Math.max(Number(q.offset) || 0, 0);

  const countRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM eol_cables c
     ${whereSql}`,
    params
  );

  const listRes = await query(
    `SELECT c.*, cy.cycle_timestamp,
            COALESCE((
              SELECT jsonb_agg(x.capture_id ORDER BY x.position NULLS LAST, x.view_name, x.camera_id, x.capture_id)
              FROM (
                SELECT DISTINCT ON (r.capture_id)
                       r.capture_id, r.position, r.view_name, r.camera_id
                FROM eol_records r
                WHERE r.cable_id = c.id
                  AND r.capture_id IS NOT NULL
                  AND r.capture_id <> ''
                ORDER BY r.capture_id, r.position NULLS LAST, r.view_name, r.camera_id
              ) x
            ), '[]'::jsonb) AS capture_ids,
            COALESCE((
              SELECT jsonb_agg(DISTINCT jsonb_build_object(
                'view_name', COALESCE(NULLIF(r.view_name, ''), ''),
                'camera_id', COALESCE(r.camera_id, ''),
                'image_url', COALESCE(r.image_url, '')
              ))
              FROM eol_records r
              WHERE r.cable_id = c.id
                AND LOWER(r.pass_fail) = 'fail'
            ), '[]'::jsonb) AS fail_cameras,
            COALESCE((
              SELECT jsonb_agg(DISTINCT r.capture_id)
              FROM eol_records r
              WHERE r.cable_id = c.id
                AND LOWER(r.pass_fail) = 'fail'
                AND r.capture_id IS NOT NULL
                AND r.capture_id <> ''
            ), '[]'::jsonb) AS fail_capture_ids,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'view_name', COALESCE(NULLIF(r.view_name, ''), ''),
                'camera_id', COALESCE(r.camera_id, ''),
                'image_url', COALESCE(r.image_url, ''),
                'marked_image_url', COALESCE(r.marked_image_url, ''),
                'capture_id', COALESCE(r.capture_id, ''),
                'pass_fail', COALESCE(r.pass_fail, ''),
                'position', r.position
              ) ORDER BY r.position NULLS LAST, r.view_name, r.camera_id, r.capture_id)
              FROM eol_records r
              WHERE r.cable_id = c.id
            ), '[]'::jsonb) AS captures_by_camera
     FROM eol_cables c
     JOIN eol_cycles cy ON cy.id = c.cycle_id
     ${whereSql}
     ORDER BY COALESCE(c.inspection_time, c.created_at::timestamp) DESC, c.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  const items = listRes.rows.map(mapCable);
  const cameraViews = [...new Set(items.flatMap((it) => it.cameraViews || []))]
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));

  return {
    total: countRes.rows[0].total,
    limit,
    offset,
    cameraViews,
    items,
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

  // Per-camera yield (EOL1…EOL5) from camera records in the same filter window
  const camRes = await query(
    `SELECT
       COALESCE(NULLIF(r.view_name, ''), r.camera_id, '(unknown)') AS camera_key,
       r.camera_id,
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE LOWER(r.pass_fail) = 'pass')::int AS pass_count,
       COUNT(*) FILTER (WHERE LOWER(r.pass_fail) = 'fail')::int AS fail_count,
       COUNT(DISTINCT r.sn) FILTER (WHERE r.sn IS NOT NULL AND r.sn <> '')::int AS unique_sns
     FROM eol_records r
     JOIN eol_cables c ON c.id = r.cable_id
     ${whereSql}
     GROUP BY 1, 2
     ORDER BY 1`,
    params
  );

  const camTrendRes = await query(
    `SELECT
       COALESCE(NULLIF(r.view_name, ''), r.camera_id, '(unknown)') AS camera_key,
       date_trunc('hour', COALESCE(r.inspection_time, r.created_at::timestamp)) AS bucket,
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE LOWER(r.pass_fail) = 'pass')::int AS pass_count,
       COUNT(*) FILTER (WHERE LOWER(r.pass_fail) = 'fail')::int AS fail_count
     FROM eol_records r
     JOIN eol_cables c ON c.id = r.cable_id
     ${whereSql}
     GROUP BY 1, 2
     ORDER BY 1, 2`,
    params
  );

  const camDefectRes = await query(
    `SELECT
       COALESCE(NULLIF(r.view_name, ''), r.camera_id, '(unknown)') AS camera_key,
       trim(d) AS defect,
       COUNT(*)::int AS count
     FROM eol_records r
     JOIN eol_cables c ON c.id = r.cable_id,
          LATERAL unnest(
            CASE
              WHEN jsonb_typeof(r.defects) = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(r.defects))
              ELSE ARRAY[]::text[]
            END
          ) AS d
     ${whereSql} AND trim(d) <> ''
     GROUP BY 1, 2
     ORDER BY 1, count DESC`,
    params
  );

  const map = config.eolCameraMap || {};
  const resolveCamLabel = (key, cameraId) => {
    if (key && map[key]) return map[key];
    if (cameraId && map[cameraId]) return map[cameraId];
    if (key && /^EOL\d+/i.test(key)) return key;
    return key || cameraId || '(unknown)';
  };

  const packCam = (row) => {
    const t = row.total || 0;
    const p = row.pass_count || 0;
    const f = row.fail_count || 0;
    return {
      view: resolveCamLabel(row.camera_key, row.camera_id),
      cameraId: row.camera_id || '',
      total: t,
      passCount: p,
      failCount: f,
      passRate: t ? (p / t) * 100 : 0,
      failRate: t ? (f / t) * 100 : 0,
      uniqueSns: row.unique_sns || 0,
      unit: 'camera',
    };
  };

  const byCameraMap = new Map();
  for (const row of camRes.rows) {
    const packed = packCam(row);
    const prev = byCameraMap.get(packed.view);
    if (!prev) {
      byCameraMap.set(packed.view, packed);
      continue;
    }
    prev.total += packed.total;
    prev.passCount += packed.passCount;
    prev.failCount += packed.failCount;
    prev.uniqueSns = Math.max(prev.uniqueSns, packed.uniqueSns);
    prev.passRate = prev.total ? (prev.passCount / prev.total) * 100 : 0;
    prev.failRate = prev.total ? (prev.failCount / prev.total) * 100 : 0;
  }
  const byCamera = [...byCameraMap.values()].sort((a, b) =>
    String(a.view).localeCompare(String(b.view), undefined, { numeric: true })
  );

  const trendByCamera = {};
  for (const row of camTrendRes.rows) {
    const label = resolveCamLabel(row.camera_key, null);
    if (!trendByCamera[label]) trendByCamera[label] = [];
    trendByCamera[label].push({
      bucket: row.bucket,
      total: row.total,
      passCount: row.pass_count,
      failCount: row.fail_count,
    });
  }

  const defectsByCamera = {};
  for (const row of camDefectRes.rows) {
    const label = resolveCamLabel(row.camera_key, null);
    if (!defectsByCamera[label]) defectsByCamera[label] = [];
    if (defectsByCamera[label].length >= 15) continue;
    defectsByCamera[label].push({ defect: row.defect, count: row.count });
  }

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
    byCamera,
    trendByCamera,
    defectsByCamera,
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
    'id', 'cycleId', 'sn', 'lineNumber', 'stationName', 'positions', 'captureIds',
    'failCameras', 'passFail', 'defectType', 'cameraCount', 'failCameraCount',
    'inspectionTime', 'createdAt',
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
      item.cycleId,
      item.sn,
      item.lineNumber,
      item.stationName,
      Array.isArray(item.positions) ? item.positions.join('|') : '',
      Array.isArray(item.captureIds) ? item.captureIds.join('|') : '',
      Array.isArray(item.failCameras) ? item.failCameras.join('|') : '',
      item.passFail,
      item.defectType,
      item.cameraCount,
      item.failCameraCount,
      item.inspectionTime,
      item.createdAt,
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
