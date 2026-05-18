ALTER TABLE api_center.services
  ADD COLUMN owner_tribe_id text;

UPDATE api_center.services
SET owner_tribe_id = service_id
WHERE service_type = 'tribe'
  AND owner_tribe_id IS NULL;

CREATE INDEX services_owner_tribe_idx
  ON api_center.services(owner_tribe_id);

CREATE INDEX services_org_owner_type_status_idx
  ON api_center.services(organization_id, owner_tribe_id, service_type, status);
