# APICenter Domain Terminology & System Architecture Reference

This internal reference defines the canonical domain vocabulary, tenancy model, and system architecture across the APICenter monorepo.

---

## 🏛️ Core Domain Terminology

### 1. Merchant of Record
APICenter is the legal and operational PayMongo merchant for v1 payment processing, including merchant configuration and settlement responsibility.

### 2. Consumer Service
A registered product backend that calls APICenter via `@alpha-explora/apicenter-sdk` or contract endpoints and receives payment lifecycle events for its owner tribe.

### 3. Owner Tribe
The APICenter tenancy and authorization boundary that owns consumer services and their resources.

### 4. Payment Resource
A provider-neutral APICenter record for a checkout session, payment intent, refund, subscription, invoice, customer, or payment-method setup.

### 5. Reference ID
The stable consumer-defined identifier linking an APICenter resource to a consumer service's local record. Unique within `(ownerTribeId, consumerServiceId, environment)`.

### 6. Payment Data Plane (`apps/payments`)
The private microservice runtime managing PayMongo credentials, provider REST calls, webhook signature verification, canonical payment state, and transactional outbox events.

### 7. Gateway Control Plane (`apps/gateway`)
The central NestJS API Gateway managing consumer authentication, tenant authorization, quotas, rate limiting, domain routing (`auth-security`, `catalog-registry`, `compliance`, `gateway-proxy`, `governance`, `payments`, `runtime-ops`), audit logging, and public facade routing.

### 8. Platform Shared Microservices (`apps/*`)
Dedicated platform microservice runtimes written in TypeScript following **100% Strict Enterprise Feature Architecture** (`features/<action>/`):
- `apps/payments`: PayMongo payment processing and subscriptions
- `apps/email`: Transactional email sending and status
- `apps/sms`: Transactional SMS delivery
- `apps/otp`: Passcode generation and verification
- `apps/geo`: Geocoding, reverse geocoding, and geofencing
- `apps/gauth`: Multi-tenant Google OAuth 2.0 & OIDC token verification
