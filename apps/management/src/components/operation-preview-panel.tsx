import type { OperationPreview } from "@/lib/api-center-client";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function OperationPreviewPanel({
  title,
  description,
  preview,
  live,
  typedPhrase,
  reason,
  previewPending,
  onPreview,
  onTypedPhraseChange,
  onReasonChange,
}: {
  title: string;
  description: string;
  preview?: OperationPreview | null;
  live: boolean;
  typedPhrase: string;
  reason: string;
  previewPending?: boolean;
  onPreview: () => void;
  onTypedPhraseChange: (value: string) => void;
  onReasonChange: (value: string) => void;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="mt-1 text-sm text-muted-foreground">{description}</div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPreview}
          disabled={previewPending}
        >
          Preview operation
        </Button>
      </div>
      {preview ? (
        <div className="mt-3 flex flex-col gap-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {preview.environment} / {preview.risk}
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {preview.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
          {live && preview.confirmationPhrase ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="live-confirmation-phrase">
                  Type {preview.confirmationPhrase}
                </FieldLabel>
                <Input
                  id="live-confirmation-phrase"
                  value={typedPhrase}
                  onChange={(event) => onTypedPhraseChange(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="live-operator-reason">
                  Change reason
                </FieldLabel>
                <Textarea
                  id="live-operator-reason"
                  value={reason}
                  onChange={(event) => onReasonChange(event.target.value)}
                />
                <FieldDescription>
                  Required for live writes and included in audit metadata.
                </FieldDescription>
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
