// =============================================================================
// Refresh token store
// =============================================================================
// Persists refresh token metadata (never the token itself) in apic_identity.refresh_tokens so any
// gateway instance can refresh or revoke it. Without a database (local runs and tests) records live
// in this process only.
// =============================================================================

import { Injectable, Optional } from "@nestjs/common";
import { LoggerService } from "@shared/logger.service";
import { ConfigService } from "@config/config.service";
import { PrismaService } from "@database/prisma.service";
import type { ApicenterRuntimeEnvironment } from "../../../types";

/** Stored refresh token payload */
export interface RefreshTokenRecord {
  jti: string;
  sub: string;
  tribeId?: string;
  projectId?: string;
  sourceServiceId: string;
  environment: ApicenterRuntimeEnvironment;
  issuedAt: number;
  expiresAt: number;
  scopes: string[];
  permissions: string[];
}

@Injectable()
export class TokenStoreService {
  private readonly memory = new Map<string, { record: RefreshTokenRecord; expiresAt: number }>();
  private readonly databaseEnabled =
    process.env.DATABASE_ENABLED === "true" || Boolean(process.env.DATABASE_URL);

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  private get db(): PrismaService | undefined {
    return this.databaseEnabled ? this.prisma : undefined;
  }

  /** Persist a refresh token record until the configured token TTL passes. */
  async store(record: RefreshTokenRecord): Promise<void> {
    const ttlSeconds = this.config.tokenStore.tokenTtlSeconds;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const db = this.db;
    if (db) {
      await db.$executeRawUnsafe(
        "INSERT INTO apic_identity.refresh_tokens (jti, subject, record, expires_at) VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT (jti) DO UPDATE SET record = EXCLUDED.record, expires_at = EXCLUDED.expires_at",
        record.jti,
        record.sub,
        JSON.stringify(record),
        expiresAt,
      );
    } else {
      this.memory.set(record.jti, { record, expiresAt: expiresAt.getTime() });
    }
    this.logger.debug(
      `TokenStoreService: Stored refresh token jti=${record.jti} sub=${record.sub} ttl=${ttlSeconds}s`,
      "TokenStoreService",
    );
  }

  /** Look up a refresh token by JTI; null once it has expired or been revoked. */
  async get(jti: string): Promise<RefreshTokenRecord | null> {
    const db = this.db;
    if (db) {
      const rows = await db.$queryRawUnsafe<Array<{ record: RefreshTokenRecord }>>(
        "SELECT record FROM apic_identity.refresh_tokens WHERE jti = $1 AND expires_at > now()",
        jti,
      );
      return rows[0]?.record ?? null;
    }
    const entry = this.memory.get(jti);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.memory.delete(jti);
      return null;
    }
    return entry.record;
  }

  /** Whether a JTI is still stored and unexpired. */
  async isValid(jti: string): Promise<boolean> {
    return (await this.get(jti)) !== null;
  }

  /** Revoke one refresh token; true when it existed. */
  async revoke(jti: string): Promise<boolean> {
    const db = this.db;
    const revoked = db
      ? (await db.$executeRawUnsafe("DELETE FROM apic_identity.refresh_tokens WHERE jti = $1", jti)) > 0
      : this.memory.delete(jti);
    if (revoked) this.logger.log(`TokenStoreService: Revoked refresh token jti=${jti}`, "TokenStoreService");
    return revoked;
  }

  /** Revoke every refresh token of a subject ("log out everywhere"); returns how many. */
  async revokeAllForSubject(sub: string): Promise<number> {
    const db = this.db;
    let count = 0;
    if (db) {
      count = await db.$executeRawUnsafe("DELETE FROM apic_identity.refresh_tokens WHERE subject = $1", sub);
    } else {
      for (const [jti, entry] of this.memory) {
        if (entry.record.sub === sub) {
          this.memory.delete(jti);
          count += 1;
        }
      }
    }
    if (count) this.logger.log(`TokenStoreService: Revoked ${count} refresh token(s) for sub=${sub}`, "TokenStoreService");
    return count;
  }

  /** Active JTIs of a subject (for audit and admin views). */
  async listForSubject(sub: string): Promise<string[]> {
    const db = this.db;
    if (db) {
      const rows = await db.$queryRawUnsafe<Array<{ jti: string }>>(
        "SELECT jti FROM apic_identity.refresh_tokens WHERE subject = $1 AND expires_at > now() ORDER BY created_at",
        sub,
      );
      return rows.map((row) => row.jti);
    }
    const now = Date.now();
    return [...this.memory.values()]
      .filter((entry) => entry.record.sub === sub && entry.expiresAt > now)
      .map((entry) => entry.record.jti);
  }
}
