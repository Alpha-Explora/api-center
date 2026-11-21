# Working-document register

Plans record execution scope and pending checks. Use [current architecture](../../architecture/current-architecture.md), [payment ownership](../../payments-platform-current.md), contracts, code, and maintained runbooks for implemented behavior. Old checked boxes and deployment snapshots are not fresh verification.

Open plan: [Payouts](2026-11-21-payouts.md): payees, held allocations, weekly and cash-out payouts from the PayMongo wallet, events, public API, SDK and the console section. All tasks built on `feat/payouts`; deployment, the first live transfer and ADR-0008 acceptance remain. Completed work is promoted into maintained concepts, ADRs, and runbooks; git history preserves the original plans.

## Working specifications

- [Control plane rebuild](../specs/2026-11-14-control-plane-rebuild-design.md): organization-owned projects, environment-bound applications, explicit grants and one application key. Built, deployed, and the only access model since the legacy model was removed on 2026-11-19.
- [Payouts and pooled payee earnings](../specs/2026-11-21-payouts-design.md): proposed design for project payouts (payees, held allocations, pooled transfers, merchant-account resolver for a later move to PayMongo linked accounts). Not approved and not built; live payouts wait for legal review and PayMongo answers.
