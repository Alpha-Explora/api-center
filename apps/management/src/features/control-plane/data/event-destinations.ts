import { z } from "zod";
import type { EnvironmentKind } from "../model/control-plane";
import { createdWebhookSchema, eventDestinationSchema, rotatedSecretSchema, type WebhookBody } from "../model/event-destinations";
import { eventTypeSchema } from "../model/event-types";
import { call, env, org, send } from "./http";

type Scope = { organizationId: string; projectId: string; kind: EnvironmentKind };

const base = ({ organizationId, projectId, kind }: Scope) => `${env(organizationId, projectId, kind)}/event-destinations`;

/** Payment event destinations of one environment: signed webhooks and Pub/Sub push endpoints. */
export const eventDestinations = {
  list: (scope: Scope) => call(z.array(eventDestinationSchema), base(scope)),
  /** The response carries the signing secret once; it may also come back with status "failed". */
  createWebhook: (scope: Scope, body: WebhookBody) => call(createdWebhookSchema, `${base(scope)}/webhooks`, send("POST", body)),
  rotateSecret: (scope: Scope, destinationId: string) =>
    call(rotatedSecretSchema, `${base(scope)}/${encodeURIComponent(destinationId)}/rotate-secret`, send("POST", {})),
  disable: (scope: Scope, destinationId: string) =>
    call(eventDestinationSchema, `${base(scope)}/${encodeURIComponent(destinationId)}/disable`, send("POST", {})),
  /** Replaces a webhook's event-type filter; an empty list delivers every type. */
  setEventTypes: (scope: Scope, destinationId: string, eventTypes: string[]) =>
    call(eventDestinationSchema, `${base(scope)}/${encodeURIComponent(destinationId)}/event-types`, send("PUT", { eventTypes })),
  /** The event types a webhook can choose from. */
  eventTypes: (organizationId: string) => call(z.array(eventTypeSchema), `${org(organizationId)}/event-types`),
};
