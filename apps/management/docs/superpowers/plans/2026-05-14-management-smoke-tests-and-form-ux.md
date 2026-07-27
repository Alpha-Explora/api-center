# Management Smoke Tests And Form UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local-only management workflow for requesting a tribe token and testing all shared services, while making service registration and usage screens easier to understand and harder to misconfigure.

**Architecture:** Keep token issuance and smoke-test calls inside `apicenter-management` local route handlers so browser code never receives platform admin secrets. The user may enter a plaintext tribe secret in the browser, but it must only be used for the token request and kept in React memory. Shared-service smoke tests should call API Center proxy routes with the issued bearer token and show structured results without storing tokens or secrets in localStorage.

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query, shadcn/ui, Zod schemas, API Center local server route handlers, existing `apiCenterAdminRequest` patterns.

---

## Scope

Build this for local/private management only. Do not add Descope login or public deployment behavior in this plan.

## Current Starting Point

- `/tribes/new` uses `src/components/tribe-form.tsx`.
- Contract tests live in `src/components/contract-tester-panel.tsx` and can test proxy routes when the user manually pastes a bearer token.
- Server-side local API Center helpers live in `src/lib/server/api-center-admin.ts`.
- Client API helpers live in `src/lib/api-center-client.ts`.
- Shared-service route contracts are implemented in `api-shared-services`:
  - `gauth`: `/health`, `/oauth/authorize`, `/oauth/token`, `/oauth/token/refresh`, `/oauth/logout`
  - `geo`: `/health`, `/geocode`, `/reverse-geocode`, `/geofence/check`
  - `payment`: `/health`, `/checkout/sessions`, `/checkout/sessions/:checkoutId`, `/payments/:paymentId/refunds`, `/webhooks`
  - `email`: `/health`, `/send`, `/status/:messageId`, `/templates`
  - `sms`: `/health`, `/send`, `/status/:messageId`, `/templates`
  - `otp`: `/health`, `/generate`, `/verify`, `/status/:otpId`

## Phase 1: Local Tribe Token Request

**Outcome:** A local management operator can request a temporary tribe bearer token from API Center without leaving the management UI.

**Files:**

- Modify: `src/lib/schemas.ts`
- Modify: `src/lib/api-center-client.ts`
- Modify: `src/lib/query-keys.ts`
- Create: `src/app/api/local/auth/token/route.ts`
- Create: `src/components/smoke-token-card.tsx`

### Tasks

- [ ] Add token schemas.

Add to `src/lib/schemas.ts`:

```ts
export const tribeTokenRequestSchema = z.object({
  tribeId: z.string().min(1),
  secret: z.string().min(1),
});

export const tribeTokenResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    accessToken: z.string(),
    refreshToken: z.string().nullable().optional(),
    expiresIn: z.number().optional(),
  }),
  meta: z
    .object({
      timestamp: z.string().optional(),
    })
    .optional(),
});

export type TribeTokenRequest = z.infer<typeof tribeTokenRequestSchema>;
export type TribeTokenResponse = z.infer<typeof tribeTokenResponseSchema>;
```

- [ ] Add local token route.

Create `src/app/api/local/auth/token/route.ts`:

```ts
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { tribeTokenRequestSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const body = await request.json();
  const input = tribeTokenRequestSchema.parse(body);

  return apiCenterAdminRequest("/api/v1/auth/token", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
```

- [ ] Add client helper.

Add to `src/lib/api-center-client.ts`:

```ts
export async function requestTribeToken(input: TribeTokenRequest) {
  const payload = tribeTokenRequestSchema.parse(input);
  const data = await request<unknown>("/api/local/auth/token", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return tribeTokenResponseSchema.parse(data).data;
}
```

- [ ] Add token card component.

Create `src/components/smoke-token-card.tsx`.

Behavior:

- inputs: `tribeId`, `secret`
- button: `Request token`
- output: masked token preview, expiry, copy-token button
- emits token to parent through `onTokenIssued(accessToken)`
- never writes token or secret to localStorage, sessionStorage, URL params, or cookies

The component should keep this state:

```ts
const [tribeId, setTribeId] = useState("smoke-tribe");
const [secret, setSecret] = useState("");
const [tokenPreview, setTokenPreview] = useState("");
```

Token preview format:

```ts
function maskToken(token: string) {
  if (token.length <= 18) return "<issued>";
  return `${token.slice(0, 10)}...${token.slice(-8)}`;
}
```

- [ ] Verify token request failure state.

Run management app and enter a wrong secret.

Expected:

```text
The UI shows "Invalid credentials" or the API Center error.
No token is stored.
```

## Phase 2: Shared-Service Smoke Test Page

**Outcome:** `/smoke-tests` lets the local operator request a token once and run safe smoke tests against every shared service.

**Files:**

- Create: `src/app/smoke-tests/page.tsx`
- Create: `src/components/shared-service-smoke-tests.tsx`
- Modify: `src/components/app-shell.tsx`

### Tasks

- [ ] Add navigation item.

Modify `src/components/app-shell.tsx`:

```ts
import { FlaskConicalIcon } from "lucide-react";
```

Add nav item:

```ts
{ href: "/smoke-tests", label: "Smoke tests", icon: FlaskConicalIcon },
```

- [ ] Add page shell.

Create `src/app/smoke-tests/page.tsx`:

```tsx
import { SharedServiceSmokeTests } from "@/components/shared-service-smoke-tests";

export default function SmokeTestsPage() {
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl bg-[linear-gradient(135deg,var(--hero-dark-from)_0%,var(--hero-dark-mid)_54%,var(--hero-dark-to)_100%)] p-6 text-white md:p-8">
        <h1 className="text-4xl font-semibold leading-tight tracking-[-0.03em]">
          Shared-service smoke tests
        </h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-white/72">
          Local-only token request and shared-service checks for API Center.
          Keep this private until management auth exists.
        </p>
      </section>
      <SharedServiceSmokeTests />
    </div>
  );
}
```

- [ ] Add smoke-test presets.

In `src/components/shared-service-smoke-tests.tsx`, define presets:

```ts
const smokeTests = [
  {
    id: "gauth-authorize",
    serviceId: "gauth",
    label: "Google auth URL",
    method: "POST",
    path: "/oauth/authorize",
    body: {
      redirectUri: "https://api-center.itsandbox.site/api/v1/shared/gauth/oauth/callback",
      scopes: ["openid", "email", "profile"],
      state: "smoke-test",
    },
    safe: true,
  },
  {
    id: "geo-geofence",
    serviceId: "geo",
    label: "Geo fence check",
    method: "POST",
    path: "/geofence/check",
    body: {
      latitude: 14.5995,
      longitude: 120.9842,
      fences: [
        {
          fenceId: "manila-test",
          name: "Manila test fence",
          latitude: 14.5995,
          longitude: 120.9842,
          radiusMeters: 500,
        },
      ],
    },
    safe: true,
  },
  {
    id: "payment-checkout",
    serviceId: "payment",
    label: "Payment checkout",
    method: "POST",
    path: "/checkout/sessions",
    body: {
      referenceId: "smoke-order-001",
      idempotencyKey: "smoke-order-001",
      successUrl: "https://api-center.itsandbox.site/smoke/success",
      cancelUrl: "https://api-center.itsandbox.site/smoke/cancel",
      lineItems: [
        {
          name: "Smoke Test Item",
          quantity: 1,
          amount: { value: 10000, currency: "PHP" },
        },
      ],
    },
    safe: false,
  },
  {
    id: "email-send",
    serviceId: "email",
    label: "Email send",
    method: "POST",
    path: "/send",
    body: {
      to: "your-email@example.com",
      subject: "API Center smoke test",
      text: "This is a smoke test from API Center shared services.",
    },
    safe: false,
  },
  {
    id: "sms-send",
    serviceId: "sms",
    label: "SMS send",
    method: "POST",
    path: "/send",
    body: {
      to: "+639000000000",
      message: "API Center smoke test",
    },
    safe: false,
  },
  {
    id: "otp-generate",
    serviceId: "otp",
    label: "OTP generate",
    method: "POST",
    path: "/generate",
    body: {
      target: "smoke@example.com",
      channel: "email",
      length: 6,
      expiresInSeconds: 300,
    },
    safe: false,
  },
];
```

- [ ] Require confirmation for provider-costing tests.

For tests with `safe: false`, show a checkbox:

```text
I understand this may call a real provider or create provider-side test data.
```

Disable those buttons until checked.

- [ ] Show result cards.

Each result card should show:

```text
service
route
HTTP status
latency
success/failure badge
response preview
```

- [ ] Verify page loads.

```powershell
npm run lint
npm run build
Invoke-WebRequest -UseBasicParsing http://localhost:3000/smoke-tests
```

Expected:

```text
HTTP 200
No build errors
```

## Phase 3: Local Smoke Test API Route

**Outcome:** The smoke-test page can call arbitrary approved shared-service presets through API Center with the issued bearer token.

**Files:**

- Modify: `src/lib/schemas.ts`
- Create: `src/app/api/local/smoke-tests/shared-service/route.ts`
- Modify: `src/lib/api-center-client.ts`

### Tasks

- [ ] Add smoke-test request schema.

Add to `src/lib/schemas.ts`:

```ts
export const smokeTestRequestSchema = z.object({
  serviceId: z.enum(["gauth", "geo", "payment", "email", "sms", "otp"]),
  method: z.enum(["GET", "POST"]),
  path: z.string().min(1),
  bearerToken: z.string().min(1),
  body: z.unknown().optional(),
});

export const smokeTestResultSchema = z.object({
  serviceId: z.string(),
  path: z.string(),
  method: z.string(),
  url: z.string(),
  ok: z.boolean(),
  status: z.number().optional(),
  latencyMs: z.number(),
  responsePreview: z.string().optional(),
  checkedAt: z.string(),
});

export type SmokeTestRequest = z.infer<typeof smokeTestRequestSchema>;
export type SmokeTestResult = z.infer<typeof smokeTestResultSchema>;
```

- [ ] Add allowlist validation.

Create `src/app/api/local/smoke-tests/shared-service/route.ts`.

Use this allowlist:

```ts
const allowedRoutes = new Set([
  "GET gauth /health",
  "POST gauth /oauth/authorize",
  "GET geo /health",
  "POST geo /geofence/check",
  "POST geo /geocode",
  "GET payment /health",
  "POST payment /checkout/sessions",
  "GET email /health",
  "POST email /send",
  "GET sms /health",
  "POST sms /send",
  "GET otp /health",
  "POST otp /generate",
  "POST otp /verify",
]);
```

Reject anything outside the allowlist with HTTP 400.

- [ ] Implement proxy call.

The route should call:

```ts
const url = getApiCenterAdminUrl(
  `/api/v1/shared/${input.serviceId}${normalizeRoutePath(input.path)}`,
);
```

and send:

```ts
headers: {
  "content-type": "application/json",
  authorization: `Bearer ${input.bearerToken}`,
}
```

Do not forward the tribe plaintext secret.

- [ ] Add client helper.

Add to `src/lib/api-center-client.ts`:

```ts
export async function runSharedServiceSmokeTest(input: SmokeTestRequest) {
  const payload = smokeTestRequestSchema.parse(input);
  const data = await request<unknown>("/api/local/smoke-tests/shared-service", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return smokeTestResultSchema.parse(data);
}
```

- [ ] Verify route rejects unsafe paths.

Call:

```powershell
Invoke-RestMethod `
  -Uri "http://localhost:3000/api/local/smoke-tests/shared-service" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"serviceId":"payment","method":"POST","path":"/webhooks","bearerToken":"x"}'
```

Expected:

```text
HTTP 400
```

## Phase 4: Register Form UX Improvements

**Outcome:** `/tribes/new` becomes harder to misuse, especially around local URLs, service IDs, shared-service consumption, and smoke-test setup.

**Files:**

- Modify: `src/components/tribe-form.tsx`
- Create: `src/lib/service-form-presets.ts`

### Tasks

- [ ] Add service form presets.

Create `src/lib/service-form-presets.ts`:

```ts
import type { ServiceManifest } from "@/lib/schemas";

export const smokeTribePreset: Partial<ServiceManifest> = {
  serviceId: "smoke-tribe",
  name: "Smoke Tribe",
  baseUrl: "https://httpbin.org",
  requiredScopes: ["smoke:read"],
  exposes: ["/status/200", "/get"],
  consumes: ["gauth", "geo", "payment", "email", "sms", "otp"],
  serviceType: "tribe",
  healthCheck: "/status/200",
  version: "1.0.0",
  description: "Temporary tribe for testing API Center shared services.",
  tags: ["smoke", "test"],
  ownerTeam: "platform",
  contact: "platform@itsandbox.site",
  serviceTier: "experimental",
  costCenter: "API-CENTER",
};
```

- [ ] Add a preset button.

In `TribeForm`, add a button near the card title:

```text
Use smoke-test preset
```

When clicked, call:

```ts
form.reset(toFormInput(smokeTribePreset));
```

Define `toFormInput` so it converts arrays to comma-separated strings exactly like `toFormDefaults`.

- [ ] Add localhost warning.

When `baseUrl` contains `localhost`, `127.0.0.1`, or `::1`, show warning text:

```text
Live GKE API Center cannot reach your laptop localhost. Use localhost only when API Center is also running locally.
```

- [ ] Improve shared-service selector.

Replace the free-text `Can consume` field with checkboxes for:

```text
gauth
geo
payment
email
sms
otp
```

Keep an advanced text field for extra service IDs:

```text
Other service IDs
```

Final `consumes` must combine selected shared services plus extra IDs.

- [ ] Add live manifest preview collapse.

Render the parsed manifest as JSON in a collapsible panel:

```text
Preview manifest
```

Show validation errors above the preview if parsing fails.

- [ ] Verify create and edit still work.

Run:

```powershell
npm run lint
npm run build
```

Manual checks:

```text
/tribes/new
/tribes/smoke-tribe/edit
```

Expected:

```text
Smoke preset fills the form.
Edit mode keeps existing values.
Localhost warning appears only for local URLs.
```

## Phase 5: Shared Usage UX Improvements

**Outcome:** Shared-service usage and service detail pages explain what to do next after token/smoke-test setup.

**Files:**

- Modify: `src/components/shared-service-usage-matrix.tsx`
- Modify: `src/components/tribe-observability-panel.tsx`
- Modify: `src/components/shared-service-observability-panel.tsx`
- Modify: `src/components/service-detail-client.tsx`

### Tasks

- [ ] Add smoke-test CTA for tribe pages.

On tribe detail pages, add:

```text
Run smoke tests
```

Link:

```text
/smoke-tests?tribeId=<serviceId>
```

- [ ] Add usage empty-state guidance.

When runtime usage is empty, show:

```text
No runtime calls yet. Request a token from Smoke tests, call one shared-service route, then refresh this page.
```

- [ ] Label `payment` clearly as PayMongo-backed.

Where shared-service names are rendered, show:

```text
payment
PayMongo-backed payment wrapper
```

Do not rename the service ID to `paymongo`.

- [ ] Add undeclared usage explanation.

When runtime calls exist but `consumes` does not include the shared service, show:

```text
This tribe successfully called a service it does not declare. Add the service ID to consumes or investigate token/scope drift.
```

## Phase 6: Documentation And Verification

**Outcome:** The new smoke-test workflow is documented and verified.

**Files:**

- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-05-14-production-readiness-next-phases.md`
- Create: `docs/operations/local-smoke-testing.md`

### Tasks

- [ ] Add local smoke-test runbook.

Create `docs/operations/local-smoke-testing.md` with:

```text
1. Register smoke-tribe.
2. Provision api-center-tribe-secret-smoke-tribe from the local console.
3. Restart API Center only if the one-time resolver config changed.
4. Open /smoke-tests.
5. Request a token.
6. Run safe tests first.
7. Confirm /shared-services/usage, /audit, /cost, and /alerts update.
```

- [ ] Update README feature list.

Add:

```text
- Smoke tests: /smoke-tests requests a temporary tribe token and runs local-only shared-service checks without storing secrets.
```

- [ ] Mark plan progress.

In `docs/superpowers/plans/2026-05-14-production-readiness-next-phases.md`, update Phase 3 to mention that `/smoke-tests` is the preferred way to request the token and run shared-service smoke calls.

- [ ] Run final verification.

```powershell
npm run lint
npm run build
Invoke-WebRequest -UseBasicParsing http://localhost:3000/smoke-tests
Invoke-WebRequest -UseBasicParsing http://localhost:3000/tribes/new
Invoke-WebRequest -UseBasicParsing http://localhost:3000/shared-services/usage
```

Expected:

```text
All commands pass.
All pages return HTTP 200.
```

- [ ] Commit and push.

```powershell
git add README.md docs src
git commit -m Add-local-shared-service-smoke-tests
git push
```

## Execution Order

1. Phase 1: local token request.
2. Phase 3: smoke-test API route.
3. Phase 2: smoke-test page.
4. Phase 4: registration form UX.
5. Phase 5: usage/detail UX.
6. Phase 6: docs and verification.

## Safety Rules

- Never store plaintext tribe secrets.
- Never store bearer tokens in localStorage, sessionStorage, cookies, or URL params.
- Never expose `API_CENTER_PLATFORM_ADMIN_SECRET` to browser JavaScript.
- Keep provider-costing smoke tests behind explicit user confirmation.
- Use `payment` as the shared-service ID; describe it as PayMongo-backed in labels.
- Keep this local-only until management auth exists.
