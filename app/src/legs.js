const DEFAULT_LEG_MAPPING = '1a2a3a4a1b2b3b4b';

/**
 * Parse strings like "1a2a3a4a1b2b3b4b" into slot(1..n) -> { leg, end }.
 */
function parseLegMapping(mapping) {
  const raw = String(mapping || DEFAULT_LEG_MAPPING).replace(/\s+/g, '');
  const tokens = [...raw.matchAll(/(\d+)([ab])/gi)].map((m) => ({
    leg: String(m[1]),
    end: String(m[2]).toLowerCase(),
  }));

  const slotToLeg = {};
  tokens.forEach((token, idx) => {
    slotToLeg[String(idx + 1)] = token;
  });

  return { tokens, slotToLeg, raw: raw || DEFAULT_LEG_MAPPING };
}

function hasViewDefect(defectType, view) {
  const re = view === 'top'
    ? /(?:^|,)\s*top-/i
    : /(?:^|,)\s*bottom-/i;
  return re.test(defectType || '');
}

/**
 * Collapse slot inspections into physical cables within each batch.
 * Rule: Fail if any end fails; Pass only if all present ends pass.
 * Multiple fails on the same cable still count as one bad cable.
 */
function buildCablesFromSlots(rows = []) {
  const map = new Map();

  for (const row of rows) {
    const { slotToLeg } = parseLegMapping(row.leg_mapping);
    const slotKey = String(row.slot || '').trim();
    const info = slotToLeg[slotKey];
    if (!info) continue;

    const key = `${row.batch_id}|${info.leg}`;
    let cable = map.get(key);
    if (!cable) {
      cable = {
        batchId: row.batch_id,
        leg: info.leg,
        lineNumber: row.line_number || '',
        carrierSn: row.carrier_sn || '',
        legMapping: row.leg_mapping || DEFAULT_LEG_MAPPING,
        ts: row.ts,
        weldingPosition: row.welding_position || '',
        ends: [],
      };
      map.set(key, cable);
    }

    cable.ends.push({
      slot: slotKey,
      end: info.end,
      passFail: row.pass_fail || '',
      defectType: row.defect_type || '',
      weldingPosition: row.welding_position || '',
      sn: row.sn || '',
    });

    const rowTs = row.ts ? new Date(row.ts).getTime() : NaN;
    const curTs = cable.ts ? new Date(cable.ts).getTime() : NaN;
    if (!Number.isNaN(rowTs) && (Number.isNaN(curTs) || rowTs < curTs)) {
      cable.ts = row.ts;
    }
  }

  return [...map.values()].map((cable) => {
    const anyFail = cable.ends.some((e) => String(e.passFail).toLowerCase() === 'fail');
    const defectType = cable.ends
      .map((e) => e.defectType)
      .filter(Boolean)
      .join(', ');
    const failEnd = cable.ends.find((e) => String(e.passFail).toLowerCase() === 'fail');

    return {
      batchId: cable.batchId,
      leg: cable.leg,
      lineNumber: cable.lineNumber,
      carrierSn: cable.carrierSn,
      legMapping: cable.legMapping,
      ts: cable.ts,
      passFail: anyFail ? 'Fail' : 'Pass',
      defectType,
      topFail: hasViewDefect(defectType, 'top'),
      botFail: hasViewDefect(defectType, 'bottom'),
      weldingPosition: (failEnd && failEnd.weldingPosition) || cable.weldingPosition || 'NA',
      endCount: cable.ends.length,
    };
  });
}

function summarizeCables(cables = []) {
  const total = cables.length;
  const failCount = cables.filter((c) => c.passFail === 'Fail').length;
  const passCount = total - failCount;
  const topFail = cables.filter((c) => c.topFail).length;
  const botFail = cables.filter((c) => c.botFail).length;
  const carrierPasses = new Set(cables.map((c) => c.batchId).filter(Boolean)).size;

  return {
    total,
    passCount,
    failCount,
    passRate: total ? (passCount / total) * 100 : 0,
    failRate: total ? (failCount / total) * 100 : 0,
    topFail,
    botFail,
    topPass: Math.max(0, total - topFail),
    botPass: Math.max(0, total - botFail),
    carrierPasses,
  };
}

function trendFromCables(cables = [], view = 'general') {
  const buckets = new Map();

  for (const cable of cables) {
    if (!cable.ts) continue;
    const d = new Date(cable.ts);
    if (Number.isNaN(d.getTime())) continue;
    d.setMinutes(0, 0, 0);
    const key = d.toISOString();
    if (!buckets.has(key)) {
      buckets.set(key, { bucket: d, total: 0, passCount: 0, failCount: 0 });
    }
    const b = buckets.get(key);
    b.total += 1;

    let failed = false;
    if (view === 'top') failed = !!cable.topFail;
    else if (view === 'bot') failed = !!cable.botFail;
    else failed = cable.passFail === 'Fail';

    if (failed) b.failCount += 1;
    else b.passCount += 1;
  }

  return [...buckets.values()]
    .sort((a, b) => a.bucket - b.bucket)
    .map((b) => ({
      bucket: b.bucket,
      total: b.total,
      passCount: b.passCount,
      failCount: b.failCount,
    }));
}

function defectsFromCables(cables = [], view = 'all') {
  const counts = new Map();
  for (const cable of cables) {
    const parts = String(cable.defectType || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const defect of parts) {
      if (view === 'top' && !/^top-/i.test(defect)) continue;
      if (view === 'bot' && !/^bottom-/i.test(defect)) continue;
      counts.set(defect, (counts.get(defect) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([defect, count]) => ({ defect, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
}

function weldingFromCables(cables = [], view = 'general') {
  const counts = new Map();
  for (const cable of cables) {
    let include = false;
    if (view === 'top') include = !!cable.topFail;
    else if (view === 'bot') include = !!cable.botFail;
    else include = cable.passFail === 'Fail';
    if (!include) continue;
    const key = cable.weldingPosition || 'NA';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([welding_position, count]) => ({ welding_position, count }))
    .sort((a, b) => b.count - a.count);
}

function byLineFromCables(cables = []) {
  const map = new Map();
  for (const cable of cables) {
    const line = cable.lineNumber || '(blank)';
    if (!map.has(line)) {
      map.set(line, {
        lineNumber: line,
        total: 0,
        passCount: 0,
        failCount: 0,
        batches: new Set(),
      });
    }
    const row = map.get(line);
    row.total += 1;
    if (cable.passFail === 'Fail') row.failCount += 1;
    else row.passCount += 1;
    if (cable.batchId) row.batches.add(cable.batchId);
  }

  return [...map.values()]
    .map((r) => ({
      lineNumber: r.lineNumber,
      total: r.total,
      passCount: r.passCount,
      failCount: r.failCount,
      passRate: r.total ? (r.passCount / r.total) * 100 : 0,
      failRate: r.total ? (r.failCount / r.total) * 100 : 0,
      uniqueSns: 0,
      carrierPasses: r.batches.size,
      uniqueCarriers: r.batches.size,
      unit: 'cable',
    }))
    .sort((a, b) => String(a.lineNumber).localeCompare(String(b.lineNumber), undefined, { numeric: true }));
}

module.exports = {
  DEFAULT_LEG_MAPPING,
  parseLegMapping,
  buildCablesFromSlots,
  summarizeCables,
  trendFromCables,
  defectsFromCables,
  weldingFromCables,
  byLineFromCables,
};
