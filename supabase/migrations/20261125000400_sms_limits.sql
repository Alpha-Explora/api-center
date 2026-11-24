BEGIN;
ALTER TABLE shared_sms.project_senders ADD COLUMN daily_limit integer CHECK (daily_limit > 0);
ALTER TABLE shared_otp.project_settings ADD COLUMN sms_daily_limit integer CHECK (sms_daily_limit > 0);

CREATE TABLE shared_sms.sms_daily_usage (
  project_id text NOT NULL, environment text NOT NULL CHECK (environment IN ('test', 'live')),
  day date NOT NULL, count integer NOT NULL CHECK (count > 0), PRIMARY KEY (project_id, environment, day)
);
CREATE TABLE shared_otp.otp_sms_daily_usage (LIKE shared_sms.sms_daily_usage INCLUDING ALL);
GRANT SELECT, INSERT, UPDATE ON shared_sms.sms_daily_usage TO sms_runtime;
GRANT SELECT, INSERT, UPDATE ON shared_otp.otp_sms_daily_usage TO otp_runtime;
COMMIT;
