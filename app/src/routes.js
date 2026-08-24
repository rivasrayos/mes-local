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
const {
  ingestEol,
  listEol,
  getEol,
  listEolLines,
  getEolDashboard,
  deleteEolByDateRange,
  toEolCsv,
} = require('./eol');
const {
  discoverCamera,
  listCameras,
  upsertCamera,
  deleteCamera,
} = require('./cameras');

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
  res.json({ ok: true, service: 'mes-local', products: ['imla', 'eol'], tz: config.tz });
});

async function handleImlaIngest(req, res, next) {
  try {
    const result = await ingestBatch(req.body);
    const body = buildNodeRedResponse(result.received);
    if (body === null) return res.status(204).end();
    return res.status(200).json(body);
  } catch (err) {
    return next(err);
  }
}

router.post('/inspections', handleImlaIngest);
router.post('/inspections/produce/passstation/batchQCProcess', handleImlaIngest);

router.get('/lines', async (_req, res, next) => {
  try {
    res.json({ lines: await listLines() });
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
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="imla-inspections.csv"');
    res.send(toCsv(result.items));
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

// -------------------- EOL --------------------

async function handleEolIngest(req, res, next) {
  try {
    const result = await ingestEol(req.body);
    const body = buildNodeRedResponse(result.received);
    if (body === null) return res.status(204).end();
    return res.status(200).json(body);
  } catch (err) {
    return next(err);
  }
}

router.post('/eol/inspections', handleEolIngest);

router.get('/eol/lines', async (_req, res, next) => {
  try {
    res.json({ lines: await listEolLines() });
  } catch (err) {
    next(err);
  }
});

router.get('/eol/inspections', async (req, res, next) => {
  try {
    const q = applyRange(req.query);
    const result = await listEol(q);
    res.json({ ...result, window: q._window });
  } catch (err) {
    next(err);
  }
});

router.get('/eol/inspections/export.csv', async (req, res, next) => {
  try {
    const q = applyRange({ ...req.query, limit: 10000, offset: 0 });
    const result = await listEol(q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="eol-inspections.csv"');
    res.send(toEolCsv(result.items));
  } catch (err) {
    next(err);
  }
});

router.get('/eol/inspections/:id', async (req, res, next) => {
  try {
    const item = await getEol(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    return res.json(item);
  } catch (err) {
    return next(err);
  }
});

router.get('/eol/dashboard', async (req, res, next) => {
  try {
    const q = applyRange(req.query);
    const data = await getEolDashboard(q);
    res.json({ ...data, window: q._window });
  } catch (err) {
    next(err);
  }
});

router.delete('/eol/history', async (req, res, next) => {
  try {
    const { from, to, before } = { ...req.query, ...req.body };
    const result = await deleteEolByDateRange({ from, to, before });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// -------------------- Settings / cameras --------------------

router.post('/settings/cameras/discover', async (req, res, next) => {
  try {
    const result = await discoverCamera(req.body?.ip);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

router.get('/settings/cameras', async (_req, res, next) => {
  try {
    res.json({ items: await listCameras() });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/cameras', async (req, res, next) => {
  try {
    const item = await upsertCamera(req.body || {});
    res.status(201).json({ ok: true, item });
  } catch (err) {
    next(err);
  }
});

router.delete('/settings/cameras/:id', async (req, res, next) => {
  try {
    res.json({ ok: true, ...(await deleteCamera(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
