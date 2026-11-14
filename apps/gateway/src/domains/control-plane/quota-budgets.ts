// Which request budgets apply to one application request. Pure; the reservation itself is atomic
// in PostgreSQL (QuotaService). Composition is conjunctive: every budget returned must have room.

import { PLAN_DEFINITIONS } from "@entitlements/tribe-plan-definitions";
import type { EnvironmentKind } from "./control-plane.types";

export const DAY_SECONDS = 86_400;

export interface Budget {
  key: string;
  limit: number;
  windowSeconds: number;
  mode: "observe" | "enforce";
  source: "plan" | "test-default" | "project-policy" | "shared-ceiling";
}

export interface PolicyRow {
  id: string;
  scope: string;
  capability: string | null;
  windowSeconds: number;
  maxRequests: number;
  mode: string;
}

export type BudgetComposition =
  | { ok: true; budgets: Budget[] }
  | { ok: false; code: "LIVE_PLAN_REQUIRED" | "PLAN_NOT_AVAILABLE" };

export function testDefaultDailyRequests(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.CONTROL_PLANE_TEST_DAILY_REQUESTS ?? 1_000);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 1_000;
}

export function listPlans() {
  return PLAN_DEFINITIONS.map((plan) => ({
    planKey: plan.planKey,
    displayName: plan.displayName,
    requestsPerDay: plan.gatewayCallsPerDay,
    liveAllowed: planAllowsLive(plan.planKey),
  }));
}

/** Starter is test-only; every other catalogued plan may back a live environment. */
export function planAllowsLive(planKey: string): boolean {
  const plan = PLAN_DEFINITIONS.find((entry) => entry.planKey === planKey);
  return Boolean(plan) && !plan!.sharedServiceAccess.startsWith("test-only");
}

export function composeBudgets(input: {
  environment: { id: string; kind: EnvironmentKind };
  capability: string;
  planKey: string | undefined;
  /** Active policies for this environment kind: the project's own and shared ceilings covering it. */
  policies: PolicyRow[];
  testDailyRequests: number;
}): BudgetComposition {
  const budgets: Budget[] = [];
  const { environment, planKey } = input;

  if (planKey) {
    const plan = PLAN_DEFINITIONS.find((entry) => entry.planKey === planKey);
    if (!plan || (environment.kind === "live" && !planAllowsLive(planKey))) return { ok: false, code: "PLAN_NOT_AVAILABLE" };
    if (plan.gatewayCallsPerDay !== null) {
      budgets.push({ key: `plan:${environment.id}`, limit: plan.gatewayCallsPerDay, windowSeconds: DAY_SECONDS, mode: "enforce", source: "plan" });
    }
  } else if (environment.kind === "live") {
    // Live traffic needs an explicit commercial decision; there is no implicit live default.
    return { ok: false, code: "LIVE_PLAN_REQUIRED" };
  } else {
    budgets.push({
      key: `test-default:${environment.id}`,
      limit: input.testDailyRequests,
      windowSeconds: DAY_SECONDS,
      mode: "enforce",
      source: "test-default",
    });
  }

  for (const policy of input.policies) {
    if (policy.capability && policy.capability !== input.capability) continue;
    budgets.push({
      key: `policy:${policy.id}`,
      limit: policy.maxRequests,
      windowSeconds: policy.windowSeconds,
      mode: policy.mode === "observe" ? "observe" : "enforce",
      source: policy.scope === "shared" ? "shared-ceiling" : "project-policy",
    });
  }
  return { ok: true, budgets };
}

/** Fixed windows aligned to the epoch, so every gateway instance agrees on boundaries. */
export function windowStart(now: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}
