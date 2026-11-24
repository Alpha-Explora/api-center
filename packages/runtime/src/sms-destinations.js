const DEFAULT_SMS_PREFIXES = Object.freeze(['+63']);
const SMS_DAILY_LIMIT_DEFAULT = 500;
const E164 = /^\+[1-9]\d{6,14}$/;
const PREFIX = /^\+[1-9]\d{0,3}$/;
const warnedRuntimes = new Set();
const USAGE_TABLE = {
  sms: 'shared_sms.sms_daily_usage',
  otp: 'shared_otp.otp_sms_daily_usage',
};

function destinationAllowed(phone, prefixes) {
  return E164.test(phone) && prefixes.some((prefix) => PREFIX.test(prefix) && phone.startsWith(prefix));
}

function smsDailyLimitDefault(env = process.env) {
  const value = Number(env.SMS_DAILY_LIMIT_DEFAULT);
  return Number.isInteger(value) && value > 0 && value <= 2147483647 ? value : SMS_DAILY_LIMIT_DEFAULT;
}

function parseSmsDeliverySettings(input) {
  const { dailyLimit, allowedPrefixes } = input;
  if (dailyLimit != null && (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 2147483647)) return null;
  if (allowedPrefixes != null && (!Array.isArray(allowedPrefixes) || allowedPrefixes.length < 1 || allowedPrefixes.length > 100
    || !allowedPrefixes.every((prefix) => typeof prefix === 'string' && PREFIX.test(prefix)))) return null;
  return {
    ...(dailyLimit !== undefined ? { dailyLimit } : {}),
    ...(allowedPrefixes !== undefined ? { allowedPrefixes: allowedPrefixes === null ? null : [...new Set(allowedPrefixes)].sort() } : {}),
  };
}

async function reserveDailySmsSend(pool, runtime, owner, limit, now = new Date()) {
  if (!pool) {
    if (!warnedRuntimes.has(runtime)) {
      warnedRuntimes.add(runtime);
      console.warn(JSON.stringify({ type: 'apicenter_sms_daily_usage_not_persisted', runtime }));
    }
    return true;
  }
  const table = USAGE_TABLE[runtime];
  const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const result = await pool.query(
    `INSERT INTO ${table} AS usage (project_id, environment, day, count) VALUES ($1,$2,$3,1)
     ON CONFLICT (project_id, environment, day) DO UPDATE SET count = usage.count + 1
     WHERE usage.count < $4 RETURNING count`,
    [owner.projectId, owner.environment, day, limit],
  );
  return result.rowCount === 1;
}

class SmsDeliveryPolicyError extends Error {
  constructor(code) {
    super(code === 'DAILY_LIMIT_REACHED' ? 'The project has reached its daily SMS limit' : 'This project cannot send SMS to that destination');
    this.code = code;
    this.statusCode = code === 'DAILY_LIMIT_REACHED' ? 429 : 403;
  }
}

module.exports = { DEFAULT_SMS_PREFIXES, destinationAllowed, smsDailyLimitDefault, parseSmsDeliverySettings,
  reserveDailySmsSend, SmsDeliveryPolicyError };
