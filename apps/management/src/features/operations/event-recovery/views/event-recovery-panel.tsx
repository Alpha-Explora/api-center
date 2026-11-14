"use client";
import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { loadEvents, replayEvent } from "../data/event-recovery-repository";

export function EventRecoveryPanel({ serviceId }: { serviceId: string }) {
  const search = useSearchParams();
  const resource = search.get("paymentResource");
  const [environment, setEnvironment] = useState<"test" | "live">(
    search.get("environment") === "live" ? "live" : "test",
  );
  const [reason, setReason] = useState("");
  const [typedPhrase, setTypedPhrase] = useState("");
  const operations = useRef(new Map<string, string>());
  const client = useQueryClient();
  const queryKey = ["payment-event-recovery", serviceId, environment];
  const events = useQuery({
    queryKey,
    queryFn: () => loadEvents(serviceId, environment),
    retry: false,
  });
  const replay = useMutation({
    mutationFn: replayEvent,
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  function replayOne(eventId: string) {
    const key = JSON.stringify({ serviceId, environment, eventId, reason });
    const operationId = operations.current.get(key) ?? crypto.randomUUID();
    operations.current.set(key, operationId);
    replay.mutate(
      { serviceId, environment, eventId, operationId, reason, typedPhrase },
      {
        onSuccess: (result) => {
          if (result.status === "published" || result.status === "failed")
            operations.current.delete(key);
        },
      },
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment event recovery</CardTitle>
        <CardDescription>
          Publication status is separate from consumer acknowledgement. Replay
          preserves the original event identity and does not repeat a payment
          command.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {resource ? (
          <p>
            Showing events for {resource} within the latest 50 events.{" "}
            <a
              className="underline"
              href={`/tribes/${encodeURIComponent(serviceId)}?section=evidence`}
            >
              Clear resource filter
            </a>
          </p>
        ) : null}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="event-environment">Environment</FieldLabel>
            <select
              id="event-environment"
              value={environment}
              onChange={(event) => {
                if (
                  event.target.value === "test" ||
                  event.target.value === "live"
                ) {
                  setEnvironment(event.target.value);
                  setTypedPhrase("");
                }
              }}
            >
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="event-reason">Replay reason</FieldLabel>
            <Input
              id="event-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
            />
          </Field>
          {environment === "live" ? (
            <Field>
              <FieldLabel htmlFor="event-live-phrase">
                Type APPLY LIVE CHANGE
              </FieldLabel>
              <Input
                id="event-live-phrase"
                value={typedPhrase}
                onChange={(event) => setTypedPhrase(event.target.value)}
              />
            </Field>
          ) : null}
        </FieldGroup>
        {events.isPending ? (
          <p role="status">Loading events…</p>
        ) : events.error ? (
          <p role="alert">
            Event state unavailable. Check the payments runtime configuration.
          </p>
        ) : !events.data?.length ? (
          <p>No events recorded for this service and environment.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {events.data
              .filter((event) => !resource || event.aggregateId === resource)
              .map((event) => (
                <li key={event.id} className="rounded-md border p-3 text-sm">
                  <p className="font-medium">
                    {event.eventType} · version {event.aggregateVersion}
                  </p>
                  <p className="break-all font-mono">{event.eventId}</p>
                  <p>
                    Outbox: {event.status} · Replay:{" "}
                    {event.replayStatus ?? "Not requested"}
                  </p>
                  <p>
                    Consumer acknowledgement: Unknown · Dead-letter count:
                    Unknown
                  </p>
                  {event.replayStatus === "uncertain" ||
                  event.replayStatus === "running" ? (
                    <p>
                      Reconcile the existing attempt before requesting another
                      replay.
                    </p>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        replay.isPending ||
                        !reason.trim() ||
                        (environment === "live" &&
                          typedPhrase !== "APPLY LIVE CHANGE")
                      }
                      onClick={() => replayOne(event.id)}
                    >
                      Replay original event
                    </Button>
                  )}
                </li>
              ))}
          </ul>
        )}
        {replay.error ? (
          <p role="alert">
            Replay did not complete. Retry with the same details to preserve its
            operation ID.
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={events.isFetching}
          onClick={() => events.refetch()}
        >
          Refresh event state
        </Button>
      </CardContent>
    </Card>
  );
}
