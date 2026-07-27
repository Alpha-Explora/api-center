import type { DeploymentConfigCheck } from "@/lib/server/deployment-config";

export function DeployedLocalDevBlocker({
  deployment,
}: {
  deployment: DeploymentConfigCheck;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-3xl rounded-lg border border-amber-200 bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-amber-700">Deployment blocked</p>
          <h1 className="text-2xl font-semibold tracking-normal">
            Deployed management is running local-dev auth
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            This runtime looks deployed, but `MANAGEMENT_AUTH_MODE` is not set to
            `google`. Privileged management pages are blocked until deployed auth
            is configured and the project is redeployed.
          </p>
        </div>

        <div className="mt-5 grid gap-3 text-sm md:grid-cols-2">
          <Diagnostic label="Runtime" value={deployment.isDeployed ? "deployed" : "local"} />
          <Diagnostic label="Auth mode" value={deployment.authMode} />
          <Diagnostic
            label="Management environment"
            value={deployment.managementEnvironment.toUpperCase()}
          />
          <Diagnostic
            label="API Center"
            value={deployment.apiCenterBaseUrl || "not configured"}
          />
          <Diagnostic
            label="Public base URL"
            value={deployment.publicBaseUrl || "not configured"}
          />
          <Diagnostic
            label="Topic prefix"
            value={deployment.kafkaTopicPrefix || "not configured"}
          />
        </div>

        <div className="mt-5 rounded-lg border bg-muted/40 p-4">
          <h2 className="text-sm font-semibold">Required fix</h2>
          <pre className="mt-3 overflow-x-auto text-xs leading-6">
            MANAGEMENT_AUTH_MODE=google{"\n"}
            NEXT_PUBLIC_GOOGLE_CLIENT_ID=&lt;google-oauth-client-id&gt;{"\n"}
            GOOGLE_CLIENT_ID=&lt;google-oauth-client-id&gt;
          </pre>
        </div>

        {deployment.missingEnv.length ? (
          <div className="mt-5 rounded-lg border border-destructive/30 bg-[#fff7f7] p-4">
            <h2 className="text-sm font-semibold text-destructive">
              Missing env vars
            </h2>
            <p className="mt-2 break-words text-sm text-muted-foreground">
              {deployment.missingEnv.join(", ")}
            </p>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function Diagnostic({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-all font-mono text-[13px] font-medium">{value}</div>
    </div>
  );
}
