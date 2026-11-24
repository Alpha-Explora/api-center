BEGIN;
ALTER TABLE shared_sms.project_senders ADD COLUMN allowed_prefixes text[];
ALTER TABLE shared_otp.project_settings ADD COLUMN sms_allowed_prefixes text[];
COMMIT;
