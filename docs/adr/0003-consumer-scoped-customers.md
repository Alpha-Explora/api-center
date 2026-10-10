---
title: "Customers Are Scoped to a Consumer Service"
status: canonical
authority: normative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "unverified"
verification: unverified
sources: ["AGENTS.md","docs/architecture/current-architecture.md"]
---
# Customers Are Scoped to a Consumer Service

APICenter creates a separate customer for each consumer service even when the same person uses multiple first-party products. This keeps customer and saved payment-method data within the product that collected it, preventing cross-product discovery or reuse while preserving one APICenter merchant account.

