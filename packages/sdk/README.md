# @alpha-explora/apicenter-sdk

The server-side TypeScript client for APICenter shared services and payments. Version 3 needs one setting, retries safely on its own, and runs on Node 20+, Deno, Bun and edge runtimes (Cloudflare Workers, Vercel Edge, Supabase Edge Functions). Upgrading from 2.x: see [UPGRADING.md](./UPGRADING.md).

## Install

Configure npm to use GitHub Packages for the `@alpha-explora` scope:

```ini
@alpha-explora:registry=https://npm.pkg.github.com
```

Authenticate with a GitHub token that can read packages, then install:

```bash
npm install @alpha-explora/apicenter-sdk
```

## Configure

Ask your APICenter operator, or use the console, for an application key per environment. Keep it in a server-only environment variable; never send it to a browser or ship it in a mobile app.

```env
APICENTER_API_KEY=ak_test_...
```

```ts
import { ApiCenter } from '@alpha-explora/apicenter-sdk';

const api = new ApiCenter(); // reads APICENTER_API_KEY

await api.email.send({ to: 'person@example.com', subject: 'Welcome', text: 'Your account is ready.' });
```

The key's prefix (`ak_test_` or `ak_live_`) selects the environment, and the key identifies your application; there is nothing else to configure. `api.environment` says which one you are on, and `await api.whoami()` returns the application, project and grants, which makes a good startup check.

Options, all optional: `apiKey` (instead of the variable), `timeoutMs` per attempt (15000), `maxRetries` (2), `fetch` (a custom implementation), and `hooks` (`onRequest`/`onResponse` for logging and tracing).

## Retries and idempotency

The SDK retries network errors, timeouts, 408, 429 and 5xx, with backoff and respecting `Retry-After`. Every write carries an `Idempotency-Key`, generated per call and reused across those retries, so a retry never repeats the write.

Pass your own key when the write belongs to a business operation that may be retried later, for example after your process restarts. Store it with the operation:

```ts
await api.payments.checkouts.create(
  { referenceId: order.id, amount: { amountMinor: order.totalMinor, currency: 'PHP' }, successUrl, cancelUrl },
  { idempotencyKey: order.checkoutKey }, // 16-255 characters, saved with the order
);
```

## Payments

```ts
import { isPending } from '@alpha-explora/apicenter-sdk';

const checkout = await api.payments.checkouts.create(input, { idempotencyKey: order.checkoutKey });
if (isPending(checkout)) {
  // APICenter accepted it; read it again with checkout.resourceId, or wait for its webhook.
} else {
  redirect(checkout.checkoutUrl);
}

for await (const record of api.payments.records.listAll({ status: 'paid' })) {
  // every matching record, fetched page by page
}
```

A checkout is paid when your webhook receives `payment.checkout.paid` (or `checkouts.getByReference` says so). A browser redirect to your success URL is not proof of payment.

## Webhooks

Receive payment events at an HTTPS route on your backend. Verify every delivery with the endpoint's `whsec_` secret, pass the **raw** body, and return 2xx once the event is stored.

On fetch-style servers (Next.js route handlers, Workers, Deno, Bun, Hono):

```ts
import { createWebhookHandler } from '@alpha-explora/apicenter-sdk';

export const POST = createWebhookHandler({
  secret: process.env.APICENTER_WEBHOOK_SECRET!,
  async onEvent(event) {
    if (event.eventType === 'payment.checkout.paid') {
      await markOrderPaid(event.referenceId, event.data.amount, event.eventId, event.aggregateVersion);
    }
  },
});
```

With Express or another Node framework:

```ts
import express from 'express';
import { verifyWebhook, ApiCenterWebhookError } from '@alpha-explora/apicenter-sdk';

app.post('/apicenter/events', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = await verifyWebhook(req.body, req.headers, process.env.APICENTER_WEBHOOK_SECRET!);
    await recordOnce(event);
    res.status(204).end();
  } catch (error) {
    res.status(error instanceof ApiCenterWebhookError ? 400 : 500).end();
  }
});
```

Events can repeat and arrive out of order: deduplicate by `eventId`, and apply a change only when its `aggregateVersion` is newer than the one you stored. Event types this SDK version does not know arrive as `eventType: 'unrecognized'` with the original in `type`; acknowledge them.

## Errors

Every failure is an `ApiCenterError` with `status`, `code` and `requestId` (quote it when asking for support). Branch on the subclass:

| Class | When |
| :--- | :--- |
| `AuthenticationError` | 401: the key is malformed, revoked or expired |
| `PermissionError` | 403: the action is not granted, or the capability or environment is not enabled |
| `ValidationError` | 400 or 422: `details` lists the fields |
| `NotFoundError` | 404 |
| `IdempotencyError` | 409: the key was used with a different request, or is still in progress |
| `ConflictError` | 409: other state conflicts |
| `RateLimitError`, `QuotaExceededError` | 429: `retryAfterSeconds` says when to try again |
| `ServerError` | 5xx, after retries |
| `ConnectionError` | APICenter could not be reached (`NETWORK_ERROR`) or did not answer in time (`REQUEST_TIMEOUT`) |

## Services

| Namespace | Methods |
| :--- | :--- |
| `email` | `send`, `get` |
| `sms` | `send`, `get` |
| `otp` | `send`, `verify`, `get` |
| `geo` | `geocode`, `reverseGeocode`, `checkGeofence` |
| `auth.google` | `getAuthorizationUrl`, `exchangeCode`, `refreshToken`, `logout` |
| `payments` | `checkouts`, `intents`, `customers`, `plans`, `paymentLinks`, `refunds`, `subscriptions`, `invoices`, `records`, `capabilities` |

## Verify calls to your published API

If your project publishes an API through APICenter, every request carries a signed `X-APICenter-Context` header naming the calling application and the action it was granted. Verify it and ignore any other identity headers:

```ts
import { createContextVerifier } from '@alpha-explora/apicenter-sdk';

const verifyCaller = createContextVerifier({
  apiId: process.env.APICENTER_API_ID!,                    // api_…
  publicKeys: process.env.APICENTER_CONTEXT_PUBLIC_KEYS!, // JSON array of Ed25519 JWKs
});

const caller = await verifyCaller(request.headers.get('x-apicenter-context'));
// caller.applicationId, caller.action, caller.environment, caller.owner.organizationId
```
