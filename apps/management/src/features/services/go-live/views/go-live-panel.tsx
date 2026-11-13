"use client";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useGoLive } from "../view-models/use-go-live";
import { ServiceSecretRotationPanel } from "./service-secret-rotation-panel";

export function GoLivePanel({ serviceId }: { serviceId: string }) {
  const [environment, setEnvironment] = useState<"test" | "live">("live");
  const [typedPhrase, setTypedPhrase] = useState("");
  const [reason, setReason] = useState("");
  const state = useGoLive(serviceId, environment);
  const data = state.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Go live</CardTitle>
        <CardDescription>
          Complete production setup and review current verification. Test access
          remains available.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="go-live-environment">Environment</FieldLabel>
            <select
              id="go-live-environment"
              value={environment}
              onChange={(event) => {
                if (
                  event.target.value === "test" ||
                  event.target.value === "live"
                ) {
                  setEnvironment(event.target.value);
                  setTypedPhrase("");
                  setReason("");
                }
              }}
            >
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </Field>
        </FieldGroup>
        {state.isPending ? <p role="status">Loading verification…</p> : null}
        {state.error ? (
          <Alert variant="destructive">
            <AlertTitle>Verification unavailable</AlertTitle>
            <AlertDescription>
              Readiness is blocked. Check gateway access and retry.
            </AlertDescription>
          </Alert>
        ) : null}
        {data ? (
          <>
            <p role="status">
              {data.ready
                ? "Required verification is current."
                : "Production handoff is blocked by the checks below."}
            </p>
            <p className="text-sm">
              Verification run:{" "}
              {data.verificationRun?.status ?? "Not requested"}
              {data.verificationRun ? ` · ${data.verificationRun.runId}` : ""}.
              A protected CI runner must claim and execute queued checks.
            </p>
            <ul className="flex flex-col gap-3">
              {data.checks.map((check) => (
                <li
                  key={check.key}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <div>
                    <p className="font-medium">{check.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {check.action}
                    </p>
                  </div>
                  <Badge
                    variant={
                      check.status === "passed" ||
                      check.status === "not_applicable"
                        ? "secondary"
                        : "outline"
                    }
                  >
                    {check.status.replaceAll("_", " ")}
                  </Badge>
                </li>
              ))}
            </ul>
            <div>
              <h3 className="font-medium">Service secret</h3>
              <p className="text-sm">
                {data.secret.status}
                {data.secret.versionName
                  ? ` · ${data.secret.versionName.split("/").slice(-2).join(" ")}`
                  : ""}
              </p>
              <p className="text-sm">
                Rotation:{" "}
                {data.secret.rotationState?.replaceAll("_", " ") ?? "Unknown"}
              </p>
              <p className="text-sm text-muted-foreground">
                Last authenticated use: {data.secret.lastUsedAt ?? "Unknown"}.
                Open Actions → Service secret for initial provisioning.
              </p>
            </div>
            {data.secret.status === "present" ? (
              <ServiceSecretRotationPanel
                key={`${serviceId}:${environment}`}
                serviceId={serviceId}
                environment={environment}
                secret={data.secret}
              />
            ) : null}
            <div className="flex flex-col gap-3">
              <h3 className="font-medium">Payment API keys</h3>
              {data.keys.length ? (
                data.keys.map((key) => (
                  <div
                    key={key.keyId}
                    className="rounded-md border p-3 text-sm"
                  >
                    <p className="font-mono">{key.keyPrefix}</p>
                    <p>Permissions: {key.scopes.join(", ")}</p>
                    <p>Created: {key.createdAt}</p>
                    <p>Expires: {key.expiresAt ?? "Unknown"}</p>
                    <p>Last authenticated use: {key.lastUsedAt ?? "Unknown"}</p>
                    <p>
                      {key.revokedAt
                        ? `Revoked: ${key.revokedAt}`
                        : "Not revoked"}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        Boolean(key.revokedAt) ||
                        state.revoke.isPending ||
                        !reason.trim() ||
                        (environment === "live" &&
                          typedPhrase !== "APPLY LIVE CHANGE")
                      }
                      onClick={() =>
                        state.revoke.mutate({
                          serviceId,
                          environment,
                          keyId: key.keyId,
                          typedPhrase,
                          reason,
                        })
                      }
                    >
                      Revoke this key
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No payment keys recorded for this environment.
                </p>
              )}
            </div>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="go-live-revoke-reason">
                  Operation reason
                </FieldLabel>
                <Input
                  id="go-live-revoke-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              {environment === "live" ? (
                <Field>
                  <FieldLabel htmlFor="go-live-revoke-phrase">
                    Type APPLY LIVE CHANGE
                  </FieldLabel>
                  <Input
                    id="go-live-revoke-phrase"
                    value={typedPhrase}
                    onChange={(event) => setTypedPhrase(event.target.value)}
                  />
                </Field>
              ) : null}
            </FieldGroup>
            <Button
              type="button"
              disabled={
                state.verify.isPending ||
                !reason.trim() ||
                (environment === "live" &&
                  typedPhrase !== "APPLY LIVE CHANGE") ||
                data.verificationRun?.status === "queued" ||
                data.verificationRun?.status === "running"
              }
              onClick={() =>
                state.verify.mutate({
                  serviceId,
                  environment,
                  typedPhrase,
                  reason,
                })
              }
            >
              Request protected verification
            </Button>
            {state.verify.error ? (
              <p role="alert">
                Verification could not be queued. Check the deployment revision,
                your role, and live confirmation.
              </p>
            ) : null}
            {state.revoke.error ? (
              <p role="alert">
                Key revocation failed. Review your role and confirmation before
                retrying.
              </p>
            ) : null}
            <div>
              <h3 className="font-medium">Production configuration</h3>
              <pre className="overflow-x-auto rounded-md border p-3 text-xs">
                {data.configurationTemplate}
              </pre>
              <p className="text-sm text-muted-foreground">
                Install the matching credentials in your backend secret manager
                and redeploy. This page does not switch traffic or execute
                provider operations.
              </p>
            </div>
          </>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={() => state.refetch()}
          disabled={state.isFetching}
        >
          Refresh verification
        </Button>
      </CardContent>
    </Card>
  );
}
