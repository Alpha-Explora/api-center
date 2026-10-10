# APICenter documentation

This is the canonical internal reading map. Consumer documentation is maintained separately in [apps/docs](../apps/docs). Read current architecture and contracts before treating a plan or historical deployment record as current behavior.

## Reading order

1. [Repository instructions](../AGENTS.md) and [maintenance rules](constitution.md).
2. [Current architecture](architecture/current-architecture.md) and the relevant accepted [ADR](adr/index.md).
3. The maintained concept or operator procedure below.
4. [Capability evidence](product/capability-evidence.md) and the [working-document register](superpowers/plans/README.md) for remaining gaps.

## Start here

- [Current APICenter architecture](architecture/current-architecture.md)
- [Documentation maintenance rules](constitution.md)
- [APICenter Developer Guide](developer/README.md)
- [APICenter Domain Terminology and System Architecture Reference](internal/domain-terminology.md)
- [Capability documentation and evidence](product/capability-evidence.md)

## Payment and platform architecture

- [APICenter Platform Setup](apicenter-platform-setup.md)
- [Database Control Plane](database-control-plane.md)
- [api-center Cloud Run Deployment](deployment-cloud-run.md)
- [APICenter Payments Current Architecture](payments-platform-current.md)

## Operations

- [APICenter Full-Plan IAM Access](operations/apicenter-full-plan-iam-access.md)
- [History write load test](operations/history-load-test.md)
- [History retention](operations/history-retention.md)
- [Payment Checkout And Subscription Handoff](operations/payment-checkout-subscription-handoff.md)
- [Payment Database Ownership](operations/payment-database-ownership.md)
- [APICenter Payment Platform Runbook](operations/payment-platform-runbook.md)
- [Shared-service database roles](operations/shared-service-database-roles.md)

## Integrations

- [AlphaCI Payment Event Delivery](integrations/alphaci-payment-events.md)
- [Payment event outbox operations](integrations/payment-event-outbox-operations.md)
- [Payment reconciliation](integrations/payment-reconciliation.md)

## Developer policy

- [Tribe API Quotas](developer/tribe-api-quotas.md)
- [Tribe Governance Scorecard Rubric](developer/tribe-governance-scorecard-rubric.md)

## Decisions, plans, and history

- [Architecture decisions](adr/index.md)
- [Working documents and verification gaps](superpowers/plans/README.md)
- [Documentation changes](log.md)
- [Release-visible changes](../CHANGELOG.md)

## Public documentation sources

- [Guide membership and aliases](../apps/docs/content/guides.json)
- [Public payment OpenAPI](../contracts/public/apicenter.openapi.yaml)
- [Public payment event AsyncAPI](../contracts/public/apicenter.asyncapi.yaml)
- [Published SDK](../packages/sdk/README.md)

Root internal documents are not automatically published. Shared-service guides do not imply full public OpenAPI coverage. See the maintenance rules for ownership, retirement, and the automated checks.
