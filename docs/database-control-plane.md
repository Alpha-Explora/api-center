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
