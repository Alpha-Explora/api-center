import { z } from "zod";
import type { EnvironmentKind } from "../model/control-plane";
import { createdWebhookSchema, eventDestinationSchema, rotatedSecretSchema, type PushBody, type WebhookBody } from "../model/event-destinations";
import { call, env, send } from "./http";

type Scope = { organizationId: string; projectId: string; kind: EnvironmentKind };

const base = ({ organizationId, projectId, kind }: Scope) => `${env(organizationId, projectId, kind)}/event-destinations`;

/** Payment event destinations of one environment: signed webhooks and Pub/Sub push endpoints. */
export const eventDestinations = {
  list: (scope: Scope) => call(z.array(eventDestinationSchema), base(scope)),
  /** The response carries the signing secret once; it may also come back with status "failed". */
  createWebhook: (scope: Scope, body: WebhookBody) => call(createdWebhookSchema, `${base(scope)}/webhooks`, send("POST", body)),
  createPush: (scope: Scope, body: PushBody) => call(eventDestinationSchema, base(scope), send("POST", body)),
  rotateSecret: (scope: Scope, destinationId: string) =>
    call(rotatedSecretSchema, `${base(scope)}/${encodeURIComponent(destinationId)}/rotate-secret`, send("POST", {})),
  disable: (scope: Scope, destinationId: string) =>
    call(eventDestinationSchema, `${base(scope)}/${encodeURIComponent(destinationId)}/disable`, send("POST", {})),
};
