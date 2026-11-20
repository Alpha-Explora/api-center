import type { EnvironmentKind } from "./control-plane";
import { isUsableKey, type EnvironmentCredential, type EnvironmentGrant } from "./environment-inventory";

export type GettingStartedStepId = "capability" | "application" | "grant" | "key" | "request";

export interface GettingStartedStep {
  id: GettingStartedStepId;
  label: string;
  /** What to do when the step is open. */
  hint: string;
  done: boolean;
  /** Section path under the environment where the step is done. */
  path: string;
}

export interface GettingStartedInput {
  enabledCapabilities: number;
  applications: { id: string; status: string }[];
  grants: Pick<EnvironmentGrant, "applicationId">[];
  credentials: Pick<EnvironmentCredential, "applicationId" | "status" | "expiresAt" | "lastUsedAt">[];
  /** Requests admitted in the usage window. */
  requests: number;
  now?: number;
}

/** The five steps from an empty environment to a first request, each with where it is done. */
export function gettingStartedSteps(input: GettingStartedInput, applicationPath: (applicationId: string, tab: string) => string): GettingStartedStep[] {
  const now = input.now ?? Date.now();
  const active = input.applications.filter((application) => application.status === "active");
  const first = active[0];
  const granted = active.find((application) => input.grants.some((grant) => grant.applicationId === application.id));
  const keyed = input.credentials.some((credential) => isUsableKey(credential, now));
  // The grant and key steps point at the application that is furthest along.
  const focus = granted ?? first;
  const onFocus = (tab: string) => (focus ? applicationPath(focus.id, tab) : "/applications");

  return [
    {
      id: "capability",
      label: "Enable a capability",
      hint: "Turn on the shared services your application calls, such as email or payments.",
      done: input.enabledCapabilities > 0,
      path: "/capabilities",
    },
    {
      id: "application",
      label: "Create an application",
      hint: "An application is your backend's identity in this environment.",
      done: active.length > 0,
      path: "/applications",
    },
    {
      id: "grant",
      label: "Grant actions",
      hint: "Grant the application each action it calls, such as email:send.",
      done: Boolean(granted),
      path: onFocus("access"),
    },
    {
      id: "key",
      label: "Issue a key",
      hint: "Store the key in your backend as APICENTER_API_KEY. It is shown once.",
      done: keyed,
      path: onFocus("keys"),
    },
    {
      id: "request",
      label: "Make a first request",
      hint: "Call APICenter with the SDK. Requests show in usage below.",
      // Usage covers 24 hours; a key's last use remembers a request after that.
      done: input.requests > 0 || input.credentials.some((credential) => credential.lastUsedAt !== null),
      path: "",
    },
  ];
}

interface SnippetCall {
  action: string;
  code: string;
}

/** A minimal call per action, in the order a new integration usually starts with. */
const CALLS: SnippetCall[] = [
  { action: "email:send", code: "await api.email.send({\n  to: 'person@example.com',\n  subject: 'Hello from APICenter',\n  text: 'It works.',\n});" },
  { action: "sms:send", code: "await api.sms.send({ to: '+639170000000', message: 'Hello from APICenter' });" },
  { action: "otp:generate", code: "const otp = await api.otp.send({ channel: 'email', recipient: 'person@example.com' });" },
  {
    action: "payments:checkout:write",
    code:
      "const checkout = await api.payments.checkouts.create(\n" +
      "  {\n" +
      "    referenceId: 'ORDER-1',\n" +
      "    amount: { amountMinor: 10000, currency: 'PHP' },\n" +
      "    successUrl: 'https://example.com/paid',\n" +
      "    cancelUrl: 'https://example.com/cart',\n" +
      "  },\n" +
      "  { idempotencyKey: 'checkout-ORDER-1' },\n" +
      ");",
  },
  { action: "geo:geocode", code: "const place = await api.geo.geocode({ address: 'Ayala Avenue, Makati City' });" },
  { action: "geo:reverse-geocode", code: "const place = await api.geo.reverseGeocode({ latitude: 14.5547, longitude: 121.0244 });" },
  { action: "geo:geofence", code: "const result = await api.geo.checkGeofence({ latitude: 14.5547, longitude: 121.0244, fenceId: 'store-1' });" },
  {
    action: "gauth:authorize",
    code: "const { url } = await api.auth.google.getAuthorizationUrl({ redirectUri: 'https://example.com/auth/callback' });",
  },
  { action: "payments:read", code: "const page = await api.payments.records.list({ status: 'paid' });" },
  { action: "payments:checkout:read", code: "const checkout = await api.payments.checkouts.getByReference('ORDER-1');" },
];

const WHOAMI = "const me = await api.whoami(); // the key's application, project and grants";

/** The call to show: the first granted action the SDK has a one-liner for, else whoami. */
export function snippetCall(grantedActions: string[]): SnippetCall {
  const granted = new Set(grantedActions);
  return CALLS.find((call) => granted.has(call.action)) ?? { action: "", code: WHOAMI };
}

export interface SdkSnippet {
  npmrc: string;
  install: string;
  env: string;
  code: string;
  /** The granted action the code calls; empty when it falls back to whoami. */
  action: string;
}

/** The install, configuration and first call, as in the public getting-started guide. */
export function sdkSnippet(kind: EnvironmentKind, grantedActions: string[]): SdkSnippet {
  const call = snippetCall(grantedActions);
  return {
    npmrc: "@alpha-explora:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}",
    install: "npm install @alpha-explora/apicenter-sdk",
    env: `APICENTER_API_KEY=ak_${kind}_…`,
    code: `import { ApiCenter } from '@alpha-explora/apicenter-sdk';\n\nconst api = new ApiCenter(); // reads APICENTER_API_KEY\n\n${call.code}`,
    action: call.action,
  };
}
