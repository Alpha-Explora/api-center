"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FormRow, NativeSelect } from "@/components/patterns/form";
import { ErrorPanel } from "@/components/patterns/notices";
import { fieldErrors } from "../../model/form-errors";
import type { Application } from "../../model/control-plane";
import { eventDestinations } from "../../data/event-destinations";
import {
  PAYMENT_EVENT_TYPES,
  createOutcome,
  liveDestinationFor,
  pushBody,
  pushFormSchema,
  webhookBody,
  webhookFormSchema,
  type CreatedWebhook,
  type EventDestination,
  type PushForm,
  type WebhookForm,
} from "../../model/event-destinations";
import { eventDestinationsKey } from "../../view-models/event-destinations";
import { useProjectEnvironment } from "../../view-models/project-environment";

type Transport = "webhook" | "pubsub-push";
type Created = { transport: "webhook"; destination: CreatedWebhook } | { transport: "pubsub-push"; destination: EventDestination };

const EMPTY_WEBHOOK: WebhookForm = { recipientApplicationId: "", url: "" };
const EMPTY_PUSH: PushForm = { recipientApplicationId: "", pushEndpoint: "", oidcAudience: "", deliveryServiceAccountEmail: "" };

/**
 * Adds a payment event destination. A signed HTTPS webhook is the normal case; a Pub/Sub push endpoint is
 * an advanced option for teams that run their own push receiver.
 */
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
  const [transport, setTransport] = useState<Transport>("webhook");
  const [webhook, setWebhook] = useState<WebhookForm>(EMPTY_WEBHOOK);
  const [push, setPush] = useState<PushForm>(EMPTY_PUSH);
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async (): Promise<Created> =>
      transport === "webhook"
        ? { transport, destination: await eventDestinations.createWebhook(scope, webhookBody(webhook)) }
        : { transport, destination: await eventDestinations.createPush(scope, pushBody(push)) },
    onSettled: () => client.invalidateQueries({ queryKey: eventDestinationsKey(organizationId, project.id, kind) }),
    onSuccess: (created) => {
      // The gateway answers 200 even when provisioning failed; that is a failure, not a new endpoint.
      const outcome = createOutcome(created.destination);
      if (outcome.kind === "failed") {
        setFailure(outcome.error);
        return;
      }
      close(false);
      if (created.transport === "webhook") onWebhookCreated(created.destination);
      else toast.success("Pub/Sub push destination added");
    },
  });

  const parsed = transport === "webhook" ? webhookFormSchema.safeParse(webhook) : pushFormSchema.safeParse(push);
  const errors = submitted ? fieldErrors(parsed.error) : {};
  const recipientId = transport === "webhook" ? webhook.recipientApplicationId : push.recipientApplicationId;
  const setRecipient = (value: string) =>
    transport === "webhook" ? setWebhook({ ...webhook, recipientApplicationId: value }) : setPush({ ...push, recipientApplicationId: value });

  function close(next: boolean) {
    if (!next) {
      setTransport("webhook");
      setWebhook(EMPTY_WEBHOOK);
      setPush(EMPTY_PUSH);
      setSubmitted(false);
      setFailure(null);
      create.reset();
    }
    onOpenChange(next);
  }

  function switchTransport(next: Transport) {
    setTransport(next);
    setSubmitted(false);
    setFailure(null);
    create.reset();
    // Keep the chosen application when switching.
    if (next === "pubsub-push") setPush({ ...push, recipientApplicationId: webhook.recipientApplicationId });
    else setWebhook({ ...webhook, recipientApplicationId: push.recipientApplicationId });
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
            if (parsed.success) create.mutate();
          }}
        >
          <SheetHeader>
            <SheetTitle>{transport === "webhook" ? "Add webhook endpoint" : "Add Pub/Sub push destination"}</SheetTitle>
            <SheetDescription>
              {transport === "webhook"
                ? `APICenter posts every payment event for the application to this URL, signed with a secret shown once. Today that is ${PAYMENT_EVENT_TYPES.join(", ")}.`
                : "Pub/Sub pushes every payment event for the application to your endpoint, authenticated with an OIDC token for the service account."}
            </SheetDescription>
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
                value={recipientId}
                aria-invalid={Boolean(errors.recipientApplicationId)}
                onChange={(event) => setRecipient(event.target.value)}
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

            {transport === "webhook" ? (
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
            ) : (
              <>
                <FormRow label="Push endpoint" htmlFor="destination-push" error={errors.pushEndpoint} hint="The https URL Pub/Sub delivers to.">
                  <Input
                    id="destination-push"
                    type="url"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono md:text-xs"
                    placeholder="https://events.yourcompany.com/pubsub"
                    value={push.pushEndpoint}
                    aria-invalid={Boolean(errors.pushEndpoint)}
                    onChange={(event) => setPush({ ...push, pushEndpoint: event.target.value })}
                  />
                </FormRow>
                <FormRow
                  label="Delivery service account"
                  htmlFor="destination-sa"
                  error={errors.deliveryServiceAccountEmail}
                  hint="Pub/Sub signs each push with an OIDC token for this account."
                >
                  <Input
                    id="destination-sa"
                    type="email"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono md:text-xs"
                    placeholder="pubsub-push@your-project.iam.gserviceaccount.com"
                    value={push.deliveryServiceAccountEmail}
                    aria-invalid={Boolean(errors.deliveryServiceAccountEmail)}
                    onChange={(event) => setPush({ ...push, deliveryServiceAccountEmail: event.target.value })}
                  />
                </FormRow>
                <FormRow
                  label="OIDC audience (optional)"
                  htmlFor="destination-audience"
                  error={errors.oidcAudience}
                  hint="Leave empty to use the push endpoint."
                >
                  <Input
                    id="destination-audience"
                    type="url"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono md:text-xs"
                    value={push.oidcAudience}
                    aria-invalid={Boolean(errors.oidcAudience)}
                    onChange={(event) => setPush({ ...push, oidcAudience: event.target.value })}
                  />
                </FormRow>
              </>
            )}

            {failure ? (
              <ErrorPanel
                title="The destination could not be provisioned"
                error={`${failure} It is listed as failed; disable it before adding a destination for this application again.`}
              />
            ) : create.error ? (
              <ErrorPanel title="The destination was not added" error={create.error} />
            ) : null}

            <button
              type="button"
              className="self-start text-left text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => switchTransport(transport === "webhook" ? "pubsub-push" : "webhook")}
            >
              {transport === "webhook" ? "Advanced: deliver to a Pub/Sub push endpoint instead" : "Use a signed webhook instead"}
            </button>
          </div>
          <SheetFooter className="flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Adding…" : transport === "webhook" ? "Add webhook" : "Add destination"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
