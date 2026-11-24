import type { EnvironmentKind } from "../model/control-plane";
import { z } from "zod";
import {
  linkedAccountSchema,
  onboardingSchema,
  pageSchema,
  payeeDetailSchema,
  payeeSchema,
  payoutOverviewSchema,
  payoutPolicySchema,
  payoutSchema,
  type PayoutPolicy,
  type LinkedAccountAction,
  type PayoutStatus,
} from "../model/payouts";
import { call, env, send } from "./http";

type Scope = { organizationId: string; projectId: string; kind: EnvironmentKind };

const base = ({ organizationId, projectId, kind }: Scope) => `${env(organizationId, projectId, kind)}/payouts`;

function query(values: Record<string, string | undefined>): string {
  const entries = Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1]));
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
}

/** A project environment's payouts: the wallet, payees, payouts, settings, and payouts that need a person. */
export const payouts = {
  linkedAccount: (scope: Scope) => call(linkedAccountSchema, `${base(scope)}/linked-account`),
  updateLinkedAccount: async (scope: Scope, action: LinkedAccountAction) => {
    const path = `${base(scope)}/linked-account`;
    switch (action.kind) {
      case "enabled":
        await call(z.object({ enabled: z.boolean() }), `${path}/enabled`, send("PUT", { enabled: action.enabled }));
        return null;
      case "start":
        return (await call(onboardingSchema, path, send("POST", action.details))).verification;
      case "verification-link":
        return (await call(onboardingSchema, `${path}/verification-link`, send("POST", {
          id: action.id, requestKey: action.requestKey,
        }))).verification;
      case "advance":
        await call(onboardingSchema, `${path}/advance`, send("POST", { id: action.id }));
        return null;
      case "close":
      case "move":
        await call(z.object({ id: z.string() }), `${path}/${action.kind}`, send("POST", {
          id: action.id, ...(action.kind === "move" ? { target: action.target } : {}),
        }));
        return null;
    }
  },
  overview: (scope: Scope) => call(payoutOverviewSchema, `${base(scope)}/overview`),
  settings: (scope: Scope) => call(payoutPolicySchema, `${base(scope)}/settings`),
  saveSettings: (scope: Scope, policy: PayoutPolicy) => call(payoutPolicySchema, `${base(scope)}/settings`, send("POST", policy)),
  payees: (scope: Scope, cursor?: string) => call(pageSchema(payeeSchema), `${base(scope)}/payees${query({ cursor, limit: "50" })}`),
  payee: (scope: Scope, payeeId: string) => call(payeeDetailSchema, `${base(scope)}/payees/${encodeURIComponent(payeeId)}`),
  list: (scope: Scope, filters: { status?: PayoutStatus; payeeId?: string; cursor?: string } = {}) =>
    call(pageSchema(payoutSchema), `${base(scope)}/payouts${query({ ...filters, limit: "50" })}`),
  /** Settles a payout that needs a person, after checking the provider's dashboard. */
  resolve: (scope: Scope, payoutId: string, outcome: "paid" | "failed", note: string) =>
    call(payoutSchema, `${base(scope)}/payouts/${encodeURIComponent(payoutId)}/resolve`, send("POST", { outcome, note })),
};
