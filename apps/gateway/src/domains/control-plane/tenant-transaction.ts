// Runs control-plane queries inside a transaction bound to one tenant. PostgreSQL row-level
// security (migration 20261114000300) hides and protects other organizations' cp_* rows from the
// application role, so a query that forgets an organization filter still cannot cross tenants.

import type { Prisma } from "@prisma/client";
import type { PrismaService } from "@database/prisma.service";
import { ServiceUnavailableError } from "@shared/errors";

export type TenantDb = Prisma.TransactionClient;
export type TenantScope = { organizationId: string } | "platform";

export function requireControlPlaneDatabase(): void {
  if (process.env.DATABASE_ENABLED !== "true" && !process.env.DATABASE_URL) {
    throw new ServiceUnavailableError("The control plane requires the APICenter database");
  }
}

export async function withTenant<T>(prisma: PrismaService, scope: TenantScope, work: (db: TenantDb) => Promise<T>): Promise<T> {
  requireControlPlaneDatabase();
  const organizationId = scope === "platform" ? "" : scope.organizationId;
  const platform = scope === "platform" ? "platform" : "";
  return prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT set_config('apicenter.organization_id', ${organizationId}, true), set_config('apicenter.scope', ${platform}, true)`;
    return work(db);
  });
}

/** The organization that owns a credential lookup prefix, read through the narrow definer function. */
export async function credentialOrganization(prisma: PrismaService, lookupPrefix: string): Promise<string | undefined> {
  requireControlPlaneDatabase();
  const rows = await prisma.$queryRaw<{ organization_id: string | null }[]>`
    SELECT apic_catalog.cp_credential_organization(${lookupPrefix}) AS organization_id`;
  return rows[0]?.organization_id ?? undefined;
}
