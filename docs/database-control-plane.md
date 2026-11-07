---
title: "Database Control Plane"
status: canonical
authority: informative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "unverified"
verification: unverified
sources: ["supabase/migrations"]
---
# Database Control Plane

APICenter owns gateway control-plane state and the project-scoped payment
ownership, reconciliation, verified webhook receipt, and event-delivery records
in its configured Postgres/Supabase database. PayMongo remains the system of
record for provider-backed payment resources and merchant settlement. Consumer
applications own their local entitlements, subscriptions, payment attempts,
event inboxes, and projections.

Provider credentials and provider-specific writes stay in APICenter's private
payment runtime. APICenter stores project/environment ownership and the metadata
needed to list, reconcile, and deliver payment events; it does not duplicate
PayMongo's provider resource tables. Consumer applications store local references
and projections, not PayMongo secrets or provider mutation logic.

Use the checked-in Supabase migrations and the payment platform runbook as the
source of truth. Do not add migrations under the retired `api-shared` repository.

## Connection budget and legacy audit compatibility

The gateway limits each instance to `DATABASE_POOL_MAX` Postgres connections (default `2`). Invalid, fractional, or non-positive values fail startup. Budget session-pooler capacity across all instances and overlapping rollout revisions; this limit does not change Cloud Run instance caps.

Migration `20261012011500_legacy_audit_write_compatibility.sql` conditionally drops `NOT NULL` from retired audit columns (`type`, `severity`, `message`, `occurred_at`) when they exist. It preserves historical values and does nothing on fresh baseline schemas without those columns. The migration uses a ten-second lock timeout; operators must assess and apply it through the normal migration process. No live database verification is claimed.
