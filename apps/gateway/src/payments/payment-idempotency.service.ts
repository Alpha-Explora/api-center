import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import Redis from "ioredis";
import { PaymentPrincipal } from "./payment-api-key.service";

type StoredResponse = {
  status: number;
  contentType?: string;
  body: string;
};

type StoredRecord = {
  fingerprint: string;
  response?: StoredResponse;
};

export type IdempotencyLookup = { replay: StoredResponse } | { miss: true };

const TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class PaymentIdempotencyService {
  private readonly memory = new Map<string, StoredRecord & { expiresAt: number }>();
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
    if (!stored) {
      const claimed = await this.writeIfAbsent(storageKey, { fingerprint });
      if (claimed) return { miss: true };
      stored = await this.read(storageKey);
      if (!stored) throw new ServiceUnavailableException('Payment idempotency storage is unavailable');
    }
    if (stored.fingerprint !== fingerprint) {
      throw new ConflictException({
        code: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH",
        message: "The idempotency key was already used with a different request",
      });
    }
    if (!stored.response) {
      throw new ConflictException({
        code: "IDEMPOTENCY_KEY_IN_PROGRESS",
        message: "The idempotency key is already being processed",
      });
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
    const current = await this.read(storageKey);
    await this.write(storageKey, {
      ...(current || {}),
      fingerprint: this.fingerprint(input.body),
      response: input.response,
    });
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
    return { fingerprint: value.fingerprint, response: value.response };
  }

  private async writeIfAbsent(key: string, value: StoredRecord): Promise<boolean> {
    const redis = await this.redisClient();
    if (redis) {
      const result = await redis.set(key, JSON.stringify(value), 'EX', TTL_SECONDS, 'NX');
      return result === 'OK';
    }
    if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('Payment idempotency storage is unavailable');
    if (this.memory.has(key)) return false;
    this.memory.set(key, { ...value, expiresAt: Date.now() + TTL_SECONDS * 1000 });
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
      key,
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

