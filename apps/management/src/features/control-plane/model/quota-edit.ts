import { formatQuotaLimit, quotaFormToBody, WINDOW_PRESETS, type QuotaForm, type QuotaFormErrors, type QuotaPolicy } from "./quotas";

/** What PUT quota-policies/:id accepts. `capability: null` widens a policy to every request. */
export type QuotaPolicyChange = {
  capability?: string | null;
  windowSeconds?: number;
  maxRequests?: number;
  mode?: "enforce" | "observe";
};

/** The edit form, prefilled with the policy's current values. */
export function policyToForm(policy: QuotaPolicy): QuotaForm {
  const preset = WINDOW_PRESETS.some((entry) => entry.seconds === policy.windowSeconds);
  return {
    capability: policy.capability ?? "",
    window: preset ? String(policy.windowSeconds) : "custom",
    customSeconds: preset ? "" : String(policy.windowSeconds),
    maxRequests: String(policy.maxRequests),
    mode: policy.mode,
  };
}

export type QuotaChangeResult = { kind: "invalid"; errors: QuotaFormErrors } | { kind: "unchanged" } | { kind: "change"; change: QuotaPolicyChange };

/** Only the fields that differ from the policy, so the audit trail records exactly what changed. */
export function quotaPolicyChange(policy: QuotaPolicy, form: QuotaForm): QuotaChangeResult {
  const parsed = quotaFormToBody(form, policy.environmentKind);
  if (!parsed.ok) return { kind: "invalid", errors: parsed.errors };
  const next = parsed.body;
  const change: QuotaPolicyChange = {};
  const capability = next.capability ?? null;
  if (capability !== policy.capability) change.capability = capability;
  if (next.windowSeconds !== policy.windowSeconds) change.windowSeconds = next.windowSeconds;
  if (next.maxRequests !== policy.maxRequests) change.maxRequests = next.maxRequests;
  if (next.mode !== policy.mode) change.mode = next.mode;
  return Object.keys(change).length === 0 ? { kind: "unchanged" } : { kind: "change", change };
}

/**
 * Whether saving should ask first: the change makes an active live policy refuse more requests than
 * before (it starts enforcing, gets a lower limit, a longer window, or a wider capability).
 */
export function tightensLivePolicy(policy: QuotaPolicy, change: QuotaPolicyChange): boolean {
  if (policy.environmentKind !== "live" || policy.status !== "active") return false;
  const mode = change.mode ?? policy.mode;
  if (mode !== "enforce") return false;
  return (
    change.mode === "enforce" ||
    (change.maxRequests !== undefined && change.maxRequests < policy.maxRequests) ||
    (change.windowSeconds !== undefined && change.windowSeconds > policy.windowSeconds) ||
    (change.capability === null && policy.capability !== null) ||
    (change.capability !== undefined && change.capability !== null && change.capability !== policy.capability)
  );
}

/** The policy's name in titles and confirmations: its limit, plus the capability it is limited to. */
export function quotaPolicyName(policy: Pick<QuotaPolicy, "maxRequests" | "windowSeconds" | "capability">): string {
  const limit = formatQuotaLimit(policy.maxRequests, policy.windowSeconds);
  return policy.capability ? `${limit} (${policy.capability})` : limit;
}
