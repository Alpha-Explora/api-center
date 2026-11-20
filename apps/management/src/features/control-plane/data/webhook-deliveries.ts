import { z } from "zod";
import type { EnvironmentKind } from "../model/control-plane";
import { sentTestEventSchema, webhookDeliverySchema } from "../model/webhook-deliveries";
import { call, env, send } from "./http";

type Scope = { organizationId: string; projectId: string; kind: EnvironmentKind };

const base = ({ organizationId, projectId, kind }: Scope, destinationId: string) =>
  `${env(organizationId, projectId, kind)}/event-destinations/${encodeURIComponent(destinationId)}`;

/** A signed webhook's delivery attempts and on-demand test events. */
export const webhookDeliveries = {
  /** Newest first, at most `limit` (1–100). */
  list: (scope: Scope, destinationId: string, limit = 25) => call(z.array(webhookDeliverySchema), `${base(scope, destinationId)}/deliveries?limit=${limit}`),
  sendTestEvent: (scope: Scope, destinationId: string) => call(sentTestEventSchema, `${base(scope, destinationId)}/test-event`, send("POST", {})),
};
