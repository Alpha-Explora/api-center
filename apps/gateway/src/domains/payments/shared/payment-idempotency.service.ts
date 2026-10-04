import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import Redis from "ioredis";
import { PaymentPrincipal } from "../features/payment-facade/payment-api-key.service";

type StoredResponse = {
  status: number;
  contentType?: string;
  body: string;
};

type StoredRecord = {
  fingerprint: string;
  response?: StoredResponse;
  createdAt?: number;
  unknownSince?: number;
};

export type IdempotencyLookup = { replay: StoredResponse } | { miss: true };

const TTL_SECONDS = 7 * 24 * 60 * 60;
const LEASE_MS = 30_000;
// PayMongo expires provider idempotency keys after 24 hours. Leave a one-hour
// margin for request/clock uncertainty before stopping automatic retries.
const UNKNOWN_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

const RESERVE_SCRIPT = `
local result = redis.call('SET', KEYS[1], ARGV[1], 'NX')
if not result then return 0 end
redis.call('SET', KEYS[2], 'processing', 'PX', ARGV[2])
return 1
`;

const MARK_UNKNOWN_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
if record.response then return 1 end
record.unknownSince = record.unknownSince or tonumber(ARGV[1])
redis.call('SET', KEYS[1], cjson.encode(record))
redis.call('PEXPIRE', KEYS[2], ARGV[2])
return 1
`;

@Injectable()
export class PaymentIdempotencyService {
  private readonly memory = new Map<string, StoredRecord & { expiresAt: number }>();
  private readonly leases = new Map<string, number>();
  private redis: Redis | null = null;
  private redisConnectPromise: Promise<Redis | null> | null = null;

  async lookupOrValidate(input: {
    principal: PaymentPrincipal;
    method: string;
    path: string;
    key?: string;
    body: unknown;
  }): Promise<IdempotencyLookup> {
    if (!this.isMutation(input.method)) return { miss: true };

    const key = input.key?.trim();
    if (!key || key.length < 16 || key.length > 255) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key must be between 16 and 255 characters for payment mutations",
      });
    }

    const storageKey = this.storageKey(input.principal, input.method, input.path, key);
    const fingerprint = this.fingerprint(input.body);
    let stored = await this.read(storageKey);
    let reserved = false;
    if (!stored) {
      const createdAt = Date.now();
      reserved = await this.writeIfAbsentAndClaimLease(storageKey, { fingerprint, createdAt });
      stored = reserved ? { fingerprint, createdAt } : await this.read(storageKey);
      if (!stored) throw new ServiceUnavailableException('Payment idempotency storage is unavailable');
    }
    if (stored.fingerprint !== fingerprint) {
      throw new ConflictException({
        code: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH",
        message: "The idempotency key was already used with a different request",
      });
    }
    if (!stored.response) {
      const unresolvedSince = stored.createdAt ?? stored.unknownSince;
      if (unresolvedSince === undefined
        || Date.now() - unresolvedSince >= UNKNOWN_RETRY_WINDOW_MS) {
        throw new ConflictException({ code: 'PAYMENT_OUTCOME_UNKNOWN',
          message: 'The provider idempotency window has expired; reconcile this payment before retrying' });
      }
      if (reserved) return { miss: true };
      if (await this.claimLease(storageKey)) return { miss: true };
      throw new ConflictException({ code: 'IDEMPOTENCY_KEY_IN_PROGRESS',
        message: 'The idempotency key is already being processed; retry after the lease expires' });
    }
    return { replay: stored.response };
  }

  async store(input: {
    principal: PaymentPrincipal;
    method: string;
    path: string;
    key: string;
    body: unknown;
    response: StoredResponse;
  }): Promise<void> {
    const storageKey = this.storageKey(input.principal, input.method, input.path, input.key);
    await this.write(storageKey, {
      fingerprint: this.fingerprint(input.body),
      response: input.response,
    });
    await this.releaseLease(storageKey);
  }

  async markUnknown(input: {
    principal: PaymentPrincipal; method: string; path: string; key?: string;
  }): Promise<void> {
    if (!input.key || !this.isMutation(input.method)) return;
    const storageKey = this.storageKey(input.principal, input.method, input.path, input.key);
    const redis = await this.redisClient();
    if (redis) {
      // Keep unresolved outcomes beyond the ordinary replay TTL so an old key
      // can never become a fresh charge after the provider forgets it.
      const result = await redis.eval(MARK_UNKNOWN_SCRIPT, 2, storageKey, `${storageKey}:lease`, Date.now(), LEASE_MS);
      if (Number(result) !== 1) throw new ServiceUnavailableException('Payment idempotency record is unavailable');
      return;
    }
    if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('Payment idempotency storage is unavailable');
    const current = this.memory.get(storageKey);
    if (!current) throw new ServiceUnavailableException('Payment idempotency record is unavailable');
    if (current.response) return;
    const unknown = { ...current, unknownSince: current.unknownSince ?? Date.now() };
    this.memory.set(storageKey, { ...unknown, expiresAt: Number.POSITIVE_INFINITY });
    if (this.leases.has(storageKey)) this.leases.set(storageKey, Date.now() + LEASE_MS);
  }

  private async claimLease(key: string): Promise<boolean> {
    const redis = await this.redisClient();
    if (redis) return (await redis.set(`${key}:lease`, 'processing', 'PX', LEASE_MS, 'NX')) === 'OK';
    if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('Payment idempotency storage is unavailable');
    const expiresAt = this.leases.get(key);
    if (expiresAt && expiresAt > Date.now()) return false;
    this.leases.set(key, Date.now() + LEASE_MS);
    return true;
  }

  private async releaseLease(key: string): Promise<void> {
    const redis = await this.redisClient();
    if (redis) await redis.del(`${key}:lease`);
    else this.leases.delete(key);
  }

  private async read(key: string): Promise<StoredRecord | null> {
    const redis = await this.redisClient();
    if (redis) {
      const raw = await redis.get(key);
      return raw ? (JSON.parse(raw) as StoredRecord) : null;
    }

    const value = this.memory.get(key);
    if (!value || value.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return { fingerprint: value.fingerprint, response: value.response,
      createdAt: value.createdAt, unknownSince: value.unknownSince };
  }

  private async writeIfAbsentAndClaimLease(key: string, value: StoredRecord): Promise<boolean> {
    const redis = await this.redisClient();
    if (redis) {
      // A reservation stays durable until a response is stored. If the gateway
      // crashes during a provider call, expiry must not turn the old key into
      // a new charge after PayMongo forgets its idempotency key.
      const result = await redis.eval(
        RESERVE_SCRIPT,
        2,
        key,
        `${key}:lease`,
        JSON.stringify(value),
        LEASE_MS,
      );
      return Number(result) === 1;
    }
    if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('Payment idempotency storage is unavailable');
    const existing = this.memory.get(key);
    if (existing && existing.expiresAt > Date.now()) return false;
    this.memory.set(key, { ...value, expiresAt: Number.POSITIVE_INFINITY });
    this.leases.set(key, Date.now() + LEASE_MS);
    return true;
  }

  private async write(key: string, value: StoredRecord): Promise<void> {
    const redis = await this.redisClient();
    if (redis) {
      await redis.setex(key, TTL_SECONDS, JSON.stringify(value));
      return;
    }
    if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('Payment idempotency storage is unavailable');
    this.memory.set(key, { ...value, expiresAt: Date.now() + TTL_SECONDS * 1000 });
  }

  private async redisClient(): Promise<Redis | null> {
    const url = process.env.REDIS_URL || process.env.REDIS_CACHE_URL;
    if (!url) return null;

    if (!this.redis) {
      this.redis = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      this.redis.on("error", () => undefined);
    }
    if (this.redis.status === "ready") return this.redis;
    if (!this.redisConnectPromise) {
      this.redisConnectPromise = this.redis
        .connect()
        .then(() => this.redis)
        .catch(() => null)
        .finally(() => {
          this.redisConnectPromise = null;
        });
    }
    const connected = await this.redisConnectPromise;
    return connected?.status === "ready" ? connected : null;
  }

  private storageKey(
    principal: PaymentPrincipal,
    method: string,
    path: string,
    key: string,
  ): string {
    const identity = [
      principal.ownerTribeId,
      principal.consumerServiceId,
      principal.environment,
      method,
      path,
      key.trim(),
    ].join(":");
    return `apicenter:payments:idempotency:${createHash("sha256").update(identity).digest("hex")}`;
  }

  private fingerprint(body: unknown): string {
    return createHash("sha256").update(JSON.stringify(this.canonicalize(body))).digest("hex");
  }

  private canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.canonicalize(item));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, this.canonicalize(item)]),
    );
  }

  private isMutation(method: string): boolean {
    return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
  }
}
