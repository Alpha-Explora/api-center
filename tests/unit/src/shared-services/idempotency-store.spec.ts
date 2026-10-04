import { createMemoryIdempotencyStore, createScopedIdempotencyKey } from '@apicenter/runtime';

describe('shared idempotency storage', () => {
  it('allows only one concurrent request to claim a key', async () => {
    const store = createMemoryIdempotencyStore();
    const body = { to: 'user@example.test', subject: 'Receipt' };

    const claims = await Promise.all([
      store.claim('email:service-a:send:key-1234567890', body),
      store.claim('email:service-a:send:key-1234567890', body),
    ]);

    expect(claims.map(({ status }) => status).sort()).toEqual(['claimed', 'in_progress']);
  });

  it('replays a completed response only for the original payload', async () => {
    const store = createMemoryIdempotencyStore();
    const key = 'sms:service-a:send:key-1234567890';
    const body = { to: '+639000000000', message: 'Your receipt is ready' };

    expect(await store.claim(key, body)).toEqual({ status: 'claimed' });
    await store.complete(key, body, { status: 201, body: { messageId: 'SM123' } });

    expect(await store.claim(key, body)).toEqual({
      status: 'replay', response: { status: 201, body: { messageId: 'SM123' } },
    });
    expect(await store.claim(key, { ...body, message: 'Different message' })).toEqual({ status: 'payload_mismatch' });
  });

  it('keeps uncertain provider outcomes blocked and releases rejected attempts', async () => {
    const store = createMemoryIdempotencyStore();
    const unknownKey = 'sms:service-a:send:key-unknown-123456';
    const body = { to: '+639000000000', message: 'Your receipt is ready' };

    await store.claim(unknownKey, body);
    await store.markUnknown(unknownKey, body);
    expect(await store.claim(unknownKey, body)).toEqual({ status: 'unknown' });

    const rejectedKey = 'email:service-a:send:key-rejected-1234';
    await store.claim(rejectedKey, body);
    await store.release(rejectedKey, body);
    expect(await store.claim(rejectedKey, body)).toEqual({ status: 'claimed' });
  });

  it('turns an expired processing lease into an unknown outcome instead of retrying', async () => {
    let now = 100;
    const store = createMemoryIdempotencyStore({ now: () => now });
    const key = 'email:service-a:send:key-expired-123456';
    const body = { to: 'user@example.test', subject: 'Receipt' };

    expect(await store.claim(key, body, { leaseMs: 10 })).toEqual({ status: 'claimed' });
    now = 111;
    expect(await store.claim(key, body, { leaseMs: 10 })).toEqual({ status: 'unknown' });
    await store.complete(key, body, { status: 201, body: { messageId: 'msg-late' } });
    expect(await store.claim(key, body)).toEqual({
      status: 'replay', response: { status: 201, body: { messageId: 'msg-late' } },
    });
  });

  it('scopes keys by consumer, tribe, environment, and route', () => {
    const base = {
      namespace: 'email',
      route: 'POST /send',
      clientKey: 'same-client-idempotency-key',
      sourceServiceId: 'client-a',
      tribeId: 'tribe-a',
      environment: 'prod',
    };
    const key = createScopedIdempotencyKey(base);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(createScopedIdempotencyKey({ ...base, sourceServiceId: 'client-b' })).not.toBe(key);
    expect(createScopedIdempotencyKey({ ...base, tribeId: 'tribe-b' })).not.toBe(key);
    expect(createScopedIdempotencyKey({ ...base, environment: 'staging' })).not.toBe(key);
    expect(createScopedIdempotencyKey({ ...base, route: 'POST /other' })).not.toBe(key);
  });
});
