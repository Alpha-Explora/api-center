# Payment reconciliation

APICenter processes team payments through one APICenter-owned PayMongo merchant account. PayMongo settles that account; it does not split settlement by APICenter project. Teams therefore use APICenter's project records and the operator export to attribute activity and calculate their internal payout or chargeback.

## List a project's records

Give a payment key the `payments:read` scope and call `GET /api/v1/payments/records`. The endpoint only returns rows for the key's registered project and environment. It supports `type`, `status`, `createdAfter`, `createdBefore`, `limit` (50 by default, at most 200), and `cursor`. `createdAfter` is inclusive; `createdBefore` is exclusive. Follow `nextCursor` until it is absent. Amounts are integer minor units represented as decimal strings, preserving PostgreSQL `bigint` precision.

For example:

```http
GET /api/v1/payments/records?type=payment&createdAfter=2026-10-01T00%3A00%3A00Z&limit=200
Authorization: Bearer apic_...
```

## Operator CSV

An APICenter operator can request `GET /api/v1/admin/payments/records` with `projectId`, `environment=test|live`, optional type/status/date filters, and `format=csv`. The export follows every page for that project and includes provider resource IDs, reference IDs, related payment IDs, amounts, currencies, statuses, and timestamps. Use provider IDs and the project reference to reconcile PayMongo transactions and refunds to the owning project. A refund is a separate record; `relatedResourceId` identifies its payment.

The export is an attribution ledger, not a PayMongo settlement statement. Reconcile its payment and refund rows against PayMongo's balance/settlement reports, and account for provider fees, failed payments, and settlement timing before calculating the amount due to each team.

## Paying teams and chargebacks

The APICenter operator or finance team calculates each team's net payable from reconciled successful payments less refunds, chargebacks, and agreed fees, then pays the team outside PayMongo. A chargeback is a liability against the shared merchant account; record its project attribution using the related payment ID and handle the deduction in the same finance process. Keep the source PayMongo report, exported CSV, reconciliation period, calculation, approver, and payout or recovery reference together in the finance record.

The CSV export contains a page snapshot at request time. For reproducible monthly close, save the downloaded export and PayMongo source report rather than relying on later queries, since webhook updates can change record statuses.
