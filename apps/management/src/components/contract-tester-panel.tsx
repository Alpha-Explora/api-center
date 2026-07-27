"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { testContract } from "@/lib/api-center-client";
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
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ContractTestResult, ServiceRegistryEntry } from "@/lib/schemas";

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export function ContractTesterPanel({
  service,
}: {
  service: ServiceRegistryEntry;
}) {
  const [method, setMethod] = useState<(typeof methods)[number]>("GET");
  const [path, setPath] = useState(service.healthCheck || "/health");
  const [bearerToken, setBearerToken] = useState("");
  const [result, setResult] = useState<ContractTestResult | null>(null);

  const routeOptions = useMemo(() => {
    const routes = new Set([service.healthCheck || "/health", ...service.exposes]);
    return Array.from(routes).filter(Boolean);
  }, [service.exposes, service.healthCheck]);

  const contractMutation = useMutation({
    mutationFn: () =>
      testContract({
        serviceId: service.serviceId,
        method,
        path,
        bearerToken: bearerToken.trim() || undefined,
      }),
    onSuccess: (nextResult) => {
      setResult(nextResult);
      toast.success("Contract test finished");
    },
    onError: () => {
      toast.error("Contract test failed", {
        description:
          "Check the service URL, selected route, and optional bearer token.",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contract tester</CardTitle>
        <CardDescription>
          Test direct backend reachability and optionally the API Center proxy.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldSet>
          <FieldTitle>Request</FieldTitle>
          <FieldGroup>
            <div className="grid gap-3 md:grid-cols-[10rem_1fr]">
              <Field>
                <FieldLabel htmlFor="contract-method">Method</FieldLabel>
                <select
                  id="contract-method"
                  className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                  value={method}
                  onChange={(event) =>
                    setMethod(event.target.value as (typeof methods)[number])
                  }
                >
                  {methods.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </Field>
              <Field>
                <FieldLabel htmlFor="contract-path">Exposed route</FieldLabel>
                <Input
                  id="contract-path"
                  list="contract-route-options"
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                />
                <datalist id="contract-route-options">
                  {routeOptions.map((route) => (
                    <option key={route} value={route} />
                  ))}
                </datalist>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="contract-token">
                Optional API Center bearer token
              </FieldLabel>
              <Textarea
                id="contract-token"
                value={bearerToken}
                onChange={(event) => setBearerToken(event.target.value)}
                placeholder="Paste a temporary tribe token to test /api/v1/tribes or /api/v1/shared. Leave blank to skip proxy test."
              />
            </Field>
          </FieldGroup>
        </FieldSet>

        <div>
          <Button
            onClick={() => contractMutation.mutate()}
            disabled={contractMutation.isPending}
          >
            Run contract test
          </Button>
        </div>

        {result ? (
          <div className="grid gap-3 md:grid-cols-2">
            {result.attempts.map((attempt) => (
              <Card key={attempt.mode}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-sm">
                      {attempt.mode === "direct"
                        ? "Direct backend"
                        : "API Center proxy"}
                    </CardTitle>
                    <Badge
                      variant={
                        attempt.ok
                          ? "secondary"
                          : attempt.skipped
                            ? "outline"
                            : "destructive"
                      }
                    >
                      {attempt.ok
                        ? "ok"
                        : attempt.skipped
                          ? "skipped"
                          : "failed"}
                    </Badge>
                  </div>
                  <CardDescription className="break-all">
                    {attempt.url}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  <div>
                    {attempt.status ? `HTTP ${attempt.status}` : "No status"}
                    {typeof attempt.latencyMs === "number"
                      ? ` in ${attempt.latencyMs} ms`
                      : ""}
                  </div>
                  {attempt.error ? (
                    <Alert variant="destructive">
                      <AlertTitle>Failure reason</AlertTitle>
                      <AlertDescription>{attempt.error}</AlertDescription>
                    </Alert>
                  ) : null}
                  {attempt.responsePreview ? (
                    <pre className="max-h-40 overflow-auto rounded-lg border bg-muted p-3 text-xs">
                      {attempt.responsePreview}
                    </pre>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
