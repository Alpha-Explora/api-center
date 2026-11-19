// The plan catalogue is code-owned; an environment's entitlement stores only the plan key.

export type PlanKey = "starter" | "standard" | "pro" | "enterprise";

export interface PlanDefinition {
  planKey: PlanKey;
  displayName: string;
  /** Requests per day across the environment; null means unlimited. */
  gatewayCallsPerDay: number | null;
  retentionTier: string;
  sharedServiceAccess: string;
  supportTier: string;
  /** Maximum payment amount in PHP minor units; null means unlimited. */
  paymentAmountMinor: number | null;
  /** Maximum payment write requests per project per minute; null means unlimited. */
  paymentRequestsPerMinute: number | null;
}

export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    planKey: "starter",
    displayName: "Starter",
    gatewayCallsPerDay: 1_000,
    retentionTier: "standard",
    sharedServiceAccess: "test-only-provider-impacting-smoke",
    supportTier: "standard",
    paymentAmountMinor: 1_000_000,
    paymentRequestsPerMinute: 30,
  },
  {
    planKey: "standard",
    displayName: "Standard",
    gatewayCallsPerDay: 25_000,
    retentionTier: "standard",
    sharedServiceAccess: "live-after-approval",
    supportTier: "standard",
    paymentAmountMinor: 10_000_000,
    paymentRequestsPerMinute: 120,
  },
  {
    planKey: "pro",
    displayName: "Pro",
    gatewayCallsPerDay: 250_000,
    retentionTier: "extended",
    sharedServiceAccess: "live",
    supportTier: "priority",
    paymentAmountMinor: 100_000_000,
    paymentRequestsPerMinute: 600,
  },
  {
    planKey: "enterprise",
    displayName: "Enterprise",
    gatewayCallsPerDay: null,
    retentionTier: "custom",
    sharedServiceAccess: "custom",
    supportTier: "dedicated",
    paymentAmountMinor: null,
    paymentRequestsPerMinute: null,
  },
];
