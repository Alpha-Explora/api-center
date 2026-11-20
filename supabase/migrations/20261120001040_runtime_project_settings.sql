-- Per-project settings the SMS and OTP runtimes enforce, set through the console's capability
-- configuration (gateway -> runtime admin routes), one row per project and environment like
-- shared_email.project_senders. Runtime roles keep exactly SELECT, INSERT and UPDATE on their schema:
-- clearing settings writes nulls rather than deleting the row.
BEGIN;

CREATE TABLE shared_sms.project_senders (
  project_id text NOT NULL,
  environment text NOT NULL,
  sender_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_senders_pkey PRIMARY KEY (project_id, environment),
  CONSTRAINT project_senders_environment_check CHECK (environment IN ('test', 'live')),
  CONSTRAINT project_senders_sender_id_check CHECK (
    sender_id IS NULL
    OR sender_id ~ '^\+[1-9][0-9]{6,14}$'
    OR (sender_id ~ '^[A-Za-z0-9 ]{1,11}$' AND sender_id ~ '[A-Za-z]')
  )
);
COMMENT ON TABLE shared_sms.project_senders IS 'Pinned SMS sender ID per project and environment; a null sender_id uses the platform sender.';
GRANT SELECT, INSERT, UPDATE ON shared_sms.project_senders TO sms_runtime;

CREATE TABLE shared_otp.project_settings (
  project_id text NOT NULL,
  environment text NOT NULL,
  code_length integer,
  expiry_seconds integer,
  max_attempts integer,
  message_template text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_settings_pkey PRIMARY KEY (project_id, environment),
  CONSTRAINT project_settings_environment_check CHECK (environment IN ('test', 'live')),
  CONSTRAINT project_settings_code_length_check CHECK (code_length IS NULL OR code_length BETWEEN 4 AND 10),
  CONSTRAINT project_settings_expiry_seconds_check CHECK (expiry_seconds IS NULL OR expiry_seconds BETWEEN 60 AND 3600),
  CONSTRAINT project_settings_max_attempts_check CHECK (max_attempts IS NULL OR max_attempts BETWEEN 1 AND 10),
  CONSTRAINT project_settings_message_template_check CHECK (
    message_template IS NULL
    OR (length(message_template) BETWEEN 1 AND 300 AND position('{{code}}' IN replace(message_template, ' ', '')) > 0)
  )
);
COMMENT ON TABLE shared_otp.project_settings IS 'OTP defaults per project and environment: code length, expiry, attempt cap and message template; nulls use platform defaults.';
GRANT SELECT, INSERT, UPDATE ON shared_otp.project_settings TO otp_runtime;

-- The attempt cap in force when a challenge was generated; null means no cap beyond the verify rate limit.
ALTER TABLE shared_otp.otp_challenges
  ADD COLUMN max_attempts integer,
  ADD CONSTRAINT otp_challenges_max_attempts_check CHECK (max_attempts IS NULL OR max_attempts BETWEEN 1 AND 10);

COMMIT;
