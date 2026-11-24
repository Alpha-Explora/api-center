// Replay records for payment mutations, keyed by caller, operation and Idempotency-Key. With a
// database they live in apic_governance.payment_idempotency_keys so every gateway instance sees
// them; without one (local runs and tests) they live in this process, and production refuses that.
import { databaseConfigured } from "@config/database-configured";
import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import type { PaymentPrincipal } from "./payment-access.types";

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

type Row = {
  fingerprint: string;
  response: StoredResponse | null;
  created_at: Date;
  unknown_since: Date | null;
};

export type IdempotencyLookup = { replay: StoredResponse } | { miss: true };

const TTL_SECONDS = 7 * 24 * 60 * 60;
const LEASE_MS = 30_000;
// PayMongo expires provider idempotency keys after 24 hours. Leave a one-hour
// margin for request/clock uncertainty before stopping automatic retries.
const UNKNOWN_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const TABLE = "apic_governance.payment_idempotency_keys";

@Injectable()
export class PaymentIdempotencyService {
  private readonly memory = new Map<string, StoredRecord & { expiresAt: number }>();
  private readonly leases = new Map<string, number>();
  private readonly databaseEnabled =
    databaseConfigured();

  constructor(@Optional() private readonly prisma?: PrismaService) {}

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
    const fingerprint = this.fingerprint(input.body);
    const db = this.db();
    if (db) {
      // Storing the response also releases the lease and starts the replay TTL.
      await db.$executeRawUnsafe(
        `INSERT INTO ${TABLE} (storage_key, fingerprint, response, expires_at) VALUES ($1, $2, $3::jsonb, now() + make_interval(secs => $4::double precision))
         ON CONFLICT (storage_key) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, response = EXCLUDED.response,
           expires_at = EXCLUDED.expires_at, lease_until = NULL, updated_at = now()`,
        storageKey, fingerprint, JSON.stringify(input.response), TTL_SECONDS,
      );
      return;
    }
    this.memory.set(storageKey, { fingerprint, response: input.response, expiresAt: Date.now() + TTL_SECONDS * 1000 });
    this.leases.delete(storageKey);
  }

  async markUnknown(input: {
    principal: PaymentPrincipal; method: string; path: string; key?: string;
  }): Promise<void> {
    if (!input.key || !this.isMutation(input.method)) return;
    const storageKey = this.storageKey(input.principal, input.method, input.path, input.key);
    const db = this.db();
    if (db) {
      // Unresolved outcomes never expire, so an old key can never become a fresh charge after the
      // provider forgets it. The lease is renewed so a concurrent retry waits for this one.
      const rows = await db.$queryRawUnsafe<Array<{ storage_key: string }>>(
        `UPDATE ${TABLE}
            SET unknown_since = CASE WHEN response IS NULL THEN COALESCE(unknown_since, now()) ELSE unknown_since END,
                lease_until = CASE WHEN response IS NULL AND lease_until IS NOT NULL THEN now() + make_interval(secs => $2::double precision) ELSE lease_until END,
                updated_at = now()
          WHERE storage_key = $1
          RETURNING storage_key`,
        storageKey, LEASE_MS / 1000,
      );
      if (rows.length !== 1) throw new ServiceUnavailableException('Payment idempotency record is unavailable');
      return;
    }
    const current = this.memory.get(storageKey);
    if (!current) throw new ServiceUnavailableException('Payment idempotency record is unavailable');
    if (current.response) return;
    const unknown = { ...current, unknownSince: current.unknownSince ?? Date.now() };
    this.memory.set(storageKey, { ...unknown, expiresAt: Number.POSITIVE_INFINITY });
    if (this.leases.has(storageKey)) this.leases.set(storageKey, Date.now() + LEASE_MS);
  }

  /** The database, or undefined for the in-process store that only non-production may use. */
  private db(): PrismaService | undefined {
    if (this.databaseEnabled && this.prisma) return this.prisma;
    if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('Payment idempotency storage is unavailable');
    return undefined;
  }

  private async claimLease(key: string): Promise<boolean> {
    const db = this.db();
    if (db) {
      const rows = await db.$queryRawUnsafe<Array<{ storage_key: string }>>(
        `UPDATE ${TABLE} SET lease_until = now() + make_interval(secs => $2::double precision), updated_at = now()
          WHERE storage_key = $1 AND response IS NULL AND (lease_until IS NULL OR lease_until <= now())
          RETURNING storage_key`,
        key, LEASE_MS / 1000,
      );
      return rows.length === 1;
    }
    const expiresAt = this.leases.get(key);
    if (expiresAt && expiresAt > Date.now()) return false;
    this.leases.set(key, Date.now() + LEASE_MS);
    return true;
  }

  private async read(key: string): Promise<StoredRecord | null> {
    const db = this.db();
    if (db) {
      const rows = await db.$queryRawUnsafe<Row[]>(
        `SELECT fingerprint, response, created_at, unknown_since FROM ${TABLE}
          WHERE storage_key = $1 AND (expires_at IS NULL OR expires_at > now())`,
        key,
      );
      const row = rows[0];
      if (!row) return null;
      return {
        fingerprint: row.fingerprint,
        response: row.response ?? undefined,
        // A record with a response no longer needs its reservation time.
        createdAt: row.response ? undefined : new Date(row.created_at).getTime(),
        unknownSince: row.unknown_since ? new Date(row.unknown_since).getTime() : undefined,
      };
    }

    const value = this.memory.get(key);
    if (!value || value.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return { fingerprint: value.fingerprint, response: value.response,
      createdAt: value.createdAt, unknownSince: value.unknownSince };
  }

  /**
   * Reserve the key with a lease. A reservation stays until a response is stored: if the gateway
   * crashes during a provider call, expiry must not turn the old key into a new charge after
   * PayMongo forgets its idempotency key. Only an expired completed record can be reserved again.
   */
  private async writeIfAbsentAndClaimLease(key: string, value: StoredRecord): Promise<boolean> {
    const db = this.db();
    if (db) {
      const rows = await db.$queryRawUnsafe<Array<{ storage_key: string }>>(
        `INSERT INTO ${TABLE} AS k (storage_key, fingerprint, created_at, lease_until)
         VALUES ($1, $2, $3, $3::timestamptz + make_interval(secs => $4::double precision))
         ON CONFLICT (storage_key) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, response = NULL,
           created_at = EXCLUDED.created_at, lease_until = EXCLUDED.lease_until, unknown_since = NULL,
           expires_at = NULL, updated_at = now()
           WHERE k.expires_at IS NOT NULL AND k.expires_at <= now()
         RETURNING storage_key`,
        key, value.fingerprint, new Date(value.createdAt ?? Date.now()), LEASE_MS / 1000,
      );
      return rows.length === 1;
    }
    const existing = this.memory.get(key);
    if (existing && existing.expiresAt > Date.now()) return false;
    this.memory.set(key, { ...value, expiresAt: Number.POSITIVE_INFINITY });
    this.leases.set(key, Date.now() + LEASE_MS);
    return true;
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
