-- Test recipients: the phone numbers and email addresses a project's test environment may really
-- deliver to. A test send to anyone else is recorded by the runtime and never reaches Twilio or
-- Resend, so a test key cannot message arbitrary people from APICenter's provider accounts.
-- Recipients are stored normalised: E.164 numbers without separators, lower-case emails.
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS apic_catalog.cp_test_recipients (
  organization_id uuid NOT NULL,
  project_id text NOT NULL,
  recipient text NOT NULL CHECK (
    recipient ~ '^\+[1-9][0-9]{6,14}$'
    OR (length(recipient) <= 254 AND recipient ~ '^[^\s@A-Z]+@[^\s@A-Z]+\.[^\s@A-Z]+$')
  ),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, recipient),
  FOREIGN KEY (project_id, organization_id) REFERENCES apic_catalog.cp_projects (id, organization_id)
);

ALTER TABLE apic_catalog.cp_test_recipients ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON apic_catalog.cp_test_recipients TO api_center_app;
DROP POLICY IF EXISTS cp_test_recipients_tenant ON apic_catalog.cp_test_recipients;
CREATE POLICY cp_test_recipients_tenant ON apic_catalog.cp_test_recipients TO api_center_app
  USING (apic_catalog.cp_tenant_visible(organization_id))
  WITH CHECK (apic_catalog.cp_tenant_visible(organization_id));

COMMIT;
