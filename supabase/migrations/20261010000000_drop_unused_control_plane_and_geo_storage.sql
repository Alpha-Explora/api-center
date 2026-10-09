-- These tables were modeled but have no application persistence callers. Promotion evidence and geo
-- caching are process-memory-backed, and the remaining control-plane records are not written or read.
-- APICenter is starting without production data, so this is a clean removal with no backfill.
-- Historical migrations stay immutable; this forward migration removes the unused schema objects.

drop view if exists api_center.tribe_secret_refs;
drop view if exists api_center_ops.provisioning_jobs;
drop view if exists api_center_ops.health_snapshots;
drop view if exists api_center_ops.smoke_test_runs;

drop table if exists apic_catalog.service_secret_references;
drop table if exists apic_catalog.shared_service_runtime_routes;
drop table if exists apic_runtime.provisioning_jobs;
drop table if exists apic_runtime.health_snapshots;
drop table if exists apic_runtime.smoke_test_runs;
drop table if exists apic_governance.promotion_evidence_bundles;

-- The only objects in shared_geo are these three uncalled tables. Drop them explicitly so
-- unexpected future dependencies fail migration instead of being removed implicitly.
drop table if exists shared_geo.geocode_requests;
drop table if exists shared_geo.normalized_locations;
drop table if exists shared_geo.geofence_checks;
drop schema if exists shared_geo;
