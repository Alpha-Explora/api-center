"use client";

import {
  AlertTriangleIcon,
  CheckCircleIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getReadiness } from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import { GovernanceReadinessPanel } from "@/components/governance-readiness-panel";
import { ActionFailedState } from "@/components/query-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ReadinessClient() {
  const readinessQuery = useQuery({
    queryKey: queryKeys.readiness,
    queryFn: getReadiness,
  });

  if (readinessQuery.isLoading) {
    return <Skeleton className="h-72 w-full" />;
  }

  if (readinessQuery.isError || !readinessQuery.data) {
    return (
      <ActionFailedState
        title="Readiness check failed"
        description="The management readiness route could not return a result."
        recoverySteps={[
          {
            label: "Check the local management API",
            description:
              "Confirm the Next.js API route can reach API Center and Secret Manager checks.",
          },
          {
            label: "Retry readiness",
            description:
              "Use this page again before changing workflow-specific settings.",
          },
        ]}
      />
    );
  }

  const readiness = readinessQuery.data;

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        <div
          className={
            readiness.ok
              ? "border-b bg-[linear-gradient(135deg,var(--brand-green-soft),#ffffff)]"
              : "border-b bg-[linear-gradient(135deg,#fff8e7,#ffffff)]"
          }
        >
          <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-3">
              <span
                className={
                  readiness.ok
                    ? "mt-1 flex size-10 items-center justify-center rounded-full bg-[var(--brand-green)] text-primary"
                    : "mt-1 flex size-10 items-center justify-center rounded-full bg-[var(--warn)] text-primary"
                }
              >
                {readiness.ok ? (
                  <CheckCircleIcon data-icon="inline-start" />
                ) : (
                  <AlertTriangleIcon data-icon="inline-start" />
                )}
              </span>
              <div>
                <CardTitle>Environment readiness</CardTitle>
                <CardDescription>
                  Checks for deployment config, API Center connectivity, and
                  secret handling.
                </CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => readinessQuery.refetch()}
              disabled={readinessQuery.isFetching}
            >
              <RefreshCwIcon data-icon="inline-start" />
              Recheck
            </Button>
          </CardHeader>
        </div>
        <CardContent className="flex flex-col gap-4 pt-4">
          <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
            <Detail
              label="Environment"
              value={readiness.managementEnvironment.toUpperCase()}
            />
            <Detail label="Auth mode" value={readiness.authMode ?? "unknown"} />
            <Detail
              label="Runtime"
              value={readiness.isDeployed ? "deployed" : "local"}
            />
            <Detail label="API Center" value={readiness.apiCenterBaseUrl} />
            <Detail
              label="Topic prefix"
              value={readiness.kafkaTopicPrefix || "none"}
            />
            <Detail
              label="GCP project"
              value={readiness.googleCloudProject || "not configured"}
            />
            <Detail
              label="Browser base URL"
              value={readiness.publicApiCenterBaseUrl}
            />
            <Detail
              label="Secret Manager auth"
              value={readiness.secretManagerAuthMode ?? "unknown"}
            />
            <Detail
              label="Checked"
              value={new Date(readiness.checkedAt).toLocaleString()}
            />
            <div className="flex flex-col gap-1 rounded-lg border bg-card p-3">
              <span className="text-muted-foreground">Overall</span>
              <Badge
                variant="secondary"
                className={
                  readiness.ok
                    ? "w-fit bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]"
                    : "w-fit bg-[#fff8e7] text-[#9a5b00]"
                }
              >
                {readiness.ok ? "ready" : "needs attention"}
              </Badge>
            </div>
          </div>

          {readiness.missingEnv.length ? (
            <Alert variant="destructive">
              <AlertTitle>Missing management env</AlertTitle>
              <AlertDescription>
                {readiness.missingEnv.join(", ")}
              </AlertDescription>
            </Alert>
          ) : null}

          {readiness.governance ? (
            <GovernanceReadinessPanel governance={readiness.governance} />
          ) : null}

          <div className="grid gap-3 md:grid-cols-3">
            {readiness.checks.map((check) => (
              <Card
                key={check.key}
                className={
                  check.ok
                    ? "border-[var(--brand-green)]/20"
                    : "border-destructive/30 bg-[#fff7f7]"
                }
              >
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm">{check.label}</CardTitle>
                    <Badge
                      variant="secondary"
                      className={
                        check.ok
                          ? "bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]"
                          : "bg-[#fff1f1] text-[#b42318]"
                      }
                    >
                      {check.ok ? "ok" : "failed"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-sm leading-6 text-muted-foreground">
                  {check.detail}
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all font-mono text-[13px] font-medium leading-5">
        {value}
      </span>
    </div>
  );
}
