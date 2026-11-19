import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ManagementSessionCard } from "@/components/management-session-card";
import { PageHeading } from "@/components/page-heading";
import { PlatformAdminOnly } from "@/components/platform-admin-only";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getManagementEnvironment } from "@/lib/management-environment";

export default function SettingsPage() {
  const managementEnvironment = getManagementEnvironment();
  const apiCenterBaseUrl =
    process.env.API_CENTER_BASE_URL ?? "https://api.apicenter.itsandbox.site";
  const publicApiCenterBaseUrl =
    process.env.NEXT_PUBLIC_API_CENTER_BASE_URL ??
    "https://api.apicenter.itsandbox.site";
  const googleCloudProject =
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCP_PROJECT_ID ??
    process.env.API_CENTER_GCP_PROJECT_ID ??
    process.env.GCLOUD_PROJECT ??
    "";
  const hasPlatformSecret = Boolean(process.env.API_CENTER_PLATFORM_ADMIN_SECRET);

  return (
    <PlatformAdminOnly>
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeading
        title="Settings"
        description="The gateway this console talks to and how it is configured."
      />

      <ManagementSessionCard />

      <Card>
        <CardHeader>
          <CardTitle>API Center endpoint</CardTitle>
          <CardDescription>
            The console server calls the gateway admin routes at this address.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <SettingDetail label="Environment">
            <Badge
              variant={
                managementEnvironment.isLive ? "destructive" : "secondary"
              }
            >
              {managementEnvironment.label}
            </Badge>
          </SettingDetail>
          <SettingDetail label="Platform secret">
            {hasPlatformSecret ? "configured" : "missing"}
          </SettingDetail>
          <SettingDetail label="Server API Center URL">
            {apiCenterBaseUrl}
          </SettingDetail>
          <SettingDetail label="Browser API Center URL">
            {publicApiCenterBaseUrl}
          </SettingDetail>
          <SettingDetail label="GCP project">
            {googleCloudProject || "not configured"}
          </SettingDetail>
        </CardContent>
      </Card>


      <Alert>
        <AlertTitle>Secrets policy</AlertTitle>
        <AlertDescription>
          Do not put platform admin secrets, Google OAuth client secrets,
          PayMongo keys, Resend keys, or database URLs in
          browser-exposed variables. The platform admin secret belongs only as a
          server environment variable named `API_CENTER_PLATFORM_ADMIN_SECRET`.
        </AlertDescription>
      </Alert>

    </div>
    </PlatformAdminOnly>
  );
}

function SettingDetail({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all font-mono text-[13px] font-medium leading-5">
        {children}
      </span>
    </div>
  );
}
