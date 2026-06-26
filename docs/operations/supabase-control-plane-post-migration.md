# Supabase Control-Plane Post-Migration State

This note records the permanent operating state after the enterprise Supabase
control-plane migration and cleanup.

## Completed Outcome

- API Center control-plane data is owned by `apic_catalog`, `apic_governance`,
  `apic_runtime`, and `apic_audit`.
- Legacy compatibility schemas and views named `api_center*` were removed.
- One-time migration evidence packets, tracker pages, and temporary collector
  scripts were removed from the repository.
- Normal future changes use the retained Supabase migration, verifier,
  registry-backfill, and registry-parity commands in `package.json`.

## Retained Operational References

- `docs/database-control-plane.md` is the canonical database architecture and
  migration-maintenance guide.
- `docs/developer/registry-persistence-runbook.md` is the registry source,
  drift, and rollback guide.
- `supabase/migrations` is the live SQL migration authority.
- `prisma/schema.prisma` stays synchronized for typed runtime access.

## Cleanup Rule

Do not recreate dated migration evidence documents or temporary tracker pages
unless a future live migration explicitly needs an approval artifact. Permanent
docs should describe the current operating model and link to retained commands,
not to one-time evidence JSON.
