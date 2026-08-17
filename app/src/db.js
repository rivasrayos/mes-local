const { Pool, types } = require('pg');
const config = require('./config');

// Keep TIMESTAMP WITHOUT TIME ZONE as wall-clock text (avoid Date/TZ shifts)
const TIMESTAMP_OID = 1114;
types.setTypeParser(TIMESTAMP_OID, (val) => {
  if (val == null) return null;
  const s = String(val).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : s;
});

const pool = new Pool({
  connectionString: config.databaseUrl,
});

async function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
