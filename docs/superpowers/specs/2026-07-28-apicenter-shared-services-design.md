# APICenter Shared Services Migration Design

## Status

Approved for implementation planning on 2026-07-28.

## Goal

Move the existing email, SMS, OTP, Google Auth, and geo runtimes from the
legacy `api-shared` repository into APICenter so APICenter owns their source,
contracts, deployments, provider configuration, and operational boundaries.
AlphaCI remains a consumer and keeps only AlphaCI-specific business logic.

## Architecture

APICenter will contain one independently deployable app for each shared
runtime:

```text
api-center/apps/
  email/
  sms/
  otp/
  gauth/
  geo/
  payments/
  gateway/
  management/
```

Each service keeps its own process, package, tests, Dockerfile, and Cloud Run
deployment. Shared APICenter runtime utilities provide health responses,
structured errors, rate limits, idempotency, provider timeouts, circuit
breakers, metrics, and gateway registration. Consumers reach the services only
through the authenticated APICenter gateway and SDK.

The old `api-shared` repository becomes frozen migration history after the
cutover is verified. No consumer will call the legacy services directly.

## Public Contracts

The migration preserves the existing endpoint shapes and response envelopes:

| Service | Endpoints |
| --- | --- |
| Email | `/send`, `/status/:messageId` |
| SMS | `/send`, `/status/:messageId` |
| OTP | `/generate`, `/verify`, `/status/:otpId` |
| Google Auth | Existing `/oauth/*` flows, including tenant credentials and signed state |
| Geo | `/geocode`, `/reverse-geocode`, `/geofence/check` |

The migration also moves and validates service manifests, scopes, SDK types,
gateway registry metadata, provider error codes, and health responses.

## Data Ownership

- Email message status is owned by the APICenter email service.
- SMS message status is owned by the APICenter SMS service.
- OTP state is owned by the APICenter OTP service.
- Geo remains stateless apart from its cache.
- Google OAuth state remains signed and short-lived; provider tokens are not
  persisted by AlphaCI.
- Existing in-memory stores remain the default unless a later persistence
  decision is made.
- Payment data remains isolated in `apps/payments`.

No AlphaCI-specific business logic moves into these runtimes.

## Deployment and Security

Each runtime receives its own Cloud Run service, service account, image,
scaling limits, and provider Secret Manager bindings. Invocation is IAM-only
from the APICenter gateway. Provider credentials are available only to the
owning runtime.

These request/response services do not introduce Confluent Cloud or Kafka.
APICenter gateway audit and usage events remain platform infrastructure.

## Migration Order

1. Move shared runtime helpers and common contracts.
2. Move email and SMS.
3. Move OTP.
4. Move Google Auth.
5. Move geo.
6. Move manifests, Cloud Run deployment configuration, and gateway routes.
7. Update SDK and management references.
8. Run compatibility, unit, integration, local proxy, and deployment checks.
9. Freeze the legacy source after cutover verification.

## Verification and Rollback

Every app must build independently, pass its relocated tests, and pass the
APICenter contract checks. Local gateway proxy smoke tests must cover all five
services. Cloud Run manifests must validate, and provider configuration checks
must not expose secrets.

Migration is incremental. If a service fails verification, its APICenter route
remains disabled and traffic can continue using the previously registered
upstream while that service is corrected. No payment runtime or AlphaCI payment
projection changes are required for rollback.

## Non-Goals

- Redesigning the existing public APIs.
- Moving AlphaCI business logic into APICenter.
- Introducing a shared database for all services.
- Reintroducing Confluent Cloud or Kafka for provider calls.
- Adding an admin UI for provider configuration in this migration.
