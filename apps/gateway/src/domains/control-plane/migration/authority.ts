// Write fencing between the legacy model and the control plane. A migrated project environment
// has exactly one authoritative model at a time; the other one refuses identity and policy writes.

import { AppError } from "@shared/errors";
import type { PrismaService } from "@database/prisma.service";
import type { TenancyDirectory } from "@registry/tenancy.types";
import { withTenant, type TenantDb } from "../tenant-transaction";
import type { EnvironmentKind } from "../control-plane.types";

/** Control-plane writes are refused while a migrated project environment is still legacy-owned. */
export async function assertControlPlaneAuthority(db: TenantDb, projectId: string, environmentKind: EnvironmentKind): Promise<void> {
  const assignment = await db.cpControlPlaneAssignment.findUnique({
    where: { projectId_environmentKind: { projectId, environmentKind } },
  });
  if (assignment && assignment.authority === "legacy") {
    throw new AppError(
      `This ${environmentKind} environment is migrated but still governed by the legacy registry; change it there or cut it over first`,
      409,
      "LEGACY_AUTHORITY",
    );
  }
}

/**
 * Legacy registry writes are refused once a migrated project environment is governed by the
 * control plane, so the two models never mutate the same principal.
 */
export async function assertLegacyRegistryWritable(
  prisma: PrismaService,
  tenancy: TenancyDirectory | undefined,
  legacyProjectId: string | undefined,
  environments: string[],
): Promise<void> {
  if (!legacyProjectId || !tenancy || (!process.env.DATABASE_URL && process.env.DATABASE_ENABLED !== "true")) return;
  const organizationId = tenancy.resolveProject(legacyProjectId)?.tribe.organizationId;
  if (!organizationId) return;
  const governed = await withTenant(prisma, { organizationId }, (db) =>
    db.cpControlPlaneAssignment.findMany({
      where: { organizationId, legacyProjectId, authority: "new", environmentKind: { in: environments } },
      select: { environmentKind: true },
    }),
  );
  if (governed.length) {
    throw new AppError(
      `Project '${legacyProjectId}' ${governed.map((row) => row.environmentKind).join(" and ")} is governed by the control plane; change it there`,
      409,
      "CONTROL_PLANE_AUTHORITY",
    );
  }
}
