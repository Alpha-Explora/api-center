import { CloudUploadIcon, CopyIcon, KeyRoundIcon } from "lucide-react";
import { OperationPreviewPanel } from "@/components/operation-preview-panel";
import { TribeSecretRotationWorkflow } from "@/components/service-detail/service-detail-sections";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { OperationPreview } from "@/lib/api-center-client";

type RuntimeEnvironment = "test" | "live";

export function TribeSecretProvisionCard({
  serviceId,
  environment,
  plaintextSecret,
  secretHash,
  provisionedSecret,
  manualCopy,
  pending,
  onGenerate,
  onCopy,
  onProvision,
  operationPreview,
  previewPending,
  onPreview,
  typedPhrase,
  operatorReason,
  onEnvironmentChange,
  onTypedPhraseChange,
  onOperatorReasonChange,
}: {
  serviceId: string;
  environment: RuntimeEnvironment;
  plaintextSecret: string;
  secretHash: string;
  provisionedSecret: { secretName: string; versionName: string } | null;
  manualCopy: { label: string; value: string } | null;
  pending: boolean;
  onGenerate: () => void;
  onCopy: () => void;
  onProvision: () => void;
  operationPreview: OperationPreview | null;
  previewPending: boolean;
  onPreview: () => void;
  typedPhrase: string;
  operatorReason: string;
  onEnvironmentChange: (value: RuntimeEnvironment) => void;
  onTypedPhraseChange: (value: string) => void;
  onOperatorReasonChange: (value: string) => void;
}) {
  const secretName = `api-center-tribe-secret-${serviceId}-${environment}`;
  const isLive = environment === "live";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon data-icon="inline-start" />
          Tribe secret
        </CardTitle>
        <CardDescription>
          Generate a one-time plaintext secret and store only its SHA-256 hash in
          Secret Manager.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label
            className="flex flex-col gap-2 text-sm font-medium"
            htmlFor="tribe-secret-environment"
          >
            Target environment
            <select
              id="tribe-secret-environment"
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={environment}
              onChange={(event) =>
                onEnvironmentChange(event.target.value as RuntimeEnvironment)
              }
            >
              <option value="test">test</option>
              <option value="live">live</option>
            </select>
          </label>
          <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
            Live secret writes require the typed phrase and operator reason for
            the target environment, regardless of where Management is deployed.
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="tribe-generated-secret" className="text-sm font-medium">
            One-time plaintext secret
          </label>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <Input
              id="tribe-generated-secret"
              readOnly
              value={plaintextSecret}
              placeholder="Generate before giving this to the tribe backend owner"
            />
            <div className="flex flex-wrap gap-2 md:justify-end">
              <Button type="button" variant="outline" onClick={onGenerate}>
                Generate
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onCopy}
                disabled={!plaintextSecret}
              >
                <CopyIcon data-icon="inline-start" />
                Copy
              </Button>
              <Button
                type="button"
                onClick={onProvision}
                disabled={!secretHash || pending}
              >
                <CloudUploadIcon data-icon="inline-start" />
                Provision secret
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            The local console keeps this only in browser memory. Secret Manager
            receives the hash.
          </p>
        </div>
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="text-xs font-medium text-muted-foreground">
            Secret Manager name
          </div>
          <div className="mt-1 break-all font-mono text-sm">{secretName}</div>
          {secretHash ? (
            <div className="mt-2 break-all font-mono text-xs text-muted-foreground">
              hash: {secretHash}
            </div>
          ) : null}
        </div>
        <TribeSecretRotationWorkflow
          secretName={secretName}
          hasGeneratedSecret={Boolean(secretHash)}
          provisionedVersionName={provisionedSecret?.versionName}
        />
        <OperationPreviewPanel
          title="Secret operation preview"
          description="Preview the Secret Manager create-or-rotate operation before provisioning."
          preview={operationPreview}
          live={isLive}
          typedPhrase={typedPhrase}
          reason={operatorReason}
          previewPending={previewPending}
          onPreview={onPreview}
          onTypedPhraseChange={onTypedPhraseChange}
          onReasonChange={onOperatorReasonChange}
        />
        {provisionedSecret ? (
          <Alert>
            <AlertTitle>Secret provisioned</AlertTitle>
            <AlertDescription>
              {provisionedSecret.secretName} latest version: {" "}
              {provisionedSecret.versionName}
            </AlertDescription>
          </Alert>
        ) : null}
        {manualCopy ? (
          <div className="rounded-lg border border-destructive/30 bg-[#fff7f7] p-3">
            <div className="text-xs font-medium text-destructive">
              Manual copy fallback: {manualCopy.label}
            </div>
            <Textarea
              readOnly
              value={manualCopy.value}
              className="mt-2 min-h-20 font-mono text-sm"
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}