---
title: "Consumers Supply Final Charges and Tax Breakdowns"
status: canonical
authority: normative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "unverified"
verification: unverified
sources: ["AGENTS.md","docs/architecture/current-architecture.md"]
---
# Consumers Supply Final Charges and Tax Breakdowns

APICenter v1 charges the final gross PHP amount supplied by the consumer service and may record its declared tax breakdown. AlphaCI and other consumers retain offer, quote, and tax-calculation logic; APICenter does not calculate tax, issue compliant tax documents, or perform tax remittance in v1.

