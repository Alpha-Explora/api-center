"use client";

import { useMemo, useState } from "react";
import { CopyIcon, PlayIcon, ShieldCheckIcon } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  previewSharedServiceSmokeOperation,
  runSharedServiceSmokeTest,
  type OperationPreview,
} from "@/lib/api-center-client";
import type { SmokeTestResult } from "@/lib/schemas";
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
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OperationPreviewPanel } from "@/components/operation-preview-panel";
import { SmokeTokenCard } from "@/components/smoke-token-card";
import {
  smokeTests,
  type SmokeTargets,
  type SmokeTestPreset,
} from "@/components/shared-service-smoke-tests/smoke-test-presets";
import {
  getPaymentSmokeTestGroups,
  groupSmokeTestsByService,
} from "@/components/shared-service-smoke-tests/smoke-test-groups";
import {
  getGoogleAuthorizationUrl,
  normalizeSmsTarget,
} from "@/components/shared-service-smoke-tests/smoke-targets";

export function SharedServiceSmokeTests({
  defaultTribeId = "smoke-tribe",
  mode = "test",
}: {
  defaultTribeId?: string;
  mode?: "test" | "live";
}) {
  const [accessToken, setAccessToken] = useState("");
  const [tokenServiceId, setTokenServiceId] = useState(defaultTribeId);
  const [providerConfirmed, setProviderConfirmed] = useState(false);
  const [operationPreview, setOperationPreview] = useState<OperationPreview | null>(null);
  const [typedPhrase, setTypedPhrase] = useState("");
  const [operatorReason, setOperatorReason] = useState("");
  const [batchRunning, setBatchRunning] = useState(false);
  const [targets, setTargets] = useState<SmokeTargets>({
    email: "your-email@example.com",
    phone: "+639000000000",
  });
  const [results, setResults] = useState<Record<string, SmokeTestResult>>({});
  const smsTarget = useMemo(() => normalizeSmsTarget(targets.phone), [targets.phone]);

  const smokeMutation = useMutation({
    mutationFn: (preset: SmokeTestPreset) =>
      runSharedServiceSmokeTest({
        serviceId: preset.serviceId,
        method: preset.method,
        path: preset.path,
        body: resolveBody(preset.body, {
          ...targets,
          phone: smsTarget.value,
        }),
        bearerToken: accessToken,
        confirmation: !preset.safe
          ? {
              typedPhrase,
              reason: operatorReason,
            }
          : undefined,
      }),
    onSuccess: (result, preset) => {
      setResults((current) => ({ ...current, [preset.id]: result }));
      toast.success(`${preset.label} finished`);
    },
    onError: (_error, preset) => {
      toast.error(`${preset.label} failed`, {
        description:
          "Check the result panel, token, service health, and provider test settings.",
      });
    },
  });

  const previewMutation = useMutation({
    mutationFn: () => previewSharedServiceSmokeOperation(),
    onSuccess: (preview) => {
      setOperationPreview(preview);
      toast.success("Operation preview loaded");
    },
    onError: () => {
      toast.error("Preview failed", {
        description: "Check management auth and retry before running provider-impacting checks.",
      });
    },
  });

  const groupedTests = useMemo(() => {
    return groupSmokeTestsByService(smokeTests);
  }, []);

  const paymentTestGroups = useMemo(() => {
    return getPaymentSmokeTestGroups(smokeTests);
  }, []);

  async function runSafeChecks() {
    if (!accessToken) {
      toast.error("Request a service token first");
      return;
    }

    setBatchRunning(true);
    for (const test of smokeTests.filter((item) => item.safe)) {
      await smokeMutation.mutateAsync(test).catch(() => undefined);
    }
    setBatchRunning(false);
  }

  async function runPaymentSubscriptionLifecycle() {
    if (!accessToken) {
      toast.error("Request a service token first");
      return;
    }
    if (!canRunProviderImpacting()) {
      toast.error("Confirm provider-impacting checks first");
      return;
    }

    const sequence = [
      "payment-customer",
      "payment-product",
      "payment-price",
      "payment-subscription",
      "payment-subscription-read",
      "payment-subscription-cancel",
      "payment-subscription-read",
    ];
    const testsById = new Map(smokeTests.map((test) => [test.id, test]));

    setBatchRunning(true);
    for (const testId of sequence) {
      const test = testsById.get(testId);
      if (test) {
        await smokeMutation.mutateAsync(test).catch(() => undefined);
      }
    }
    setBatchRunning(false);
  }

  function renderTest(test: SmokeTestPreset) {
    const result = results[test.id];
    const pending =
      smokeMutation.isPending && smokeMutation.variables?.id === test.id;
    const smsTargetInvalid = test.id === "sms-send" && Boolean(smsTarget.error);
    const disabled =
      !accessToken ||
      pending ||
      smsTargetInvalid ||
      (!test.safe && !canRunProviderImpacting());

    return (
      <div key={test.id} className="rounded-lg border p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{test.label}</span>
              <Badge variant={test.safe ? "secondary" : "outline"}>
                {test.safe ? "safe" : "confirm first"}
              </Badge>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {test.description}
            </div>
            <div className="mt-2 font-mono text-xs text-muted-foreground">
              {test.method} /api/v1/shared/{test.serviceId}
              {test.path}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (smsTargetInvalid) {
                toast.error("Use a valid SMS test number", {
                  description:
                    smsTarget.error ??
                    "Use E.164 format like +639171234567, or enter a PH mobile number like 09171234567.",
                });
                return;
              }
              smokeMutation.mutate(test);
            }}
            disabled={disabled}
          >
            <PlayIcon data-icon="inline-start" />
            Run
          </Button>
        </div>

        {result ? <SmokeResult result={result} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <SmokeTokenCard
        defaultServiceId={tokenServiceId}
        onTokenIssued={(token, serviceId) => {
          setAccessToken(token);
          setTokenServiceId(serviceId);
        }}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Shared-service checks</CardTitle>
              <CardDescription>
                Run safe checks first, then explicitly enable provider-impacting checks.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {accessToken ? (
                <Badge variant="secondary">token for {tokenServiceId}</Badge>
              ) : (
                <Badge variant="outline">token required</Badge>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={runSafeChecks}
                disabled={!accessToken || batchRunning}
              >
                <PlayIcon data-icon="inline-start" />
                Run safe checks
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Alert>
            <ShieldCheckIcon data-icon="inline-start" />
            <AlertTitle>Start with health and safe tests</AlertTitle>
            <AlertDescription>
              Provider-impacting tests can create checkout sessions, send messages, or create OTP
              records. Keep test payloads pointed at your own test accounts.
            </AlertDescription>
          </Alert>

          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="smoke-email-target">Email target</FieldLabel>
              <Input
                id="smoke-email-target"
                value={targets.email}
                onChange={(event) =>
                  setTargets((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
              <FieldDescription>
                Used only by email and OTP provider-impacting checks.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="smoke-phone-target">SMS target</FieldLabel>
              <Input
                id="smoke-phone-target"
                value={targets.phone}
                aria-invalid={Boolean(smsTarget.error)}
                onChange={(event) =>
                  setTargets((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
              />
              <FieldDescription>
                {smsTarget.error
                  ? smsTarget.error
                  : `Used by SMS checks. Sending as ${smsTarget.value}.`}
              </FieldDescription>
            </Field>
          </FieldGroup>

          <Label
            htmlFor="provider-impacting-checks-confirmed"
            className="flex items-start gap-3 rounded-lg border bg-muted/35 p-3 text-sm"
          >
            <input
              id="provider-impacting-checks-confirmed"
              className="mt-1"
              type="checkbox"
              checked={providerConfirmed}
              onChange={(event) => setProviderConfirmed(event.target.checked)}
            />
            <span>
              I understand provider-impacting checks may call a real provider or create
              provider-side test data.
            </span>
          </Label>

          <OperationPreviewPanel
            title="Provider-impacting operation preview"
            description="Preview the impact before running checkout, subscription, email, SMS, or OTP checks."
            preview={operationPreview}
            live={mode === "live"}
            typedPhrase={typedPhrase}
            reason={operatorReason}
            previewPending={previewMutation.isPending}
            onPreview={() => previewMutation.mutate()}
            onTypedPhraseChange={setTypedPhrase}
            onReasonChange={setOperatorReason}
          />

          <div className="grid gap-4 xl:grid-cols-2">
            {Object.entries(groupedTests).map(([serviceId, tests]) => (
              <Card key={serviceId} className="border-[var(--brand-green)]/20">
                <CardHeader>
                  <CardTitle className="font-mono text-base">{serviceId}</CardTitle>
                  <CardDescription>{serviceDescription(serviceId)}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {serviceId === "payment" ? (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-sm font-medium">Payment subscription smoke</div>
                          <div className="text-sm text-muted-foreground">
                            Creates customer, product, price, subscription, reads it, cancels it, then reads it again.
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={runPaymentSubscriptionLifecycle}
                          disabled={!accessToken || !canRunProviderImpacting() || batchRunning}
                        >
                          <PlayIcon data-icon="inline-start" />
                          Run lifecycle
                        </Button>
                      </div>
                      {paymentTestGroups.map(([group, groupTests]) => (
                        <div key={group} className="rounded-lg border bg-muted/20 p-3">
                          <div className="mb-3 text-sm font-medium">{group}</div>
                          <div className="flex flex-col gap-3">
                            {groupTests.map(renderTest)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    tests.filter((test) => test.safe).map(renderTest)
                  )}
                  {serviceId !== "payment" && tests.some((test) => !test.safe) ? (
                    <details className="rounded-lg border bg-muted/20 p-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        Provider-impacting checks
                      </summary>
                      <div className="mt-3 flex flex-col gap-3">
                        {tests.filter((test) => !test.safe).map(renderTest)}
                      </div>
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  function canRunProviderImpacting() {
    if (!providerConfirmed) return false;
    if (mode !== "live") return true;
    return typedPhrase === "APPLY LIVE CHANGE" && Boolean(operatorReason.trim());
  }
}

function resolveBody(
  body: SmokeTestPreset["body"],
  targets: SmokeTargets,
): unknown {
  return typeof body === "function" ? body(targets) : body;
}

function SmokeResult({ result }: { result: SmokeTestResult }) {
  const authorizationUrl = getGoogleAuthorizationUrl(result.responsePreview);

  return (
    <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={result.ok ? "secondary" : "destructive"}>
          {result.ok ? "ok" : "failed"}
        </Badge>
        <span>{typeof result.status === "number" ? `HTTP ${result.status}` : "No status"}</span>
        <span>{result.latencyMs} ms</span>
      </div>
      {result.responsePreview ? (
        <pre className="mt-3 max-h-48 overflow-auto rounded-md border bg-background p-3 text-xs">
          {formatPreview(result.responsePreview)}
        </pre>
      ) : null}
      {authorizationUrl ? (
        <div className="mt-3 rounded-md border bg-background p-3">
          <div className="text-sm font-medium">Google OAuth handoff URL</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Copy this URL and open it in Chrome or the device system browser.
            Google can block OAuth inside embedded in-app browsers.
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 text-xs">
              {authorizationUrl}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(authorizationUrl);
                toast.success("Google OAuth URL copied");
              }}
            >
              <CopyIcon data-icon="inline-start" />
              Copy URL
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatPreview(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function serviceDescription(serviceId: string) {
  if (serviceId === "payment") return "PayMongo-backed checkout and subscription wrapper";
  if (serviceId === "gauth") return "Google OAuth wrapper";
  if (serviceId === "geo") return "Google Maps and geofence wrapper";
  if (serviceId === "email") return "Resend-backed email wrapper";
  if (serviceId === "sms") return "SMS delivery wrapper";
  return "OTP issue and verify wrapper";
}
