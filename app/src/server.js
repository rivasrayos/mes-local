const path = require('path');
const express = require('express');
const config = require('./config');
const { pool } = require('./db');
const { ensureSchema } = require('./ensureSchema');
const routes = require('./routes');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use('/api', routes);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  console.error(err);
  res.status(status).json({
    error: err.message || 'Internal Server Error',
  });
});

async function waitForDb({ attempts = 60, delayMs = 2000 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await pool.query('SELECT 1');
      if (i > 1) console.log(`Database ready after ${i} attempt(s)`);
      return;
    } catch (err) {
      lastErr = err;
      console.error(`Waiting for database (${i}/${attempts}): ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr || new Error('Database not reachable');
}

async function start() {
  await waitForDb();
  await ensureSchema();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`MES Local (IMLA/EOL) listening on :${config.port}`);
    console.log(`TZ=${config.tz} RESPONSE_ENABLED=${config.responseEnabled}`);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
