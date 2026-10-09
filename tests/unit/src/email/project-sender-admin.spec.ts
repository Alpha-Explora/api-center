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
    const req = { header: () => 'wrong-token', params: { projectId: 'project-a', environment: 'live' }, body: {} } as any;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(setProjectSender).not.toHaveBeenCalled();
  });
});
