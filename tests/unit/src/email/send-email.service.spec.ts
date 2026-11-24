import type { SharedServiceCaller } from "@apicenter/runtime";
import type { EmailSendRequest } from "@alpha-explora/apicenter-contracts";

const mockSend = jest.fn();
/** The email provider, behind APICenter's EmailSender interface. */
const sender = { provider: 'fake', configured: () => true, send: mockSend };
const EMAIL_ID = /^eml_[0-9a-hjkmnp-tv-z]{26}$/;

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
    model: "application",
  };

  beforeEach(() => {
    jest.resetModules();
    mockSend
      .mockReset()
      .mockResolvedValue({ providerMessageId: "provider-message-1" });
    process.env.RESEND_API_KEY = "test-resend-key";
    process.env.EMAIL_FROM_ADDRESS = "no-reply@example.test";
  });

  afterAll(() => {
    if (originalResendApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalResendApiKey;
    if (originalEmailFrom === undefined) delete process.env.EMAIL_FROM_ADDRESS;
    else process.env.EMAIL_FROM_ADDRESS = originalEmailFrom;
  });

  async function send(input: EmailSendRequest): Promise<void> {
    const { SendEmailService } =
      require("../../../../apps/email/src/features/send-email/send-email.service") as typeof import("../../../../apps/email/src/features/send-email/send-email.service");
    const store = {
      save: jest.fn(async (record) => record),
      findById: jest.fn(async () => null),
      getProjectSender: jest.fn(),
      setProjectSender: jest.fn(),
      applyDeliveryEvent: jest.fn(),
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
    await new SendEmailService(store, sender).execute(input, owner);
  }

  it("sends markup-like text only as the provider plain-text part", async () => {
    const text = '<script>alert("not HTML")</script> & <b>still text</b>';

    await send({ to: "user@example.test", subject: "Plain text", text });

    expect(mockSend).toHaveBeenCalledWith({
      from: "no-reply@example.test",
      to: ["user@example.test"],
      subject: "Plain text",
      text,
    });
    expect(mockSend.mock.calls[0][0]).not.toHaveProperty("html");
  });

  it("preserves both supplied HTML and plain-text provider parts", async () => {
    const html = "<strong>Hello</strong>";
    const text = "Hello";

    await send({ to: "user@example.test", subject: "Multipart", html, text });

    expect(mockSend).toHaveBeenCalledWith({
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
    const service = new SendEmailService(store, sender);

    await service.execute({ to: 'user@example.test', subject: 'Approved', text: 'Hello' }, owner);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ from: 'approved@example.test' }));
    await expect(service.execute({ from: 'other@example.test', to: 'user@example.test', subject: 'Rejected', text: 'Hello' }, owner))
      .rejects.toBeInstanceOf(SenderNotApprovedError);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('rejects sends after the project UTC-day limit is reached', async () => {
    const { MemoryEmailStore } = require('../../../../apps/email/src/shared/email-store') as typeof import('../../../../apps/email/src/shared/email-store');
    const { DailyLimitReachedError } = require('../../../../apps/email/src/shared/email-policy-errors') as typeof import('../../../../apps/email/src/shared/email-policy-errors');
    const store = new MemoryEmailStore();
    await store.setProjectSender({ projectId: owner.projectId, environment: owner.environment, fromAddress: 'approved@example.test', dailyLimit: 1 });
    const { SendEmailService } = require('../../../../apps/email/src/features/send-email/send-email.service') as typeof import('../../../../apps/email/src/features/send-email/send-email.service');
    const service = new SendEmailService(store, sender);

    await service.execute({ to: 'user@example.test', subject: 'First', text: 'Hello' }, owner);
    await expect(service.execute({ to: 'user@example.test', subject: 'Second', text: 'Hello' }, owner))
      .rejects.toBeInstanceOf(DailyLimitReachedError);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  async function memoryService(dailyLimit: number) {
    const { MemoryEmailStore } = require('../../../../apps/email/src/shared/email-store') as typeof import('../../../../apps/email/src/shared/email-store');
    const store = new MemoryEmailStore();
    await store.setProjectSender({ projectId: owner.projectId, environment: owner.environment, fromAddress: 'approved@example.test', dailyLimit });
    const { SendEmailService } = require('../../../../apps/email/src/features/send-email/send-email.service') as typeof import('../../../../apps/email/src/features/send-email/send-email.service');
    return { store, service: new SendEmailService(store, sender) };
  }

  it('lets exactly one of two concurrent sends through a daily limit of one', async () => {
    const { service } = await memoryService(1);
    const { DailyLimitReachedError } = require('../../../../apps/email/src/shared/email-policy-errors') as typeof import('../../../../apps/email/src/shared/email-policy-errors');
    mockSend.mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve({ providerMessageId: 're_concurrent' }), 20);
    }));

    const outcomes = await Promise.allSettled([
      service.execute({ to: 'user@example.test', subject: 'First', text: 'Hello' }, owner),
      service.execute({ to: 'user@example.test', subject: 'Second', text: 'Hello' }, owner),
    ]);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(outcomes[0]).toMatchObject({ status: 'fulfilled', value: { messageId: expect.stringMatching(EMAIL_ID), status: 'queued' } });
    expect(outcomes[1].status).toBe('rejected');
    expect((outcomes[1] as PromiseRejectedResult).reason).toBeInstanceOf(DailyLimitReachedError);
  });

  it('does not hold the project lock while the provider sends', async () => {
    const { service } = await memoryService(2);
    let finishFirst!: (value: unknown) => void;
    const firstResult = new Promise((resolve) => { finishFirst = resolve; });
    mockSend
      .mockReturnValueOnce(firstResult)
      .mockResolvedValueOnce({ providerMessageId: 're_fast' });

    const first = service.execute({ to: 'user@example.test', subject: 'Slow', text: 'Hello' }, owner);
    const second = service.execute({ to: 'user@example.test', subject: 'Fast', text: 'Hello' }, owner);
    let secondFinishedFirst: boolean;
    try {
      secondFinishedFirst = await settlesWithin(second, 500);
    } finally {
      finishFirst({ providerMessageId: 're_slow' });
      await Promise.allSettled([first, second]);
    }

    expect(secondFinishedFirst).toBe(true);
    await expect(second).resolves.toMatchObject({ messageId: expect.stringMatching(EMAIL_ID), status: 'queued' });
    await expect(first).resolves.toMatchObject({ messageId: expect.stringMatching(EMAIL_ID), status: 'queued' });
  });

  it('marks a failed provider send failed without using up the daily limit', async () => {
    const { store, service } = await memoryService(1);
    mockSend.mockRejectedValueOnce(new Error('provider down'));

    await expect(service.execute({ to: 'user@example.test', subject: 'Fails', text: 'Hello' }, owner))
      .rejects.toThrow('provider down');
    const records = [...(store as unknown as { store: Map<string, { record: { status: string } }> }).store.values()];
    expect(records.map(({ record }) => record.status)).toEqual(['failed']);

    await expect(service.execute({ to: 'user@example.test', subject: 'Retry', text: 'Hello' }, owner))
      .resolves.toMatchObject({ messageId: expect.stringMatching(EMAIL_ID), status: 'queued' });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
