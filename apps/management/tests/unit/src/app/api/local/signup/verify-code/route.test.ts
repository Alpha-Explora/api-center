import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as sendCode } from "@/app/api/local/signup/email-code/route";
import { POST as verifyCode } from "@/app/api/local/signup/verify-code/route";

describe("POST /api/local/signup/verify-code", () => {
  const originalEmailServiceBaseUrl = process.env.EMAIL_SERVICE_BASE_URL;

  afterEach(() => {
    process.env.EMAIL_SERVICE_BASE_URL = originalEmailServiceBaseUrl;
    delete (globalThis as { __apicenterSignupEmailCodes?: unknown })
      .__apicenterSignupEmailCodes;
    delete (globalThis as { __apicenterSignupEmailRateLimits?: unknown })
      .__apicenterSignupEmailRateLimits;
    vi.restoreAllMocks();
  });

  it("accepts the latest code once and rejects replay", async () => {
    process.env.EMAIL_SERVICE_BASE_URL = "http://email-service:4012";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await sendCode(
      new Request("http://localhost/api/local/signup/email-code", {
        method: "POST",
        body: JSON.stringify({
          email: "Person@Example.com",
        }),
      }),
    );

    const [, requestInit] = fetchMock.mock.calls[0];
    const emailBody = JSON.parse(String(requestInit?.body));
    const code = /browser window: (\d{6})/.exec(emailBody.text)?.[1];

    expect(code).toMatch(/^\d{6}$/);

    const accepted = await verifyCode(
      new Request("http://localhost/api/local/signup/verify-code", {
        method: "POST",
        body: JSON.stringify({
          code,
          email: "person@example.com",
        }),
      }),
    );
    const replayed = await verifyCode(
      new Request("http://localhost/api/local/signup/verify-code", {
        method: "POST",
        body: JSON.stringify({
          code,
          email: "person@example.com",
        }),
      }),
    );

    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      success: true,
      data: {
        email: "person@example.com",
        verified: true,
      },
    });
    expect(replayed.status).toBe(400);
  });

  it("returns a human error for the wrong code", async () => {
    process.env.EMAIL_SERVICE_BASE_URL = "http://email-service:4012";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );

    await sendCode(
      new Request("http://localhost/api/local/signup/email-code", {
        method: "POST",
        body: JSON.stringify({
          email: "person@example.com",
        }),
      }),
    );

    const response = await verifyCode(
      new Request("http://localhost/api/local/signup/verify-code", {
        method: "POST",
        body: JSON.stringify({
          code: "000000",
          email: "person@example.com",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: "That code is not right. Check the email and try again.",
    });
  });
});
