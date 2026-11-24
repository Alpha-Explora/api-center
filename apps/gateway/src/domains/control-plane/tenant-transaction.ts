// Runs control-plane queries inside a transaction bound to one tenant. PostgreSQL row-level
// security (migration 20261114000300) hides and protects other organizations' cp_* rows from the
// application role, so a query that forgets an organization filter still cannot cross tenants.

import { databaseConfigured } from "@config/database-configured";
import type { Prisma } from "@prisma/client";
import type { PrismaService } from "@database/prisma.service";
import { ServiceUnavailableError } from "@shared/errors";

export type TenantDb = Prisma.TransactionClient;
export type TenantScope = { organizationId: string } | "platform";

/** Prisma's interactive-transaction limits. */
export interface TenantTransactionOptions {
  timeoutMs: number;
  maxWaitMs: number;
}

/**
 * The default for console and request-path transactions. Prisma's own defaults (2 s wait, 5 s run)
 * turn a briefly full pool into errors: the database is in another region, so a transaction holds
 * its connection for several round trips, and a console page starts about a dozen at once. Waiting
 * up to 8 s queues them instead; the console proxy allows 20 s per request.
 */
export const DEFAULT_TENANT_TRANSACTION: TenantTransactionOptions = { timeoutMs: 10_000, maxWaitMs: 8_000 };

/** For bulk writes such as a migration backfill: dozens of inserts, each one database round trip. */
export const BULK_TENANT_TRANSACTION: TenantTransactionOptions = { timeoutMs: 120_000, maxWaitMs: 15_000 };

export function requireControlPlaneDatabase(): void {
  if (!databaseConfigured()) {
    throw new ServiceUnavailableError("The control plane requires the APICenter database");
  }
}

export async function withTenant<T>(
  prisma: PrismaService,
  scope: TenantScope,
  work: (db: TenantDb) => Promise<T>,
  options: TenantTransactionOptions = DEFAULT_TENANT_TRANSACTION,
): Promise<T> {
  requireControlPlaneDatabase();
  const organizationId = scope === "platform" ? "" : scope.organizationId;
  const platform = scope === "platform" ? "platform" : "";
  return prisma.$transaction(
    async (db) => {
      await db.$executeRaw`SELECT set_config('apicenter.organization_id', ${organizationId}, true), set_config('apicenter.scope', ${platform}, true)`;
      return work(db);
    },
    { timeout: options.timeoutMs, maxWait: options.maxWaitMs },
  );
}

/** The organization that owns a credential lookup prefix, read through the narrow definer function. */
export async function credentialOrganization(prisma: PrismaService, lookupPrefix: string): Promise<string | undefined> {
  requireControlPlaneDatabase();
  const rows = await prisma.$queryRaw<{ organization_id: string | null }[]>`
    SELECT apic_catalog.cp_credential_organization(${lookupPrefix}) AS organization_id`;
  return rows[0]?.organization_id ?? undefined;
}
