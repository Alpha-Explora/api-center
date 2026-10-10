import type { SharedServiceCaller } from "@apicenter/runtime";
import type { EmailSendRequest } from "@apicenter/contracts";

const mockResendSend = jest.fn();

/** Resolves true if the promise settles within the time limit, false if it is still pending. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true, () => true), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

describe("SendEmailService provider payload", () => {
  const originalResendApiKey = process.env.RESEND_API_KEY;
  const originalEmailFrom = process.env.EMAIL_FROM_ADDRESS;
  const owner: SharedServiceCaller = {
    tribeId: "tribe-a",
    projectId: "project-a",
    serviceId: "service-a",
    environment: "test",
  };

  beforeEach(() => {
    jest.resetModules();
    mockResendSend
      .mockReset()
      .mockResolvedValue({ data: { id: "provider-message-1" }, error: null });
    process.env.RESEND_API_KEY = "test-resend-key";
    process.env.EMAIL_FROM_ADDRESS = "no-reply@example.test";
    jest.doMock("resend", () => ({
      Resend: jest.fn(() => ({ emails: { send: mockResendSend } })),
    }));
  });

  afterAll(() => {
    if (originalResendApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalResendApiKey;
    if (originalEmailFrom === undefined) delete process.env.EMAIL_FROM_ADDRESS;
    else process.env.EMAIL_FROM_ADDRESS = originalEmailFrom;
    jest.dontMock("resend");
  });

  async function send(input: EmailSendRequest): Promise<void> {
    const { SendEmailService } =
      require("../../../../apps/email/src/features/send-email/send-email.service") as typeof import("../../../../apps/email/src/features/send-email/send-email.service");
    const store = {
      save: jest.fn(async (record) => record),
      findById: jest.fn(async () => null),
      setProjectSender: jest.fn(),
      sendWithinDailyLimit: jest.fn(async (
        _owner: SharedServiceCaller,
        message: { defaultFrom: string; provider: string; recipients: string[] },
        send: (fromAddress: string) => Promise<string | undefined>,
      ) => {
        const messageId = (await send(message.defaultFrom)) ?? "msg_local";
        const sentAt = new Date().toISOString();
        return {
          messageId,
          provider: message.provider,
          status: "queued",
          recipient: message.recipients,
          recipientCount: message.recipients.length,
          sentAt,
          createdAt: sentAt,
        };
      }),
    };
    await new SendEmailService(store).execute(input, owner);
  }

  it("sends markup-like text only as the provider plain-text part", async () => {
    const text = '<script>alert("not HTML")</script> & <b>still text</b>';

    await send({ to: "user@example.test", subject: "Plain text", text });

    expect(mockResendSend).toHaveBeenCalledWith({
      from: "no-reply@example.test",
      to: ["user@example.test"],
      subject: "Plain text",
      text,
    });
    expect(mockResendSend.mock.calls[0][0]).not.toHaveProperty("html");
  });

  it("preserves both supplied HTML and plain-text provider parts", async () => {
    const html = "<strong>Hello</strong>";
    const text = "Hello";

    await send({ to: "user@example.test", subject: "Multipart", html, text });

    expect(mockResendSend).toHaveBeenCalledWith({
      from: "no-reply@example.test",
      to: ["user@example.test"],
      subject: "Multipart",
      html,
      text,
    });
  });

  it('uses the project approved sender and rejects a different requested sender', async () => {
    const { MemoryEmailStore } = require('../../../../apps/email/src/shared/email-store') as typeof import('../../../../apps/email/src/shared/email-store');
    const { SenderNotApprovedError } = require('../../../../apps/email/src/shared/email-policy-errors') as typeof import('../../../../apps/email/src/shared/email-policy-errors');
    const store = new MemoryEmailStore();
    await store.setProjectSender({ projectId: owner.projectId, environment: owner.environment, fromAddress: 'approved@example.test', dailyLimit: 3 });
    const { SendEmailService } = require('../../../../apps/email/src/features/send-email/send-email.service') as typeof import('../../../../apps/email/src/features/send-email/send-email.service');
    const service = new SendEmailService(store);

    await service.execute({ to: 'user@example.test', subject: 'Approved', text: 'Hello' }, owner);
    expect(mockResendSend).toHaveBeenCalledWith(expect.objectContaining({ from: 'approved@example.test' }));
    await expect(service.execute({ from: 'other@example.test', to: 'user@example.test', subject: 'Rejected', text: 'Hello' }, owner))
      .rejects.toBeInstanceOf(SenderNotApprovedError);
    expect(mockResendSend).toHaveBeenCalledTimes(1);
  });

  it('rejects sends after the project UTC-day limit is reached', async () => {
    const { MemoryEmailStore } = require('../../../../apps/email/src/shared/email-store') as typeof import('../../../../apps/email/src/shared/email-store');
    const { DailyLimitReachedError } = require('../../../../apps/email/src/shared/email-policy-errors') as typeof import('../../../../apps/email/src/shared/email-policy-errors');
    const store = new MemoryEmailStore();
    await store.setProjectSender({ projectId: owner.projectId, environment: owner.environment, fromAddress: 'approved@example.test', dailyLimit: 1 });
    const { SendEmailService } = require('../../../../apps/email/src/features/send-email/send-email.service') as typeof import('../../../../apps/email/src/features/send-email/send-email.service');
    const service = new SendEmailService(store);

    await service.execute({ to: 'user@example.test', subject: 'First', text: 'Hello' }, owner);
    await expect(service.execute({ to: 'user@example.test', subject: 'Second', text: 'Hello' }, owner))
      .rejects.toBeInstanceOf(DailyLimitReachedError);
    expect(mockResendSend).toHaveBeenCalledTimes(1);
  });

  async function memoryService(dailyLimit: number) {
    const { MemoryEmailStore } = require('../../../../apps/email/src/shared/email-store') as typeof import('../../../../apps/email/src/shared/email-store');
    const store = new MemoryEmailStore();
    await store.setProjectSender({ projectId: owner.projectId, environment: owner.environment, fromAddress: 'approved@example.test', dailyLimit });
    const { SendEmailService } = require('../../../../apps/email/src/features/send-email/send-email.service') as typeof import('../../../../apps/email/src/features/send-email/send-email.service');
    return { store, service: new SendEmailService(store) };
  }

  it('lets exactly one of two concurrent sends through a daily limit of one', async () => {
    const { service } = await memoryService(1);
    const { DailyLimitReachedError } = require('../../../../apps/email/src/shared/email-policy-errors') as typeof import('../../../../apps/email/src/shared/email-policy-errors');
    mockResendSend.mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve({ data: { id: 're_concurrent' }, error: null }), 20);
    }));

    const outcomes = await Promise.allSettled([
      service.execute({ to: 'user@example.test', subject: 'First', text: 'Hello' }, owner),
      service.execute({ to: 'user@example.test', subject: 'Second', text: 'Hello' }, owner),
    ]);

    expect(mockResendSend).toHaveBeenCalledTimes(1);
    expect(outcomes[0]).toMatchObject({ status: 'fulfilled', value: { messageId: 're_concurrent', status: 'queued' } });
    expect(outcomes[1].status).toBe('rejected');
    expect((outcomes[1] as PromiseRejectedResult).reason).toBeInstanceOf(DailyLimitReachedError);
  });

  it('does not hold the project lock while the provider sends', async () => {
    const { service } = await memoryService(2);
    let finishFirst!: (value: unknown) => void;
    const firstResult = new Promise((resolve) => { finishFirst = resolve; });
    mockResendSend
      .mockReturnValueOnce(firstResult)
      .mockResolvedValueOnce({ data: { id: 're_fast' }, error: null });

    const first = service.execute({ to: 'user@example.test', subject: 'Slow', text: 'Hello' }, owner);
    const second = service.execute({ to: 'user@example.test', subject: 'Fast', text: 'Hello' }, owner);
    let secondFinishedFirst: boolean;
    try {
      secondFinishedFirst = await settlesWithin(second, 500);
    } finally {
      finishFirst({ data: { id: 're_slow' }, error: null });
      await Promise.allSettled([first, second]);
    }

    expect(secondFinishedFirst).toBe(true);
    await expect(second).resolves.toMatchObject({ messageId: 're_fast', status: 'queued' });
    await expect(first).resolves.toMatchObject({ messageId: 're_slow', status: 'queued' });
  });

  it('marks a failed provider send failed without using up the daily limit', async () => {
    const { store, service } = await memoryService(1);
    mockResendSend.mockResolvedValueOnce({ data: null, error: { message: 'provider down' } });

    await expect(service.execute({ to: 'user@example.test', subject: 'Fails', text: 'Hello' }, owner))
      .rejects.toThrow('provider down');
    const records = [...(store as unknown as { store: Map<string, { record: { status: string } }> }).store.values()];
    expect(records.map(({ record }) => record.status)).toEqual(['failed']);

    await expect(service.execute({ to: 'user@example.test', subject: 'Retry', text: 'Hello' }, owner))
      .resolves.toMatchObject({ messageId: 'provider-message-1', status: 'queued' });
    expect(mockResendSend).toHaveBeenCalledTimes(2);
  });
});
