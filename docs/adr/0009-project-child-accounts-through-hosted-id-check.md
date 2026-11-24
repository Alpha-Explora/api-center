---
title: Project child accounts through the hosted ID check
status: active
authority: normative
owner: platform-maintainers
audience: [engineers, operators, maintainers]
last_verified: "2026-11-24"
verification: repository
sources: [apps/payments/src/features/linked-accounts, apps/payments/src/features/payouts/merchant-accounts.ts, supabase/migrations/20261124001300_linked_accounts.sql, supabase/migrations/20261124001400_payee_verification.sql]
---
# Project child accounts through the hosted ID check

## Decision

The approved design assigns a project its own PayMongo merchant account after provider verification and an explicit move. APICenter supplies the API, SDK, project isolation, payment routing, payout ledger, and audit history. PayMongo hosts identity capture and holds provider-side verification material. The project owns its users, eligibility, instructions for allocation and release, payout settings, and payee verification. Finance owns internal billing. Platform administrators own which projects can onboard and the provider relationship.

Existing resources keep the account chosen at creation. Historical payouts and refunds use that account even if a project moves or a switch is disabled. New collections resolve the active project mapping only when both linked-account switches are enabled. Customers, subscriptions, invoices, and catalog operations use the parent.

APICenter can enforce a shared payee verification requirement using `PAYOUTS_REQUIRE_PAYEE_VERIFICATION`. Products can apply stricter rules and record the project’s verification through the API and SDK.

## Rollout

The account state machine, routing, payout pools and console are implemented. The PayMongo test key returns a static mock account and a placeholder hosted URL. The test adapter exercises that contract and keeps the static account out of collection routing. Live onboarding requires a verified live contract for the remaining activation fields and capability requests. Live routing also requires an authenticated child webhook, an approved test transfer from the child wallet, and resolution of the provider and legal conditions in the working plan.

See the [working plan](../superpowers/plans/2026-11-24-linked-accounts.md) and [payouts runbook](../operations/payouts-runbook.md).
