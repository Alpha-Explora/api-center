import { createProjectSenderAdminHandler } from '../../../../apps/email/src/shared/project-sender-admin';
import type { EmailRepositoryInterface } from '../../../../apps/email/src/shared/email-repository.interface';

describe('project email sender admin handler', () => {
  it('requires the configured internal token and saves the sender policy', async () => {
    const setProjectSender = jest.fn(async (sender) => sender);
    const handler = createProjectSenderAdminHandler({
      store: { setProjectSender } as unknown as EmailRepositoryInterface,
      expectedToken: 'secret-token',
    });
    const req = {
      method: 'PUT',
      header: (name: string) => name === 'X-APICenter-Email-Admin-Token' ? 'secret-token' : undefined,
      params: { projectId: 'project-a', environment: 'test' },
      body: { fromAddress: 'mail@example.test', dailyLimit: 25 },
    } as any;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;

    await handler(req, res);

    expect(setProjectSender).toHaveBeenCalledWith({
      projectId: 'project-a', environment: 'test', fromAddress: 'mail@example.test', dailyLimit: 25,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects missing or invalid tokens before touching storage', async () => {
    const setProjectSender = jest.fn();
    const handler = createProjectSenderAdminHandler({
      store: { setProjectSender } as unknown as EmailRepositoryInterface,
      expectedToken: 'secret-token',
    });
    const req = { method: 'PUT', header: () => 'wrong-token', params: { projectId: 'project-a', environment: 'live' }, body: {} } as any;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(setProjectSender).not.toHaveBeenCalled();
  });

  it('reads the saved sender with the platform defaults', async () => {
    const getProjectSender = jest.fn(async () => ({
      projectId: 'project-a', environment: 'live', fromAddress: 'mail@example.test', dailyLimit: null,
    }));
    const handler = createProjectSenderAdminHandler({
      store: { getProjectSender } as unknown as EmailRepositoryInterface,
      expectedToken: 'secret-token',
      defaults: { fromAddress: 'no-reply@apicenter.test', dailyLimit: 500 },
    });
    const req = { method: 'GET', header: () => 'secret-token', params: { projectId: 'project-a', environment: 'live' } } as any;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;

    await handler(req, res);

    expect(getProjectSender).toHaveBeenCalledWith('project-a', 'live');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      projectId: 'project-a', environment: 'live', configured: true, fromAddress: 'mail@example.test', dailyLimit: null,
      defaults: { fromAddress: 'no-reply@apicenter.test', dailyLimit: 500 },
    });
  });

  it('reports an unconfigured project as not configured', async () => {
    const handler = createProjectSenderAdminHandler({
      store: { getProjectSender: jest.fn(async () => null) } as unknown as EmailRepositoryInterface,
      expectedToken: 'secret-token',
    });
    const req = { method: 'GET', header: () => 'secret-token', params: { projectId: 'project-a', environment: 'test' } } as any;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ configured: false, fromAddress: null, dailyLimit: null }));
  });
});
