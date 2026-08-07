const config = require('./config');

/** Format a Date in configured TZ as YYYY-MM-DD HH:mm:ss */
function formatInTz(date = new Date(), timeZone = config.tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function parseInspectionTime(raw) {
  if (!raw || typeof raw !== 'string') return null;
  // Accept YYYY-M-D H:mm:ss or zero-padded variants (IMLA + EOL)
  const m = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${m[1]}-${pad(m[2])}-${pad(m[3])} ${pad(m[4])}:${m[5]}:${m[6]}`;
}

/**
 * Shift windows in plant local time:
 * day: 06:00 -> 18:00
 * night: 18:00 -> 06:00 next day
 */
function getShiftBounds(now = new Date(), timeZone = config.tz) {
  const local = formatInTz(now, timeZone);
  const [datePart, timePart] = local.split(' ');
  const hour = Number(timePart.slice(0, 2));
  const isDay = hour >= 6 && hour < 18;

  if (isDay) {
    return {
      shift: 'day',
      from: `${datePart} 06:00:00`,
      to: `${datePart} 18:00:00`,
    };
  }

  // Night shift: if before 06:00, started previous calendar day at 18:00
  const base = new Date(`${datePart}T12:00:00Z`);
  if (hour < 6) {
    base.setUTCDate(base.getUTCDate() - 1);
  }
  const startDate = formatInTz(base, 'UTC').slice(0, 10);
  const endBase = new Date(`${startDate}T12:00:00Z`);
  endBase.setUTCDate(endBase.getUTCDate() + 1);
  const endDate = formatInTz(endBase, 'UTC').slice(0, 10);

  return {
    shift: 'night',
    from: `${startDate} 18:00:00`,
    to: `${endDate} 06:00:00`,
  };
}

function hoursAgoLocal(hours, now = new Date(), timeZone = config.tz) {
  const d = new Date(now.getTime() - hours * 3600 * 1000);
  return formatInTz(d, timeZone);
}

function resolveTimeWindow(query = {}) {
  const range = String(query.range || '24h').toLowerCase();

  if (query.from && query.to) {
    return { range: 'custom', from: query.from, to: query.to };
  }

  if (range === 'shift' || range === 'current_shift') {
    const s = getShiftBounds();
    return { range: 'shift', from: s.from, to: s.to, shift: s.shift };
  }

  if (range === '8h') {
    const to = formatInTz();
    return { range: '8h', from: hoursAgoLocal(8), to };
  }

  if (range === '7d') {
    const to = formatInTz();
    return { range: '7d', from: hoursAgoLocal(24 * 7), to };
  }

  // default 24h
  const to = formatInTz();
  return { range: '24h', from: hoursAgoLocal(24), to };
}

module.exports = {
  formatInTz,
  parseInspectionTime,
  getShiftBounds,
  resolveTimeWindow,
};
