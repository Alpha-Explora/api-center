import type { SharedServiceCaller } from "@apicenter/runtime";
import type { EmailSendRequest } from "@apicenter/contracts";

const mockResendSend = jest.fn();

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
        _requestedFrom: string | undefined,
        defaultFrom: string,
        _limit: number,
        send: (fromAddress: string) => Promise<any>,
      ) => send(defaultFrom)),
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
});
