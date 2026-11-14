import { z } from "zod";

export const environmentKindSchema = z.enum(["test", "live"]);
export type EnvironmentKind = z.infer<typeof environmentKindSchema>;

export const projectSummarySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
});

export const projectSchema = projectSummarySchema.extend({
  environments: z.array(
    z.object({
      id: z.string(),
      kind: environmentKindSchema,
      status: z.string(),
      capabilities: z.array(z.object({ capability: z.string(), status: z.string() })),
    }),
  ),
});

export const capabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  actions: z.array(z.object({ action: z.string(), description: z.string() })),
});

export const applicationSchema = z.object({ id: z.string(), slug: z.string(), name: z.string(), status: z.string() });

export const grantSchema = z.object({
  id: z.string(),
  targetKind: z.string().optional(),
  capability: z.string().optional(),
  apiId: z.string().optional(),
  action: z.string(),
  status: z.string(),
  provenance: z.string(),
});

export const credentialSchema = z.object({
  id: z.string(),
  lookupPrefix: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

export const issuedCredentialSchema = z.object({
  id: z.string(),
  lookupPrefix: z.string(),
  expiresAt: z.string(),
  secret: z.string(),
});

export const meSchema = z.object({
  actor: z.object({ kind: z.string(), email: z.string().optional() }),
  platformAccess: z.boolean(),
  organizationRole: z.string().nullable().optional(),
  projectRoles: z.record(z.string(), z.string()),
});

export const memberSchema = z.object({ email: z.string(), role: z.string(), status: z.string(), identityLinked: z.boolean() });
export const teamSchema = z.object({ id: z.string(), slug: z.string(), name: z.string(), members: z.array(z.string()) });

export const planSchema = z.object({ planKey: z.string(), displayName: z.string(), requestsPerDay: z.number().nullable(), liveAllowed: z.boolean() });

export const readinessSchema = z.object({
  environmentId: z.string(),
  status: z.string(),
  ready: z.boolean(),
  checks: z.array(z.object({ key: z.string(), passed: z.boolean(), detail: z.string() })),
});

export const usageSchema = z.object({
  since: z.string(),
  requests: z.number(),
  byApplicationAction: z.array(
    z.object({ applicationId: z.string(), action: z.string(), admitted: z.number(), completed: z.number(), failed: z.number() }),
  ),
});

export const inventorySchema = z.object({
  revision: z.string(),
  ready: z.boolean(),
  plan: z.object({
    projects: z.array(z.object({ legacyProjectId: z.string(), slug: z.string(), environments: z.array(z.object({ kind: z.string(), applications: z.array(z.unknown()), apis: z.array(z.unknown()) })) })),
    blockers: z.array(z.object({ legacyId: z.string(), reason: z.string() })),
    approximations: z.array(z.object({ legacyId: z.string(), note: z.string() })),
  }),
});

export const assignmentSchema = z.object({
  projectId: z.string(),
  environmentKind: z.string(),
  authority: z.enum(["legacy", "new"]),
  fenceVersion: z.number(),
  legacyProjectId: z.string(),
  cutOverAt: z.string().nullable(),
});

export const mismatchSchema = z.object({
  projectId: z.string(),
  environmentKind: z.string(),
  sourceServiceId: z.string(),
  target: z.string(),
  action: z.string(),
  legacyAllowed: z.boolean(),
  newAllowed: z.boolean(),
  occurrences: z.number(),
});

export type Project = z.infer<typeof projectSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type Application = z.infer<typeof applicationSchema>;
export type Grant = z.infer<typeof grantSchema>;
export type Credential = z.infer<typeof credentialSchema>;
export type IssuedCredential = z.infer<typeof issuedCredentialSchema>;
