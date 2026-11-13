// The finite set of capability actions an application can be granted, and how gateway routes map
// to them. A route that maps to no action is denied: new runtime routes are not reachable until
// they are catalogued here.

export interface CapabilityAction {
  action: string;
  description: string;
}

interface CatalogRoute {
  method: string;
  pattern: RegExp;
  action: string;
}

interface CapabilityDefinition {
  id: string;
  name: string;
  actions: CapabilityAction[];
  routes: CatalogRoute[];
}

const STATUS_ID = "[^/]+";

function route(method: string, path: string, action: string): CatalogRoute {
  return { method, pattern: new RegExp(`^${path}/?$`), action };
}

// Routes mirror the supported shared-service operations published in the consumer OpenAPI.
const CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    id: "email",
    name: "Email",
    actions: [
      { action: "email:send", description: "Send an email" },
      { action: "email:read", description: "Read the delivery status of an email this project sent" },
    ],
    routes: [route("POST", "/send", "email:send"), route("GET", `/status/${STATUS_ID}`, "email:read")],
  },
  {
    id: "sms",
    name: "SMS",
    actions: [
      { action: "sms:send", description: "Send an SMS message" },
      { action: "sms:read", description: "Read the delivery status of a message this project sent" },
    ],
    routes: [route("POST", "/send", "sms:send"), route("GET", `/status/${STATUS_ID}`, "sms:read")],
  },
  {
    id: "otp",
    name: "One-time passwords",
    actions: [
      { action: "otp:generate", description: "Generate and deliver a one-time password" },
      { action: "otp:verify", description: "Verify a one-time password" },
      { action: "otp:read", description: "Read the status of a one-time password this project issued" },
    ],
    routes: [
      route("POST", "/generate", "otp:generate"),
      route("POST", "/verify", "otp:verify"),
      route("GET", `/status/${STATUS_ID}`, "otp:read"),
    ],
  },
  {
    id: "geo",
    name: "Geolocation",
    actions: [
      { action: "geo:geocode", description: "Convert an address to coordinates" },
      { action: "geo:reverse-geocode", description: "Convert coordinates to an address" },
      { action: "geo:geofence", description: "Check whether a point is inside a geofence" },
    ],
    routes: [
      route("POST", "/geocode", "geo:geocode"),
      route("POST", "/reverse-geocode", "geo:reverse-geocode"),
      route("POST", "/geofence/check", "geo:geofence"),
    ],
  },
  {
    id: "gauth",
    name: "Google sign-in",
    actions: [
      { action: "gauth:authorize", description: "Start a Google sign-in" },
      { action: "gauth:token", description: "Exchange or refresh Google sign-in tokens" },
      { action: "gauth:logout", description: "Revoke a Google sign-in session" },
    ],
    routes: [
      route("POST", "/oauth/authorize", "gauth:authorize"),
      route("POST", "/oauth/token", "gauth:token"),
      route("POST", "/oauth/token/refresh", "gauth:token"),
      route("POST", "/oauth/logout", "gauth:logout"),
    ],
  },
  {
    // The payments facade (/api/v1/payments) maps its own routes to these actions, which are the
    // same scope strings payment API keys use. Payments are never reachable through /shared.
    id: "payments",
    name: "Payments",
    actions: [
      { action: "payments:read", description: "List payment records and read capabilities" },
      { action: "payments:checkout:read", description: "Read checkout sessions" },
      { action: "payments:checkout:write", description: "Create and cancel checkout sessions" },
      { action: "payments:intents:read", description: "Read payment intents" },
      { action: "payments:intents:write", description: "Create, confirm and cancel payment intents" },
      { action: "payments:customers:read", description: "Read customers" },
      { action: "payments:customers:write", description: "Create customers" },
      { action: "payments:subscriptions:read", description: "Read plans, subscriptions and their invoices" },
      { action: "payments:subscriptions:write", description: "Create plans and subscriptions; cancel subscriptions" },
      { action: "payments:payment-links:read", description: "Read payment links" },
      { action: "payments:payment-links:write", description: "Create and update payment links" },
      { action: "payments:refunds:read", description: "Read refunds" },
      { action: "payments:refunds:write", description: "Create refunds" },
      { action: "payments:invoices:read", description: "Read invoices" },
    ],
    routes: [],
  },
];

export function listCapabilities(): { id: string; name: string; actions: CapabilityAction[] }[] {
  return CAPABILITIES.map(({ id, name, actions }) => ({ id, name, actions: [...actions] }));
}

export function isKnownCapability(capability: string): boolean {
  return CAPABILITIES.some((definition) => definition.id === capability);
}

export function isCatalogedAction(capability: string, action: string): boolean {
  return CAPABILITIES.some(
    (definition) =>
      definition.id === capability && definition.actions.some((entry) => entry.action === action),
  );
}

/**
 * Maps a request on a capability (path relative to the capability root, e.g. `/send`) to its
 * catalogued action. Returns undefined for anything not catalogued.
 */
export function resolveCapabilityAction(
  capability: string,
  method: string,
  relativePath: string,
): string | undefined {
  const definition = CAPABILITIES.find((entry) => entry.id === capability);
  if (!definition) return undefined;
  const upperMethod = method.toUpperCase();
  return definition.routes.find(
    (route) => route.method === upperMethod && route.pattern.test(relativePath),
  )?.action;
}
