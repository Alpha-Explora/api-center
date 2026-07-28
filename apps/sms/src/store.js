const SMS_KEY_PREFIX = 'apic:sms:';

function createSmsStore(env = process.env) {
  const mode = env.SMS_STORE_MODE || (env.NODE_ENV === 'production' ? 'redis' : 'memory');

  if (mode === 'memory') {
    if (env.NODE_ENV === 'production') {
      throw new Error('SMS_STORE_MODE=memory is not allowed in production. Configure SMS_REDIS_URL or REDIS_URL.');
    }

    return createMemorySmsStore();
  }

  if (mode !== 'redis') {
    throw new Error(`Unsupported SMS_STORE_MODE: ${mode}`);
  }

  const redisUrl = env.SMS_REDIS_URL || env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('SMS Redis storage requires SMS_REDIS_URL or REDIS_URL.');
  }

  return createRedisSmsStore(redisUrl);
}

function createMemorySmsStore() {
  const entries = new Map();

  return {
    async createMessage(entry) {
      entries.set(entry.messageId, entry);
      return entry;
    },

    async getMessage(messageId) {
      return entries.get(messageId) || null;
    },

    async updateMessage(messageId, patch) {
      const current = entries.get(messageId);
      if (!current) {
        return null;
      }

      const updated = { ...current, ...patch };
      entries.set(messageId, updated);
      return updated;
    },
  };
}

function createRedisSmsStore(redisUrl) {
  let clientPromise;

  async function getClient() {
    if (!clientPromise) {
      const { createClient } = require('redis');
      const client = createClient({ url: redisUrl });
      client.on('error', (error) => {
        console.error('[sms-gateway] Redis error:', error.message);
      });
      clientPromise = client.connect().then(() => client);
    }

    return clientPromise;
  }

  return {
    async createMessage(entry) {
      const client = await getClient();
      await client.set(`${SMS_KEY_PREFIX}${entry.messageId}`, JSON.stringify(entry));
      return entry;
    },

    async getMessage(messageId) {
      const client = await getClient();
      const raw = await client.get(`${SMS_KEY_PREFIX}${messageId}`);
      return raw ? JSON.parse(raw) : null;
    },

    async updateMessage(messageId, patch) {
      const current = await this.getMessage(messageId);
      if (!current) {
        return null;
      }

      const updated = { ...current, ...patch };
      const client = await getClient();
      await client.set(`${SMS_KEY_PREFIX}${messageId}`, JSON.stringify(updated));
      return updated;
    },
  };
}

module.exports = {
  createSmsStore,
  createMemorySmsStore,
  createRedisSmsStore,
};
