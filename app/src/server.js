const path = require('path');
const express = require('express');
const config = require('./config');
const { pool } = require('./db');
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

async function start() {
  // Fail fast if DB is unreachable
  await pool.query('SELECT 1');
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`MES IMLA listening on :${config.port}`);
    console.log(`TZ=${config.tz} RESPONSE_ENABLED=${config.responseEnabled}`);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
