"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldGroup, Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { loadRequests } from "../data/diagnostics-repository";

export function RequestDiagnosticsPanel({ serviceId }: { serviceId?: string }) {
  const [environment, setEnvironment] = useState<"test" | "live">("test");
  const [input, setInput] = useState("");
  const [correlationId, setCorrelationId] = useState("");
  const records = useQuery({
    queryKey: ["request-diagnostics", serviceId, environment, correlationId],
    queryFn: () => loadRequests(serviceId, environment, correlationId),
    retry: false,
    enabled: Boolean(serviceId || correlationId),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {serviceId
            ? "Request diagnostics"
            : "Unattributed authentication failures"}
        </CardTitle>
        <CardDescription>
          {serviceId
            ? "Latest 50 requests in the last 24 hours. Search by the correlation ID returned with the response."
            : "Platform administrators can look up an authentication failure by correlation ID. Unverified credentials are never used to infer tenant ownership."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setCorrelationId(input);
          }}
        >
          <FieldGroup>
            {serviceId ? (
              <Field>
                <FieldLabel htmlFor="diagnostic-environment">
                  Environment
                </FieldLabel>
                <select
                  id="diagnostic-environment"
                  value={environment}
                  onChange={(event) => {
                    if (
                      event.target.value === "test" ||
                      event.target.value === "live"
                    )
                      setEnvironment(event.target.value);
                  }}
                >
                  <option value="test">Test</option>
                  <option value="live">Live</option>
                </select>
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="diagnostic-correlation">
                Correlation ID
              </FieldLabel>
              <Input
                id="diagnostic-correlation"
                value={input}
                maxLength={128}
                onChange={(event) => setInput(event.target.value)}
              />
            </Field>
            <Button type="submit" variant="outline">
              Find requests
            </Button>
          </FieldGroup>
        </form>
        {!serviceId && !correlationId ? (
          <p>Enter a correlation ID to look up a request.</p>
        ) : records.isPending ? (
          <p role="status">Loading requests…</p>
        ) : records.error ? (
          <p role="alert">
            Request diagnostics are unavailable. Check gateway access and retry.
          </p>
        ) : !records.data?.length ? (
          <p>No matching requests recorded.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {records.data.map((record) => (
              <li
                key={record.requestId}
                className="rounded-md border p-3 text-sm"
              >
                <p className="font-medium">
                  {record.method} {record.route} · HTTP {record.statusCode}
                </p>
                <p>
                  {record.occurredAt} · {record.durationMs} ms
                </p>
                <p>
                  Failure stage: {record.failureStage ?? "None"}
                  {record.errorCode ? ` · ${record.errorCode}` : ""}
                </p>
                <p className="break-all font-mono">
                  Correlation: {record.correlationId}
                </p>
                {serviceId && record.paymentResourceId ? (
                  <a
                    className="underline"
                    href={`/tribes/${encodeURIComponent(serviceId)}?section=evidence&environment=${environment}&paymentResource=${encodeURIComponent(record.paymentResourceId)}`}
                  >
                    View events for {record.paymentResourceId}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
