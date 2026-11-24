"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FormRow, NativeSelect } from "@/components/patterns/form";
import { ErrorPanel } from "@/components/patterns/notices";
import { fieldErrors } from "../../model/form-errors";
import type { Application } from "../../model/control-plane";
import { eventDestinations } from "../../data/event-destinations";
import {
  createOutcome,
  liveDestinationFor,
  webhookBody,
  webhookFormSchema,
  type CreatedWebhook,
  type EventDestination,
  type WebhookForm,
} from "../../model/event-destinations";
import { ALL_EVENT_TYPES, eventTypesBody, type EventTypeSelection } from "../../model/event-types";
import { eventDestinationsKey, useEventTypeCatalogue } from "../../view-models/event-destinations";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { EventTypesPicker } from "./event-types-picker";

const EMPTY_WEBHOOK: WebhookForm = { recipientApplicationId: "", url: "" };

export function CreateDestinationSheet({
  open,
  onOpenChange,
  applications,
  destinations,
  onWebhookCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applications: Application[];
  destinations: EventDestination[];
  onWebhookCreated: (destination: CreatedWebhook) => void;
}) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const client = useQueryClient();
  const scope = { organizationId, projectId: project.id, kind };
  const [webhook, setWebhook] = useState<WebhookForm>(EMPTY_WEBHOOK);
  const [eventTypes, setEventTypes] = useState<EventTypeSelection>(ALL_EVENT_TYPES);
  const catalogue = useEventTypeCatalogue();
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => eventDestinations.createWebhook(scope, webhookBody(webhook, chosenTypes.ok ? chosenTypes.eventTypes : [])),
    onSettled: () => client.invalidateQueries({ queryKey: eventDestinationsKey(organizationId, project.id, kind) }),
    onSuccess: (created) => {
      // The gateway answers 200 even when provisioning failed; that is a failure, not a new endpoint.
      const outcome = createOutcome(created);
      if (outcome.kind === "failed") {
        setFailure(outcome.error);
        return;
      }
      close(false);
      onWebhookCreated(created);
    },
  });

  const parsed = webhookFormSchema.safeParse(webhook);
  const chosenTypes = eventTypesBody(eventTypes);
  const errors = submitted ? fieldErrors(parsed.error) : {};
  function close(next: boolean) {
    if (!next) {
      setWebhook(EMPTY_WEBHOOK);
      setEventTypes(ALL_EVENT_TYPES);
      setSubmitted(false);
      setFailure(null);
      create.reset();
    }
    onOpenChange(next);
  }

  const recipients = applications.filter((application) => application.status === "active");

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="sm:max-w-md">
        <form
          noValidate
          className="flex h-full flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
            setFailure(null);
            if (parsed.success && chosenTypes.ok) create.mutate();
          }}
        >
          <SheetHeader>
            <SheetTitle>Add webhook endpoint</SheetTitle>
            <SheetDescription>APICenter posts selected payment events to this URL. The signing secret is shown once.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <FormRow
              label="Application"
              htmlFor="destination-application"
              error={errors.recipientApplicationId}
              hint="An application can have one destination at a time. Disable its current one to replace it."
            >
              <NativeSelect
                id="destination-application"
                value={webhook.recipientApplicationId}
                aria-invalid={Boolean(errors.recipientApplicationId)}
                onChange={(event) => setWebhook({ ...webhook, recipientApplicationId: event.target.value })}
              >
                <option value="">Choose an application</option>
                {recipients.map((application) => {
                  const taken = Boolean(liveDestinationFor(application.id, destinations));
                  return (
                    <option key={application.id} value={application.id} disabled={taken}>
                      {application.name}
                      {taken ? " (has a destination)" : ""}
                    </option>
                  );
                })}
              </NativeSelect>
            </FormRow>

            <FormRow label="Endpoint URL" htmlFor="destination-url" error={errors.url} hint="A public https URL. Private and internal hosts are refused.">
              <Input
                id="destination-url"
                type="url"
                autoComplete="off"
                spellCheck={false}
                className="font-mono md:text-xs"
                placeholder="https://api.yourcompany.com/webhooks/apicenter"
                value={webhook.url}
                aria-invalid={Boolean(errors.url)}
                onChange={(event) => setWebhook({ ...webhook, url: event.target.value })}
              />
            </FormRow>
            <EventTypesPicker
              idPrefix="create-event-types"
              catalogue={catalogue.data ?? []}
              loading={catalogue.isLoading}
              error={catalogue.error}
              selection={eventTypes}
              onChange={setEventTypes}
              problem={submitted && !chosenTypes.ok ? chosenTypes.error : undefined}
            />
            {failure ? (
              <ErrorPanel
                title="The destination could not be provisioned"
                error={`${failure} It is listed as failed; disable it before adding a destination for this application again.`}
              />
            ) : create.error ? (
              <ErrorPanel title="The destination was not added" error={create.error} />
            ) : null}

          </div>
          <SheetFooter className="flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Adding…" : "Add webhook"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
