"use client";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createReplacement,
  rotateServiceCredential,
} from "../data/credential-rotation-repository";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { GoLiveSummary } from "../model/go-live";

export function ServiceSecretRotationPanel({
  serviceId,
  environment,
  secret,
}: {
  serviceId: string;
  environment: "test" | "live";
  secret: GoLiveSummary["secret"];
}) {
  const [replacement, setReplacement] = useState<{
    plaintext: string;
    hash: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [typedPhrase, setTypedPhrase] = useState("");
  const operation = useRef(new Map<string, string>());
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: rotateServiceCredential,
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: ["service-go-live", serviceId, environment],
      }),
  });
  const confirmed =
    reason.trim().length > 0 &&
    (environment === "test" || typedPhrase === "APPLY LIVE CHANGE");
  function apply(action: "start" | "verify" | "revoke-old") {
    const key = JSON.stringify({
      serviceId,
      environment,
      action,
      hash: replacement?.hash,
      reason,
    });
    const operationId = operation.current.get(key) ?? crypto.randomUUID();
    operation.current.set(key, operationId);
    mutation.mutate({
      serviceId,
      environment,
      action,
      operationId,
      ...(action === "start" ? { secretHashSha256: replacement?.hash } : {}),
      reason,
      typedPhrase,
    });
  }
  const canStart =
    secret.rotationState === "active_current" ||
    secret.rotationState === "old_revoked";
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <h4 className="font-medium">Rotate service secret</h4>
      <p className="text-sm text-muted-foreground">
        Generate a replacement, deploy it to your backend, authenticate with it,
        then retire the old secret. Existing bearer tokens retain their own
        expiry. Other gateway instances refresh credential caches within{" "}
        {secret.cacheTtlSeconds ?? 300} seconds.
      </p>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="rotation-reason">Rotation reason</FieldLabel>
          <Input
            id="rotation-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
          />
        </Field>
        {environment === "live" ? (
          <Field>
            <FieldLabel htmlFor="rotation-live-phrase">
              Type APPLY LIVE CHANGE for rotation
            </FieldLabel>
            <Input
              id="rotation-live-phrase"
              value={typedPhrase}
              onChange={(event) => setTypedPhrase(event.target.value)}
            />
          </Field>
        ) : null}
      </FieldGroup>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!canStart || mutation.isPending}
          onClick={async () => setReplacement(await createReplacement())}
        >
          Generate replacement
        </Button>
        <Button
          type="button"
          disabled={
            !replacement || !canStart || !confirmed || mutation.isPending
          }
          onClick={() => apply("start")}
        >
          Start dual-valid rotation
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={
            secret.rotationState !== "active_dual_valid" ||
            !secret.replacementVerifiedAt ||
            !confirmed ||
            mutation.isPending
          }
          onClick={() => apply("verify")}
        >
          Verify replacement
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={
            secret.rotationState !== "old_pending_revoke" ||
            !confirmed ||
            mutation.isPending
          }
          onClick={() => apply("revoke-old")}
        >
          Revoke old secret
        </Button>
      </div>
      {replacement ? (
        <Field>
          <FieldLabel htmlFor="replacement-secret">
            One-time replacement secret
          </FieldLabel>
          <Input
            id="replacement-secret"
            readOnly
            value={replacement.plaintext}
          />
          <p className="text-sm text-muted-foreground">
            Save this in the backend secret manager. It is held only in this
            browser memory; reloading loses it.
          </p>
        </Field>
      ) : null}
      {mutation.error ? (
        <p role="alert">
          Rotation could not complete. Inspect the current version and retry the
          same action details; uncertain writes require operator reconciliation.
        </p>
      ) : null}
    </div>
  );
}
