function envBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

module.exports = {
  port: Number(process.env.PORT || 3100),
  databaseUrl: process.env.DATABASE_URL || 'postgres://mes:mes_secret_change_me@127.0.0.1:5432/mes_imla',
  tz: process.env.TZ || 'America/Los_Angeles',
  responseEnabled: envBool(process.env.RESPONSE_ENABLED, true),
  responseBodyTemplate: process.env.RESPONSE_BODY || '{"ok":true,"received":{{received}}}',
};
