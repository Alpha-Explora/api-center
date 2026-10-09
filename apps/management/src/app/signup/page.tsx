import type { Metadata } from "next";
import { ManagementAuthGate } from "@/components/management-auth-gate";

export const metadata: Metadata = {
  title: "Sign in | APICenter",
  description: "Sign in to APICenter with your organization Google account.",
};

export default function SignupPage() {
  const googleClientId =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";

  return (
    <ManagementAuthGate
      googleClientId={googleClientId}
      authenticatedRedirectHref="/dashboard"
    >
      <div />
    </ManagementAuthGate>
  );
}
