"use client";

import { useMemo, useState } from "react";
import { CheckIcon, RefreshCwIcon } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { listServices, registerService } from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import { sharedServiceManifests } from "@/lib/shared-service-manifests";
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
import { Textarea } from "@/components/ui/textarea";

export function SharedServicesSetupClient() {
  const [selected, setSelected] = useState(
    () => new Set(sharedServiceManifests.map((manifest) => manifest.serviceId)),
  );
  const [reviewedSelection, setReviewedSelection] = useState(false);
  const servicesQuery = useQuery({
    queryKey: queryKeys.services,
    queryFn: listServices,
  });

  const registeredIds = useMemo(
    () => new Set((servicesQuery.data ?? []).map((service) => service.serviceId)),
    [servicesQuery.data],
  );

  const selectedManifests = sharedServiceManifests.filter((manifest) =>
    selected.has(manifest.serviceId),
  );

  const registerMutation = useMutation({
    mutationFn: async () => {
      const results = [];
      for (const manifest of selectedManifests) {
        results.push(await registerService(manifest));
      }
      return results;
    },
    onSuccess: async (services) => {
      toast.success(`Registered ${services.length} shared service(s)`);
      await servicesQuery.refetch();
    },
    onError: () => {
      toast.error("Shared service registration failed", {
        description:
          "Check API Center base URL and the local platform admin secret.",
      });
    },
  });

  function toggle(serviceId: string) {
    const next = new Set(selected);
    if (next.has(serviceId)) {
      next.delete(serviceId);
    } else {
      next.add(serviceId);
    }
    setReviewedSelection(false);
    setSelected(next);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_26rem]">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>Shared-service manifests</CardTitle>
            <CardDescription>
              Review the predefined shared services before registering them.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            onClick={() => servicesQuery.refetch()}
            disabled={servicesQuery.isFetching}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {sharedServiceManifests.map((manifest) => (
            <Card key={manifest.serviceId}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-sm">{manifest.name}</CardTitle>
                  <Badge
                    variant={
                      registeredIds.has(manifest.serviceId)
                        ? "secondary"
                        : "outline"
                    }
                  >
                    {registeredIds.has(manifest.serviceId)
                      ? "registered"
                      : "not registered"}
                  </Badge>
                </div>
                <CardDescription>{manifest.serviceId}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <div className="text-muted-foreground">{manifest.baseUrl}</div>
                <div>
                  <span className="font-medium">Scopes: </span>
                  {manifest.requiredScopes.join(", ")}
                </div>
                <div>
                  <span className="font-medium">Routes: </span>
                  {manifest.exposes.join(", ")}
                </div>
                <Button
                  variant={selected.has(manifest.serviceId) ? "default" : "outline"}
                  onClick={() => toggle(manifest.serviceId)}
                >
                  {selected.has(manifest.serviceId) ? (
                    <CheckIcon data-icon="inline-start" />
                  ) : null}
                  {selected.has(manifest.serviceId) ? "Selected" : "Select"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Review payload</CardTitle>
          <CardDescription>
            This JSON is submitted through the local register proxy.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            aria-label="Shared-service registration payload"
            readOnly
            className="min-h-96 font-mono text-xs"
            value={JSON.stringify(selectedManifests, null, 2)}
          />
          <label
            htmlFor="shared-services-setup-reviewed"
            className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3 text-sm"
          >
            <input
              id="shared-services-setup-reviewed"
              type="checkbox"
              className="mt-1"
              checked={reviewedSelection}
              onChange={(event) => setReviewedSelection(event.target.checked)}
              disabled={!selectedManifests.length}
            />
            <span>
              I reviewed selected shared-service manifests and the registration payload.
            </span>
          </label>
          <Button
            onClick={() => registerMutation.mutate()}
            disabled={
              !selectedManifests.length ||
              !reviewedSelection ||
              registerMutation.isPending
            }
          >
            Register selected
          </Button>
          {servicesQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load registry</AlertTitle>
              <AlertDescription>
                Registration can still fail until the server environment is configured.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
