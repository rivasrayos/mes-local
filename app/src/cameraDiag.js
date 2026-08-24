const { normalizeIp, isValidIpOrHost, listCameras } = require('./cameras');

const FETCH_MS = 4500;
const WRITE_MS = 10000;

async function fetchJson(ip, path, { method = 'GET', body = null, timeoutMs = FETCH_MS } = {}) {
  const url = `http://${ip}${path}`;
  const started = Date.now();
  try {
    const opts = {
      method,
      headers: { Accept: 'application/json, text/plain, */*' },
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (body != null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      data,
      error: res.ok ? null : (typeof data === 'object' && data?.description) || `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      data: null,
      error: e.name === 'TimeoutError' || /aborted|timeout/i.test(e.message)
        ? 'timeout'
        : (e.message || String(e)),
    };
  }
}

function parseEnvVars(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '—';
  if (v < 1024) return `${v} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let x = v;
  let i = -1;
  do {
    x /= 1024;
    i += 1;
  } while (x >= 1024 && i < units.length - 1);
  return `${x.toFixed(x >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function recipeSummary(recipe) {
  if (!recipe || typeof recipe !== 'object') return null;
  const blocks = Array.isArray(recipe.blockInstances)
    ? recipe.blockInstances.map((b) => b.blockType || b.name).filter(Boolean)
    : [];
  const img = recipe.imagingSettings || {};
  return {
    id: recipe.id ?? null,
    name: recipe.name || '',
    plcRecipeId: recipe.plcRecipeId ?? recipe.plc_recipe_id ?? null,
    editedAt: recipe.editedAt || recipe.edited_at || '',
    blocks,
    exposure: img.exposure ?? null,
    gain: img.gain ?? null,
    focus: img.focus ?? null,
    imagingStatus: img.status || '',
  };
}

/**
 * Probe one OV80i camera for diagnostic snapshot (read-only).
 */
async function probeCamera(ipRaw, registry = null) {
  const ip = normalizeIp(ipRaw);
  if (!isValidIpOrHost(ip)) {
    const err = new Error('IP inválida');
    err.status = 400;
    throw err;
  }

  const probedAt = new Date().toISOString();
  const serverNowMs = Date.now();

  const [
    health,
    serial,
    version,
    hostname,
    deviceName,
    cameraType,
    storage,
    network,
    activation,
    time,
    recipe,
    deploy,
    envVars,
    industrial,
    ntp,
  ] = await Promise.all([
    fetchJson(ip, '/edge/v2/healthcheck'),
    fetchJson(ip, '/edge/v2/device/serial_number'),
    fetchJson(ip, '/edge/v2/device/version'),
    fetchJson(ip, '/edge/v2/device/hostname'),
    fetchJson(ip, '/edge/device/name'),
    fetchJson(ip, '/edge/v2/device/camera_type'),
    fetchJson(ip, '/edge/v2/device/storage'),
    fetchJson(ip, '/edge/v2/device/network'),
    fetchJson(ip, '/edge/v2/device/activation'),
    fetchJson(ip, '/edge/v2/device/time'),
    fetchJson(ip, '/edge/recipe/active'),
    fetchJson(ip, '/edge/recipe/deployment-status'),
    fetchJson(ip, '/edge/environmental_variables'),
    fetchJson(ip, '/edge/industrial_ethernet/protocol'),
    fetchJson(ip, '/edge/v2/device/ntp'),
  ]);

  const online = health.ok || serial.ok || version.ok || recipe.ok;
  const warnings = [];

  const serialNumber =
    (serial.data && (serial.data.serial_number || serial.data.serialNumber)) || '';
  const swVersion = (version.data && version.data.version) || '';
  const host =
    (hostname.data && hostname.data.hostname) || '';
  const name =
    (deviceName.data && deviceName.data.name) || '';
  const type =
    (cameraType.data && cameraType.data.camera_type) || '';

  const storageData = storage.ok && storage.data && typeof storage.data === 'object'
    ? {
        total: storage.data.total,
        used: storage.data.used,
        free: storage.data.free,
        percent: storage.data.percent != null ? Number(storage.data.percent) : null,
        totalLabel: formatBytes(storage.data.total),
        usedLabel: formatBytes(storage.data.used),
        freeLabel: formatBytes(storage.data.free),
      }
    : null;
  if (storageData?.percent != null && storageData.percent >= 85) {
    warnings.push(`Disco al ${storageData.percent}%`);
  }

  const net = network.ok && network.data ? network.data : null;
  const activeAddr = net?.active?.address || net?.configuration?.address || '';
  const mac = net?.mac_address || '';
  if (activeAddr && activeAddr !== ip) {
    warnings.push(`IP activa ${activeAddr} ≠ registrada ${ip}`);
  }

  const activated = activation.ok
    ? !!(activation.data && activation.data.activated)
    : null;
  if (activated === false) warnings.push('Dispositivo no activado');

  let clockSkewSec = null;
  if (time.ok && time.data && time.data.now_us != null) {
    const camMs = Number(time.data.now_us) / 1000;
    if (Number.isFinite(camMs)) {
      clockSkewSec = Math.round((camMs - serverNowMs) / 1000);
      if (Math.abs(clockSkewSec) > 30) {
        warnings.push(`Reloj desfasado ${clockSkewSec}s vs MES`);
      }
    }
  }

  const env = envVars.ok ? parseEnvVars(envVars.data) : {};
  const dateInstalled = env.DATE_INSTALLED || env.DATE_INSTALED || '';
  let installedAge = null;
  if (dateInstalled) {
    const t = Date.parse(dateInstalled);
    if (!Number.isNaN(t)) {
      installedAge = formatDuration(serverNowMs - t);
    }
  }

  // API has no boot uptime; use DATE_INSTALLED as best available "online since" proxy
  const uptimeLabel = installedAge
    ? `desde instalación ${dateInstalled} (${installedAge})`
    : '';

  const activeRecipe = recipe.ok ? recipeSummary(recipe.data) : null;
  if (recipe.ok && !activeRecipe?.name) warnings.push('Sin receta activa clara');

  const deployment = deploy.ok && deploy.data && typeof deploy.data === 'object'
    ? {
        overallDeployed: !!deploy.data.overallDeployed,
        alignerDeployed: !!deploy.data.alignerDeployed,
        classifierDeployed: !!deploy.data.classifierDeployed || !!deploy.data.anyClassifierDeployed,
        segmenterDeployed: !!deploy.data.segmenterDeployed || !!deploy.data.anySegmenterDeployed,
      }
    : null;
  if (deployment && deployment.overallDeployed === false) {
    warnings.push('Modelos no desplegados (deployment)');
  }

  const industrialProtocol =
    (industrial.ok && industrial.data && industrial.data.active_protocol) || '';

  const ntpEnabled = ntp.ok ? !!(ntp.data && ntp.data.enabled) : null;
  const ntpServers = ntp.ok && Array.isArray(ntp.data?.servers)
    ? ntp.data.servers.filter(Boolean)
    : [];
  if (ntpEnabled === true && !ntpServers.length) {
    warnings.push('NTP activo pero sin servidor configurado');
  } else if (ntpEnabled === false) {
    warnings.push('NTP desactivado');
  }

  if (!online) warnings.push('Cámara no responde');

  return {
    ip,
    online,
    probedAt,
    latencyMs: (() => {
      const lats = [health, serial, version, recipe].filter((r) => r.ok).map((r) => r.ms);
      return lats.length ? Math.min(...lats) : null;
    })(),
    registry: registry
      ? {
          lineNumber: registry.lineNumber || '',
          product: registry.product || '',
          role: registry.role || '',
          cameraId: registry.cameraId || '',
        }
      : null,
    serialNumber,
    version: swVersion,
    hostname: host,
    deviceName: name,
    cameraType: type,
    activated,
    storage: storageData,
    network: {
      address: activeAddr,
      mac,
      mode: net?.active?.mode || net?.configuration?.mode || '',
    },
    clockSkewSec,
    env: {
      lineCode: env.LINE_CODE || '',
      timezone: env.CAMERA_TIMEZONE || '',
      dateInstalled,
    },
    uptimeLabel,
    recipe: activeRecipe,
    deployment,
    industrialProtocol,
    ntp: {
      enabled: ntpEnabled,
      servers: ntpServers,
    },
    warnings,
    errors: {
      health: health.error,
      serial: serial.error,
      version: version.error,
      recipe: recipe.error,
      storage: storage.error,
    },
  };
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function probeRegisteredCameras({ lineNumber, product } = {}) {
  let items = await listCameras();
  const line = String(lineNumber || '').trim().toUpperCase();
  const prod = String(product || '').trim().toLowerCase();
  if (line) {
    items = items.filter((c) => String(c.lineNumber || '').toUpperCase() === line);
  }
  if (prod) {
    items = items.filter((c) => String(c.product || '').toLowerCase() === prod);
  }

  const cameras = await mapPool(items, 4, async (reg) => {
    try {
      return await probeCamera(reg.ip, reg);
    } catch (e) {
      return {
        ip: reg.ip,
        online: false,
        probedAt: new Date().toISOString(),
        registry: {
          lineNumber: reg.lineNumber || '',
          product: reg.product || '',
          role: reg.role || '',
          cameraId: reg.cameraId || '',
        },
        serialNumber: reg.serialNumber || '',
        version: '',
        warnings: [e.message || String(e)],
        errors: { health: e.message || String(e) },
      };
    }
  });

  const online = cameras.filter((c) => c.online).length;
  return {
    probedAt: new Date().toISOString(),
    total: cameras.length,
    online,
    offline: cameras.length - online,
    cameras,
  };
}

async function filterRegistered({ lineNumber, product } = {}) {
  let items = await listCameras();
  const line = String(lineNumber || '').trim().toUpperCase();
  const prod = String(product || '').trim().toLowerCase();
  if (line) {
    items = items.filter((c) => String(c.lineNumber || '').toUpperCase() === line);
  }
  if (prod) {
    items = items.filter((c) => String(c.product || '').toLowerCase() === prod);
  }
  return items;
}

/** Push NTP config to registered cameras (read/write on device). */
async function applyNtpToRegistered({
  ntpServer,
  enabled = true,
  lineNumber,
  product,
} = {}) {
  const server = normalizeIp(ntpServer);
  if (!isValidIpOrHost(server)) {
    const err = new Error('Servidor NTP inválido (usa IP o hostname)');
    err.status = 400;
    throw err;
  }
  const items = await filterRegistered({ lineNumber, product });
  const results = await mapPool(items, 4, async (reg) => {
    const res = await fetchJson(reg.ip, '/edge/v2/device/ntp', {
      method: 'POST',
      timeoutMs: WRITE_MS,
      body: {
        enabled: enabled !== false,
        servers: [server],
      },
    });
    return {
      ip: reg.ip,
      lineNumber: reg.lineNumber,
      role: reg.role,
      ok: res.ok,
      error: res.error,
      detail: typeof res.data === 'string' ? res.data : (res.ok ? 'ok' : ''),
    };
  });
  return {
    ntpServer: server,
    enabled: enabled !== false,
    total: results.length,
    okCount: results.filter((r) => r.ok).length,
    failCount: results.filter((r) => !r.ok).length,
    results,
  };
}

/** One-shot: set each camera clock to MES server time (microseconds).
 * OV80i refuses SetTime while NTP/auto-sync is enabled, so we:
 * 1) read NTP config  2) disable NTP  3) set time  4) restore NTP
 */
async function syncTimeToRegistered({
  lineNumber,
  product,
  reenableNtp = true,
} = {}) {
  const nowUs = Math.round(Date.now() * 1000);
  const items = await filterRegistered({ lineNumber, product });
  const results = await mapPool(items, 3, async (reg) => {
    const base = {
      ip: reg.ip,
      lineNumber: reg.lineNumber,
      role: reg.role,
    };

    const ntpBefore = await fetchJson(reg.ip, '/edge/v2/device/ntp', { timeoutMs: WRITE_MS });
    const servers = ntpBefore.ok && Array.isArray(ntpBefore.data?.servers)
      ? ntpBefore.data.servers.filter(Boolean)
      : [];
    const wasEnabled = ntpBefore.ok ? !!ntpBefore.data?.enabled : true;

    if (wasEnabled || ntpBefore.ok) {
      const off = await fetchJson(reg.ip, '/edge/v2/device/ntp', {
        method: 'POST',
        timeoutMs: WRITE_MS,
        body: { enabled: false, servers: servers.length ? servers : ['0.pool.ntp.org'] },
      });
      if (!off.ok) {
        return {
          ...base,
          ok: false,
          error: `No se pudo desactivar NTP: ${off.error || 'error'}`,
        };
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    const set = await fetchJson(reg.ip, '/edge/v2/device/time', {
      method: 'POST',
      timeoutMs: WRITE_MS,
      body: { now_us: nowUs },
    });
    if (!set.ok) {
      // best-effort re-enable if we disabled
      if (wasEnabled && reenableNtp) {
        await fetchJson(reg.ip, '/edge/v2/device/ntp', {
          method: 'POST',
          timeoutMs: WRITE_MS,
          body: { enabled: true, servers },
        });
      }
      return {
        ...base,
        ok: false,
        error: set.error || 'No se pudo setear hora',
      };
    }

    if (reenableNtp && wasEnabled) {
      const on = await fetchJson(reg.ip, '/edge/v2/device/ntp', {
        method: 'POST',
        timeoutMs: WRITE_MS,
        body: { enabled: true, servers: servers.length ? servers : ['0.pool.ntp.org'] },
      });
      if (!on.ok) {
        return {
          ...base,
          ok: true,
          warning: `Hora OK, pero NTP no se reactivó: ${on.error || 'error'}`,
        };
      }
    }

    // verify
    const after = await fetchJson(reg.ip, '/edge/v2/device/time', { timeoutMs: WRITE_MS });
    let skewSec = null;
    if (after.ok && after.data?.now_us != null) {
      skewSec = Math.round((Number(after.data.now_us) - Date.now() * 1000) / 1000);
    }

    return {
      ...base,
      ok: true,
      skewSec,
      warning:
        skewSec != null && Math.abs(skewSec) > 5
          ? `Hora aplicada, skew residual ${skewSec}s (NTP de planta puede estar mal)`
          : null,
    };
  });

  return {
    mesTimeUs: nowUs,
    mesTimeIso: new Date().toISOString(),
    total: results.length,
    okCount: results.filter((r) => r.ok).length,
    failCount: results.filter((r) => !r.ok).length,
    results,
  };
}

module.exports = {
  probeCamera,
  probeRegisteredCameras,
  applyNtpToRegistered,
  syncTimeToRegistered,
};
