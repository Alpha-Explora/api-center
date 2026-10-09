import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  checkSignupEmailSendLimit,
  deleteSignupEmailCode,
  normalizeSignupEmail,
  storeSignupEmailCode,
} from "@/lib/server/signup-email-codes";

const signupEmailCodeRequestSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

type TribeTokenResponse = {
  success: boolean;
  data?: {
    accessToken?: string;
  };
};

class SignupEmailConfigurationError extends Error {}

export async function POST(request: Request) {
  const parsed = signupEmailCodeRequestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Use a valid email address before sending a verification code.",
      },
      { status: 400 },
    );
  }

  const email = normalizeSignupEmail(parsed.data.email);
  const sendLimit = checkSignupEmailSendLimit({ email });

  if (!sendLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: "Too many codes were sent. Wait a bit, then try again.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(sendLimit.retryAfterSeconds),
        },
      },
    );
  }

  const displayName = [parsed.data.firstName, parsed.data.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");

  storeSignupEmailCode({
    code,
    email,
  });

  try {
    await sendSignupVerificationEmail({ code, displayName, email });
  } catch (error) {
    deleteSignupEmailCode(email);

    if (error instanceof SignupEmailConfigurationError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "We could not send the email code. Try again in a moment.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      expiresInSeconds: 600,
      sentTo: email,
    },
  });
}

async function sendSignupVerificationEmail({
  code,
  displayName,
  email,
}: {
  code: string;
  displayName: string;
  email: string;
}) {
  const emailServiceBaseUrl = process.env.EMAIL_SERVICE_BASE_URL?.trim();
  const productName = process.env.SIGNUP_EMAIL_PRODUCT_NAME?.trim() || "APICenter";

  if (!emailServiceBaseUrl) {
    console.info(
      `[signup-email-code] Verification code for ${email}: ${code}`,
    );
    return;
  }

  const subject = `Verify your ${productName} email address`;
  const greeting = displayName ? `Hi ${displayName},` : "Hi,";
  const htmlGreeting = escapeHtml(greeting);
  const htmlEmail = escapeHtml(email);
  const text = [
    `Verify your email for ${productName}`,
    "",
    greeting,
    "",
    `We need to verify your email address ${email} before you can access your account.`,
    `Enter this code in your open browser window: ${code}`,
    "",
    "This code expires in 10 minutes.",
    "",
    `If you didn't sign up for ${productName}, you can safely ignore this email.`,
  ].join("\n");
  const html = [
    '<div style="font-family:Inter,Arial,sans-serif;color:#111827;line-height:1.55">',
    `<h1 style="font-size:24px;line-height:1.2;margin:0 0 16px">Verify your email</h1>`,
    `<p>${htmlGreeting}</p>`,
    `<p>We need to verify your email address <a href="mailto:${encodeURIComponent(email)}">${htmlEmail}</a> before you can access your account. Enter this code in your open browser window.</p>`,
    `<p style="font-size:28px;letter-spacing:0.12em;margin:24px 0">${code}</p>`,
    '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />',
    '<p style="font-size:13px;color:#4b5563">This code expires in 10 minutes.</p>',
    `<p style="font-size:13px;color:#4b5563">If you didn't sign up for ${productName}, you can safely ignore this email.</p>`,
    "</div>",
  ].join("");

  const authorization = await getSignupEmailAuthorizationHeader(emailServiceBaseUrl);
  const response = await fetch(`${emailServiceBaseUrl.replace(/\/$/, "")}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `signup-email-code:${email}:${code}`,
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({
      html,
      metadata: {
        productName,
        purpose: "signup_email_verification",
      },
      subject,
      to: email,
      text,
    }),
  });

  if (!response.ok) {
    throw new Error("Email service rejected the verification email request.");
  }
}

async function getSignupEmailAuthorizationHeader(emailServiceBaseUrl: string) {
  if (!isApiCenterSharedProxyUrl(emailServiceBaseUrl)) {
    return null;
  }

  const tribeId = process.env.SIGNUP_EMAIL_TRIBE_ID?.trim();
  const sourceServiceId = process.env.SIGNUP_EMAIL_SOURCE_SERVICE_ID?.trim();
  const secret = process.env.SIGNUP_EMAIL_TRIBE_SECRET?.trim();

  if (!tribeId || !sourceServiceId || !secret) {
    throw new SignupEmailConfigurationError(
      "Signup email credentials are missing. Set SIGNUP_EMAIL_TRIBE_ID, SIGNUP_EMAIL_SOURCE_SERVICE_ID, and SIGNUP_EMAIL_TRIBE_SECRET.",
    );
  }

  const environment =
    process.env.SIGNUP_EMAIL_APICENTER_ENVIRONMENT?.trim() || "live";
  const apiCenterBaseUrl =
    process.env.API_CENTER_BASE_URL?.trim() ||
    inferApiCenterBaseUrl(emailServiceBaseUrl);

  const tokenResponse = await fetch(
    `${apiCenterBaseUrl.replace(/\/$/, "")}/api/v1/auth/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        environment,
        secret,
        sourceServiceId,
        tribeId,
      }),
    },
  );

  if (!tokenResponse.ok) {
    throw new Error("API Center rejected the signup email token request.");
  }

  const tokenBody = (await tokenResponse.json()) as TribeTokenResponse;
  const accessToken = tokenBody.data?.accessToken;

  if (!accessToken) {
    throw new Error("API Center did not return a signup email access token.");
  }

  return `Bearer ${accessToken}`;
}

function inferApiCenterBaseUrl(emailServiceBaseUrl: string) {
  const sharedPathIndex = emailServiceBaseUrl.indexOf("/api/v1/shared/");

  if (sharedPathIndex >= 0) {
    return emailServiceBaseUrl.slice(0, sharedPathIndex);
  }

  return "https://api-center.itsandbox.site";
}

function isApiCenterSharedProxyUrl(emailServiceBaseUrl: string) {
  return emailServiceBaseUrl.includes("/api/v1/shared/");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
