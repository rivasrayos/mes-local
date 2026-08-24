const { query } = require('./db');
const config = require('./config');

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

function toCameraId(serialNumber) {
  const s = String(serialNumber || '').trim().toLowerCase();
  if (!s) return '';
  if (s.startsWith('ov80i-')) return s;
  return `ov80i-${s}`;
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

async function refreshCameraMapCache() {
  const res = await query(
    `SELECT ip, camera_id, role, product
     FROM camera_registry
     ORDER BY updated_at DESC`
  ).catch(() => ({ rows: [] }));
  const map = {};
  for (const row of res.rows) {
    if (row.product !== 'eol') continue;
    if (row.camera_id) map[row.camera_id] = row.role;
    if (row.ip) map[row.ip] = row.role;
  }
  registryCache = map;
  return map;
}

function getMergedCameraMap() {
  return {
    ...config.eolCameraMap,
    ...registryCache,
  };
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

  // Same physical camera already registered under another line/role → move it
  if (camRow) {
    const otherIds = new Set();
    if (byIp.rows[0]) otherIds.add(byIp.rows[0].id);
    if (byCam.rows[0]) otherIds.add(byCam.rows[0].id);
    // If ip and camera_id pointed at different rows, drop the duplicate
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
    // Free target slot if occupied by a different camera
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
    const item = mapRow(res.rows[0]);
    if (warning) item.warning = warning;
    return item;
  }

  // Slot already taken by another camera → replace that slot
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
  return { deleted: true, id };
}

module.exports = {
  discoverCamera,
  listCameras,
  upsertCamera,
  deleteCamera,
  refreshCameraMapCache,
  getMergedCameraMap,
  toCameraId,
  normalizeIp,
};
