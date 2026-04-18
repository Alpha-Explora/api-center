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

## Tribe Startup Checklist

1. Add hashed startup secret in gateway env:
   - `TRIBE_SECRET_<SERVICE_ID_UPPER_SNAKE>=<sha256>`
2. Ensure tribe requests an access token from `/api/v1/auth/token`.
3. Register service manifest at startup.
4. Verify discovery visibility through `/api/v1/tribes` or `/api/v1/shared`.
5. Verify health endpoint path and readiness behavior.

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
