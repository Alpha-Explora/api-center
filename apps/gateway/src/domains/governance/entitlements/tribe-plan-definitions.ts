import type { TribePlanDefinition } from "./tribe-plan.types";

/**
 * The plan catalogue is intentionally code-owned; assignments persist only the plan key.
 */
export const PLAN_DEFINITIONS: TribePlanDefinition[] = [
  {
    planKey: "starter",
    displayName: "Starter",
    gatewayCallsPerDay: 1_000,
    kafkaPublishesPerDay: 100,
    retentionTier: "standard",
    sharedServiceAccess: "test-only-provider-impacting-smoke",
    supportTier: "standard",
  },
  {
    planKey: "standard",
    displayName: "Standard",
    gatewayCallsPerDay: 25_000,
    kafkaPublishesPerDay: 5_000,
    retentionTier: "standard",
    sharedServiceAccess: "live-after-approval",
    supportTier: "standard",
  },
  {
    planKey: "pro",
    displayName: "Pro",
    gatewayCallsPerDay: 250_000,
    kafkaPublishesPerDay: 50_000,
    retentionTier: "extended",
    sharedServiceAccess: "live",
    supportTier: "priority",
  },
  {
    planKey: "enterprise",
    displayName: "Enterprise",
    gatewayCallsPerDay: null,
    kafkaPublishesPerDay: null,
    retentionTier: "custom",
    sharedServiceAccess: "custom",
    supportTier: "dedicated",
  },
];
