import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { Notice } from "@/components/patterns/notices";
import { DescriptionList, Panel } from "@/components/patterns/panel";
import { PlatformSection } from "@/components/platform-admin-only";
import { AccountPanel } from "@/components/account-panel";
import { OrganizationSettingsPanel } from "@/features/control-plane/views/settings/organization-settings-panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { getManagementEnvironment } from "@/lib/management-environment";
import { PayoutPausePanel, PlatformOperatorsPanel } from "@/features/control-plane/views/settings/payout-controls";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  const managementEnvironment = getManagementEnvironment();
  const apiCenterBaseUrl = process.env.API_CENTER_BASE_URL ?? "https://api.apicenter.itsandbox.site";
  const publicApiCenterBaseUrl = process.env.NEXT_PUBLIC_API_CENTER_BASE_URL ?? "https://api.apicenter.itsandbox.site";
  const googleCloudProject =
    process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT_ID ?? process.env.API_CENTER_GCP_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? "";
  const hasPlatformSecret = Boolean(process.env.API_CENTER_PLATFORM_ADMIN_SECRET);

  return (
    <>
      <PageHeader title="Settings" description="Your account, this organization and, for platform operators, how this deployment is configured." />
      <AccountPanel />
      <OrganizationSettingsPanel />
      <PlatformSection>
      <h2 className="mt-2 text-sm font-semibold">Platform</h2>
      <PayoutPausePanel />
      <PlatformOperatorsPanel />
      <Panel title="Gateway" description="The console server calls the gateway's admin routes at this address.">
        <DescriptionList
          items={[
            {
              label: "Console deployment",
              value: <StatusBadge tone={managementEnvironment.isLive ? "danger" : "neutral"}>{managementEnvironment.label}</StatusBadge>,
            },
            {
              label: "Platform credential",
              value: <StatusBadge tone={hasPlatformSecret ? "success" : "danger"}>{hasPlatformSecret ? "Configured" : "Missing"}</StatusBadge>,
            },
            { label: "Server gateway URL", value: <span className="font-mono text-xs">{apiCenterBaseUrl}</span> },
            { label: "Browser gateway URL", value: <span className="font-mono text-xs">{publicApiCenterBaseUrl}</span> },
            { label: "Google Cloud project", value: <span className="font-mono text-xs">{googleCloudProject || "Not configured"}</span> },
          ]}
        />
      </Panel>
      <Notice title="Keep secrets server-side">
        Never put the platform credential, OAuth client secrets, PayMongo or Resend keys, or database URLs in <code className="font-mono">NEXT_PUBLIC_</code>{" "}
        variables. The platform credential belongs only in the server variable <code className="font-mono">API_CENTER_PLATFORM_ADMIN_SECRET</code>.
      </Notice>
      </PlatformSection>
    </>
  );
}
