---
title: "APICenter Is the V1 Merchant of Record"
status: canonical
authority: normative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "unverified"
verification: unverified
sources: ["AGENTS.md","docs/architecture/current-architecture.md"]
---
# APICenter Is the V1 Merchant of Record

APICenter owns the PayMongo merchant account and is the merchant of record for all v1 consumer payments. This keeps provider credentials, merchant configuration, webhook verification, and settlement responsibility in one platform boundary; supporting per-consumer merchant accounts is intentionally deferred because it requires a separate tenant-credential and merchant-onboarding product.

