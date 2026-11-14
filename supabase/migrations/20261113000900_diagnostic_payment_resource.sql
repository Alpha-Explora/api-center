BEGIN;
ALTER TABLE apic_runtime.request_diagnostics ADD COLUMN payment_resource_id text CHECK(length(payment_resource_id)<=200);
COMMENT ON COLUMN apic_runtime.request_diagnostics.payment_resource_id IS 'Public payment ID from a successful mapped response; never a caller reference or provider payload';
COMMIT;
