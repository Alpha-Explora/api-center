"use client";

import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import type { ServiceHealthResult, ServiceRegistryEntry } from "@/lib/schemas";

export function ServiceIdentityPanel({
  service,
  healthResult,
  healthPending,
  onCheckHealth,
}: {
  service: ServiceRegistryEntry;
  healthResult: ServiceHealthResult | null;
  healthPending: boolean;
  onCheckHealth: () => void;
}) {
  const isTribe = (service.serviceType ?? "tribe") === "tribe";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>{service.name}</CardTitle>
            <CardDescription>{service.baseUrl}</CardDescription>
          </div>
          <StatusBadge status={service.status} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-4 text-sm md:grid-cols-2">
          <Detail label="Service ID" value={service.serviceId} />
          <Detail label="Type" value={service.serviceType ?? "tribe"} />
          <Detail
            label="Owner tribe"
            value={service.ownerTribeId ?? service.serviceId}
          />
          <Detail label="Owner team" value={service.ownerTeam || "Unset"} />
          <Detail label="Contact" value={service.contact || "Unset"} />
          <Detail label="Version" value={service.version || "Unset"} />
          <Detail label="Tier" value={service.serviceTier || "Unset"} />
          <Detail label="Cost center" value={service.costCenter || "Unset"} />
          <Detail label="Health path" value={service.healthCheck || "Unset"} />
          <Detail
            label="Required scopes"
            value={
              service.requiredScopes.length
                ? service.requiredScopes.join(", ")
                : "None"
            }
          />
          <Detail
            label="Consumes"
            value={service.consumes.length ? service.consumes.join(", ") : "None"}
          />
          <Detail
            label="Exposes"
            value={service.exposes.length ? service.exposes.join(", ") : "None"}
          />
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href={`/tribes/${service.serviceId}/edit`} />}
          >
            Edit manifest
          </Button>
          <Button
            variant="outline"
            onClick={onCheckHealth}
            disabled={healthPending}
          >
            Check health
          </Button>
          {isTribe ? (
            <Button
              nativeButton={false}
              variant="outline"
              render={
                <Link
                  href={`/smoke-tests?tribeId=${encodeURIComponent(service.serviceId)}`}
                />
              }
            >
              Smoke shared services
            </Button>
          ) : null}
        </div>
        {healthResult ? (
          <Alert variant={healthResult.ok ? "default" : "destructive"}>
            <AlertTitle>Health {healthResult.ok ? "passed" : "failed"}</AlertTitle>
            <AlertDescription>
              {healthResult.status ? `HTTP ${healthResult.status}. ` : ""}
              {healthResult.url || healthResult.error}. Checked at{" "}
              {new Date(healthResult.checkedAt).toLocaleString()}.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium">{value}</dd>
    </div>
  );
}
