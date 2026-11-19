-- Moves records still owned by a legacy (tribe, project) to the organization and project the
-- control plane migrated them to, and each legacy service to its application, then drops the
-- owner mappings. Afterwards every record's owner is the one the gateway signs, so the gateway no
-- longer translates owners per request.
--
-- Driven by apic_catalog.cp_resource_owner_mappings (legacy owner per migrated project
-- environment) and apic_catalog.cp_legacy_mappings (legacy service -> application). A service
-- without an application mapping keeps its ID.

create temporary table legacy_owner_remap on commit drop as
select m.organization_id::text as organization_id,
       m.project_id,
       m.environment_kind as environment,
       m.owner_group_id as legacy_tribe_id,
       m.owner_project_id as legacy_project_id
  from apic_catalog.cp_resource_owner_mappings m;

create temporary table legacy_service_remap on commit drop as
select l.organization_id::text as organization_id,
       l.environment_kind as environment,
       l.source_id as legacy_service_id,
       l.target_id as application_id
  from apic_catalog.cp_legacy_mappings l
 where l.source_kind = 'service' and l.target_kind = 'application';

-- 1. Owners: legacy (tribe, project) -> (organization, project).
update shared_payment.resource_owners r
   set tribe_id = o.organization_id, project_id = o.project_id
  from legacy_owner_remap o
 where r.environment = o.environment and r.tribe_id = o.legacy_tribe_id and r.project_id = o.legacy_project_id;

update shared_payment.payment_event_outbox e
   set owner_tribe_id = o.organization_id, project_id = o.project_id
  from legacy_owner_remap o
 where e.environment = o.environment and e.owner_tribe_id = o.legacy_tribe_id and e.project_id = o.legacy_project_id;

update shared_email.email_messages m
   set tribe_id = o.organization_id, project_id = o.project_id
  from legacy_owner_remap o
 where m.environment = o.environment and m.tribe_id = o.legacy_tribe_id and m.project_id = o.legacy_project_id;

update shared_sms.sms_messages m
   set tribe_id = o.organization_id, project_id = o.project_id
  from legacy_owner_remap o
 where m.environment = o.environment and m.tribe_id = o.legacy_tribe_id and m.project_id = o.legacy_project_id;

update shared_otp.otp_challenges c
   set tribe_id = o.organization_id, project_id = o.project_id
  from legacy_owner_remap o
 where c.environment = o.environment and c.tribe_id = o.legacy_tribe_id and c.project_id = o.legacy_project_id;

update shared_email.project_senders p
   set project_id = o.project_id
  from legacy_owner_remap o
 where p.environment = o.environment
   and p.project_id = o.legacy_project_id
   and not exists (select 1 from shared_email.project_senders q where q.project_id = o.project_id and q.environment = o.environment);

-- 2. Services: within a remapped organization, a legacy service ID -> its application ID.
update shared_payment.resource_owners r
   set consumer_service_id = s.application_id
  from legacy_service_remap s
 where r.tribe_id = s.organization_id and r.environment = s.environment and r.consumer_service_id = s.legacy_service_id;

update shared_payment.payment_event_outbox e
   set consumer_service_id = s.application_id
  from legacy_service_remap s
 where e.owner_tribe_id = s.organization_id and e.environment = s.environment and e.consumer_service_id = s.legacy_service_id;

update shared_email.email_messages m
   set service_id = s.application_id
  from legacy_service_remap s
 where m.tribe_id = s.organization_id and m.environment = s.environment and m.service_id = s.legacy_service_id;

update shared_sms.sms_messages m
   set service_id = s.application_id
  from legacy_service_remap s
 where m.tribe_id = s.organization_id and m.environment = s.environment and m.service_id = s.legacy_service_id;

update shared_otp.otp_challenges c
   set service_id = s.application_id
  from legacy_service_remap s
 where c.tribe_id = s.organization_id and c.environment = s.environment and c.service_id = s.legacy_service_id;

delete from apic_catalog.cp_resource_owner_mappings;
