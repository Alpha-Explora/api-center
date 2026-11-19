import { connection } from "next/server";
import { AppShell } from "@/components/shell/app-shell";
import { DeployedLocalDevBlocker } from "@/components/deployed-local-dev-blocker";
import { Providers } from "@/app/providers";
import { getDeploymentConfigCheck } from "@/lib/server/deployment-config";

export default async function ManagementLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read the deployment's settings per request; prerendering would bake in the build machine's values,
  // including whether local-dev sign-in must be blocked.
  await connection();
  const deployment = getDeploymentConfigCheck();
  const managementAuthMode = deployment.authMode;

  if (deployment.deployedLocalDevBlocked) {
    return <DeployedLocalDevBlocker deployment={deployment} />;
  }

  return (
    <Providers authMode={managementAuthMode} googleClientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID}>
      <AppShell authMode={managementAuthMode}>{children}</AppShell>
    </Providers>
  );
}
