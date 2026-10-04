import Redis from 'ioredis';
import type { OtpRepositoryInterface } from './otp-repository.interface';
import type { OtpRecord } from './otp-store';

const CONSUME_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'OTP_NOT_FOUND' end
local record = cjson.decode(raw)
if record.status == 'used' then return 'OTP_ALREADY_USED' end
if record.status == 'expired' or tonumber(record.expiresAt) < tonumber(ARGV[2]) then
  record.status = 'expired'
  redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL')
  return 'OTP_EXPIRED'
end
if record.codeHash ~= ARGV[1] then return 'OTP_INVALID' end
record.status = 'used'
redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL')
return 'VERIFIED'
`;

/** Stores OTP challenge state in Redis with atomic single-use verification. */
export class RedisOtpStore implements OtpRepositoryInterface {
  private readonly redis: Redis;

  constructor(url = process.env.OTP_REDIS_URL || process.env.REDIS_URL) {
    if (!url) throw new Error('OTP Redis URL is required');
    this.redis = new Redis(url, { maxRetriesPerRequest: 1 });
  }

  async save(record: OtpRecord): Promise<OtpRecord> {
    await this.redis.set(`otp:challenge:${record.otpId}`, JSON.stringify(record), 'PX',
      Math.max(1000, record.expiresAt - Date.now() + 3600000));
    return record;
  }

  async findById(otpId: string): Promise<OtpRecord | null> {
    const value = await this.redis.get(`otp:challenge:${otpId}`);
    return value ? JSON.parse(value) as OtpRecord : null;
  }

  async update(otpId: string, patch: Partial<OtpRecord>): Promise<OtpRecord | null> {
    const record = await this.findById(otpId);
    if (!record) return null;
    return this.save({ ...record, ...patch });
  }

  async consume(otpId: string, codeHash: string): Promise<string> {
    return String(await this.redis.eval(CONSUME_SCRIPT, 1, `otp:challenge:${otpId}`, codeHash, Date.now()));
  }
}
