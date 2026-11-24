BEGIN;
CREATE TABLE apic_catalog.platform_operators (
  email text PRIMARY KEY CHECK (email = lower(email) AND length(email) <= 320 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  added_by text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_by text,
  removed_at timestamptz,
  CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);
GRANT SELECT, INSERT, UPDATE ON apic_catalog.platform_operators TO api_center_app;
COMMIT;
