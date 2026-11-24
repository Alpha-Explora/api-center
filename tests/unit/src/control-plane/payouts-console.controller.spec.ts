import { PayoutsConsoleController, maskPayee } from '../../../../apps/gateway/src/domains/control-plane/payouts-console.controller';

jest.mock('../../../../apps/gateway/src/shared/proxy/cloud-run-auth', () => ({
  getCloudRunAuthorizationHeader: jest.fn().mockResolvedValue(undefined),
}));

describe('PayoutsConsoleController', () => {
  const organizationId = '9cb3f8a4-0a56-4c61-a087-6abd02a9e1f0';
  const params = { organizationId, projectId: 'prj_1', environment: 'test' };
  const req = { consoleActor: { kind: 'member', email: 'ops@example.test', subject: 's', platformAdmin: false } } as any;
  const saved = { token: process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST, url: process.env.APICENTER_PAYMENTS_URL };
  let access: { require: jest.Mock };
  let contexts: { sign: jest.Mock };
  let audit: { record: jest.Mock };
  let calls: Array<{ url: string; init: any }>;
  let reply: { status: number; body: unknown };

  function controller() {
    const instance = new PayoutsConsoleController(access as any, contexts as any, audit as any);
    instance.useFetch(async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
    });
    return instance;
  }

  beforeEach(() => {
    process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST = 'runtime-token';
    process.env.APICENTER_PAYMENTS_URL = 'https://payments.internal';
    access = { require: jest.fn().mockResolvedValue({}) };
    audit = { record: jest.fn().mockResolvedValue({}) };
    contexts = { sign: jest.fn().mockResolvedValue({ signedContext: 'signed.ctx', resourceOwner: { groupId: 'legacy-org', projectId: 'legacy-prj' },
      requestId: 'req-1' }) };
    calls = [];
    reply = { status: 200, body: { success: true, data: {} } };
  });

  afterAll(() => {
    if (saved.token === undefined) delete process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST; else process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST = saved.token;
    if (saved.url === undefined) delete process.env.APICENTER_PAYMENTS_URL; else process.env.APICENTER_PAYMENTS_URL = saved.url;
  });

  it('refuses a project the actor cannot read, before reaching the runtime', async () => {
    access.require.mockRejectedValue(Object.assign(new Error("Project 'prj_1' was not found"), { statusCode: 404 }));
    await expect(controller().overview(params, req)).rejects.toThrow('was not found');
    expect(contexts.sign).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('reads with environment.read and a payouts read context for the project owner', async () => {
    await controller().overview(params, req);
    expect(access.require).toHaveBeenCalledWith(req.consoleActor, organizationId, 'environment.read', { projectId: 'prj_1', environmentKind: 'test' });
    expect(contexts.sign).toHaveBeenCalledWith({ organizationId, projectId: 'prj_1', environmentKind: 'test', capability: 'payments',
      action: 'payments:payouts:read' });
    expect(calls[0].url).toBe('https://payments.internal/admin/payouts/overview');
    expect(calls[0].init.headers).toMatchObject({ authorization: 'Bearer runtime-token', 'x-apicenter-context': 'signed.ctx',
      'x-apicenter-owner-tribe-id': 'legacy-org', 'x-apicenter-project-id': 'legacy-prj', 'x-apicenter-consumer-service-id': 'console' });
  });

  it('lets only platform operators save settings or resolve a payout', async () => {
    await expect(controller().saveSettings(params, { immediate: true }, req)).rejects.toThrow('platform operators');
    await expect(controller().resolve({ ...params, payoutId: 'po_1' }, { outcome: 'paid', note: 'x' }, req)).rejects.toThrow('platform operators');
    expect(calls).toHaveLength(0);
  });

  it('needs environment.write to save settings or resolve a payout, and records who did it', async () => {
    const operator = { consoleActor: { ...req.consoleActor, platformAdmin: true } } as any;
    access.require.mockImplementation(async (_actor, _org, action) => {
      if (action === 'environment.write') throw Object.assign(new Error('Your role does not allow environment write'), { statusCode: 403 });
      return {};
    });
    await expect(controller().saveSettings(params, { immediate: true }, operator)).rejects.toThrow('does not allow');
    await expect(controller().resolve({ ...params, payoutId: 'po_1' }, { outcome: 'paid', note: 'x' }, operator)).rejects.toThrow('does not allow');
    expect(calls).toHaveLength(0);

    access.require.mockResolvedValue({});
    await controller().resolve({ ...params, payoutId: 'po_1' }, { outcome: 'paid', note: 'Found in the dashboard', actor: 'forged' }, operator);
    expect(calls[0].url).toBe('https://payments.internal/admin/payouts/po_1/resolve');
    expect(JSON.parse(calls[0].init.body)).toEqual({ outcome: 'paid', note: 'Found in the dashboard', actor: 'ops@example.test' });
    expect(contexts.sign).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'payments:payouts:write' }));
  });

  it('masks account numbers in payee lists and details', async () => {
    reply = { status: 200, body: { success: true, data: { records: [{ id: 'pye_1',
      destination: { type: 'instapay', bic: 'GXCHPHM2XXX', accountNumber: '09171234567', accountName: 'Juan' } }], nextCursor: 'c' } } };
    const page = await controller().payees(params, { limit: '10' }, req) as any;
    expect(calls[0].url).toBe('https://payments.internal/payouts/payees?limit=10');
    expect(page.data).toEqual({ nextCursor: 'c', records: [{ id: 'pye_1',
      destination: { type: 'instapay', bic: 'GXCHPHM2XXX', accountName: 'Juan', accountNumberLast4: '4567' } }] });
    expect(maskPayee({ id: 'pye_2', destination: null })).toEqual({ id: 'pye_2', destination: null });
  });

  it('passes the runtime error through with its status', async () => {
    reply = { status: 409, body: { success: false, error: { code: 'INVALID_PAYOUT_STATE', message: 'no' } } };
    const operator = { consoleActor: { ...req.consoleActor, platformAdmin: true } } as any;
    await expect(controller().resolve({ ...params, payoutId: 'po_1' }, { outcome: 'paid', note: 'x' }, operator))
      .rejects.toMatchObject({ status: 409, response: { error: { code: 'INVALID_PAYOUT_STATE' } } });
  });

  it('records linked-account mutations without forwarding personal details to audit', async () => {
    const details = { businessName: 'Test Merchant', tin: '111-111-111' };
    reply = { status: 200, body: { success: true, data: {
      id: 'lac_example', verification: { url: 'https://identity.example/session' },
    } } };
    await controller().startLinkedAccount(params, details, req);
    expect(access.require).toHaveBeenCalledWith(req.consoleActor, organizationId, 'environment.write',
      { projectId: 'prj_1', environmentKind: 'test' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      type: 'linked_account.onboarding_started', organizationId, projectId: 'prj_1', resourceId: 'lac_example',
    }));
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(/111-111-111|identity.example/);
    await expect(controller().setLinkedAccountEnabled(params, { enabled: true }, req)).rejects.toThrow('platform operators');
    await expect(controller().closeLinkedAccount(params, { id: 'lac_example' }, req)).rejects.toThrow('platform operators');
  });

  it('rejects malformed targets and filters', async () => {
    await expect(controller().overview({ ...params, environment: 'prod' }, req)).rejects.toThrow('environment');
    await expect(controller().payouts(params, { status: 'bogus' }, req)).rejects.toThrow('invalid');
    await expect(controller().payee({ ...params, payeeId: '../x' }, req)).rejects.toThrow('payeeId');
  });
});
