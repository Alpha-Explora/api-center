import { z } from "zod";

/**
 * Where an application receives payment events: a signed HTTPS webhook, or a Pub/Sub push endpoint.
 * A webhook can be limited to chosen event types (`eventTypes`, empty for all); a Pub/Sub push
 * destination always receives every type.
 */
export const destinationStatusSchema = z.enum(["provisioning", "active", "failed", "disabled"]);

export const eventDestinationSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  environmentId: z.string(),
  recipientApplicationId: z.string(),
  eventFamily: z.string(),
  transport: z.enum(["webhook", "pubsub-push"]),
  pushEndpoint: z.string(),
  oidcAudience: z.string().nullable(),
  deliveryServiceAccountEmail: z.string(),
  subscriptionName: z.string().nullable(),
  webhookUrl: z.string().nullable(),
  secretRotatedAt: z.string().nullable(),
  /** Event types delivered; empty or missing (gateways before the filter) delivers every type. */
  eventTypes: z.array(z.string()).optional(),
  status: destinationStatusSchema,
  lastError: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EventDestination = z.infer<typeof eventDestinationSchema>;

export const createdWebhookSchema = eventDestinationSchema.extend({ signingSecret: z.string() });
export type CreatedWebhook = z.infer<typeof createdWebhookSchema>;

export const rotatedSecretSchema = eventDestinationSchema.extend({
  signingSecret: z.string(),
  previousSecretExpiresAt: z.string().nullable(),
});
export type RotatedSecret = z.infer<typeof rotatedSecretSchema>;

/** Standard Webhooks headers every delivery carries. */
export const WEBHOOK_HEADERS = ["webhook-id", "webhook-timestamp", "webhook-signature"] as const;

export const TRANSPORT_LABELS: Record<EventDestination["transport"], string> = { webhook: "Webhook", "pubsub-push": "Pub/Sub push" };

/** Where deliveries go: the customer's URL for a webhook (the push endpoint is APICenter's relay), the push endpoint for Pub/Sub. */
export function destinationEndpoint(destination: EventDestination): string {
  return destination.transport === "webhook" ? (destination.webhookUrl ?? destination.pushEndpoint) : destination.pushEndpoint;
}

/** The gateway allows one destination per application unless it is disabled. */
export function liveDestinationFor(applicationId: string, destinations: EventDestination[]): EventDestination | undefined {
  return destinations.find((destination) => destination.recipientApplicationId === applicationId && destination.status !== "disabled");
}

/** Disabled destinations last, newest first within each group. */
export function sortDestinations(destinations: EventDestination[]): EventDestination[] {
  return [...destinations].sort((a, b) => {
    const disabled = Number(a.status === "disabled") - Number(b.status === "disabled");
    return disabled !== 0 ? disabled : b.createdAt.localeCompare(a.createdAt);
  });
}

/** What the person should be told after a create call returned. Provisioning can fail with a 200. */
export type CreateOutcome<T extends EventDestination> = { kind: "created"; destination: T } | { kind: "failed"; destination: T; error: string };

export function createOutcome<T extends EventDestination>(destination: T): CreateOutcome<T> {
  if (destination.status === "failed") {
    return { kind: "failed", destination, error: destination.lastError ?? "Provisioning failed without a reason." };
  }
  return { kind: "created", destination };
}

const APPLICATION_ID = /^app_[a-z0-9]{24}$/;
const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);

/** The gateway's URL shape checks: https, no credentials, not an obviously private host. DNS is checked by the gateway. */
export function publicHttpsUrlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter a full URL, starting with https://.";
  }
  if (url.protocol !== "https:") return "The URL must use https.";
  if (url.username || url.password) return "The URL must not contain a user name or password.";
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".internal") || host.endsWith(".local") || isPrivateIp(host)) {
    return "The URL must point to a public host.";
  }
  return null;
}

function isPrivateIp(host: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  return host === "::1" || host === "::" || /^(fc|fd|fe8|fe9|fea|feb)/.test(host);
}

const publicHttpsUrl = z
  .string()
  .trim()
  .min(1, "Enter a URL.")
  .max(2048, "Use at most 2048 characters.")
  .superRefine((value, context) => {
    const problem = publicHttpsUrlProblem(value);
    if (problem) context.addIssue({ code: "custom", message: problem });
  });

const recipient = z.string().regex(APPLICATION_ID, "Choose an application.");

export const webhookFormSchema = z.object({ recipientApplicationId: recipient, url: publicHttpsUrl });
export type WebhookForm = { recipientApplicationId: string; url: string };
export type WebhookBody = z.infer<typeof webhookFormSchema> & { eventTypes?: string[] };

/** An empty `eventTypes` (every type) is left out of the body. */
export function webhookBody(form: WebhookForm, eventTypes: string[] = []): WebhookBody {
  return { ...webhookFormSchema.parse(form), ...(eventTypes.length ? { eventTypes } : {}) };
}

export const pushFormSchema = z.object({
  recipientApplicationId: recipient,
  pushEndpoint: publicHttpsUrl,
  oidcAudience: z
    .string()
    .trim()
    .max(2048, "Use at most 2048 characters.")
    .refine((value) => value === "" || URL.canParse(value), "Enter a full URL, or leave it empty."),
  deliveryServiceAccountEmail: z.string().trim().min(1, "Enter the service account email.").max(320).email("Enter a valid service account email."),
});
export type PushForm = { recipientApplicationId: string; pushEndpoint: string; oidcAudience: string; deliveryServiceAccountEmail: string };
export type PushBody = { recipientApplicationId: string; pushEndpoint: string; oidcAudience?: string; deliveryServiceAccountEmail: string };

/** An empty audience is left out; Pub/Sub then uses the push endpoint as the token audience. */
export function pushBody(form: PushForm): PushBody {
  const { oidcAudience, ...rest } = pushFormSchema.parse(form);
  return oidcAudience ? { ...rest, oidcAudience } : rest;
}
