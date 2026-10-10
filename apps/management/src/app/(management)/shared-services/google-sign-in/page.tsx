import { PageHeading } from "@/components/page-heading";
import { GoogleSignInSettingsClient } from "@/components/google-sign-in-settings-client";

export default function GoogleSignInPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Google sign-in"
        description="Manage Google sign-in settings for each project and environment."
      />
      <GoogleSignInSettingsClient />
    </div>
  );
}
