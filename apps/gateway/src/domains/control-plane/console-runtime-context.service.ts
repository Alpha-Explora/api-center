// Signs a runtime context for a console page that reads or changes a project's records in a capability
// runtime (the payout pages). The context names the same resource owner an application of the project
// would get, including the legacy owner of a migrated project, so the runtime scopes rows identically.
// The caller must already have checked the console actor's access to the project.

import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "@database/prisma.service";
import { NotFoundError } from "@shared/errors";
import { RuntimeContextSigner } from "./runtime-context.signer";
import { withTenant } from "./tenant-transaction";
import type { EnvironmentKind, ResourceOwner } from "./control-plane.types";

/** The application id runtimes see for console requests. */
export const CONSOLE_APPLICATION_ID = "console";

export interface ConsoleRuntimeContext {
  signedContext: string;
  resourceOwner: ResourceOwner;
  requestId: string;
}

@Injectable()
export class ConsoleRuntimeContextService {
  constructor(private readonly prisma: PrismaService, private readonly signer: RuntimeContextSigner) {}

  async sign(input: { organizationId: string; projectId: string; environmentKind: EnvironmentKind; capability: string; action: string }):
    Promise<ConsoleRuntimeContext> {
    const { environment, ownerMapping } = await withTenant(this.prisma, { organizationId: input.organizationId }, async (db) => {
      const [environment, ownerMapping] = await Promise.all([
        db.cpEnvironment.findFirst({
          where: { organizationId: input.organizationId, projectId: input.projectId, kind: input.environmentKind },
          select: { id: true },
        }),
        db.cpResourceOwnerMapping.findFirst({
          where: { organizationId: input.organizationId, projectId: input.projectId, environmentKind: input.environmentKind },
        }),
      ]);
      return { environment, ownerMapping };
    });
    if (!environment) throw new NotFoundError(`Environment '${input.environmentKind}' was not found`);
    const resourceOwner: ResourceOwner = ownerMapping
      ? { groupId: ownerMapping.ownerGroupId, projectId: ownerMapping.ownerProjectId }
      : { groupId: input.organizationId, projectId: input.projectId };
    const requestId = randomUUID();
    const signedContext = this.signer.sign({
      identity: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        environmentId: environment.id,
        environmentKind: input.environmentKind,
        applicationId: CONSOLE_APPLICATION_ID,
        credentialId: CONSOLE_APPLICATION_ID,
      },
      resourceOwner,
      capability: input.capability,
      action: input.action,
      requestId,
    });
    return { signedContext, resourceOwner, requestId };
  }
}
