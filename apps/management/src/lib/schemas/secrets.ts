import { z } from "zod";

const serviceSecretIdSchema = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    "Use lower-case letters, numbers, and hyphens only",
  );

const runtimeEnvironmentSchema = z.enum(["test", "live"]);

/** Each tribe service has its own credential per environment; the secret is never shared across services. */
export const tribeSecretProvisionRequestSchema = z.object({
  serviceId: serviceSecretIdSchema,
  environment: runtimeEnvironmentSchema,
  secretHashSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, "Use a SHA-256 hex hash"),
  mode: z.enum(["create-or-rotate"]).default("create-or-rotate"),
  confirmation: z
    .object({
      typedPhrase: z.string().optional(),
      reason: z.string().optional(),
    })
    .optional(),
});

export const tribeSecretProvisionResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    serviceId: z.string(),
    environment: runtimeEnvironmentSchema,
    secretId: z.string(),
    secretName: z.string(),
    versionName: z.string(),
    versionNumber: z.string().optional(),
    rotatedAt: z.string(),
  }),
});

export const tribeSecretStatusResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    serviceId: z.string(),
    tribeId: z.string().optional(),
    environment: runtimeEnvironmentSchema.optional(),
    secretId: z.string(),
    expectedSecretId: z.string().optional(),
    exists: z.boolean(),
    enabled: z.boolean().optional(),
    state: z.string().optional(),
    latestEnabledVersion: z.string().optional(),
    latestVersionCreatedAt: z.string().optional(),
    rotationWarning: z
      .object({
        stale: z.boolean(),
        severity: z.enum(["info", "warning", "error"]),
        message: z.string(),
      })
      .optional(),
  }),
});

export const sharedServiceSecretStatusItemSchema = z.object({
  serviceId: z.string(),
  label: z.string().optional(),
  secretName: z.string(),
  exists: z.boolean(),
  latestEnabledVersion: z.string().optional(),
  latestVersionCreatedAt: z.string().optional(),
  observedKeyNames: z.array(z.string()),
  missingKeyNames: z.array(z.string()),
  status: z.enum(["ready", "missing", "absent"]),
  updatedAt: z.string().optional(),
});

export const sharedServiceSecretStatusResponseSchema = z.object({
  sharedServices: z.array(sharedServiceSecretStatusItemSchema),
});

export const tribeSecretDeleteRequestSchema = z.object({
  mode: z.enum(["delete"]),
  environment: runtimeEnvironmentSchema,
  confirmServiceId: z.string(),
  confirmation: z
    .object({
      typedPhrase: z.string().optional(),
      reason: z.string().optional(),
    })
    .optional(),
});

export const tribeSecretDeleteResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    serviceId: z.string(),
    tribeId: z.string().optional(),
    environment: runtimeEnvironmentSchema.optional(),
    secretId: z.string(),
    action: z.enum(["deleted", "not-found"]),
  }),
});

export type TribeSecretProvisionRequest = z.infer<
  typeof tribeSecretProvisionRequestSchema
>;
export type TribeSecretProvisionResponse = z.infer<
  typeof tribeSecretProvisionResponseSchema
>;
export type TribeSecretStatusResponse = z.infer<
  typeof tribeSecretStatusResponseSchema
>;
export type SharedServiceSecretStatusResponse = z.infer<
  typeof sharedServiceSecretStatusResponseSchema
>;
export type TribeSecretDeleteRequest = z.infer<
  typeof tribeSecretDeleteRequestSchema
>;
export type TribeSecretDeleteResponse = z.infer<
  typeof tribeSecretDeleteResponseSchema
>;
