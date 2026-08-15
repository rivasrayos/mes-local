function envBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

/** Parse "id:Label,id:Label" or JSON object into a map */
function parseCameraMap(raw) {
  if (!raw) return {};
  const text = String(raw).trim();
  if (!text) return {};
  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text);
      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [String(k).trim(), String(v).trim()])
      );
    } catch {
      return {};
    }
  }
  const map = {};
  for (const part of text.split(',')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const label = part.slice(idx + 1).trim();
    if (key && label) map[key] = label;
  }
  return map;
}

// Default plant map: cameraId / host IP → EOL1..EOL5
// L11 EOL TIP
const DEFAULT_EOL_CAMERA_MAP = {
  'ov80i-gsac586514': 'EOL1',
  '192.168.11.174': 'EOL1',
  'ov80i-gsac586492': 'EOL2',
  '192.168.11.175': 'EOL2',
  'ov80i-gsac586484': 'EOL3',
  '192.168.11.176': 'EOL3',
  'ov80i-gsac586513': 'EOL4',
  '192.168.11.177': 'EOL4',
  'ov80i-gsac586500': 'EOL5',
  '192.168.11.178': 'EOL5',
  // L12 EOL TIP (serials seen without view label)
  'ov80i-gsac586457': 'EOL1',
  'ov80i-gsac586479': 'EOL4',
  'ov80i-gsac586503': 'EOL5',
};

module.exports = {
  port: Number(process.env.PORT || 3100),
  databaseUrl: process.env.DATABASE_URL || 'postgres://mes:mes_secret_change_me@127.0.0.1:5432/mes_imla',
  tz: process.env.TZ || 'America/Los_Angeles',
  responseEnabled: envBool(process.env.RESPONSE_ENABLED, true),
  responseBodyTemplate: process.env.RESPONSE_BODY || '{"ok":true,"received":{{received}}}',
  eolCameraMap: {
    ...DEFAULT_EOL_CAMERA_MAP,
    ...parseCameraMap(process.env.EOL_CAMERA_MAP),
  },
};
