import { z } from "zod";
import type { EnvironmentKind } from "../model/control-plane";
import { environmentCredentialSchema, environmentGrantSchema } from "../model/environment-inventory";
import { call, env } from "./http";

type Scope = { organizationId: string; projectId: string; kind: EnvironmentKind };

/** Keys and grants of every application in one environment, in one request each. */
export const environmentInventory = {
  /** Active keys, soonest expiry first. */
  credentials: ({ organizationId, projectId, kind }: Scope) =>
    call(z.array(environmentCredentialSchema), `${env(organizationId, projectId, kind)}/credentials`),
  grants: ({ organizationId, projectId, kind }: Scope) => call(z.array(environmentGrantSchema), `${env(organizationId, projectId, kind)}/grants`),
};
