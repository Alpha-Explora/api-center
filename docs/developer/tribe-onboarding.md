# Tribe Onboarding and Bootstrap Transition

This runbook defines how a tribe moves from temporary bootstrap manifests to
runtime self-registration at service startup.

## Registration Contract

Each tribe service must register with `POST /api/v1/registry/register` using this shape:

```json
{
  "serviceId": "orders-service",
  "name": "Orders Service",
  "baseUrl": "http://orders-service:4000",
  "requiredScopes": ["orders:read", "orders:write"],
  "exposes": ["orders:read", "orders:write"],
  "consumes": ["inventory-service"],
  "serviceType": "tribe",
  "healthCheck": "/health",
  "version": "1.0.0",
  "ownerTeam": "orders",
  "serviceTier": "standard"
}
```

Validation notes:

- `baseUrl` must be absolute `http` or `https`.
- `requiredScopes` and `exposes` must be non-empty arrays.
- Arrays must not contain duplicate values.
- `healthCheck`, if provided, must start with `/`.
- `serviceTier`, if provided, must be `critical`, `standard`, or `experimental`.
- Shared-service manifests may include advisory `quotaHints`; API Center quota
  policies remain the runtime enforcement source.

## Multi-Environment Service Registration

Register one stable service identity and attach one or more environment records.
The service identity owns governance, contacts, scopes, dependencies, and
lifecycle state. Each environment owns its runtime URL, health path, event
topic, tribe secret principal, and promotion evidence.

Supported environment keys are `test`, `staging`, `uat`, `demo`, and `live`.
Custom keys are not accepted in the first release. `baseUrl` remains required
as a compatibility mirror of the first/default environment URL.

Example:

```json
{
  "serviceId": "trinithrive",
  "name": "TriniThrive",
  "ownerTribeId": "trinithrive",
  "baseUrl": "https://trinithrive-test.example.com",
  "requiredScopes": ["service:read"],
  "exposes": ["/health"],
  "environments": [
    {
      "environment": "test",
      "baseUrl": "https://trinithrive-test.example.com",
      "healthCheck": "/health"
    },
    {
      "environment": "staging",
      "baseUrl": "https://trinithrive-staging.example.com",
      "healthCheck": "/health"
    }
  ]
}
```

## Tribe Startup Checklist

1. Create the per-tribe Secret Manager secret:
   - secret name: `api-center-tribe-secret-<tribe-id>`
   - payload stores `secretHashSha256=<sha256>` only
2. Ensure tribe requests an access token from `/api/v1/auth/token`.
3. Register service manifest at startup.
4. Verify discovery visibility through `/api/v1/tribes` or `/api/v1/shared`.
5. Verify health endpoint path and readiness behavior.

## Token Issuance Model

New tribes do not need a Descope app for API Center machine-to-machine access.
API Center validates the plaintext tribe secret against
`api-center-tribe-secret-<tribe-id>`, derives scopes from the registry, and
issues an API Center-signed internal JWT. Legacy
`TRIBE_SECRET_<SERVICE_ID_UPPER_SNAKE>` env keys are accepted only during
migration.

The tribe sends the plaintext secret only to:

```text
POST /api/v1/auth/token
```

Secret Manager stores only the SHA-256 hash:

```json
{
  "serviceId": "orders-service",
  "secretHashSha256": "<sha256 hash of plaintext tribe secret>",
  "status": "active",
  "rotatedAt": "2026-05-14T00:00:00.000Z"
}
```

Secret name:

```text
api-center-tribe-secret-orders-service
```

Descope remains for human/user identity and future management-console login. Do
not create one Descope OAuth or Inbound App per tribe unless the deployment is
explicitly switched back to `AUTH_PROVIDER=descope`.

## Temporary No-Confluent/No-AWS Mode

When `DATA_PIPELINE_ENABLED=false`, onboarding is complete when the service is
registered, the tribe secret hash is configured, `/api/v1/auth/token` issues a
token, and at least one allowed proxied call succeeds.

Do not require Confluent topic creation, S3 Sink inclusion, Athena access, or
raw export validation until `DATA_PIPELINE_ENABLED=true`.

## Transition Plan: Bootstrap to Self-Registration

1. Enable bootstrap only for temporary non-prod bootstrap:
   - `REGISTRY_BOOTSTRAP_ENABLED=true`
2. Deploy tribe service with startup registration.
3. Confirm tribe appears in discovery without bootstrap entries.
4. Remove tribe entry from bootstrap manifests.
5. Restart gateway and verify discovery still lists the tribe.
6. Repeat for each tribe until manifests are empty.
7. Disable bootstrap mode:
   - `REGISTRY_BOOTSTRAP_ENABLED=false`

## Production Safeguard

Bootstrap mode is blocked in production by default. To override explicitly:

```bash
REGISTRY_BOOTSTRAP_ENABLED=true
REGISTRY_BOOTSTRAP_ALLOW_IN_PRODUCTION=true
```

Use the override only for planned incidents or controlled migration windows.
