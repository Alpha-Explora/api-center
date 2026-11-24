import { Injectable } from "@nestjs/common";
import { AuditEventsService } from "@audit/audit-events.service";
import { ConfigService } from "@config/config.service";
import { databaseConfigured } from "@config/database-configured";
import { PrismaService } from "@database/prisma.service";
import { ConflictError, NotFoundError } from "@shared/errors";

const CACHE_MS = 60_000;
const LOCK_KEY = "apicenter:platform-operators";

@Injectable()
export class PlatformOperatorsService {
  private cache?: { expiresAt: number; emails: Set<string> };

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly audit: AuditEventsService) {}

  async isOperator(email: string): Promise<boolean> {
    const normalized = email.toLowerCase();
    if (this.config.platformAdminEmails.includes(normalized)) return true;
    if (!databaseConfigured()) return false;
    if (!this.cache || this.cache.expiresAt <= Date.now()) {
      const rows = await this.prisma.platformOperator.findMany({ where: { removedAt: null }, select: { email: true } });
      this.cache = { expiresAt: Date.now() + CACHE_MS, emails: new Set(rows.map((row) => row.email)) };
    }
    return this.cache.emails.has(normalized);
  }

  async list() {
    const configured = new Set(this.config.platformAdminEmails);
    const stored = databaseConfigured() ? await this.prisma.platformOperator.findMany({ where: { removedAt: null } }) : [];
    return [
      ...[...configured].map((email) => ({ email, source: "configuration" as const, addedBy: null, addedAt: null })),
      ...stored.filter((row) => !configured.has(row.email)).map((row) => ({
        email: row.email, source: "console" as const, addedBy: row.addedBy, addedAt: row.addedAt.toISOString(),
      })),
    ].sort((first, second) => first.email.localeCompare(second.email));
  }

  async add(email: string, actor: string) {
    if (this.config.platformAdminEmails.includes(email)) return;
    const changed = await this.prisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0))`;
      if ((await db.platformOperator.findUnique({ where: { email } }))?.removedAt === null) return false;
      await db.platformOperator.upsert({
        where: { email }, create: { email, addedBy: actor },
        update: { addedBy: actor, addedAt: new Date(), removedAt: null, removedBy: null },
      });
      return true;
    });
    this.cache = undefined;
    if (changed) await this.record("added", email, actor);
  }

  async remove(email: string, actor: string) {
    if (email === actor.toLowerCase()) throw new ConflictError("You cannot remove your own operator access");
    if (this.config.platformAdminEmails.includes(email)) throw new ConflictError("This operator comes from deployment configuration");
    await this.prisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0))`;
      const current = await db.platformOperator.findUnique({ where: { email } });
      if (!current || current.removedAt) throw new NotFoundError("Platform operator was not found");
      if (!this.config.platformAdminEmails.length && await db.platformOperator.count({ where: { removedAt: null } }) <= 1) {
        throw new ConflictError("At least one platform operator must remain");
      }
      await db.platformOperator.update({ where: { email }, data: { removedAt: new Date(), removedBy: actor } });
    });
    this.cache = undefined;
    await this.record("removed", email, actor);
  }

  private async record(action: "added" | "removed", email: string, actor: string) {
    await this.audit.record({
      type: `platform.operator.${action}`, actionFamily: "lifecycle", severity: "info",
      message: `Platform operator ${action}`, actor, resourceType: "platform_operator", resourceId: email,
    });
  }
}
