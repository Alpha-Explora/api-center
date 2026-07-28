# Database Control Plane

APICenter owns the gateway control-plane state and canonical payment state in its
configured Postgres/Supabase database. AlphaCI owns its local entitlement,
subscription, payment-attempt, inbox, and projection tables.

Provider credentials and provider-specific writes stay in APICenter's private
payment runtime. AlphaCI stores local references and projections, not PayMongo
secrets or provider mutation logic.

Use the checked-in Supabase migrations and the payment platform runbook as the
source of truth. Do not add migrations under the retired `api-shared` repository.