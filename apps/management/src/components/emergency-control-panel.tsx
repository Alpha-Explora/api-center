"use client";

import { useState } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ActionReadiness } from "@/components/action-readiness";

const confirmationPhrase = "APPLY LIVE CHANGE";

export function EmergencyControlPanel({
  onApply,
}: {
  onApply: (input: {
    targetType: string;
    targetId: string;
    mode: string;
    reason: string;
    confirmation: {
      typedPhrase: string;
      reason: string;
    };
  }) => void;
}) {
  const [targetType, setTargetType] = useState("tribe");
  const [targetId, setTargetId] = useState("");
  const [mode, setMode] = useState("pause");
  const [reason, setReason] = useState("");
  const [typedPhrase, setTypedPhrase] = useState("");
  const canApply =
    Boolean(targetId.trim()) &&
    Boolean(reason.trim()) &&
    typedPhrase === confirmationPhrase;
  const targetReady = Boolean(targetId.trim());
  const reasonReady = Boolean(reason.trim());
  const confirmationReady = typedPhrase === confirmationPhrase;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangleIcon data-icon="inline-start" />
          Emergency controls
        </CardTitle>
        <CardDescription>
          Apply a temporary containment mode only after reviewing the target,
          impact, and audit reason.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canApply) return;
            onApply({
              targetType,
              targetId: targetId.trim(),
              mode,
              reason: reason.trim(),
              confirmation: {
                typedPhrase,
                reason: reason.trim(),
              },
            });
          }}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="emergency-target-id">Target ID</FieldLabel>
              <Input
                id="emergency-target-id"
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
                placeholder="campus-one"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="emergency-target-type">Target type</FieldLabel>
              <select
                id="emergency-target-type"
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                value={targetType}
                onChange={(event) => setTargetType(event.target.value)}
              >
                <option value="tribe">Tribe</option>
                <option value="service">Service</option>
                <option value="shared-service">Shared service</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="emergency-mode">Mode</FieldLabel>
              <select
                id="emergency-mode"
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                value={mode}
                onChange={(event) => setMode(event.target.value)}
              >
                <option value="pause">Pause</option>
                <option value="isolate">Isolate</option>
                <option value="quota_lockdown">Quota lockdown</option>
                <option value="observe_only">Rollback to observe</option>
              </select>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="emergency-reason">Reason</FieldLabel>
            <Textarea
              id="emergency-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <FieldDescription>
              Required audit context for the incident or containment decision.
            </FieldDescription>
          </Field>

          <Alert>
            <AlertTitle>Review before applying</AlertTitle>
            <AlertDescription>
              This will set {targetId.trim() || "the selected target"} to{" "}
              {formatMode(mode)}. Type {confirmationPhrase} to enable the
              emergency control.
            </AlertDescription>
          </Alert>

          <Field>
            <FieldLabel htmlFor="emergency-confirmation">
              Confirmation phrase
            </FieldLabel>
            <Input
              id="emergency-confirmation"
              value={typedPhrase}
              onChange={(event) => setTypedPhrase(event.target.value)}
              placeholder={`Type ${confirmationPhrase}`}
            />
          </Field>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <ActionReadiness
              title="Before applying"
              items={[
                {
                  label: "Target ID",
                  ready: targetReady,
                  detail: targetReady
                    ? `${targetId.trim()} is selected.`
                    : "Enter the service, tribe, or shared-service identifier.",
                },
                {
                  label: "Audit reason",
                  ready: reasonReady,
                  detail: reasonReady
                    ? "Audit context is captured."
                    : "Add the incident or containment reason.",
                },
                {
                  label: "Confirmation phrase",
                  ready: confirmationReady,
                  detail: confirmationReady
                    ? "Typed phrase matches exactly."
                    : `Type ${confirmationPhrase} exactly.`,
                },
              ]}
            />
            <Button type="submit" variant="destructive" disabled={!canApply}>
              Apply emergency control
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function formatMode(value: string) {
  return value.replaceAll("_", " ");
}
