import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ServiceRegistryEntry } from "@/lib/schemas";

type EnvironmentRow = NonNullable<ServiceRegistryEntry["environments"]>[number] &
  Record<string, unknown>;

export function ServiceEnvironmentPanel({
  service,
}: {
  service: ServiceRegistryEntry;
}) {
  const environments = resolveEnvironmentRows(service);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service environments</CardTitle>
        <CardDescription>
          Runtime endpoints and operation guardrails attached to this stable service identity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          {environments.map((environment) => {
            const targetEnvironment = environment.environment;
            const isLive = targetEnvironment === "live";
            return (
              <div
                key={targetEnvironment}
                className="grid gap-3 rounded-lg border bg-muted/20 p-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Badge variant={isLive ? "default" : "secondary"}>
                      {targetEnvironment}
                    </Badge>
                    <div className="mt-2 break-all font-mono">
                      {environment.baseUrl}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {environment.healthCheck ?? service.healthCheck ?? "/health"}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {isLive
                      ? "Live actions require phrase, reason, and audit evidence."
                      : "Test actions use normal confirmation."}
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-4">
                  <EnvironmentFact label="Health" value={healthLabel(environment, service)} />
                  <EnvironmentFact label="Secret" value={stringValue(environment.secretStatus, "pending handoff")} />
                  <EnvironmentFact label="Shared routes" value={stringValue(environment.sharedServiceRouteStatus, "configured by registry")} />
                  <EnvironmentFact label="Quota" value={stringValue(environment.quotaPolicyStatus, "policy required")} />
                  <EnvironmentFact label="Last smoke" value={stringValue(environment.lastSmokeRunAt, "not run")} />
                  <EnvironmentFact label="Promotion evidence" value={stringValue(environment.promotionEvidenceStatus, "not attached")} />
                  <EnvironmentFact label="Break-glass" value={stringValue(environment.breakGlassState, "inactive")} />
                  <EnvironmentFact label="Action guard" value={isLive ? "elevated live write" : "standard write"} />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function resolveEnvironmentRows(service: ServiceRegistryEntry): EnvironmentRow[] {
  const rows = service.environments && service.environments.length > 0
    ? service.environments
    : [
        {
          environment: "test" as const,
          baseUrl: service.baseUrl,
          healthCheck: service.healthCheck,
          status: service.status,
          healthy: service.healthy,
          lastHealthCheckAt: service.lastHealthCheckAt,
        },
      ];

  return rows.map((row) => ({
    ...row,
    baseUrl: row.baseUrl || service.baseUrl,
    healthCheck: row.healthCheck ?? service.healthCheck,
    status: row.status ?? service.status,
  }));
}

function EnvironmentFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background/70 p-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm">{value}</div>
    </div>
  );
}

function healthLabel(environment: EnvironmentRow, service: ServiceRegistryEntry) {
  if (environment.healthy === true) return "healthy";
  if (environment.healthy === false) return "unhealthy";
  return stringValue(environment.status, service.status);
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}
