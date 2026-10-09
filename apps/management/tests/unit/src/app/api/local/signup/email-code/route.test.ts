import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/local/signup/email-code/route";

describe("POST /api/local/signup/email-code", () => {
  const originalApiCenterBaseUrl = process.env.API_CENTER_BASE_URL;
  const originalEmailServiceBaseUrl = process.env.EMAIL_SERVICE_BASE_URL;
  const originalSignupEmailEnvironment =
    process.env.SIGNUP_EMAIL_APICENTER_ENVIRONMENT;
  const originalSignupEmailSourceServiceId =
    process.env.SIGNUP_EMAIL_SOURCE_SERVICE_ID;
  const originalSignupEmailTribeId = process.env.SIGNUP_EMAIL_TRIBE_ID;
  const originalSignupEmailTribeSecret =
    process.env.SIGNUP_EMAIL_TRIBE_SECRET;
  const originalSignupEmailMaxSends =
    process.env.SIGNUP_EMAIL_MAX_SENDS_PER_WINDOW;
  const originalProductName = process.env.SIGNUP_EMAIL_PRODUCT_NAME;

  afterEach(() => {
    process.env.API_CENTER_BASE_URL = originalApiCenterBaseUrl;
    process.env.EMAIL_SERVICE_BASE_URL = originalEmailServiceBaseUrl;
    process.env.SIGNUP_EMAIL_APICENTER_ENVIRONMENT =
      originalSignupEmailEnvironment;
    process.env.SIGNUP_EMAIL_SOURCE_SERVICE_ID =
      originalSignupEmailSourceServiceId;
    process.env.SIGNUP_EMAIL_TRIBE_ID = originalSignupEmailTribeId;
    process.env.SIGNUP_EMAIL_TRIBE_SECRET = originalSignupEmailTribeSecret;
    process.env.SIGNUP_EMAIL_MAX_SENDS_PER_WINDOW =
      originalSignupEmailMaxSends;
    process.env.SIGNUP_EMAIL_PRODUCT_NAME = originalProductName;
    delete (globalThis as { __apicenterSignupEmailCodes?: unknown })
      .__apicenterSignupEmailCodes;
    delete (globalThis as { __apicenterSignupEmailRateLimits?: unknown })
      .__apicenterSignupEmailRateLimits;
    vi.restoreAllMocks();
  });

  it("sends the verification code through the APICenter email service", async () => {
    process.env.EMAIL_SERVICE_BASE_URL = "http://email-service:4012";
    process.env.SIGNUP_EMAIL_PRODUCT_NAME = "APICenter";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
    } as Response);

    const response = await POST(
      new Request("http://localhost/api/local/signup/email-code", {
        method: "POST",
        body: JSON.stringify({
          email: "T.Anthony.Playz@gmail.com",
          firstName: "Anthony",
          lastName: "Torres",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://email-service:4012/send",
      expect.objectContaining({
        method: "POST",
      }),
    );

    const [, requestInit] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(requestInit?.body));

    expect(body).toMatchObject({
      subject: "Verify your APICenter email address",
      to: "t.anthony.playz@gmail.com",
    });
    expect(body).not.toHaveProperty("templateId");
    expect(body.text).toContain("Enter this code in your open browser window");
    expect(body.metadata).toMatchObject({
      productName: "APICenter",
      purpose: "signup_email_verification",
    });
  });

  it("mints an APICenter token before sending through the shared email proxy", async () => {
    process.env.API_CENTER_BASE_URL = "https://api-center.example.test";
    process.env.EMAIL_SERVICE_BASE_URL =
      "https://api-center.example.test/api/v1/shared/email";
    process.env.SIGNUP_EMAIL_APICENTER_ENVIRONMENT = "live";
    process.env.SIGNUP_EMAIL_SOURCE_SERVICE_ID = "apicenter-management";
    process.env.SIGNUP_EMAIL_TRIBE_ID = "apicenter";
    process.env.SIGNUP_EMAIL_TRIBE_SECRET = "signup-service-secret";
    process.env.SIGNUP_EMAIL_PRODUCT_NAME = "APICenter";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              accessToken: "apicenter-token",
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const response = await POST(
      new Request("http://localhost/api/local/signup/email-code", {
        method: "POST",
        body: JSON.stringify({
          email: "person@example.com",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api-center.example.test/api/v1/auth/token",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          environment: "live",
          secret: "signup-service-secret",
          sourceServiceId: "apicenter-management",
          tribeId: "apicenter",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api-center.example.test/api/v1/shared/email/send",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer apicenter-token",
        }),
      }),
    );
  });

  it("requires signup token credentials when using the APICenter shared email proxy", async () => {
    process.env.API_CENTER_BASE_URL = "https://api-center.example.test";
    process.env.EMAIL_SERVICE_BASE_URL =
      "https://api-center.example.test/api/v1/shared/email";
    process.env.SIGNUP_EMAIL_TRIBE_ID = "";
    process.env.SIGNUP_EMAIL_SOURCE_SERVICE_ID = "";
    process.env.SIGNUP_EMAIL_TRIBE_SECRET = "";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 200,
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/local/signup/email-code", {
        method: "POST",
        body: JSON.stringify({
          email: "person@example.com",
        }),
      }),
    );

    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("Signup email credentials are missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("escapes profile fields before rendering verification email HTML", async () => {
    process.env.EMAIL_SERVICE_BASE_URL = "http://email-service:4012";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    const response = await POST(
      new Request("http://localhost/api/local/signup/email-code", {
        method: "POST",
        body: JSON.stringify({
          email: "person@example.com",
          firstName: "<img src=x onerror=alert(1)>",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const [, requestInit] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(requestInit?.body));

    expect(body.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(body.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("throttles repeated verification email sends for the same email", async () => {
    process.env.EMAIL_SERVICE_BASE_URL = "http://email-service:4012";
    process.env.SIGNUP_EMAIL_MAX_SENDS_PER_WINDOW = "2";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    const requestBody = JSON.stringify({
      email: "person@example.com",
    });

    const first = await POST(
      new Request("http://localhost/api/local/signup/email-code", {
        method: "POST",
        body: requestBody,
      }),
    );
    const second = await POST(
      new Request("http://localhost/api/local/signup/email-code", {
        method: "POST",
        body: requestBody,
      }),
    );
    const third = await POST(
      new Request("http://localhost/api/local/signup/email-code", {
        method: "POST",
        body: requestBody,
      }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns a human error when the email service rejects the request", async () => {
    process.env.EMAIL_SERVICE_BASE_URL = "http://email-service:4012";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
    } as Response);

    const response = await POST(
      new Request("http://localhost/api/local/signup/email-code", {
        method: "POST",
        body: JSON.stringify({
          email: "person@example.com",
        }),
      }),
    );

    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      success: false,
      error: "We could not send the email code. Try again in a moment.",
    });
  });
});
