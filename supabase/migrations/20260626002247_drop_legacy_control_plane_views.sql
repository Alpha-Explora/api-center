drop view if exists api_center_audit.audit_events;

drop view if exists api_center_ops.pipeline_feedback_actions;
drop view if exists api_center_ops.tribe_api_quota_decisions;
drop view if exists api_center_ops.usage_rollups;
drop view if exists api_center_ops.smoke_test_runs;
drop view if exists api_center_ops.health_snapshots;
drop view if exists api_center_ops.topic_onboarding_states;
drop view if exists api_center_ops.provisioning_jobs;
drop view if exists api_center_ops.tribe_plan_assignments;
drop view if exists api_center_ops.tribe_plan_definitions;
drop view if exists api_center_ops.tribe_api_quota_policies;
drop view if exists api_center_ops.approval_requests;
drop view if exists api_center_ops.service_registration_requests;

drop view if exists api_center.s3_sink_topics;
drop view if exists api_center.confluent_topics;
drop view if exists api_center.tribe_secret_refs;
drop view if exists api_center.service_lifecycle_events;
drop view if exists api_center.service_dependencies;
drop view if exists api_center.service_scopes;
drop view if exists api_center.service_routes;
drop view if exists api_center.service_environments;
drop view if exists api_center.services;
drop view if exists api_center.organizations;

drop schema if exists api_center_audit;
drop schema if exists api_center_ops;
drop schema if exists api_center;
