import { AppShell } from "@/components/app-shell";
import { DeployedLocalDevBlocker } from "@/components/deployed-local-dev-blocker";
import { Providers } from "@/app/providers";
import { getManagementEnvironment } from "@/lib/management-environment";
import { getDeploymentConfigCheck } from "@/lib/server/deployment-config";

export default function ManagementLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const managementEnvironment = getManagementEnvironment();
  const deployment = getDeploymentConfigCheck();
  const managementAuthMode = deployment.authMode;

  if (deployment.deployedLocalDevBlocked) {
    return <DeployedLocalDevBlocker deployment={deployment} />;
  }

  return (
    <Providers
      authMode={managementAuthMode}
      googleClientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID}
    >
      <AppShell environment={managementEnvironment} authMode={managementAuthMode}>
        {children}
      </AppShell>
    </Providers>
  );
}
