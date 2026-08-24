const fs = require('fs');
const path = require('path');
const { query } = require('./db');
const config = require('./config');

const BACKUP_DIR = process.env.CAMERA_BACKUP_DIR || path.join(__dirname, '..', 'data', 'backups');
const BACKUP_FILE = path.join(BACKUP_DIR, 'camera_registry.json');

/** @type {object[]} */
let registryEntries = [];
/** @type {Record<string, string>} cameraKey → EOL role (flat map for ingest/list) */
let registryCache = {};

function normalizeIp(raw) {
  let ip = String(raw || '').trim();
  ip = ip.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].trim();
  return ip;
}

function isValidIpOrHost(ip) {
  if (!ip || ip.length > 253) return false;
  if (/[^\w.\-]/.test(ip)) return false;
  return true;
}

/** Canonical camera id: ov80i-<serial> (lowercase). Accepts DVBOI- / bare serial. */
function toCameraId(serialNumber) {
  let s = String(serialNumber || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^dvboi-/, 'ov80i-');
  if (s.startsWith('ov80i-')) return s;
  return `ov80i-${s}`;
}

/** All lookup keys for a camera id / serial / ip */
function cameraKeyVariants(raw) {
  const keys = new Set();
  const add = (v) => {
    const t = String(v || '').trim();
    if (!t) return;
    keys.add(t);
    keys.add(t.toLowerCase());
    keys.add(t.toUpperCase());
  };
  add(raw);
  const lower = String(raw || '').trim().toLowerCase();
  if (!lower) return [...keys];

  const canon = toCameraId(lower);
  if (canon) {
    add(canon);
    const serial = canon.replace(/^ov80i-/, '');
    add(serial);
    add(`dvboi-${serial}`);
    add(`DVBOI-${serial.toUpperCase()}`);
    add(`ov80i-${serial}`);
  }
  return [...keys];
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ip: row.ip,
    serialNumber: row.serial_number,
    cameraId: row.camera_id,
    lineNumber: row.line_number || '',
    product: row.product,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function indexRegistry(rows = []) {
  registryEntries = rows.map(mapRow).filter(Boolean);
  const map = {};
  for (const entry of registryEntries) {
    if (entry.product !== 'eol') continue;
    for (const key of cameraKeyVariants(entry.cameraId)) {
      map[key] = entry.role;
    }
    for (const key of cameraKeyVariants(entry.serialNumber)) {
      map[key] = entry.role;
    }
    if (entry.ip) {
      map[entry.ip] = entry.role;
      map[String(entry.ip).toLowerCase()] = entry.role;
    }
  }
  registryCache = map;
  return map;
}

async function refreshCameraMapCache() {
  const res = await query(
    `SELECT * FROM camera_registry
     ORDER BY line_number, product, role, ip`
  ).catch(() => ({ rows: [] }));
  return indexRegistry(res.rows);
}

function writeCameraBackup(items = registryEntries) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const payload = {
      savedAt: new Date().toISOString(),
      items: (items || []).map((c) => ({
        ip: c.ip,
        serialNumber: c.serialNumber,
        cameraId: c.cameraId,
        lineNumber: c.lineNumber,
        product: c.product,
        role: c.role,
      })),
    };
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {
    console.error('camera registry backup failed:', e.message);
  }
}

function readCameraBackup() {
  try {
    if (!fs.existsSync(BACKUP_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
    return Array.isArray(raw?.items) ? raw.items : (Array.isArray(raw) ? raw : []);
  } catch (e) {
    console.error('camera registry backup read failed:', e.message);
    return [];
  }
}

/** If DB registry is empty but file backup exists, re-insert rows. */
async function restoreCameraBackupIfEmpty() {
  const countRes = await query(`SELECT COUNT(*)::int AS n FROM camera_registry`).catch(() => ({ rows: [{ n: 0 }] }));
  if ((countRes.rows[0]?.n || 0) > 0) {
    writeCameraBackup(registryEntries);
    return { restored: 0, skipped: true };
  }
  const items = readCameraBackup();
  if (!items.length) return { restored: 0, skipped: false };
  let restored = 0;
  for (const item of items) {
    try {
      await upsertCamera(item);
      restored += 1;
    } catch (e) {
      console.error('restore camera failed:', item?.ip, e.message);
    }
  }
  console.log(`Restored ${restored} cameras from backup file`);
  return { restored, skipped: false };
}

function getMergedCameraMap() {
  const merged = { ...config.eolCameraMap };
  // Expand static config keys with variants so DVBOI- matches ov80i-
  for (const [key, role] of Object.entries(config.eolCameraMap || {})) {
    for (const v of cameraKeyVariants(key)) {
      if (merged[v] == null) merged[v] = role;
    }
  }
  return { ...merged, ...registryCache };
}

/**
 * Resolve registry entry by camera id / serial / IP.
 * Prefers matching product + line when provided.
 */
function lookupCamera(rawKey, { product, lineNumber } = {}) {
  const variants = new Set(cameraKeyVariants(rawKey));
  if (!variants.size) return null;

  const matches = registryEntries.filter((e) => {
    const keys = new Set([
      ...cameraKeyVariants(e.cameraId),
      ...cameraKeyVariants(e.serialNumber),
      e.ip,
      String(e.ip || '').toLowerCase(),
    ]);
    for (const v of variants) {
      if (keys.has(v)) return true;
    }
    return false;
  });
  if (!matches.length) return null;

  const prod = product ? String(product).toLowerCase() : '';
  const line = lineNumber ? String(lineNumber).trim() : '';

  if (prod && line) {
    const hit = matches.find(
      (e) => e.product === prod && String(e.lineNumber).toUpperCase() === line.toUpperCase()
    );
    if (hit) return hit;
  }
  if (prod) {
    const hit = matches.find((e) => e.product === prod);
    if (hit) return hit;
  }
  if (line) {
    const hit = matches.find(
      (e) => String(e.lineNumber).toUpperCase() === line.toUpperCase()
    );
    if (hit) return hit;
  }
  return matches[0];
}

/** Station label (EOL1… / TOP / BOT) from registry or static EOL map */
function resolveStationRole(rawKey, opts = {}) {
  const entry = lookupCamera(rawKey, opts);
  if (entry?.role) return entry.role;

  if (!opts.product || opts.product === 'eol') {
    const map = getMergedCameraMap();
    for (const v of cameraKeyVariants(rawKey)) {
      if (map[v]) return map[v];
    }
  }
  return '';
}

function listCamerasByLine(lineNumber, product) {
  const line = String(lineNumber || '').trim().toUpperCase();
  const prod = product ? String(product).toLowerCase() : '';
  return registryEntries.filter((e) => {
    if (line && String(e.lineNumber).toUpperCase() !== line) return false;
    if (prod && e.product !== prod) return false;
    return true;
  });
}

/** Fixed EOL column headers for the table (never raw serials) */
function getEolColumnLabels(_lineNumber) {
  return ['EOL1', 'EOL2', 'EOL3', 'EOL4', 'EOL5'];
}

function isStationLabel(label) {
  const v = String(label || '').trim().toUpperCase();
  return /^EOL[1-5]$/.test(v) || v === 'TOP' || v === 'BOT';
}

/** Discover Overview camera serial by IP via postgrest device_info */
async function discoverCamera(ipRaw) {
  const ip = normalizeIp(ipRaw);
  if (!isValidIpOrHost(ip)) {
    const err = new Error('IP inválida');
    err.status = 400;
    throw err;
  }

  const url = `http://${ip}/postgrest/device_info?select=serial_number&order=id.asc&limit=1`;
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    const err = new Error(`No se pudo contactar la cámara en ${ip}: ${e.message}`);
    err.status = 502;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(`Cámara en ${ip} respondió HTTP ${res.status}`);
    err.status = 502;
    throw err;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    const err = new Error(`Respuesta inválida de la cámara ${ip}`);
    err.status = 502;
    throw err;
  }

  const row = Array.isArray(data) ? data[0] : data;
  const serial = row?.serial_number || row?.serialNumber || '';
  if (!serial) {
    const err = new Error(`Cámara en ${ip} encontrada, pero sin serial_number`);
    err.status = 502;
    throw err;
  }

  const serialNumber = String(serial).trim();
  return {
    found: true,
    ip,
    serialNumber,
    cameraId: toCameraId(serialNumber),
  };
}

async function listCameras() {
  const res = await query(
    `SELECT * FROM camera_registry
     ORDER BY line_number, product, role, ip`
  );
  indexRegistry(res.rows);
  return res.rows.map(mapRow);
}

function validateRole(product, role) {
  const p = String(product || '').toLowerCase();
  const r = String(role || '').trim().toUpperCase();
  if (p === 'eol') {
    if (!/^EOL[1-5]$/.test(r)) {
      const err = new Error('Para EOL el rol debe ser EOL1…EOL5');
      err.status = 400;
      throw err;
    }
    return { product: 'eol', role: r };
  }
  if (p === 'imla') {
    if (!['TOP', 'BOT'].includes(r)) {
      const err = new Error('Para IMLA el rol debe ser TOP o BOT');
      err.status = 400;
      throw err;
    }
    return { product: 'imla', role: r };
  }
  const err = new Error('product debe ser eol o imla');
  err.status = 400;
  throw err;
}

async function upsertCamera({
  ip,
  serialNumber,
  cameraId,
  lineNumber,
  product,
  role,
}) {
  const host = normalizeIp(ip);
  if (!isValidIpOrHost(host)) {
    const err = new Error('IP inválida');
    err.status = 400;
    throw err;
  }
  const serial = String(serialNumber || '').trim();
  const camId = toCameraId(cameraId || serial);
  if (!serial || !camId) {
    const err = new Error('Falta serial de cámara');
    err.status = 400;
    throw err;
  }
  const line = String(lineNumber || '').trim();
  if (!line) {
    const err = new Error('Falta lineNumber');
    err.status = 400;
    throw err;
  }
  const pr = validateRole(product, role);

  const byIp = await query(`SELECT * FROM camera_registry WHERE ip = $1`, [host]);
  const byCam = await query(`SELECT * FROM camera_registry WHERE camera_id = $1`, [camId]);
  const bySlot = await query(
    `SELECT * FROM camera_registry
     WHERE line_number = $1 AND product = $2 AND role = $3`,
    [line, pr.product, pr.role]
  );

  const camRow = byIp.rows[0] || byCam.rows[0] || null;
  const slotRow = bySlot.rows[0] || null;
  let warning = null;

  if (camRow) {
    const otherIds = new Set();
    if (byIp.rows[0]) otherIds.add(byIp.rows[0].id);
    if (byCam.rows[0]) otherIds.add(byCam.rows[0].id);
    for (const id of otherIds) {
      if (id !== camRow.id) {
        await query(`DELETE FROM camera_registry WHERE id = $1`, [id]);
      }
    }
    if (
      camRow.line_number !== line ||
      camRow.product !== pr.product ||
      camRow.role !== pr.role
    ) {
      warning =
        `Cámara movida de ${camRow.line_number} ${String(camRow.product).toUpperCase()} ${camRow.role}` +
        ` → ${line} ${pr.product.toUpperCase()} ${pr.role}. ` +
        `Una IP/serial solo puede estar en una línea a la vez.`;
    }
    if (slotRow && slotRow.id !== camRow.id) {
      await query(`DELETE FROM camera_registry WHERE id = $1`, [slotRow.id]);
      warning = (warning ? `${warning} ` : '') +
        `Se reemplazó la cámara anterior en ${line} ${pr.role}.`;
    }
    const res = await query(
      `UPDATE camera_registry SET
         ip = $1,
         serial_number = $2,
         camera_id = $3,
         line_number = $4,
         product = $5,
         role = $6,
         updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [host, serial, camId, line, pr.product, pr.role, camRow.id]
    );
    await refreshCameraMapCache();
    writeCameraBackup();
    const item = mapRow(res.rows[0]);
    if (warning) item.warning = warning;
    return item;
  }

  if (slotRow) {
    warning =
      `Se reemplazó la cámara anterior en ${line} ${pr.product.toUpperCase()} ${pr.role}` +
      ` (${slotRow.ip}).`;
    const res = await query(
      `UPDATE camera_registry SET
         ip = $1,
         serial_number = $2,
         camera_id = $3,
         updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [host, serial, camId, slotRow.id]
    );
    await refreshCameraMapCache();
    writeCameraBackup();
    const item = mapRow(res.rows[0]);
    item.warning = warning;
    return item;
  }

  const res = await query(
    `INSERT INTO camera_registry (
       ip, serial_number, camera_id, line_number, product, role, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6, NOW())
     RETURNING *`,
    [host, serial, camId, line, pr.product, pr.role]
  );
  await refreshCameraMapCache();
  writeCameraBackup();
  return mapRow(res.rows[0]);
}

async function deleteCamera(id) {
  const res = await query(
    `DELETE FROM camera_registry WHERE id = $1 RETURNING id`,
    [id]
  );
  if (!res.rows.length) {
    const err = new Error('Cámara no encontrada');
    err.status = 404;
    throw err;
  }
  await refreshCameraMapCache();
  writeCameraBackup();
  return { deleted: true, id };
}

module.exports = {
  discoverCamera,
  listCameras,
  listCamerasByLine,
  upsertCamera,
  deleteCamera,
  refreshCameraMapCache,
  restoreCameraBackupIfEmpty,
  writeCameraBackup,
  getMergedCameraMap,
  getEolColumnLabels,
  lookupCamera,
  resolveStationRole,
  isStationLabel,
  toCameraId,
  normalizeIp,
  isValidIpOrHost,
  cameraKeyVariants,
};
