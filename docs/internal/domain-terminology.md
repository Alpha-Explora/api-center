---
title: "APICenter Domain Terminology & System Architecture Reference"
status: canonical
authority: informative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "2026-10-12"
verification: repository
sources: ["AGENTS.md","docs/architecture/current-architecture.md"]
---
# APICenter Domain Terminology & System Architecture Reference

This internal reference defines the canonical domain vocabulary, tenancy model, and system architecture across the APICenter monorepo.

---

## 🏛️ Core Domain Terminology

### 1. Merchant of Record
APICenter is the legal and operational PayMongo merchant for v1 payment processing, including merchant configuration and settlement responsibility.

### 2. Organization
The outer access scope for Management. Users receive an organization role; organization membership scopes the tribes and projects visible to them.

### 3. Tribe
A grouping for related projects. Tribes can own people, approvals, and an optional quota ceiling; they are inside an organization and are not the outer Management access boundary.

### 4. Project
A product or workload namespace within a tribe. Services are registered to one project, and project plans and quota budgets attach to this level.

### 5. Consumer Service
A registered backend that calls APICenter through `@alpha-explora/apicenter-sdk` or the REST API. It belongs to a project and may receive payment lifecycle events when event delivery is configured.

### 6. Payment Resource
A provider-neutral APICenter handle for a PayMongo-backed checkout session, payment intent, refund, subscription, invoice, customer, or payment-method setup. APICenter stores its project/environment ownership and selected listing or reconciliation metadata; PayMongo stores the canonical provider resource.

### 7. Reference ID
The stable consumer-defined identifier linking an APICenter resource to a consumer service's local record. It is unique within `(ownerTribeId, consumerServiceId, environment)`.

### 8. Payment Data Plane (`apps/payments`)
The private microservice runtime managing PayMongo credentials and provider REST calls, webhook signature verification, APICenter ownership/reconciliation records, and transactional outbox events. PayMongo remains the source of truth for provider-backed payment resources.

### 9. Gateway Control Plane (`apps/gateway`)
The central NestJS API Gateway managing consumer authentication, tenant authorization, quotas, rate limiting, domain routing (`auth-security`, `catalog-registry`, `compliance`, `gateway-proxy`, `governance`, `payments`, `runtime-ops`), audit logging, and public facade routing.

### 10. Platform Shared Microservices (`apps/*`)
Platform-owned service runtimes organized by feature under `features/<action>/`:
- `apps/payments`: PayMongo payment processing and subscriptions
- `apps/email`: Transactional email sending and status
- `apps/sms`: Transactional SMS delivery
- `apps/otp`: Passcode generation and verification
- `apps/geo`: Geocoding, reverse geocoding, and geofencing
- `apps/gauth`: Multi-tenant Google OAuth 2.0 & OIDC token verification
