import { recipientRateLimitKey } from '@apicenter/runtime';

describe('recipientRateLimitKey', () => {
  const shop = { projectId: 'prj_shop', environment: 'live' as const };

  it('gives one recipient one limit however the number is written', () => {
    const key = recipientRateLimitKey('sms:send', shop, '+639171234567');
    expect(recipientRateLimitKey('sms:send', shop, ' +63 917-123-4567 ')).toBe(key);
    expect(recipientRateLimitKey('sms:send', shop, '+63 (917) 123.4567')).toBe(key);
    expect(recipientRateLimitKey('email:send', shop, ' Dana@Example.com ')).toBe(recipientRateLimitKey('email:send', shop, 'dana@example.com'));
  });

  it("keeps one project's limit from blocking another project or environment", () => {
    const key = recipientRateLimitKey('otp:generate', shop, '+639171234567');
    expect(recipientRateLimitKey('otp:generate', { projectId: 'prj_other', environment: 'live' }, '+639171234567')).not.toBe(key);
    expect(recipientRateLimitKey('otp:generate', { ...shop, environment: 'test' }, '+639171234567')).not.toBe(key);
  });
});
