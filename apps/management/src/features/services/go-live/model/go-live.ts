import { z } from "zod";

export const goLiveCheckSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(["passed", "failed", "missing", "stale", "not_applicable"]),
  action: z.string(),
});
export const credentialSchema = z.object({
  keyId: z.string(),
  keyPrefix: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
});
export const goLiveSchema = z.object({
  serviceId: z.string(),
  environment: z.enum(["test", "live"]),
  ready: z.boolean(),
  checks: z.array(goLiveCheckSchema),
  keys: z.array(credentialSchema),
  secret: z.object({
    status: z.enum(["present", "missing", "unknown"]),
    versionName: z.string().nullable(),
    createdAt: z.string().nullable(),
    rotationState: z.string().nullable(),
    lastUsedAt: z.string().nullable(),
    replacementVerifiedAt: z.string().nullable(),
    cacheTtlSeconds: z.number().nullable(),
  }),
  configurationTemplate: z.string(),
  verificationRun: z
    .object({ runId: z.string(), status: z.string() })
    .nullable(),
});
export type GoLiveSummary = z.infer<typeof goLiveSchema>;
