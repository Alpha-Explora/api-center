"use client";

import { useMemo, useState } from "react";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listServices,
  listTribes,
  registerService,
} from "@/lib/api-center-client";
import { copyTextToClipboard } from "@/lib/client-clipboard";
import { queryKeys } from "@/lib/query-keys";
import { buildServiceRegistrationPlan } from "@/lib/service-registration-policy";
import {
  serviceManifestSchema,
  type ServiceManifest,
  type ServiceRegistrationPlan,
} from "@/lib/schemas";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export function ManifestToolsClient() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState("");
  const [plan, setPlan] = useState<ServiceRegistrationPlan | null>(null);
  const [reviewedImport, setReviewedImport] = useState(false);
  const servicesQuery = useQuery({
    queryKey: queryKeys.services,
    queryFn: listServices,
  });
  const tribesQuery = useQuery({
    queryKey: queryKeys.tenancyTribes,
    queryFn: listTribes,
  });

  const exportJson = useMemo(() => {
    return JSON.stringify(servicesQuery.data ?? [], null, 2);
  }, [servicesQuery.data]);

  const importMutation = useMutation({
    mutationFn: async () => {
      const manifests = parseManifestInput(input);
      let succeeded = 0;
      const failures: string[] = [];

      for (const manifest of manifests) {
        try {
          await registerService(manifest);
          succeeded += 1;
        } catch (error) {
          failures.push(
            `${manifest.serviceId}: ${
              error instanceof Error ? error.message : "failed"
            }`,
          );
        }
      }

      return { succeeded, failures };
    },
    onSuccess: ({ succeeded, failures }) => {
      setResult(
        failures.length
          ? `${succeeded} imported, ${failures.length} failed:\n${failures.join("\n")}`
          : `${succeeded} manifest(s) imported.`,
      );
      toast.success("Import finished");
      setPlan(null);
      setReviewedImport(false);
      void servicesQuery.refetch();
    },
    onError: (error) => {
      setResult(error instanceof Error ? error.message : "Import failed");
      toast.error("Import failed");
    },
  });

  function validateInput() {
    try {
      const manifests = parseManifestInput(input);
      setPlan(
        buildServiceRegistrationPlan({
          manifests,
          existingServices: servicesQuery.data ?? [],
          projects: (tribesQuery.data ?? []).flatMap((tribe) => tribe.projects),
          mode: "local-direct",
        }),
      );
      setReviewedImport(false);
      setResult("");
      toast.success("Registration plan ready");
    } catch (error) {
      setPlan(null);
      setReviewedImport(false);
      setResult(error instanceof Error ? error.message : "Validation failed");
      toast.error("Dry run failed");
    }
  }

  async function copyExport() {
    const copied = await copyTextToClipboard(exportJson);
    if (copied) {
      toast.success("Registry export copied");
      return;
    }

    toast.error("Copy was blocked", {
      description: "Select the registry export text and copy it manually.",
    });
  }

  function downloadExport() {
    const blob = new Blob([exportJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `api-center-registry-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function clearImport() {
    setInput("");
    setPlan(null);
    setReviewedImport(false);
    setResult("");
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Export registry</CardTitle>
          <CardDescription>
            Current API Center registry entries as JSON.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            aria-label="Registry export JSON"
            readOnly
            className="min-h-96 font-mono text-xs"
            value={exportJson}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={copyExport}
              disabled={!servicesQuery.data}
            >
              Copy export
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={downloadExport}
              disabled={!servicesQuery.data}
            >
              Download JSON
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import manifests</CardTitle>
          <CardDescription>
            Paste one manifest or an array of manifests. Each valid manifest is
            submitted through API Center register.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            aria-label="Manifest import JSON"
            className="min-h-72 font-mono text-xs"
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setPlan(null);
              setReviewedImport(false);
            }}
            placeholder='{"serviceId":"campusone-students","name":"CampusOne Students API","baseUrl":"https://api.example.com","requiredScopes":["service:read"],"exposes":["/health"],"consumes":[]}'
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={validateInput}
              disabled={!input.trim()}
            >
              Validate dry run
            </Button>
            <Button
              onClick={() => importMutation.mutate()}
              disabled={!plan?.canApply || !reviewedImport || importMutation.isPending}
            >
              Import manifests
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={clearImport}
              disabled={!input && !plan && !result}
            >
              Clear
            </Button>
          </div>
          {plan ? <RegistrationPlanPanel plan={plan} /> : null}
          {plan?.canApply ? (
            <label className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={reviewedImport}
                onChange={(event) => setReviewedImport(event.target.checked)}
              />
              <span>
                I reviewed the dry run, owner tribe mapping, and registry actions.
              </span>
            </label>
          ) : null}
          {result ? (
            <Alert>
              <AlertTitle>Import result</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap">
                {result}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function RegistrationPlanPanel({ plan }: { plan: ServiceRegistrationPlan }) {
  return (
    <Alert variant={plan.canApply ? "default" : "destructive"}>
      <AlertTitle>
        {plan.canApply
          ? "Registration plan is applicable"
          : "Registration plan is blocked"}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>
          {plan.items.filter((item) => item.action === "create").length} new
          manifest(s).
        </span>
        <span>
          {plan.items.filter((item) => item.action === "update").length}{" "}
          existing manifest(s).
        </span>
        <div className="grid gap-2">
          {plan.items.map((item) => (
            <div
              key={item.serviceId}
              className="rounded-md border bg-background p-3"
            >
              <div className="font-medium">
                {item.action}: {item.serviceId}
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                APICENTER_SERVICE_ID={item.sourceServiceId}
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                project={item.projectId ?? "shared"} tribe={item.ownerTribeId ?? "none"}
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                topic={item.eventTopic}
              </div>
            </div>
          ))}
        </div>
        {plan.issues.length ? (
          <div className="grid gap-2">
            {plan.issues.map((issue) => (
              <div
                key={`${issue.code}:${issue.serviceId ?? "global"}:${issue.message}`}
              >
                <span className="font-medium">{issue.severity}</span>:{" "}
                {issue.message}
              </div>
            ))}
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function parseManifestInput(input: string): ServiceManifest[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("Input is not valid JSON.");
  }

  const many = z.array(serviceManifestSchema).safeParse(parsed);
  if (many.success) return many.data;

  const single = serviceManifestSchema.safeParse(parsed);
  if (single.success) return [single.data];

  throw new Error("JSON does not match the service manifest schema.");
}
