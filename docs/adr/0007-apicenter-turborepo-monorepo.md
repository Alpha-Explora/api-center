# ADR-0007: APICenter Turborepo Monorepo

## Status

Accepted

## Decision

APICenter is the source-of-truth Turborepo monorepo for the gateway, payment runtime, remaining shared-service runtimes, SDK, contracts, and Management application. It uses npm workspaces for the initial migration and keeps each app independently deployable with separate Cloud Run service accounts, secrets, scaling, health checks, and database boundaries. The `api-shared` repository is frozen legacy migration source and is archived only after parity and deployment evidence are complete.

## Consequences

The platform gains one release and contract boundary without forcing all runtimes into one process. The first migration does not change package managers; current npm and package-lock-based CI remains valid. Runtime moves require parity evidence before the legacy repository is retired.