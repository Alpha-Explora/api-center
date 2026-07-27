import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DeploymentRestartCard } from "@/components/deployment-restart-card";
import { ManagementSessionCard } from "@/components/management-session-card";
import { PageHeading } from "@/components/page-heading";
import { SharedServiceProviderConfigHealthPanel } from "@/components/secret-health-panel";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getKafkaTopicPrefix,
  getManagementEnvironment,
} from "@/lib/management-environment";

export default function SettingsPage() {
  const managementEnvironment = getManagementEnvironment();
  const apiCenterBaseUrl =
    process.env.API_CENTER_BASE_URL ?? "https://api-center.itsandbox.site";
  const publicApiCenterBaseUrl =
    process.env.NEXT_PUBLIC_API_CENTER_BASE_URL ??
    "https://api-center.itsandbox.site";
  const kafkaTopicPrefix = getKafkaTopicPrefix();
  const googleCloudProject =
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCP_PROJECT_ID ??
    process.env.API_CENTER_GCP_PROJECT_ID ??
    process.env.GCLOUD_PROJECT ??
    "";
  const hasPlatformSecret = Boolean(process.env.API_CENTER_PLATFORM_ADMIN_SECRET);
  const restartEnabled = process.env.ALLOW_DEPLOYMENT_RESTARTS === "true";
  const namespace = process.env.K8S_NAMESPACE ?? "api-center";
  const deployment = process.env.K8S_API_CENTER_DEPLOYMENT ?? "api-center";

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeading
        title="Settings"
        description="Runtime config and deployment readiness checks."
      />

      <ManagementSessionCard
        environment={managementEnvironment.isLive ? "live" : "test"}
      />

      <Card>
        <CardHeader>
          <CardTitle>API Center endpoint</CardTitle>
          <CardDescription>
            Local server route handlers proxy registry calls to this endpoint.
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
          <SettingDetail label="Kafka topic prefix">
            {kafkaTopicPrefix || "none"}
          </SettingDetail>
          <SettingDetail label="GCP project">
            {googleCloudProject || "not configured"}
          </SettingDetail>
        </CardContent>
      </Card>

      <DeploymentRestartCard
        enabled={restartEnabled}
        namespace={namespace}
        deployment={deployment}
      />

      <SharedServiceProviderConfigHealthPanel />

      <Alert>
        <AlertTitle>Secrets policy</AlertTitle>
        <AlertDescription>
          Do not put platform admin secrets, Google OAuth client secrets,
          PayMongo keys, Resend keys, Kafka credentials, or Redis URLs in
          browser-exposed variables. The platform admin secret belongs only as a
          server environment variable named `API_CENTER_PLATFORM_ADMIN_SECRET`.
        </AlertDescription>
      </Alert>

      <Alert>
        <AlertTitle>Tribe token mode</AlertTitle>
        <AlertDescription>
          Tribe M2M tokens are issued by API Center in internal JWT mode. Google
          sign-in is used only for human management-console identity. Do not
          create one OAuth app per tribe; tenant-branded auth belongs in the
          gauth shared-service workflow.
        </AlertDescription>
      </Alert>
    </div>
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
