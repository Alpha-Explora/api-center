"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { request } from "@/lib/api-center/client-core";

type Result = {
  ownerTribeId: string;
  consumerServiceId: string;
  environment: "test" | "live";
  apiKey: string;
  keyPrefix: string;
  eventDelivery?: {
    status: "active";
    subscriptionName?: string;
    topicName?: string;
  };
};

type ApiResponse = {
  success: boolean;
  data?: Result;
  error?: { message?: string };
};

export function PaymentConsumerServicePanel() {
  const [result, setResult] = useState<Result | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [ownerTribeId, setOwnerTribeId] = useState("");
  const [environment, setEnvironment] = useState<"test" | "live">("test");
  const [pushEndpoint, setPushEndpoint] = useState("");
  const [deliveryServiceAccountEmail, setDeliveryServiceAccountEmail] =
    useState("");
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
          pushEndpoint: pushEndpoint || undefined,
          deliveryServiceAccountEmail:
            deliveryServiceAccountEmail || undefined,
        }),
      });

      if (!payload.success || !payload.data) {
        throw new Error(payload.error?.message ?? "Registration failed");
      }
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
        "/api/local/payment-consumers/" + encodeURIComponent(serviceId) + "/rotate-key",
        {
          method: "POST",
          body: JSON.stringify({ ownerTribeId, environment }),
        },
      );

      if (!payload.success || !payload.data) {
        throw new Error(payload.error?.message ?? "Rotation failed");
      }
      setResult(payload.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Rotation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Payment consumers
      </p>
      <h2 className="mt-2 text-xl font-semibold">Register or rotate a consumer key</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Keys are displayed once. Store the generated value in the consumer&apos;s
        secret manager immediately.
      </p>

      <form className="mt-6 grid gap-4" onSubmit={register}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium" htmlFor="ownerTribeId">
            Owner tribe
            <input
              className="h-10 rounded-md border bg-background px-3 font-normal"
              id="ownerTribeId"
              value={ownerTribeId}
              onChange={(event) => setOwnerTribeId(event.target.value)}
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="serviceId">
            Consumer service ID
            <input
              className="h-10 rounded-md border bg-background px-3 font-normal"
              id="serviceId"
              value={serviceId}
              onChange={(event) => setServiceId(event.target.value)}
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="environment">
            Environment
            <select
              className="h-10 rounded-md border bg-background px-3 font-normal"
              id="environment"
              value={environment}
              onChange={(event) =>
                setEnvironment(event.target.value as "test" | "live")
              }
            >
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </label>
          <label
            className="grid gap-2 text-sm font-medium"
            htmlFor="deliveryServiceAccountEmail"
          >
            Delivery service account
            <input
              className="h-10 rounded-md border bg-background px-3 font-normal"
              id="deliveryServiceAccountEmail"
              type="email"
              value={deliveryServiceAccountEmail}
              onChange={(event) =>
                setDeliveryServiceAccountEmail(event.target.value)
              }
            />
          </label>
        </div>

        <label className="grid gap-2 text-sm font-medium" htmlFor="pushEndpoint">
          Cloud Run event endpoint
          <input
            className="h-10 rounded-md border bg-background px-3 font-normal"
            id="pushEndpoint"
            type="url"
            placeholder="https://service-xxxxx-uc.a.run.app/api/v1/payments/events"
            value={pushEndpoint}
            onChange={(event) => setPushEndpoint(event.target.value)}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            {busy ? "Working..." : "Register consumer"}
          </button>
          <button
            className="rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={busy || !serviceId || !ownerTribeId}
            type="button"
            onClick={rotate}
          >
            Rotate key
          </button>
        </div>
      </form>

      {error ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm" role="status">
          <strong>Generated key, shown once</strong>
          <p className="mt-1 text-muted-foreground">
            Prefix: <code>{result.keyPrefix}</code>. Management does not store
            this plaintext value.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded bg-white px-2 py-1">{result.apiKey}</code>
            <button
              className="rounded-md border bg-white px-3 py-1 text-xs font-semibold"
              type="button"
              onClick={() => navigator.clipboard.writeText(result.apiKey)}
            >
              Copy
            </button>
          </div>
          {result.eventDelivery ? (
            <p className="mt-2 text-muted-foreground">
              Delivery: <span className="font-semibold">{result.eventDelivery.status}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}