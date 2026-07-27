"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { request } from "@/lib/api-center/client-core";

type PaymentScope = "payments:read" | "payments:write";
type Result = {
  ownerTribeId: string;
  consumerServiceId: string;
  environment: "test" | "live";
  apiKey: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  status: "active" | "revoked";
  eventDelivery?: {
    status: "pending_validation" | "active" | "delivery_failed" | "revoked";
    subscriptionName?: string;
    topicName?: string;
    lastDeliveryAt: string | null;
    deadLetterCount: number | null;
  };
};

type ApiResponse = { success: boolean; data?: Result; error?: { message?: string } };

export function PaymentConsumerServicePanel() {
  const [result, setResult] = useState<Result | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [ownerTribeId, setOwnerTribeId] = useState("");
  const [environment, setEnvironment] = useState<"test" | "live">("test");
  const [scopes, setScopes] = useState<PaymentScope[]>(["payments:read", "payments:write"]);
  const [pushEndpoint, setPushEndpoint] = useState("");
  const [deliveryServiceAccountEmail, setDeliveryServiceAccountEmail] = useState("");
  const [consumerProjectId, setConsumerProjectId] = useState("");
  const [cloudRunRegion, setCloudRunRegion] = useState("asia-southeast1");
  const [cloudRunServiceName, setCloudRunServiceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const payload = await request<ApiResponse>("/api/local/payment-consumers", {
        method: "POST",
        body: JSON.stringify({
          ownerTribeId,
          consumerServiceId: serviceId,
          environment,
          scopes,
          pushEndpoint: pushEndpoint || undefined,
          eventEndpointUrl: pushEndpoint || undefined,
          deliveryServiceAccountEmail: deliveryServiceAccountEmail || undefined,
          consumerProjectId: consumerProjectId || undefined,
          cloudRunRegion: cloudRunRegion || undefined,
          cloudRunServiceName: cloudRunServiceName || undefined,
        }),
      });
      if (!payload.success || !payload.data) throw new Error(payload.error?.message ?? "Registration failed");
      setResult(payload.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const payload = await request<ApiResponse>(
        `/api/local/payment-consumers/${encodeURIComponent(serviceId)}/rotate-key`,
        { method: "POST", body: JSON.stringify({ ownerTribeId, environment, scopes }) },
      );
      if (!payload.success || !payload.data) throw new Error(payload.error?.message ?? "Rotation failed");
      setResult(payload.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Rotation failed");
    } finally {
      setBusy(false);
    }
  }

  function toggleScope(scope: PaymentScope) {
    setScopes((current) => current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope]);
  }

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Payment consumers</p>
      <h2 className="mt-2 text-xl font-semibold">Register or rotate a consumer key</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The generated key is shown once. Store it in the consumer&apos;s Secret Manager immediately; APICenter stores only a hash.
      </p>

      <form className="mt-6 grid gap-4" onSubmit={register}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium" htmlFor="ownerTribeId">Owner tribe<input className="h-10 rounded-md border bg-background px-3 font-normal" id="ownerTribeId" value={ownerTribeId} onChange={(event) => setOwnerTribeId(event.target.value)} required /></label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="serviceId">Consumer service ID<input className="h-10 rounded-md border bg-background px-3 font-normal" id="serviceId" value={serviceId} onChange={(event) => setServiceId(event.target.value)} required /></label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="environment">Environment<select className="h-10 rounded-md border bg-background px-3 font-normal" id="environment" value={environment} onChange={(event) => setEnvironment(event.target.value as "test" | "live")}><option value="test">Test</option><option value="live">Live</option></select></label>
          <fieldset className="grid gap-2 text-sm font-medium"><legend>Scopes</legend><div className="flex flex-wrap gap-3 font-normal"><label className="flex items-center gap-2"><input type="checkbox" checked={scopes.includes("payments:read")} onChange={() => toggleScope("payments:read")} /> payments:read</label><label className="flex items-center gap-2"><input type="checkbox" checked={scopes.includes("payments:write")} onChange={() => toggleScope("payments:write")} /> payments:write</label></div></fieldset>
          <label className="grid gap-2 text-sm font-medium" htmlFor="deliveryServiceAccountEmail">Delivery service account<input className="h-10 rounded-md border bg-background px-3 font-normal" id="deliveryServiceAccountEmail" type="email" value={deliveryServiceAccountEmail} onChange={(event) => setDeliveryServiceAccountEmail(event.target.value)} /></label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="consumerProjectId">Consumer GCP project<input className="h-10 rounded-md border bg-background px-3 font-normal" id="consumerProjectId" value={consumerProjectId} onChange={(event) => setConsumerProjectId(event.target.value)} /></label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="cloudRunRegion">Cloud Run region<input className="h-10 rounded-md border bg-background px-3 font-normal" id="cloudRunRegion" value={cloudRunRegion} onChange={(event) => setCloudRunRegion(event.target.value)} /></label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="cloudRunServiceName">Cloud Run service name<input className="h-10 rounded-md border bg-background px-3 font-normal" id="cloudRunServiceName" value={cloudRunServiceName} onChange={(event) => setCloudRunServiceName(event.target.value)} /></label>
        </div>
        <label className="grid gap-2 text-sm font-medium" htmlFor="pushEndpoint">Cloud Run event endpoint<input className="h-10 rounded-md border bg-background px-3 font-normal" id="pushEndpoint" type="url" placeholder="https://service-xxxxx-uc.a.run.app/api/v1/payments/events" value={pushEndpoint} onChange={(event) => setPushEndpoint(event.target.value)} /></label>
        <div className="flex flex-wrap gap-2"><button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={busy || scopes.length === 0} type="submit">{busy ? "Working..." : "Register consumer"}</button><button className="rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy || !serviceId || !ownerTribeId || scopes.length === 0} type="button" onClick={rotate}>Rotate key</button></div>
      </form>

      {error ? <p className="mt-4 text-sm text-destructive" role="alert">{error}</p> : null}
      {result ? <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm" role="status">
        <strong>Generated key, shown once</strong>
        <p className="mt-1 text-muted-foreground">Copy this value now. Only the prefix, hash-backed lifecycle metadata, and scopes remain available later.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2"><code className="rounded bg-white px-2 py-1">{result.apiKey}</code><button className="rounded-md border bg-white px-3 py-1 text-xs font-semibold" type="button" onClick={() => navigator.clipboard.writeText(result.apiKey)}>Copy</button></div>
        <dl className="mt-3 grid gap-1 text-muted-foreground sm:grid-cols-2"><div><dt className="inline font-semibold">Prefix:</dt> <dd className="inline"><code>{result.keyPrefix}</code></dd></div><div><dt className="inline font-semibold">Scopes:</dt> <dd className="inline">{result.scopes.join(", ")}</dd></div><div><dt className="inline font-semibold">Created:</dt> <dd className="inline">{new Date(result.createdAt).toLocaleString()}</dd></div><div><dt className="inline font-semibold">Expires:</dt> <dd className="inline">{result.expiresAt ? new Date(result.expiresAt).toLocaleString() : "No expiry"}</dd></div><div><dt className="inline font-semibold">Key status:</dt> <dd className="inline">{result.status}</dd></div></dl>
        {result.eventDelivery ? <div className="mt-3 border-t border-emerald-200 pt-3 text-muted-foreground"><div>Delivery: <span className="font-semibold">{result.eventDelivery.status}</span></div><div>Last delivery: {result.eventDelivery.lastDeliveryAt ? new Date(result.eventDelivery.lastDeliveryAt).toLocaleString() : "No delivery recorded"}</div><div>Dead-letter count: {result.eventDelivery.deadLetterCount ?? "Unavailable until telemetry is connected"}</div></div> : null}
      </div> : null}
    </section>
  );
}