CREATE TABLE api_center.service_environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES api_center.services(id) ON DELETE CASCADE,
  environment text NOT NULL,
  base_url text NOT NULL,
  health_check_path text,
  status text NOT NULL DEFAULT 'active',
  healthy boolean,
  last_health_check_at timestamptz,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_environment_unique UNIQUE (service_id, environment),
  CONSTRAINT service_environment_key_check CHECK (environment IN ('test', 'staging', 'uat', 'demo', 'live'))
);

CREATE INDEX service_environments_env_status_idx
  ON api_center.service_environments(environment, status);

INSERT INTO api_center.service_environments (
  service_id,
  environment,
  base_url,
  health_check_path,
  status,
  healthy,
  last_health_check_at,
  registered_at,
  updated_at
)
SELECT
  id,
  'test',
  base_url,
  health_check_path,
  status,
  healthy,
  last_health_check_at,
  registered_at,
  updated_at
FROM api_center.services
ON CONFLICT (service_id, environment) DO NOTHING;
