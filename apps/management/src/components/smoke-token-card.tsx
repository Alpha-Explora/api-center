"use client";

import { useState } from "react";
import {
  CheckCircleIcon,
  CloudUploadIcon,
  CopyIcon,
  KeyRoundIcon,
  WandSparklesIcon,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  provisionTribeSecret,
  requestTribeToken,
} from "@/lib/api-center-client";
import { copyTextToClipboard } from "@/lib/client-clipboard";
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
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function SmokeTokenCard({
  defaultTribeId = "smoke-tribe",
  onTokenIssued,
}: {
  defaultTribeId?: string;
  onTokenIssued: (accessToken: string, tribeId: string) => void;
}) {
  const [tribeId, setTribeId] = useState(defaultTribeId);
  const [secret, setSecret] = useState("");
  const [hashPlaintext, setHashPlaintext] = useState("");
  const [secretHash, setSecretHash] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [expiresIn, setExpiresIn] = useState<number | undefined>();
  const [provisionedSecret, setProvisionedSecret] = useState<{
    secretName: string;
    versionName: string;
    rotatedAt: string;
  } | null>(null);
  const [manualCopy, setManualCopy] = useState<{
    label: string;
    value: string;
  } | null>(null);
  const normalizedTribeId = normalizeServiceId(tribeId || "smoke-tribe");
  const targetEnvironment = "test" as const;
  const secretManagerName = `api-center-tribe-secret-${normalizedTribeId || "smoke-tribe"}-${targetEnvironment}`;
  const localManagementMode =
    process.env.NEXT_PUBLIC_LOCAL_MANAGEMENT_MODE !== "false";

  const tokenMutation = useMutation({
    mutationFn: () =>
      requestTribeToken({
        tribeId: tribeId.trim(),
        secret,
      }),
    onSuccess: (token) => {
      setAccessToken(token.accessToken);
      setExpiresIn(token.expiresIn);
      onTokenIssued(token.accessToken, tribeId.trim());
      setSecret("");
      toast.success("Temporary token issued");
    },
    onError: (error) => {
      setAccessToken("");
      onTokenIssued("", tribeId.trim());
      toast.error("Token request failed", {
        description:
          getErrorMessage(error) ??
          "Check the tribe ID, plaintext secret, and API Center auth configuration.",
      });
    },
  });

  const provisionSecretMutation = useMutation({
    mutationFn: () =>
      provisionTribeSecret({
        tribeId: normalizedTribeId,
        sourceServiceId: normalizedTribeId,
        environment: targetEnvironment,
        secretHashSha256: secretHash,
        mode: "create-or-rotate",
      }),
    onSuccess: (result) => {
      setProvisionedSecret({
        secretName: result.secretName,
        versionName: result.versionName,
        rotatedAt: result.rotatedAt,
      });
      toast.success("Tribe secret provisioned");
    },
    onError: (error) => {
      toast.error("Secret provisioning failed", {
        description:
          getErrorMessage(error) ??
          "Check local gcloud impersonation or deployed Secret Manager auth.",
      });
    },
  });

  async function copyToken() {
    if (!accessToken) return;
    await copyText(accessToken, "Token copied", "access token");
  }

  async function generatePlaintextSecret() {
    const generated = generateRandomSecret();
    setHashPlaintext(generated);
    setSecret(generated);
    setSecretHash(await sha256Hex(generated));
    toast.success("Plaintext secret generated");
  }

  async function hashSecret() {
    if (!hashPlaintext) return;
    setSecretHash(await sha256Hex(hashPlaintext));
    toast.success("SHA-256 hash created");
  }

  async function copyHash() {
    if (!secretHash) return;
    await copyText(secretHash, "Hash copied", "SHA-256 hash");
  }

  async function copySecretManagerEntry() {
    if (!secretHash) return;
    await copyText(
      JSON.stringify(
        {
          tribeId: normalizedTribeId,
          sourceServiceId: normalizedTribeId,
          environment: targetEnvironment,
          secretHashSha256: secretHash,
          status: "active",
          rotatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "Secret Manager entry copied",
      "Secret Manager entry",
    );
  }

  async function copyText(value: string, successMessage: string, label: string) {
    let copied = false;

    try {
      copied = await copyTextToClipboard(value);
    } catch {
      copied = false;
    }

    if (copied) {
      setManualCopy(null);
      toast.success(successMessage);
      return;
    }

    setManualCopy({ label, value });
    toast.error("Copy was blocked", {
      description: "Select the displayed value and copy it manually.",
    });
  }

  function usePlaintextForToken() {
    setSecret(hashPlaintext);
    toast.success("Plaintext copied into token form");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <KeyRoundIcon data-icon="inline-start" />
              Request tribe token
            </CardTitle>
            <CardDescription>
              Use the tribe plaintext secret once to request a temporary API Center bearer token.
            </CardDescription>
          </div>
          {accessToken ? <Badge variant="secondary">token in memory</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert>
          <AlertTitle>Local-only credential flow</AlertTitle>
          <AlertDescription>
            The plaintext secret is submitted only to the local token route. The token is kept in
            React memory and disappears on refresh.
          </AlertDescription>
        </Alert>

        <div className="rounded-lg border bg-muted/25 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <WandSparklesIcon data-icon="inline-start" />
                Secret hash helper
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Generate or paste a plaintext secret, then provision the hash into Secret
                Manager as{" "}
                <span className="font-mono text-foreground">{secretManagerName}</span>.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={generatePlaintextSecret}>
              Generate secret
            </Button>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <Field>
              <FieldLabel htmlFor="smoke-secret-hasher">Plaintext to hash</FieldLabel>
              <Input
                id="smoke-secret-hasher"
                type="password"
                value={hashPlaintext}
                onChange={(event) => {
                  setHashPlaintext(event.target.value);
                  setSecretHash("");
                }}
                placeholder="Generate or paste a plaintext secret"
              />
              <FieldDescription>
                This stays in your browser. Store only the hash in Secret Manager.
              </FieldDescription>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={hashSecret}
                disabled={!hashPlaintext}
              >
                Create hash
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={usePlaintextForToken}
                disabled={!hashPlaintext}
              >
                Use for token
              </Button>
            </div>
          </div>

          {secretHash ? (
            <div className="mt-4 rounded-lg border bg-background p-3">
              <div className="text-xs font-medium text-muted-foreground">
                Secret Manager payload
              </div>
              <div className="mt-2 break-all font-mono text-sm">
                {JSON.stringify({
                  tribeId: normalizedTribeId,
                  sourceServiceId: normalizedTribeId,
                  environment: targetEnvironment,
                  secretHashSha256: secretHash,
                  status: "active",
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={copyHash}>
                  <CopyIcon data-icon="inline-start" />
                  Copy hash
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={copySecretManagerEntry}>
                  <CopyIcon data-icon="inline-start" />
                  Copy payload
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => provisionSecretMutation.mutate()}
                  disabled={
                    !localManagementMode ||
                    !normalizedTribeId ||
                    !secretHash ||
                    provisionSecretMutation.isPending
                  }
                >
                  <CloudUploadIcon data-icon="inline-start" />
                  Provision secret
                </Button>
              </div>
              {provisionedSecret ? (
                <div className="mt-3 rounded-md border bg-[var(--brand-green-soft)] p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium text-[var(--brand-green-deep)]">
                    <CheckCircleIcon data-icon="inline-start" />
                    Secret Manager version created
                  </div>
                  <div className="mt-2 break-all font-mono text-xs">
                    {provisionedSecret.secretName}
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {provisionedSecret.versionName}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    API Center can validate this without a restart after
                    `TRIBE_SECRET_SOURCE=gcp-secret-manager` is enabled.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 rounded-lg border bg-muted/10 p-3 md:grid-cols-[minmax(12rem,0.65fr)_minmax(0,1fr)_auto] md:items-end">
          <Field>
            <FieldLabel htmlFor="smoke-tribe-id" className="h-5 w-full items-center">
              Tribe ID
            </FieldLabel>
            <Input
              id="smoke-tribe-id"
              value={tribeId}
              onChange={(event) => setTribeId(event.target.value)}
              placeholder="smoke-tribe"
            />
          </Field>
          <Field>
            <FieldLabel
              htmlFor="smoke-tribe-secret"
              className="h-5 w-full items-center justify-between"
            >
              <span>Plaintext tribe secret</span>
              <Badge variant="outline" className="hidden sm:inline-flex">
                Paste plaintext, not hash
              </Badge>
            </FieldLabel>
            <Input
              id="smoke-tribe-secret"
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="Paste the temporary smoke secret"
            />
          </Field>
          <Button
            type="button"
            onClick={() => tokenMutation.mutate()}
            disabled={!tribeId.trim() || !secret || tokenMutation.isPending}
          >
            Request token
          </Button>
        </div>

        {accessToken ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/35 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs text-muted-foreground">Access token</div>
              <div className="mt-1 font-mono text-sm">{maskToken(accessToken)}</div>
              {expiresIn ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  Expires in about {Math.round(expiresIn / 60)} minutes.
                </div>
              ) : null}
            </div>
            <Button type="button" variant="outline" onClick={copyToken}>
              <CopyIcon data-icon="inline-start" />
              Copy token
            </Button>
          </div>
        ) : null}

        {manualCopy ? (
          <div className="rounded-lg border border-destructive/30 bg-[#fff7f7] p-3">
            <div className="text-xs font-medium text-destructive">
              Manual copy fallback: {manualCopy.label}
            </div>
            <textarea
              readOnly
              value={manualCopy.value}
              className="mt-2 min-h-20 w-full resize-y rounded-lg border bg-background p-2 font-mono text-sm"
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : undefined;
}

function maskToken(token: string) {
  if (token.length <= 18) return "<issued>";
  return `${token.slice(0, 10)}...${token.slice(-8)}`;
}

function normalizeServiceId(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "smoke-tribe";
}

function generateRandomSecret() {
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
