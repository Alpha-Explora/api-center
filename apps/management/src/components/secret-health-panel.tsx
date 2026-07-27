"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getSharedServiceSecretStatus,
  getTribeSecretStatus,
} from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function SharedServiceProviderConfigHealthPanel() {
  const statusQuery = useQuery({
    queryKey: queryKeys.sharedServiceSecretStatus,
    queryFn: getSharedServiceSecretStatus,
    retry: 1,
  });

  if (statusQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider config health</CardTitle>
        <CardDescription>
          Schema-aware shared-service config checks. Only allowlisted key names
          are shown.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {statusQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Provider config unavailable</AlertTitle>
            <AlertDescription>
              Shared-service secret metadata could not be checked from this
              management session.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          {(statusQuery.data?.sharedServices ?? []).map((item) => (
            <div key={item.serviceId} className="rounded-lg border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{item.serviceId}</div>
                  <div className="text-muted-foreground">{item.label}</div>
                </div>
                <Badge
                  variant={item.status === "ready" ? "secondary" : "destructive"}
                >
                  {item.status}
                </Badge>
              </div>
              <Metadata label="Secret" value={item.secretName} />
              <Metadata
                label="Observed keys"
                value={item.observedKeyNames.join(", ") || "none"}
              />
              <Metadata
                label="Missing keys"
                value={item.missingKeyNames.join(", ") || "none"}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function TribeSecretHealthPanel({ serviceId }: { serviceId: string }) {
  const statusQuery = useQuery({
    queryKey: queryKeys.tribeSecretStatus(serviceId),
    queryFn: () => getTribeSecretStatus(serviceId),
    retry: 1,
  });

  if (statusQuery.isLoading) {
    return <Skeleton className="h-52 w-full" />;
  }

  const status = statusQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tribe secret health</CardTitle>
        <CardDescription>
          Secret Manager metadata only. Plaintext secrets and secret hashes are
          never loaded here.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {statusQuery.isError || !status ? (
          <Alert variant="destructive">
            <AlertTitle>Secret metadata unavailable</AlertTitle>
            <AlertDescription>
              Check Secret Manager auth and project configuration.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <Metadata
                label="Expected secret ID"
                value={status.expectedSecretId ?? status.secretId}
              />
              <Metadata label="Exists" value={status.exists ? "yes" : "no"} />
              <Metadata label="Enabled" value={status.enabled ? "yes" : "no"} />
              <Metadata label="State" value={status.state ?? "unknown"} />
              <Metadata
                label="Latest enabled version"
                value={
                  status.latestEnabledVersion
                    ? `Version ${status.latestEnabledVersion}`
                    : "none"
                }
              />
              <Metadata
                label="Latest version timestamp"
                value={status.latestVersionCreatedAt ?? "not available"}
              />
            </div>

            {status.rotationWarning ? (
              <Alert
                variant={
                  status.rotationWarning.severity === "error"
                    ? "destructive"
                    : "default"
                }
              >
                <AlertTitle>Rotation status</AlertTitle>
                <AlertDescription>
                  {status.rotationWarning.message}
                </AlertDescription>
              </Alert>
            ) : null}

            <Alert>
              <AlertTitle>Guarded rotation flow</AlertTitle>
              <AlertDescription>
                Use the Tribe secret card on this tab to generate a new
                one-time secret and rotate the stored hash. Live rotation still
                requires preview, typed confirmation, and a change reason.
              </AlertDescription>
            </Alert>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3 text-sm">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 break-all font-mono">{value}</div>
    </div>
  );
}
