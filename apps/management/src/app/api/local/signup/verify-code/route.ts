import { NextResponse } from "next/server";
import { z } from "zod";
import {
  normalizeSignupEmail,
  verifySignupEmailCode,
} from "@/lib/server/signup-email-codes";

const signupVerifyCodeRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  email: z.string().email(),
});

export async function POST(request: Request) {
  const parsed = signupVerifyCodeRequestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Enter the six-digit code from your email.",
      },
      { status: 400 },
    );
  }

  const email = normalizeSignupEmail(parsed.data.email);
  const verification = verifySignupEmailCode({
    code: parsed.data.code,
    email,
  });

  if (!verification.ok) {
    return NextResponse.json(
      {
        success: false,
        error:
          verification.reason === "expired"
            ? "That code expired. Send a new one and try again."
            : "That code is not right. Check the email and try again.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      email: verification.email,
      verified: true,
    },
  });
}
