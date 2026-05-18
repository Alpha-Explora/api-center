# Descope Human Auth Reference

This note is for future work where Descope is used for human/admin identity in
API Center or `apicenter-management`.

Current production split:

```text
Tribe/backend M2M auth -> API Center internal JWT
Human/admin login -> Descope
Google OAuth product features -> api-shared-services gauth
```

Descope should not be required for normal tribe token issuance anymore. New
tribes should use API Center internal JWTs through `/api/v1/auth/token`.

## What Descope Should Be Used For

Use Descope for human-facing identity and account controls:

| Use case | Why Descope fits |
|---|---|
| Management console login | Authenticates human platform admins before loading management data |
| Admin roles | Separates platform admin, tribe owner, shared-service maintainer, and read-only observer |
| MFA | Adds passkey, OTP, magic link, TOTP, or other second-factor checks for privileged users |
| Invite flows | Lets platform admins invite new tribe owners or maintainers |
| Organization membership | Can model ImplementSprint admins now and per-tribe admin groups later |
| Session management | Handles login, logout, refresh, force logout, and compromised user sessions |
| Human audit identity | Lets audit logs record which person changed a service, secret, registration, or policy |

## What Descope Should Not Own

Do not use Descope for these platform internals unless there is a deliberate
architecture change:

```text
tribe backend token issuance
shared-service M2M auth
Kafka publishing auth
Confluent Cloud API keys
provider API keys such as PayMongo, Resend, Google Maps, or SMS
```

Those belong to API Center, GCP Secret Manager, Confluent Cloud, or the specific
shared-service runtime.

## Current API Center Behavior

Production should stay on:

```text
AUTH_PROVIDER=composite
```

In this mode:

```text
Token issuance:
  /api/v1/auth/token
  -> validate api-center-tribe-secret-<tribe-id>
  -> sign API Center internal JWT

Token validation:
  incoming bearer token
  -> validate API Center JWT first
  -> if that fails, validate Descope token as fallback
```

That means Descope is still useful for human/admin bearer tokens, but not for
new tribe M2M token issuance.

## Secret Manager Shape

Keep these only if Descope human/admin auth or validation fallback is still
needed:

```json
{
  "DESCOPE_PROJECT_ID": "<project-id>",
  "DESCOPE_ISSUER": "https://api.descope.com/v1/apps/<project-id>",
  "DESCOPE_AUDIENCE": "<project-id>",
  "DESCOPE_JWKS_URI": "https://api.descope.com/<project-id>/.well-known/jwks.json"
}
```

Usually optional unless using Descope-only token issuance:

```json
{
  "DESCOPE_TOKEN_ENDPOINT": "https://api.descope.com/oauth2/v1/apps/token",
  "DESCOPE_DEFAULT_CLIENT_SECRET": "<legacy-m2m-secret>"
}
```

Avoid adding these for new tribes:

```json
{
  "DESCOPE_CLIENT_SECRET_<SERVICE_ID>": "not needed for internal tribe JWT mode"
}
```

## Management Console Future Flow

Target flow for public `apicenter-management`:

```text
Admin opens management console
-> redirected to Descope login
-> Descope returns user/session token
-> management backend validates token with API Center or Descope JWKS
-> management backend checks admin role/org membership
-> server-side route handlers call API Center with API_CENTER_PLATFORM_ADMIN_SECRET
```

Important boundary:

```text
Browser user token = Descope human identity
Server API Center secret = management backend to API Center admin access
Tribe token = API Center internal JWT for service-to-service calls
```

Never expose `API_CENTER_PLATFORM_ADMIN_SECRET` to the browser.

## Suggested Roles

Start simple:

| Role | Access |
|---|---|
| `platform_admin` | Full management access, secret rotation workflows, service registration |
| `tribe_owner` | View and manage own tribe registration, consumers, and smoke checks |
| `shared_service_owner` | View and manage owned shared service runtime metadata |
| `observer` | Read-only dashboards, audit, cost, alerts |

## Implementation Checklist

Before deploying management publicly:

- Add Descope login route.
- Store human session server-side or in secure HTTP-only cookies.
- Protect all management routes.
- Add server-side role checks for write actions.
- Keep `API_CENTER_PLATFORM_ADMIN_SECRET` server-only.
- Log the Descope user ID/email on every management write action.
- Add logout and forced session invalidation behavior.
- Add tests proving anonymous users cannot read or mutate management data.

## If Descope M2M Is Re-enabled Later

Only do this intentionally. It reintroduces per-tribe provider setup and token
issuance dependency on Descope.

Required shape:

```text
AUTH_PROVIDER=descope
DESCOPE_PROJECT_ID=<project-id>
DESCOPE_ISSUER=<issuer>
DESCOPE_AUDIENCE=<audience>
DESCOPE_JWKS_URI=<jwks-uri>
DESCOPE_TOKEN_ENDPOINT=<token-endpoint>
DESCOPE_DEFAULT_CLIENT_SECRET=<default-client-secret>
DESCOPE_CLIENT_SECRET_<SERVICE_ID>=<optional-service-secret>
```

Expected old flow:

```text
Tribe calls /api/v1/auth/token
-> API Center validates the tribe secret hash
-> API Center calls Descope token endpoint
-> Descope issues access token
-> API Center validates Descope JWT on requests
```

Prefer keeping this disabled unless there is a strong reason for Descope to own
service identities.
