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
});
