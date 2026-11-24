import { parseAccountEvent } from '../../../../../apps/payments/src/features/linked-accounts/account-events';
import { applyEvent, initialState } from '../../../../../apps/payments/src/features/linked-accounts/linked-account-lifecycle';

const providerAccountId = 'org_fixture';
const created = applyEvent(initialState(), { type: 'created', providerAccountId });
const pending = applyEvent(applyEvent(created, { type: 'details_submitted' }), {
  type: 'verification_link_issued', expiresAt: new Date('2026-11-25T00:00:00Z'),
});

describe('linked account provider events', () => {
  function payload(type: string, data: unknown) {
    return { data: { id: 'evt_fixture', attributes: { type, data } } };
  }

  it('requires a session identifier for a verification event', () => {
    const type = 'account.identity_verification.passed';
    expect(parseAccountEvent(payload(type, { account_id: providerAccountId }))).toBeNull();
    expect(parseAccountEvent(payload(type, { account_id: providerAccountId, id: 'verif_fixture' }))).toMatchObject({
      providerAccountId, sessionId: 'verif_fixture', event: { type: 'verification_passed' },
    });
  });

  it('preserves activation before verification and accepts an activation webhook without wallet details', () => {
    const parsed = parseAccountEvent(payload('merchant.activated', { merchant_id: providerAccountId }))!;
    expect(parsed).toMatchObject({ providerAccountId, event: { type: 'activated', wallet: null } });
    const active = applyEvent(pending, parsed.event);
    expect(active.status).toBe('active');
    expect(applyEvent(active, { type: 'verification_passed' })).toBe(active);
    expect(applyEvent(active, { type: 'verification_failed', reason: 'late failure' })).toBe(active);
  });

  it('ignores unrelated webhook events', () => {
    expect(parseAccountEvent(payload('payment.paid', { merchant_id: providerAccountId }))).toBeNull();
  });
});
