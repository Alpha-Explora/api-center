import { z } from "zod";

export const serviceStatusSchema = z.enum([
  "proposed",
  "active",
  "deprecated",
  "retired",
]);

export const serviceTypeSchema = z.enum(["tribe", "shared"]);

export const serviceEnvironmentKeySchema = z.enum([
  "test",
  "staging",
  "uat",
  "demo",
  "live",
]);

export const serviceTierSchema = z.enum([
  "critical",
  "standard",
  "experimental",
]);

export const quotaHintSchema = z.object({
  recommendedWindowSeconds: z.number().int().positive().optional(),
  recommendedMaxRequests: z.number().int().positive().optional(),
  providerCostSensitive: z.boolean().optional(),
  notes: z.string().min(1).optional(),
});

export const serviceEnvironmentManifestSchema = z.object({
  environment: serviceEnvironmentKeySchema,
  baseUrl: z.string().url("Environment URL must be valid"),
  healthCheck: z.string().optional(),
});

export const serviceEnvironmentSchema = serviceEnvironmentManifestSchema.extend({
  status: serviceStatusSchema.default("active"),
  healthy: z.boolean().optional(),
  lastHealthCheckAt: z.string().optional(),
  secretStatus: z.string().optional(),
  sharedServiceRouteStatus: z.string().optional(),
  quotaPolicyStatus: z.string().optional(),
  lastSmokeRunAt: z.string().optional(),
  promotionEvidenceStatus: z.string().optional(),
  breakGlassState: z.string().optional(),
});

const serviceManifestBaseSchema = z.object({
  serviceId: z
    .string()
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
  name: z.string().min(2, "Service name is required"),
  baseUrl: z.string().url("Backend service URL must be a valid URL"),
  requiredScopes: z
    .array(z.string().min(1))
    .min(1, "At least one required scope is required"),
  exposes: z
    .array(z.string().min(1))
    .min(1, "At least one exposed route is required"),
  consumes: z.array(z.string().min(1)).default([]),
  /** Project that owns a tribe service. The tribe is derived from it by the gateway. */
  projectId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "Use a lowercase project slug")
    .optional(),
  serviceType: serviceTypeSchema.default("tribe"),
  healthCheck: z.string().optional(),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+/, "Use semver, for example 1.0.0")
    .default("1.0.0"),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().min(1)).default([]),
  ownerTeam: z.string().optional(),
  contact: z.string().optional(),
  serviceTier: serviceTierSchema.default("standard"),
  costCenter: z.string().optional(),
  sunsetDate: z.string().optional(),
  replacementService: z.string().optional(),
  quotaHints: quotaHintSchema.optional(),
  apiProductName: z.string().optional(),
  apiProductDescription: z.string().optional(),
  slaTier: z.string().optional(),
  supportChannel: z.string().optional(),
  documentationUrl: z.string().url().optional(),
  providerCostSensitive: z.boolean().optional(),
  environments: z.array(serviceEnvironmentManifestSchema).optional(),
});

function validateServiceManifestPlacement(
  manifest: z.infer<typeof serviceManifestBaseSchema>,
  context: z.RefinementCtx,
) {
  const issue = projectPlacementIssue(manifest);
  if (issue) context.addIssue({ code: "custom", path: ["projectId"], message: issue });
}

export const serviceManifestSchema = serviceManifestBaseSchema.superRefine(
  validateServiceManifestPlacement,
);

// Reads stay tolerant: an unplaced service must still render so operators can fix it.
export const serviceRegistryEntrySchema = serviceManifestBaseSchema.extend({
    projectId: z.preprocess((value) => value ?? undefined, z.string().optional()),
    /** Derived by the gateway from projectId; never sent on writes. */
    ownerTribeId: z.preprocess((value) => value ?? undefined, z.string().optional()),
    registeredAt: z.string(),
    updatedAt: z.string(),
    status: serviceStatusSchema,
    previousVersion: z.string().optional(),
    healthy: z.boolean().optional(),
    lastHealthCheckAt: z.string().optional(),
    serviceTier: z.preprocess(
      (value) => value ?? undefined,
      serviceTierSchema.default("standard"),
    ),
    costCenter: z.preprocess(
      (value) => value ?? undefined,
      z.string().optional(),
    ),
    environments: z.array(serviceEnvironmentSchema).optional(),
  });

export const registrationPlanSeveritySchema = z.enum([
  "info",
  "warning",
  "blocking",
]);

export const registrationPlanIssueSchema = z.object({
  severity: registrationPlanSeveritySchema,
  code: z.string(),
  serviceId: z.string().optional(),
  message: z.string(),
});

export const serviceRegistrationPlanItemSchema = z.object({
  serviceId: z.string(),
  ownerTribeId: z.string().nullable(),
  projectId: z.string().nullable(),
  sourceServiceId: z.string(),
  eventTopic: z.string(),
  action: z.enum(["create", "update"]),
  manifest: serviceManifestBaseSchema,
});

export const serviceRegistrationPlanSchema = z.object({
  canApply: z.boolean(),
  items: z.array(serviceRegistrationPlanItemSchema),
  issues: z.array(registrationPlanIssueSchema),
});

export const registrationRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "applied",
]);

export const registrationValidationReportSchema = z.object({
  canApply: z.boolean(),
  issues: z.array(registrationPlanIssueSchema),
});

export const serviceRegistrationRequestSchema = z.object({
  id: z.string(),
  serviceId: z.string(),
  ownerTribeId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  status: registrationRequestStatusSchema,
  // Historical requests predate projects; reads must not reject them.
  manifest: serviceManifestBaseSchema,
  validationReport: registrationValidationReportSchema,
  requestedBy: z.string().optional(),
  approvedBy: z.string().optional(),
  rejectedBy: z.string().optional(),
  rejectionReason: z.string().optional(),
  appliedServiceId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  decidedAt: z.string().optional(),
  appliedAt: z.string().optional(),
});

export const registrationRequestListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(serviceRegistrationRequestSchema),
  meta: z
    .object({
      total: z.number().optional(),
      timestamp: z.string().optional(),
    })
    .optional(),
});

export const registrationRequestDetailResponseSchema = z.object({
  success: z.boolean(),
  data: serviceRegistrationRequestSchema,
  meta: z
    .object({
      timestamp: z.string().optional(),
    })
    .optional(),
});

export const registryListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(serviceRegistryEntrySchema),
  meta: z
    .object({
      total: z.number().optional(),
      timestamp: z.string().optional(),
    })
    .optional(),
});

export const registryDetailResponseSchema = z.object({
  success: z.boolean(),
  data: serviceRegistryEntrySchema,
  meta: z
    .object({
      timestamp: z.string().optional(),
    })
    .optional(),
});

export const serviceHealthResultSchema = z.object({
  serviceId: z.string(),
  checkedAt: z.string(),
  ok: z.boolean(),
  status: z.number().optional(),
  url: z.string(),
  error: z.string().optional(),
});

export const serviceConsumerResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    serviceId: z.string(),
    consumers: z.array(z.string()),
  }),
  meta: z.object({ total: z.number().optional() }).optional(),
});

export const readinessCheckSchema = z.object({
  key: z.string(),
  label: z.string(),
  ok: z.boolean(),
  detail: z.string(),
});

export const governanceReadinessSchema = z.object({
  status: z.enum(["up", "down"]),
  quotaEnforcer: z.enum(["up", "down"]),
  policyEngine: z.enum(["up", "down"]),
  approvals: z.enum(["up", "down"]),
  imageTag: z.string(),
  sdkContractVersion: z.string(),
});

export const deploymentConfigCheckSchema = z.object({
  isDeployed: z.boolean(),
  deployedLocalDevBlocked: z.boolean(),
  authMode: z.enum(["local-dev", "google"]),
  managementEnvironment: z.enum(["local", "test", "live"]),
  managementEnv: z.string(),
  publicBaseUrl: z.string(),
  apiCenterBaseUrl: z.string(),
  publicApiCenterBaseUrl: z.string(),
  kafkaTopicPrefix: z.string(),
  googleCloudProject: z.string(),
  secretManagerAuthMode: z.enum([
    "vercel-oidc",
    "local-impersonation",
    "service-account-file",
    "missing",
  ]),
  google: z.object({
    clientId: z.string(),
    publicClientId: z.string(),
  }),
  gcp: z.object({
    projectNumber: z.string(),
    serviceAccountEmail: z.string(),
    workloadIdentityPoolId: z.string(),
    workloadIdentityPoolProviderId: z.string(),
  }),
  confluent: z.object({
    environmentId: z.string(),
    kafkaClusterId: z.string(),
    kafkaRestEndpoint: z.string(),
    s3ConnectorName: z.string(),
    defaultRetentionMs: z.string(),
  }),
  requiredEnv: z.array(z.string()),
  missingEnv: z.array(z.string()),
});

export const readinessResponseSchema = z.object({
  checkedAt: z.string(),
  ok: z.boolean(),
  managementEnvironment: z.enum(["local", "test", "live"]),
  authMode: z.enum(["local-dev", "google"]).optional(),
  isDeployed: z.boolean().optional(),
  deployedLocalDevBlocked: z.boolean().optional(),
  apiCenterBaseUrl: z.string(),
  publicApiCenterBaseUrl: z.string(),
  kafkaTopicPrefix: z.string(),
  googleCloudProject: z.string(),
  secretManagerAuthMode: z
    .enum([
      "vercel-oidc",
      "local-impersonation",
      "service-account-file",
      "missing",
    ])
    .optional(),
  deployment: deploymentConfigCheckSchema.optional(),
  secretManagerAuth: z.object({
    ok: z.boolean(),
    detail: z.string(),
  }),
  missingEnv: z.array(z.string()),
  checks: z.array(readinessCheckSchema),
  governance: governanceReadinessSchema.optional(),
});

export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
export type ServiceType = z.infer<typeof serviceTypeSchema>;
export type ServiceTier = z.infer<typeof serviceTierSchema>;
export type QuotaHint = z.infer<typeof quotaHintSchema>;
export type ServiceManifest = z.infer<typeof serviceManifestSchema>;
export type ServiceRegistryEntry = z.infer<typeof serviceRegistryEntrySchema>;
export type RegistrationPlanIssue = z.infer<typeof registrationPlanIssueSchema>;
export type ServiceRegistrationPlanItem = z.infer<
  typeof serviceRegistrationPlanItemSchema
>;
export type ServiceRegistrationPlan = z.infer<
  typeof serviceRegistrationPlanSchema
>;
export type RegistrationRequestStatus = z.infer<
  typeof registrationRequestStatusSchema
>;
export type RegistrationValidationReport = z.infer<
  typeof registrationValidationReportSchema
>;
export type ServiceRegistrationRequest = z.infer<
  typeof serviceRegistrationRequestSchema
>;
export type ServiceHealthResult = z.infer<typeof serviceHealthResultSchema>;
export type DeploymentConfigCheck = z.infer<typeof deploymentConfigCheckSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

/** Tribe services must name a project; shared services must not. Returns the problem, or null. */
export function projectPlacementIssue(manifest: {
  serviceType?: string;
  projectId?: string;
}): string | null {
  const shared = (manifest.serviceType ?? "tribe") === "shared";
  if (shared && manifest.projectId) return "Shared services cannot belong to a project";
  if (!shared && !manifest.projectId) return "Choose the project this tribe service belongs to";
  return null;
}
