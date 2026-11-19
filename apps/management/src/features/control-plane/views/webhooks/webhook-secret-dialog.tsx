"use client";
import { SecretDialog } from "@/components/patterns/secret-dialog";
import { formatDateTime } from "@/lib/format";
import { WEBHOOK_HEADERS } from "../../model/event-destinations";

export type IssuedSigningSecret = {
  signingSecret: string;
  applicationName: string;
  /** Set after a rotation: when the old secret stops signing. Null when there was none. */
  previousSecretExpiresAt?: string | null;
  rotated: boolean;
};

/** Shows a webhook signing secret once, with how to verify deliveries. */
export function WebhookSecretDialog({ issued, onClose }: { issued: IssuedSigningSecret | null; onClose: () => void }) {
  return (
    <SecretDialog
      secret={issued?.signingSecret ?? null}
      title={issued?.rotated ? "Copy the new signing secret" : "Copy this signing secret now"}
      description={`It will not be shown again. Store it with ${issued?.applicationName ?? "the application"} and use it to verify every delivery.`}
      details={
        issued ? (
          <div className="flex flex-col gap-2 text-xs text-muted-foreground">
            {issued.rotated ? (
              <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-foreground">
                {issued.previousSecretExpiresAt
                  ? `The previous secret also signs deliveries until ${formatDateTime(issued.previousSecretExpiresAt)}. Deploy this one before then.`
                  : "There was no previous secret; only this one signs deliveries."}
              </p>
            ) : null}
            <div className="rounded-md border px-3 py-2">
              <p className="font-medium text-foreground">Verifying deliveries</p>
              <p className="mt-1">
                Deliveries follow Standard Webhooks and carry{" "}
                {WEBHOOK_HEADERS.map((header, index) => (
                  <span key={header}>
                    <code className="font-mono text-foreground">{header}</code>
                    {index < WEBHOOK_HEADERS.length - 1 ? ", " : ""}
                  </span>
                ))}
                . The signature is HMAC-SHA256 of <code className="font-mono text-foreground">id.timestamp.body</code>, keyed with the base64 part after{" "}
                <code className="font-mono text-foreground">whsec_</code>. Check it against the raw body and refuse old timestamps.{" "}
                <code className="font-mono text-foreground">verifyWebhook</code> in{" "}
                <code className="font-mono text-foreground">@alpha-explora/apicenter-sdk</code> does both.
              </p>
            </div>
          </div>
        ) : null
      }
      onClose={onClose}
    />
  );
}
