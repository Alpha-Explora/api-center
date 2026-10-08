-- Retention for append-only history tables.
--
-- 20260625162216_enterprise_control_plane_schemas.sql declared a retention window in a table comment
-- (for example "retention=400d") but nothing deleted expired rows, so these tables grew without bound.
-- scripts/purge-expired-history.cjs now enforces the window in each comment. This migration gives it what
-- it needs:
--   * a dedicated api_center_retention role that may select and delete on exactly these tables. The
--     application role stays append-only for audit events (20261009000100_audit_events_append_only.sql);
--     purges run under this role, never under api_center_app.
--   * a retention policy on promotion_evidence_bundles, the one managed table that had none.
--   * BRIN indexes on the time columns the purge filters on. The tables are written in time order, so a
--     BRIN index is small and keeps each purge batch from scanning the whole table. audit_events already
--     has a btree index on created_at.
--
-- api_center_retention is NOLOGIN. Create the login role used by the purge job and grant it membership:
--   create role apicenter_purge login password '...' in role api_center_retention;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'api_center_retention') then
    create role api_center_retention nologin;
  end if;
end $$;

grant usage on schema apic_audit, apic_runtime, apic_governance to api_center_retention;
grant select, delete on
  apic_audit.audit_events,
  apic_runtime.quota_evaluations,
  apic_runtime.usage_rollups,
  apic_runtime.health_snapshots,
  apic_runtime.smoke_test_runs,
  apic_runtime.pipeline_feedback_actions,
  apic_governance.promotion_evidence_bundles
to api_center_retention;

comment on table apic_governance.promotion_evidence_bundles is
  'retention=400d; Durable promotion/compliance evidence snapshots keyed by service and source/target environment. Store evidence metadata, not secrets.';

create index if not exists quota_evaluations_created_brin_idx
  on apic_runtime.quota_evaluations using brin (created_at);
create index if not exists usage_rollups_window_end_brin_idx
  on apic_runtime.usage_rollups using brin (window_end);
create index if not exists health_snapshots_checked_brin_idx
  on apic_runtime.health_snapshots using brin (checked_at);
create index if not exists smoke_test_runs_created_brin_idx
  on apic_runtime.smoke_test_runs using brin (created_at);
create index if not exists pipeline_feedback_actions_created_brin_idx
  on apic_runtime.pipeline_feedback_actions using brin (created_at);
create index if not exists promotion_evidence_created_brin_idx
  on apic_governance.promotion_evidence_bundles using brin (created_at);

