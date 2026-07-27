# @alpha-explora/apicenter-sdk

The provider-neutral TypeScript client for APICenter payments.

## Install from GitHub Packages

Configure npm to resolve the Alpha-Explora scope from GitHub Packages:

```ini
@alpha-explora:registry=https://npm.pkg.github.com
```

Authenticate with a GitHub token that has `read:packages`, then install:

```bash
npm install @alpha-explora/apicenter-sdk
```

The SDK calls only the public `/api/v1/payments/*` API and requires an APICenter consumer API key. It does not contain PayMongo credentials.
