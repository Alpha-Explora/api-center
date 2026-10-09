# Database Control Plane

APICenter owns gateway control-plane state and the project-scoped payment
ownership, reconciliation, verified webhook receipt, and event-delivery records
in its configured Postgres/Supabase database. PayMongo remains the system of
record for provider-backed payment resources and merchant settlement. AlphaCI
owns its local entitlement, subscription, payment-attempt, inbox, and projection
tables.

Provider credentials and provider-specific writes stay in APICenter's private
payment runtime. APICenter stores project/environment ownership and the metadata
needed to list, reconcile, and deliver payment events; it does not duplicate
PayMongo's provider resource tables. AlphaCI stores local references and
projections, not PayMongo secrets or provider mutation logic.

Use the checked-in Supabase migrations and the payment platform runbook as the
source of truth. Do not add migrations under the retired `api-shared` repository.
