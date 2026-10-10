---
title: "V1 Payments Use PHP Only"
status: canonical
authority: normative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "unverified"
verification: unverified
sources: ["AGENTS.md","docs/architecture/current-architecture.md"]
---
# V1 Payments Use PHP Only

APICenter v1 accepts and settles only PHP amounts. This matches the APICenter PayMongo merchant account and Philippine payment methods, and avoids introducing foreign-exchange, multi-currency refund, pricing, and reporting rules before they are explicitly designed.

