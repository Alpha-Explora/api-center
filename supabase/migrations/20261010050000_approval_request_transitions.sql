-- Approval requests: each approval is used once and decisions move only from the expected state.
-- 'applied' marks an approval consumed by a live action (applied_at records when).
-- cancelled_by/cancelled_at record who withdrew a pending request, matching the rejection columns.

alter table apic_governance.approval_requests
  add column if not exists applied_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists cancelled_at timestamptz;

alter table apic_governance.approval_requests
  drop constraint if exists approval_requests_status_check;

alter table apic_governance.approval_requests
  add constraint approval_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled', 'applied'));
