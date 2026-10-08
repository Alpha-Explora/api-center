# @alpha-explora/apicenter-sdk

TypeScript clients for APICenter payments and shared services.

## Install from GitHub Packages

Configure npm to resolve the Alpha-Explora scope from GitHub Packages:

```ini
@alpha-explora:registry=https://npm.pkg.github.com
```

Authenticate with a GitHub token that has `read:packages`, then install:

```bash
npm install @alpha-explora/apicenter-sdk
```

`PaymentsClient` calls `/api/v1/payments/*` with a payment API key. `SharedServicesClient` calls `/api/v1/shared/*` with a service token minted by `POST /api/v1/auth/token`. A service token is bound to a registered service, project, tribe, and environment; callers do not send a tribe ID header.

```ts
import { PaymentsClient, SharedServicesClient } from '@alpha-explora/apicenter-sdk';

const payments = new PaymentsClient({
  baseUrl: process.env.APICENTER_URL!,
  apiKey: process.env.APICENTER_PAYMENT_API_KEY!,
});

const shared = new SharedServicesClient({
  baseUrl: process.env.APICENTER_URL!,
  serviceToken: process.env.APICENTER_SERVICE_TOKEN!,
});
```

`TribeClient` combines both clients and therefore requires both credentials. The SDK does not contain PayMongo credentials.
