import { z } from "zod";
import { createHash } from "node:crypto";
import type { ServiceRegistryEntry } from "../../../types";

export const RuntimeEnvironment = z.enum(["test", "live"]);
export const CheckId = z.enum([
  "health",
  "authentication",
  "authorization",
  "discovery",
  "provider.email",
  "provider.sms",
  "provider.otp",
  "provider.geo",
  "provider.gauth",
  "provider.payments",
  "event_delivery",
]);
export const VerificationCheck = z
  .object({
    checkId: CheckId,
    status: z.enum(["passed", "failed", "skipped", "blocked"]),
    errorCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
      .optional(),
  })
  .strict();
export const VerificationReport = z
  .object({
    version: z.literal(1),
    runId: z.string().uuid(),
    serviceId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,149}$/),
    environment: RuntimeEnvironment,
    configurationFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    gatewayRevision: z.string().regex(/^[a-f0-9]{40}$/),
    deploymentRevision: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/),
    ciRunId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/),
    observedAt: z.string().datetime(),
    checks: z.array(VerificationCheck).min(1).max(20),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.checks.map((check) => check.checkId)).size ===
      value.checks.length,
    "Duplicate check IDs",
  );
export type VerificationReport = z.infer<typeof VerificationReport>;
export type CheckState =
  | "passed"
  | "failed"
  | "missing"
  | "stale"
  | "not_applicable";
export type VerificationSummary = {
  serviceId: string;
  environment: "test" | "live";
  configurationFingerprint: string;
  gatewayRevision: string | null;
  deploymentRevision: string | null;
  observedAt: string | null;
  ready: boolean;
  checks: Array<{ checkId: z.infer<typeof CheckId>; status: CheckState }>;
};

export function configurationFingerprint(
  entry: ServiceRegistryEntry,
  environment: "test" | "live",
  credentialVersions: unknown = [],
) {
  const row = entry.environments?.find(
    (item) => item.environment === environment,
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        serviceId: entry.serviceId,
        projectId: entry.projectId,
        ownerTribeId: entry.ownerTribeId,
        status: entry.status,
        environment,
        baseUrl: row?.baseUrl ?? null,
        healthCheck: row?.healthCheck ?? null,
        scopes: [...entry.requiredScopes].sort(),
        consumes: [...entry.consumes].sort(),
        exposes: [...entry.exposes].sort(),
        version: entry.version,
        credentialVersions,
      }),
    )
    .digest("hex");
}

export function summarizeVerification(input: {
  entry: ServiceRegistryEntry;
  environment: "test" | "live";
  fingerprint: string;
  gatewayRevision: string | null;
  report: VerificationReport | null;
  deploymentKnown?: boolean;
  deploymentRevision?: string | null;
  eventDeliveryRequired?: boolean;
  now?: number;
}): VerificationSummary {
  const { entry, environment, report, fingerprint, gatewayRevision } = input;
  const required: Array<z.infer<typeof CheckId>> = [
    "health",
    "authentication",
    "authorization",
    "discovery",
  ];
  for (const provider of [
    "email",
    "sms",
    "otp",
    "geo",
    "gauth",
    "payments",
  ] as const) {
    if (
      entry.consumes.includes(provider) ||
      (provider === "payments" && entry.consumes.includes("payment"))
    )
      required.push(`provider.${provider}`);
  }
  if (input.eventDeliveryRequired) required.push("event_delivery");
  const now = input.now ?? Date.now();
  const stale =
    report &&
    (now - Date.parse(report.observedAt) >= 86_400_000 ||
      report.configurationFingerprint !== fingerprint ||
      report.gatewayRevision !== gatewayRevision ||
      (input.deploymentRevision !== undefined &&
        report.deploymentRevision !== input.deploymentRevision));
  const checks = required.map((checkId) => {
    const observed = report?.checks.find((check) => check.checkId === checkId);
    const status: CheckState =
      !gatewayRevision ||
      input.deploymentKnown === false ||
      !report ||
      !observed
        ? "missing"
        : stale
          ? "stale"
          : observed.status === "passed"
            ? "passed"
            : "failed";
    return { checkId, status };
  });
  return {
    serviceId: entry.serviceId,
    environment,
    configurationFingerprint: fingerprint,
    gatewayRevision,
    deploymentRevision: report?.deploymentRevision ?? null,
    observedAt: report?.observedAt ?? null,
    ready: checks.every((check) => check.status === "passed"),
    checks,
  };
}
