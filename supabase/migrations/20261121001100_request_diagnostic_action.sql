-- The action a request was authorized for (for example payments:intents:read), so the console's request
-- log can say what a request did. The route template alone reads /api/v1/payments/{*path} for every
-- payment call. Null for requests refused before authorization and for rows recorded before this column.
BEGIN;
ALTER TABLE apic_runtime.request_diagnostics
  ADD COLUMN action text CHECK (action IS NULL OR action ~ '^[a-z0-9][a-z0-9:._-]{0,119}$');
COMMIT;
