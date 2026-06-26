do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('apic_governance', 'service_registration_requests_status_created_idx', 'registry_change_requests_status_created_idx'),
      ('apic_governance', 'service_registration_requests_service_idx', 'registry_change_requests_service_idx'),
      ('apic_governance', 'service_registration_requests_owner_idx', 'registry_change_requests_owner_idx'),
      ('apic_governance', 'tribe_quota_policies_owner_status_idx', 'quota_policies_owner_status_idx'),
      ('apic_governance', 'tribe_quota_policies_scope_target_idx', 'quota_policies_scope_target_idx'),
      ('apic_governance', 'tribe_plan_assignments_owner_env_status_idx', 'entitlement_assignments_owner_env_status_idx'),
      ('apic_governance', 'tribe_plan_assignments_plan_env_idx', 'entitlement_assignments_plan_env_idx'),
      ('apic_runtime', 'topic_onboarding_states_env_owner_idx', 'event_topic_onboarding_states_env_owner_idx'),
      ('apic_runtime', 'topic_onboarding_states_updated_idx', 'event_topic_onboarding_states_updated_idx'),
      ('apic_runtime', 'tribe_quota_decisions_owner_created_idx', 'quota_evaluations_owner_created_idx'),
      ('apic_runtime', 'tribe_quota_decisions_outcome_created_idx', 'quota_evaluations_outcome_created_idx'),
      ('apic_runtime', 'tribe_quota_decisions_correlation_idx', 'quota_evaluations_correlation_idx')
    ) as t(schema_name, legacy_name, enterprise_name)
  loop
    if to_regclass(format('%I.%I', item.schema_name, item.legacy_name)) is not null
       and to_regclass(format('%I.%I', item.schema_name, item.enterprise_name)) is null then
      execute format('alter index %I.%I rename to %I', item.schema_name, item.legacy_name, item.enterprise_name);
    elsif to_regclass(format('%I.%I', item.schema_name, item.legacy_name)) is not null
       and to_regclass(format('%I.%I', item.schema_name, item.enterprise_name)) is not null then
      execute format('drop index %I.%I', item.schema_name, item.legacy_name);
    end if;
  end loop;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'apic_governance'
      and r.relname = 'quota_policies'
      and c.conname = 'tribe_api_quota_policies_mode_check'
  ) and not exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'apic_governance'
      and r.relname = 'quota_policies'
      and c.conname = 'quota_policies_mode_check'
  ) then
    alter table apic_governance.quota_policies
      rename constraint tribe_api_quota_policies_mode_check to quota_policies_mode_check;
  end if;

  if exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'apic_governance'
      and r.relname = 'quota_policies'
      and c.conname = 'tribe_api_quota_policies_status_check'
  ) then
    alter table apic_governance.quota_policies
      drop constraint tribe_api_quota_policies_status_check;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'apic_governance'
      and r.relname = 'quota_policies'
      and c.conname = 'quota_policies_status_check'
  ) then
    alter table apic_governance.quota_policies
      add constraint quota_policies_status_check check (status in ('active', 'disabled', 'archived'));
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'apic_governance'
      and r.relname = 'entitlement_assignments'
      and c.conname = 'entitlement_assignments_status_check'
  ) then
    alter table apic_governance.entitlement_assignments
      add constraint entitlement_assignments_status_check check (status in ('active', 'suspended', 'archived'));
  end if;

  if exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'apic_runtime'
      and r.relname = 'quota_evaluations'
      and c.conname = 'tribe_api_quota_decisions_mode_check'
  ) and not exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'apic_runtime'
      and r.relname = 'quota_evaluations'
      and c.conname = 'quota_evaluations_mode_check'
  ) then
    alter table apic_runtime.quota_evaluations
      rename constraint tribe_api_quota_decisions_mode_check to quota_evaluations_mode_check;
  end if;

  if exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'apic_runtime'
      and r.relname = 'quota_evaluations'
      and c.conname = 'tribe_api_quota_decisions_outcome_check'
  ) and not exists (
    select 1 from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'apic_runtime'
      and r.relname = 'quota_evaluations'
      and c.conname = 'quota_evaluations_outcome_check'
  ) then
    alter table apic_runtime.quota_evaluations
      rename constraint tribe_api_quota_decisions_outcome_check to quota_evaluations_outcome_check;
  end if;
end $$;
