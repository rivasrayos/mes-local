const express = require('express');
const config = require('./config');
const { resolveTimeWindow } = require('./time');
const {
  ingestBatch,
  listInspections,
  getInspection,
  listLines,
  getDashboard,
  deleteByDateRange,
  toCsv,
} = require('./inspections');

const router = express.Router();

function applyRange(query) {
  const window = resolveTimeWindow(query);
  return {
    ...query,
    from: query.from || window.from,
    to: query.to || window.to,
    _window: window,
  };
}

function buildNodeRedResponse(received) {
  if (!config.responseEnabled) {
    return null;
  }
  const raw = config.responseBodyTemplate.replace(/\{\{\s*received\s*\}\}/g, String(received));
  try {
    return JSON.parse(raw);
  } catch {
    return { ok: true, received, raw };
  }
}

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'mes-imla', tz: config.tz });
});

async function handleIngest(req, res, next) {
  try {
    const result = await ingestBatch(req.body);
    const body = buildNodeRedResponse(result.received);
    if (body === null) {
      return res.status(204).end();
    }
    return res.status(200).json(body);
  } catch (err) {
    return next(err);
  }
}

// Canonical ingest path used by Node-RED MES_BASE_URL
router.post('/inspections', handleIngest);
// Compatibility alias when pack_mes_v2_msg still appends the old MES suffix
router.post('/inspections/produce/passstation/batchQCProcess', handleIngest);

router.get('/lines', async (_req, res, next) => {
  try {
    const lines = await listLines();
    res.json({ lines });
  } catch (err) {
    next(err);
  }
});

router.get('/inspections', async (req, res, next) => {
  try {
    const q = applyRange(req.query);
    const result = await listInspections(q);
    res.json({ ...result, window: q._window });
  } catch (err) {
    next(err);
  }
});

router.get('/inspections/export.csv', async (req, res, next) => {
  try {
    const q = applyRange({ ...req.query, limit: 10000, offset: 0 });
    const result = await listInspections(q);
    const csv = toCsv(result.items);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="imla-inspections.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

router.get('/inspections/:id', async (req, res, next) => {
  try {
    const item = await getInspection(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    return res.json(item);
  } catch (err) {
    return next(err);
  }
});

router.get('/dashboard', async (req, res, next) => {
  try {
    const q = applyRange(req.query);
    const data = await getDashboard(q);
    res.json({ ...data, window: q._window });
  } catch (err) {
    next(err);
  }
});

router.delete('/history', async (req, res, next) => {
  try {
    const { from, to, before } = { ...req.query, ...req.body };
    const result = await deleteByDateRange({ from, to, before });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
