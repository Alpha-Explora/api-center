# Upgrading from 2.x to 3.0

Version 3 works only with application keys and payment event contract 2.0. Every removal below has one replacement.

## Configuration

| 2.x | 3.0 |
| :--- | :--- |
| `new ApiCenter({ baseUrl, auth: { apiKey } })` | `new ApiCenter()` with `APICENTER_API_KEY` set, or `new ApiCenter({ apiKey })` |
| `baseUrl`, `APICENTER_URL` | Removed. The SDK knows APICenter's address. |
| `auth: { serviceId, environment, secret }` | Removed. Ask for an application key (`ak_test_…`, `ak_live_…`). |
| `auth: { getAccessToken }` | Removed. Use an application key. |
| `paymentApiKey`, `APICENTER_PAYMENT_API_KEY` | Removed. Payments use the application key when it holds `payments:*` grants. |
| `fetchImpl` | `fetch` |
| `api.setup.status()` | `api.whoami()` |

## Method names

| 2.x | 3.0 |
| :--- | :--- |
| `email.getStatus(id)` | `email.get(id)` |
| `sms.getStatus(id)` | `sms.get(id)` |
| `otp.generate(input, options)` | `otp.send(input, options?)` |
| `otp.getStatus(id)` | `otp.get(id)` |
| `geo.geocodeAddress(input)` | `geo.geocode(input)` |
| `geo.checkFence(input)` | `geo.checkGeofence(input)` |
| `googleAuth.*` | `auth.google.*` |
| `checkouts.cancel(id, options, input)` | `checkouts.cancel(id, input?, options?)` |
| `subscriptions.cancel(id, options, input)` | `subscriptions.cancel(id, input?, options?)` |
| `records.list({ ...filters, signal })` | `records.list(filters, { signal })`, or `records.listAll(filters)` to iterate every page |

## Writes

`{ idempotencyKey }` is now optional on every write. Without it the SDK generates one per call and reuses it on its own retries. Keep passing your own where a write must not repeat across process restarts, such as one checkout per order.

## Errors

`ApiCenterError.correlationId` is now `requestId`. Errors are subclasses (`AuthenticationError`, `PermissionError`, `ValidationError`, `NotFoundError`, `IdempotencyError`, `RateLimitError`, `QuotaExceededError`, `ServerError`, `ConnectionError`), so `instanceof` replaces most `code` comparisons. Timeouts and network failures are `ConnectionError` with `code` `REQUEST_TIMEOUT` or `NETWORK_ERROR`.

## Payment events (contract 2.0)

| 1.x field | 2.0 |
| :--- | :--- |
| `ownerTribeId`, `ownerGroupId` | `organizationId` |
| `ownerProjectId` | `projectId` |
| `consumerServiceId` | `applicationId` |
| `data.environment` | `environment` |
| `data.referenceId`, `data.aggregateVersion` | `referenceId`, `aggregateVersion` (top level only) |
| `data.amount: { amountMinor, currency }` | `data.amount` (minor units) and `data.currency` |

`parsePaymentEvent` returns a union keyed by `eventType`; unknown types come back as `eventType: 'unrecognized'`. Events arrive by signed webhook: use `verifyWebhook` (now async) or `createWebhookHandler` instead of verifying Pub/Sub OIDC tokens.

## Published APIs

`createContextVerifier` returns an async function: `await verifyCaller(header)`. `caller.owner` is `{ organizationId, projectId }` (was `{ groupId, projectId }`).
