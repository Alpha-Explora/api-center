BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE apic_catalog.cp_feature_requests (
  id text PRIMARY KEY CHECK (id ~ '^frq_[a-z0-9]{24}$'),
  organization_id uuid NOT NULL,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  environment_kind text NOT NULL CHECK (environment_kind IN ('test', 'live')),
  feature text NOT NULL CHECK (feature IN ('plan.upgrade', 'payments.live', 'payouts.sending',
    'payouts.merchant_account', 'payouts.payee_wallets', 'sms.sender', 'email.sender', 'sms.daily_limit', 'sms.international')),
  change jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(change) = 'object'),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'deciding', 'approved', 'rejected', 'cancelled')),
  requested_by text NOT NULL,
  decided_by text,
  decided_at timestamptz,
  decision_note text CHECK (length(decision_note) BETWEEN 1 AND 500),
  claim_token uuid,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (environment_id, project_id, organization_id) REFERENCES apic_catalog.cp_environments (id, project_id, organization_id),
  CHECK ((status = 'deciding') = (claim_token IS NOT NULL AND claimed_at IS NOT NULL))
);

CREATE UNIQUE INDEX cp_feature_requests_pending_idx ON apic_catalog.cp_feature_requests (environment_id, feature)
  WHERE status IN ('pending', 'deciding');
CREATE INDEX cp_feature_requests_project_idx ON apic_catalog.cp_feature_requests (organization_id, project_id, created_at DESC);
ALTER TABLE apic_catalog.cp_feature_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON apic_catalog.cp_feature_requests TO api_center_app;
CREATE POLICY cp_feature_requests_tenant ON apic_catalog.cp_feature_requests TO api_center_app
  USING (apic_catalog.cp_tenant_visible(organization_id))
  WITH CHECK (apic_catalog.cp_tenant_visible(organization_id));
COMMIT;
