import { z } from "zod";

export const environmentKindSchema = z.enum(["test", "live"]);
export type EnvironmentKind = z.infer<typeof environmentKindSchema>;

export const projectSummarySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  /** List pages only: each environment's status, active applications, and requests in the last 24 hours. */
  summary: z
    .object({
      environments: z.array(z.object({ kind: z.string(), status: z.string() })),
      applications: z.number(),
      requests24h: z.number(),
    })
    .optional(),
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

export const applicationSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  createdAt: z.string().optional(),
  /** The applications list adds what it shows: active keys and grants, granted capabilities, last key use. */
  activeKeys: z.number().optional(),
  activeGrants: z.number().optional(),
  capabilities: z.array(z.string()).optional(),
  lastUsedAt: z.string().nullable().optional(),
});

export const grantSchema = z.object({
  id: z.string(),
  targetKind: z.string().optional(),
  capability: z.string().optional(),
  apiId: z.string().optional(),
  action: z.string(),
  status: z.string(),
  provenance: z.string(),
  createdAt: z.string().optional(),
  revokedAt: z.string().nullable().optional(),
});

export const credentialSchema = z.object({
  id: z.string(),
  lookupPrefix: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string().optional(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  revokedReason: z.string().nullable().optional(),
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

/** status: active, suspended, invited (can still accept) or invite_expired. */
export const memberSchema = z.object({
  email: z.string(),
  role: z.string(),
  status: z.string(),
  inviteExpiresAt: z.string().nullable().optional(),
  identityLinked: z.boolean(),
  /** When they were added, and by whom (an audit actor label). */
  addedAt: z.string().nullable().optional(),
  addedBy: z.string().nullable().optional(),
  /** Their own project roles; roles through teams are not listed here. */
  projects: z.array(z.object({ projectId: z.string(), name: z.string(), role: z.string() })).optional(),
});
export const teamSchema = z.object({ id: z.string(), slug: z.string(), name: z.string(), members: z.array(z.string()) });

export const planSchema = z.object({ planKey: z.string(), displayName: z.string(), requestsPerDay: z.number().nullable(), liveAllowed: z.boolean() });

export const readinessSchema = z.object({
  environmentId: z.string(),
  status: z.string(),
  ready: z.boolean(),
  checks: z.array(z.object({ key: z.string(), passed: z.boolean(), detail: z.string() })),
});

/** An environment.activate_live approval request; a person other than the requester must decide it. */
export const activationRequestSchema = z.object({
  id: z.string(),
  status: z.string(),
  reason: z.string(),
  requestedBy: z.string(),
  approvedBy: z.string().nullable().optional(),
  rejectedBy: z.string().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type ActivationRequest = z.infer<typeof activationRequestSchema>;

export const usageSchema = z.object({
  since: z.string(),
  requests: z.number(),
  byApplicationAction: z.array(
    z.object({ applicationId: z.string(), action: z.string(), admitted: z.number(), completed: z.number(), failed: z.number() }),
  ),
});

export type Project = z.infer<typeof projectSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type Application = z.infer<typeof applicationSchema>;
export type Grant = z.infer<typeof grantSchema>;
export type Credential = z.infer<typeof credentialSchema>;
export type IssuedCredential = z.infer<typeof issuedCredentialSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type Me = z.infer<typeof meSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Team = z.infer<typeof teamSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type Readiness = z.infer<typeof readinessSchema>;
export type ProjectEnvironment = Project["environments"][number];
