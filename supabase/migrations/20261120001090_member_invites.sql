-- Invites: a member added to an organization is 'invited' until their first verified sign-in, and
-- the invite expires. Before, a new member was active at once and whoever first signed in with that
-- email address (for example a mistyped or recycled one) bound their identity and got access.
-- Existing members are active and keep their access.
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE apic_catalog.organization_members ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz;

ALTER TABLE apic_catalog.organization_members DROP CONSTRAINT IF EXISTS organization_members_status_check;
ALTER TABLE apic_catalog.organization_members
  ADD CONSTRAINT organization_members_status_check CHECK (status IN ('active', 'suspended', 'invited'));

ALTER TABLE apic_catalog.organization_members DROP CONSTRAINT IF EXISTS organization_members_invite_check;
ALTER TABLE apic_catalog.organization_members
  ADD CONSTRAINT organization_members_invite_check CHECK ((status = 'invited') = (invite_expires_at IS NOT NULL));

COMMIT;
