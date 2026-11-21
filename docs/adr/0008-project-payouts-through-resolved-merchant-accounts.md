---
title: "ADR-0008: Project Payouts Through Resolved Merchant Accounts"
status: active
authority: normative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "unverified"
verification: unverified
sources: ["docs/superpowers/specs/2026-11-21-payouts-design.md","docs/adr/0001-apicenter-v1-merchant-of-record.md","docs/adr/0002-v1-first-party-payment-scope.md","apps/payments/src/shared/paymongo-client.ts"]
---
# ADR-0008: Project Payouts Through Resolved Merchant Accounts

Status: proposed on 2026-11-21. It takes effect once the user accepts it and the legal review in the [payouts design](../superpowers/specs/2026-11-21-payouts-design.md) is complete. Until then, ADR-0001 and ADR-0002 still apply in full.

## Context

Marketplace-style projects need to pay the people who deliver their service (payees) out of the payments they collect, after the project's own completion signal. [ADR-0002](0002-v1-first-party-payment-scope.md) excludes settlement, allocation and payout. [ADR-0001](0001-apicenter-v1-merchant-of-record.md) makes APICenter's single PayMongo account the merchant of record for every project.

PayMongo linked accounts would give each project its own child merchant account and each payee their own wallet, but they are not yet enabled on our account. The PayMongo wallet and transfer API are available today, and each transfer costs about ₱10.

## Decision

1. APICenter offers provider-neutral payouts. A project registers payees, attaches allocations to payments, releases allocations when its own business rule is met, and receives payout events. Consumers never see PayMongo accounts, wallets, rails or `Account-ID`.
2. One resolver decides which merchant account acts for a project and environment. Today every project resolves to the parent account. A later child account is a data change per project, with an effective time. Every provider call goes through the resolver.
3. Every money record stores the merchant account it used. A payout is funded from the account that received the money, never from another one.
4. Released allocations are pooled per payee and per merchant account. A project's payout policy (immediate, scheduled, threshold or on-demand) decides when a pool becomes one transfer, so one transfer fee covers many jobs.
5. Payout destinations are a closed set of types: InstaPay (GCash or bank) and PayMongo wallet today, and a linked consumer account later. Only the transfer adapter knows the rails.
6. Provider webhook secrets are resolved per merchant account. This is ready for per-child webhooks even while there is one account.

## Consequences

- This supersedes ADR-0002's exclusion of allocation and payout for first-party projects. ADR-0001 still applies to every project that resolves to the parent account.
- APICenter funds immediate payouts from a wallet float before PayMongo settles the customer payment. Float balance, reconciliation and low-balance handling become an operational duty.
- Holding released earnings until a pooled payout may be regulated in the Philippines (BSP). The pooling window stays short, and live payouts wait for legal confirmation.
- APICenter, not PayMongo, ensures a payout is sent exactly once, because the transfer API has no idempotency key.
- Moving a project to a child account changes neither the public payout contract nor the ledger.
