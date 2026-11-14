-- Control plane rebuild, slice 9: event destinations.
-- A destination delivers one recipient application's payment events in one environment to an
-- authenticated Pub/Sub push endpoint. The subscription filter is the recipient application, so a
-- destination never receives another application's events.
BEGIN;

CREATE TABLE apic_catalog.cp_event_destinations (
  id text PRIMARY KEY CHECK (id ~ '^dst_[a-z0-9]{24}$'),
  organization_id uuid NOT NULL,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  recipient_application_id text NOT NULL,
  event_family text NOT NULL DEFAULT 'payments' CHECK (event_family IN ('payments')),
  transport text NOT NULL DEFAULT 'pubsub-push' CHECK (transport IN ('pubsub-push')),
  push_endpoint text NOT NULL CHECK (push_endpoint ~ '^https://' AND length(push_endpoint) <= 2048),
  oidc_audience text,
  delivery_service_account_email text NOT NULL,
  subscription_name text,
  status text NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning','active','failed','disabled')),
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 500),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (recipient_application_id, environment_id, project_id, organization_id)
    REFERENCES apic_catalog.cp_applications(id, environment_id, project_id, organization_id)
);
CREATE UNIQUE INDEX cp_event_destinations_recipient_idx
  ON apic_catalog.cp_event_destinations (recipient_application_id, event_family) WHERE status <> 'disabled';

ALTER TABLE apic_catalog.cp_event_destinations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON apic_catalog.cp_event_destinations TO api_center_app;
CREATE POLICY cp_event_destinations_tenant ON apic_catalog.cp_event_destinations TO api_center_app
  USING (apic_catalog.cp_tenant_visible(organization_id))
  WITH CHECK (apic_catalog.cp_tenant_visible(organization_id));

COMMIT;
