import { AlertTriangleIcon } from "lucide-react";
import type { DeploymentConfigCheck } from "@/lib/server/deployment-config";

export function DeployedLocalDevBlocker({
  deployment,
}: {
  deployment: DeploymentConfigCheck;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-12 text-foreground">
      <section className="w-full max-w-2xl rounded-lg border bg-card shadow-xs">
        <div className="flex gap-3 border-b px-6 py-5">
          <AlertTriangleIcon aria-hidden className="mt-1 size-4 shrink-0 text-warning" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">
              Deployed management is running local-dev auth
            </h1>
            <p className="mt-1.5 max-w-xl text-[13px] text-muted-foreground">
              This runtime looks deployed, but <code className="font-mono text-xs">MANAGEMENT_AUTH_MODE</code> is
              not <code className="font-mono text-xs">google</code>. Management pages stay blocked until deployed
              auth is configured and the console is redeployed.
            </p>
          </div>
        </div>

        <dl className="grid gap-x-8 gap-y-2.5 px-6 py-5 text-[13px] sm:grid-cols-[max-content_1fr]">
          <Diagnostic label="Runtime" value={deployment.isDeployed ? "deployed" : "local"} />
          <Diagnostic label="Auth mode" value={deployment.authMode} />
          <Diagnostic label="Management environment" value={deployment.managementEnvironment} />
          <Diagnostic label="API Center" value={deployment.apiCenterBaseUrl || "not configured"} />
          <Diagnostic label="Public base URL" value={deployment.publicBaseUrl || "not configured"} />
        </dl>

        <div className="border-t px-6 py-5">
          <h2 className="text-sm font-semibold">Required configuration</h2>
          <pre className="mt-3 overflow-x-auto rounded-md border bg-muted/50 px-3 py-2.5 font-mono text-xs leading-5">
            MANAGEMENT_AUTH_MODE=google{"\n"}
            NEXT_PUBLIC_GOOGLE_CLIENT_ID=&lt;google-oauth-client-id&gt;{"\n"}
            GOOGLE_CLIENT_ID=&lt;google-oauth-client-id&gt;
          </pre>
          {deployment.missingEnv.length ? (
            <div role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px]">
              <p className="font-medium text-foreground">Missing environment variables</p>
              <p className="mt-0.5 break-words font-mono text-xs text-muted-foreground">
                {deployment.missingEnv.join(", ")}
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function Diagnostic({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-xs leading-5">{value}</dd>
    </div>
  );
}
