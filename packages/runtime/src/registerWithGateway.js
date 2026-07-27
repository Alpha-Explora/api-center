const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_BASE_DELAY_MS = 3000;

function shouldRegisterWithGateway(env = process.env) {
  const raw = env.REGISTER_WITH_GATEWAY;
  if (raw === undefined || raw === '') {
    return true;
  }

  return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

async function registerWithGateway({
  manifestPath,
  baseUrl,
  apiCenterUrl = process.env.API_CENTER_URL || 'http://localhost:3000',
  platformSecret = process.env.PLATFORM_ADMIN_SECRET || '',
  fetchImpl = fetch,
  serviceLabel = 'shared-service',
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger = console,
  enabled = shouldRegisterWithGateway(),
}) {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf-8'));
  manifest.baseUrl = baseUrl || manifest.baseUrl;

  if (!enabled) {
    logger.log(`[${serviceLabel}] gateway registration disabled`);
    return manifest;
  }

  const registerUrl = `${apiCenterUrl.replace(/\/$/, '')}/api/v1/registry/register`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchImpl(registerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Platform-Secret': platformSecret,
        },
        body: JSON.stringify(manifest),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      logger.log(`[${serviceLabel}] registered with api-center`);
      return manifest;
    } catch (err) {
      const retryDelayMs = baseDelayMs * Math.pow(2, attempt - 1);
      if (attempt < maxAttempts) {
        logger.warn(
          `[${serviceLabel}] registration attempt ${attempt} failed, retrying in ${retryDelayMs}ms:`,
          err.message,
        );
        await delay(retryDelayMs);
      } else {
        logger.warn(
          `[${serviceLabel}] WARN: all ${maxAttempts} registration attempts failed:`,
          err.message,
        );
      }
    }
  }

  return manifest;
}

module.exports = { registerWithGateway, shouldRegisterWithGateway };
