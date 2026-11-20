// Current-window usage of every request budget that can apply in one project environment: the
// plan's (or test default's) daily budget and each quota policy. Counts come from
// cp_quota_counters, keyed exactly as QuotaService.reserve writes them (quota-budgets.ts).

import { composeBudgets, DAY_SECONDS, policyBudgetKey, windowStart, type Budget, type PolicyRow } from "../quota-budgets";
import { PLAN_DEFINITIONS } from "../plan-definitions";
import type { EnvironmentKind } from "../control-plane.types";

export interface MeterPolicy extends PolicyRow {
  status: string;
}

export interface QuotaMeter {
  /** cp_quota_counters.budget_key. */
  budgetKey: string;
  source: Budget["source"];
  policyId: string | null;
  capability: string | null;
  mode: "observe" | "enforce";
  windowSeconds: number;
  /** null when the plan is unlimited. */
  limit: number | null;
  /** Requests counted in the current window; null when nothing counts toward it (a disabled policy). */
  used: number | null;
  windowStart: string;
  windowEnd: string;
}

export interface QuotaMeters {
  generatedAt: string;
  planKey: string | null;
  /** Why no base budget applies, when none does. */
  baseBudget: "plan" | "test-default" | "unlimited" | "live-plan-required" | "plan-not-available";
  meters: QuotaMeter[];
}

export function quotaMeterWindows(input: { environment: { id: string; kind: EnvironmentKind }; planKey: string | undefined; policies: MeterPolicy[]; testDailyRequests: number }) {
  const composition = composeBudgets({ ...input, capability: "", policies: [] });
  const base = composition.ok ? composition.budgets : [];
  return { composition, budgets: [...base, ...input.policies.map(policyBudget)] };
}

type Counter = { budgetKey: string; windowStart: Date; requestCount: number };

function meterFor(budget: Budget, policy: MeterPolicy | undefined, counters: Counter[], now: Date): QuotaMeter {
  const start = windowStart(now, budget.windowSeconds);
  const counted = counters.find((counter) => counter.budgetKey === budget.key && counter.windowStart.getTime() === start.getTime());
  return {
    budgetKey: budget.key,
    source: budget.source,
    policyId: policy?.id ?? null,
    capability: policy?.capability ?? null,
    mode: budget.mode,
    windowSeconds: budget.windowSeconds,
    limit: budget.limit,
    used: policy && policy.status !== "active" ? null : (counted?.requestCount ?? 0),
    windowStart: start.toISOString(),
    windowEnd: new Date(start.getTime() + budget.windowSeconds * 1000).toISOString(),
  };
}

function policyBudget(policy: MeterPolicy): Budget {
  return {
    key: policyBudgetKey(policy),
    limit: policy.maxRequests,
    windowSeconds: policy.windowSeconds,
    mode: policy.mode === "observe" ? "observe" : "enforce",
    source: policy.scope === "shared" ? "shared-ceiling" : "project-policy",
  };
}

/** Shared ceilings count once for every covered project, so their meters are organization-wide. */
export function sharedCeilingMeters(policies: MeterPolicy[], counters: Counter[], now: Date) {
  return { generatedAt: now.toISOString(), meters: policies.map((policy) => meterFor(policyBudget(policy), policy, counters, now)) };
}

export function buildQuotaMeters(
  input: { environment: { id: string; kind: EnvironmentKind }; planKey: string | undefined; policies: MeterPolicy[]; testDailyRequests: number },
  counters: Counter[],
  now: Date,
): QuotaMeters {
  const { composition, budgets } = quotaMeterWindows(input);
  const policies = new Map(input.policies.map((policy) => [policyBudgetKey(policy), policy]));
  const meters = budgets.map((budget) => meterFor(budget, policies.get(budget.key), counters, now));

  const plan = input.planKey ? PLAN_DEFINITIONS.find((entry) => entry.planKey === input.planKey) : undefined;
  let baseBudget: QuotaMeters["baseBudget"];
  if (!composition.ok) baseBudget = composition.code === "LIVE_PLAN_REQUIRED" ? "live-plan-required" : "plan-not-available";
  else if (plan && plan.gatewayCallsPerDay === null) baseBudget = "unlimited";
  else baseBudget = input.planKey ? "plan" : "test-default";

  if (baseBudget === "unlimited") {
    const start = windowStart(now, DAY_SECONDS);
    meters.unshift({
      budgetKey: `plan:${input.environment.id}`,
      source: "plan",
      policyId: null,
      capability: null,
      mode: "enforce",
      windowSeconds: DAY_SECONDS,
      limit: null,
      used: null,
      windowStart: start.toISOString(),
      windowEnd: new Date(start.getTime() + DAY_SECONDS * 1000).toISOString(),
    });
  }

  return { generatedAt: now.toISOString(), planKey: input.planKey ?? null, baseBudget, meters };
}
