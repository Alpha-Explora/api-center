const OTP_KEY_PREFIX = 'apic:otp:';

export interface OtpRecord {
  otpId: string;
  target: string;
  channel: 'sms' | 'email';
  code: string;
  expiresAt: number;
  status: 'pending' | 'used' | 'expired';
}

export interface OtpStore {
  createOtp(entry: OtpRecord): Promise<OtpRecord>;
  getOtp(otpId: string): Promise<OtpRecord | null>;
  updateOtp(otpId: string, patch: Partial<OtpRecord>): Promise<OtpRecord | null>;
}

export function createOtpStore(env: Record<string, string | undefined> = process.env): OtpStore {
  const mode = env.OTP_STORE_MODE || (env.NODE_ENV === 'production' ? 'redis' : 'memory');

  if (mode === 'memory') {
    if (env.NODE_ENV === 'production') {
      throw new Error('OTP_STORE_MODE=memory is not allowed in production. Configure OTP_REDIS_URL or REDIS_URL.');
    }

    return createMemoryOtpStore();
  }

  if (mode !== 'redis') {
    throw new Error(`Unsupported OTP_STORE_MODE: ${mode}`);
  }

  const redisUrl = env.OTP_REDIS_URL || env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('OTP Redis storage requires OTP_REDIS_URL or REDIS_URL.');
  }

  return createRedisOtpStore(redisUrl);
}

export function createMemoryOtpStore(): OtpStore {
  const entries = new Map<string, OtpRecord>();

  return {
    async createOtp(entry) {
      entries.set(entry.otpId, entry);
      return entry;
    },

    async getOtp(otpId) {
      return entries.get(otpId) || null;
    },

    async updateOtp(otpId, patch) {
      const current = entries.get(otpId);
      if (!current) {
        return null;
      }

      const updated = { ...current, ...patch };
      entries.set(otpId, updated);
      return updated;
    },
  };
}

export function createRedisOtpStore(redisUrl: string): OtpStore {
  let clientPromise: Promise<any> | undefined;

  async function getClient() {
    if (!clientPromise) {
      const { createClient } = require('redis');
      const client = createClient({ url: redisUrl });
      client.on('error', (error: any) => {
        console.error('[otp-gateway] Redis error:', error?.message);
      });
      clientPromise = client.connect().then(() => client);
    }

    return clientPromise;
  }

  async function writeEntry(entry: OtpRecord) {
    const client = await getClient();
    const secondsUntilExpiry = Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));
    await client.set(`${OTP_KEY_PREFIX}${entry.otpId}`, JSON.stringify(entry), {
      EX: secondsUntilExpiry,
    });
    return entry;
  }

  return {
    async createOtp(entry) {
      return writeEntry(entry);
    },

    async getOtp(otpId) {
      const client = await getClient();
      const raw = await client.get(`${OTP_KEY_PREFIX}${otpId}`);
      return raw ? (JSON.parse(raw) as OtpRecord) : null;
    },

    async updateOtp(otpId, patch) {
      const current = await this.getOtp(otpId);
      if (!current) {
        return null;
      }

      return writeEntry({ ...current, ...patch });
    },
  };
}
