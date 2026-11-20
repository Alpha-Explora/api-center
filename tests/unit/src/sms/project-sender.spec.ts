import { createSmsSenderAdminHandler } from '../../../../apps/sms/src/shared/project-sender-admin';
import { isValidSmsSenderId, resolveSmsSender, SmsSenderNotApprovedError } from '../../../../apps/sms/src/shared/project-sender';
import { MemorySmsStore } from '../../../../apps/sms/src/shared/sms-store';

function call(handler: ReturnType<typeof createSmsSenderAdminHandler>, method: string, body?: unknown, token = 'sms-token') {
  const req = {
    method,
    header: (name: string) => (name === 'X-APICenter-Sms-Admin-Token' ? token : undefined),
    params: { projectId: 'prj_a', environment: 'test' },
    body,
  } as any;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
  return handler(req, res).then(() => res);
}

describe('SMS sender IDs', () => {
  it('accepts E.164 numbers and alphanumeric sender IDs only', () => {
    expect(isValidSmsSenderId('+639171234567')).toBe(true);
    expect(isValidSmsSenderId('Serbizio')).toBe(true);
    expect(isValidSmsSenderId('Shop 24')).toBe(true);
    expect(isValidSmsSenderId('123456')).toBe(false);
    expect(isValidSmsSenderId('TwelveLetter')).toBe(false);
    expect(isValidSmsSenderId('Shop-24')).toBe(false);
  });

  it('uses the pinned sender and refuses a request that names another', () => {
    expect(resolveSmsSender(undefined, null)).toBeUndefined();
    expect(resolveSmsSender(undefined, 'Serbizio')).toBe('Serbizio');
    expect(resolveSmsSender('Serbizio', 'Serbizio')).toBe('Serbizio');
    expect(() => resolveSmsSender('Other', 'Serbizio')).toThrow(SmsSenderNotApprovedError);
  });

  it('lets an unpinned project name only the platform sender, never a brand of its choosing', () => {
    expect(() => resolveSmsSender('BDO', null)).toThrow(SmsSenderNotApprovedError);
    expect(() => resolveSmsSender('BDO', null, '+15005550006')).toThrow(SmsSenderNotApprovedError);
    expect(resolveSmsSender('+15005550006', null, '+15005550006')).toBe('+15005550006');
  });
});

describe('SMS sender admin handler', () => {
  const handler = () => createSmsSenderAdminHandler({ store: new MemorySmsStore(), expectedToken: 'sms-token', platformSenderConfigured: true });

  it('pins, reads and clears a project sender', async () => {
    const admin = handler();
    const empty = await call(admin, 'GET');
    expect(empty.json).toHaveBeenCalledWith(expect.objectContaining({ configured: false, senderId: null, platformSenderConfigured: true }));

    const saved = await call(admin, 'PUT', { senderId: ' Serbizio ' });
    expect(saved.status).toHaveBeenCalledWith(200);
    expect(saved.json).toHaveBeenCalledWith(expect.objectContaining({ configured: true, senderId: 'Serbizio' }));
    expect((await call(admin, 'GET')).json).toHaveBeenCalledWith(expect.objectContaining({ senderId: 'Serbizio' }));

    const cleared = await call(admin, 'DELETE');
    expect(cleared.json).toHaveBeenCalledWith(expect.objectContaining({ configured: false, senderId: null }));
  });

  it('rejects a bad token and an invalid sender', async () => {
    const admin = handler();
    expect((await call(admin, 'GET', undefined, 'wrong')).status).toHaveBeenCalledWith(401);
    expect((await call(admin, 'PUT', { senderId: '12345' })).status).toHaveBeenCalledWith(400);
  });
});
