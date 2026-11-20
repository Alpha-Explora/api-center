-- The console's request log reads one project environment, newest first.
--
-- CONCURRENTLY, so the gateway's insert on every request is not blocked while the index builds. It
-- cannot run inside a transaction block, so this file holds this one statement and nothing else; do
-- not add BEGIN/COMMIT or other statements. scripts/replay-supabase-migrations.cjs sends it as one
-- statement. If `supabase db push` refuses it ("cannot run inside a transaction block"), run this
-- file with psql and record it with `supabase migration repair --status applied 20261120001021`.
--
-- If a build is interrupted it leaves an INVALID index that IF NOT EXISTS would then skip; drop it
-- with DROP INDEX CONCURRENTLY apic_runtime.request_diagnostics_project_idx and apply this again.
-- scripts/verify-control-plane-schema.ts reports an invalid index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS request_diagnostics_project_idx
  ON apic_runtime.request_diagnostics (project_id, environment, created_at DESC, request_id DESC)
  WHERE project_id IS NOT NULL;
