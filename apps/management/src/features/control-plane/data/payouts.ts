import type { EnvironmentKind } from "../model/control-plane";
import {
  pageSchema,
  payeeDetailSchema,
  payeeSchema,
  payoutOverviewSchema,
  payoutPolicySchema,
  payoutSchema,
  type PayoutPolicy,
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
