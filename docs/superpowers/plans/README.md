# Working-document register

Plans record execution scope and pending checks. Use [current architecture](../../architecture/current-architecture.md), [payment ownership](../../payments-platform-current.md), contracts, code, and maintained runbooks for implemented behavior. Old checked boxes and deployment snapshots are not fresh verification.

Open plan: [Payouts](2026-11-21-payouts.md): payees, held allocations, weekly and cash-out payouts from the PayMongo wallet, events, public API, SDK and the console section. All tasks built on `feat/payouts`; deployment, the first live transfer and ADR-0008 acceptance remain.

Open plan: [Linked accounts](2026-11-24-linked-accounts.md): Sandbox onboarding, account-specific collections and payouts, console and payee verification are implemented on `feat/linked-accounts`. Live onboarding, provider verification and rollout remain pending. Phase B (payee consumer accounts) is held for PayMongo answers.

## Working specifications

- [Control plane rebuild](../specs/2026-11-14-control-plane-rebuild-design.md): organization-owned projects, environment-bound applications, explicit grants and one application key. Built, deployed, and the only access model since the legacy model was removed on 2026-11-19.
- [Payouts and pooled payee earnings](../specs/2026-11-21-payouts-design.md): approved and implemented on `feat/payouts`. Live payouts await the rollout conditions in the runbook.
