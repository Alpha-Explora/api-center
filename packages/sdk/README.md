# @alpha-explora/apicenter-sdk

One server-side TypeScript client for APICenter shared services and payments.

## Install

Configure npm to use GitHub Packages for the `@alpha-explora` scope:

```ini
@alpha-explora:registry=https://npm.pkg.github.com
```

Authenticate with a GitHub token that can read packages, then install:

```bash
npm install @alpha-explora/apicenter-sdk
```

## Configure a service

Keep these values in server-only environment variables. Do not use `NEXT_PUBLIC_` variables or expose the service secret to a browser.

```env
APICENTER_URL=https://api-center.itsandbox.site
APICENTER_SERVICE_ID=orders-api
APICENTER_ENVIRONMENT=test
APICENTER_SERVICE_SECRET=<secret-issued-for-this-service-and-environment>
```

```ts
import { randomUUID } from 'node:crypto';
import { ApiCenter } from '@alpha-explora/apicenter-sdk';

const api = new ApiCenter({
  baseUrl: process.env.APICENTER_URL!,
  auth: {
    serviceId: process.env.APICENTER_SERVICE_ID!,
    environment: process.env.APICENTER_ENVIRONMENT as 'test' | 'live',
    secret: process.env.APICENTER_SERVICE_SECRET!,
  },
});

const result = await api.email.send(
  {
    to: 'person@example.com',
    subject: 'Welcome',
    text: 'Your account is ready.',
  },
  { idempotencyKey: randomUUID() },
);
```

The SDK obtains and rotates the APICenter service token. APICenter derives project and tribe placement and enforces scopes from the registered service. Give the service only the scopes it needs.

## Payments

Use a payment API key when one has been provisioned. Otherwise, the service token is used and must have the required payment scope.

```env
APICENTER_PAYMENT_API_KEY=<optional-payment-key>
```

```ts
const api = new ApiCenter({
  baseUrl: process.env.APICENTER_URL!,
  auth: {
    serviceId: process.env.APICENTER_SERVICE_ID!,
    environment: process.env.APICENTER_ENVIRONMENT as 'test' | 'live',
    secret: process.env.APICENTER_SERVICE_SECRET!,
  },
  paymentApiKey: process.env.APICENTER_PAYMENT_API_KEY,
});

const checkout = await api.payments.checkouts.create(
  {
    referenceId: 'order-123',
    amount: { amountMinor: 49900, currency: 'PHP' },
    successUrl: 'https://app.example.com/payments/success',
    cancelUrl: 'https://app.example.com/payments/cancel',
  },
  { idempotencyKey: randomUUID() },
);
```

Payment writes require a unique idempotency key between 16 and 255 characters. The SDK does not retry mutations. It accepts the gateway's `202` pending-resource response as well as completed resources.

## Other namespaces

The client exposes `email`, `sms`, `otp`, `geo`, `googleAuth`, and `payments`. Request and response types are re-exported from `@apicenter/contracts`. Shared-service send and OTP mutation methods also require an idempotency key.

```ts
const challenge = await api.otp.generate(
  { recipient: 'person@example.com', channel: 'email', purpose: 'login' },
  { idempotencyKey: randomUUID() },
);

const address = await api.geo.reverseGeocode({ latitude: 14.5995, longitude: 120.9842 });
```

Choose `test` or `live` using the service credentials issued for that environment. Never share credentials between environments.

## Errors

The SDK throws `ApiCenterError` for APICenter failures. It includes the HTTP `status`, APICenter `code` and `details` when present, and `correlationId` when returned by the gateway.

```ts
import { ApiCenterError } from '@alpha-explora/apicenter-sdk';

try {
  await api.sms.send(
    { to: '+639171234567', message: 'Your code is 123456' },
    { idempotencyKey: randomUUID() },
  );
} catch (error) {
  if (error instanceof ApiCenterError) {
    console.error(error.status, error.code, error.correlationId);
  }
  throw error;
}
```
