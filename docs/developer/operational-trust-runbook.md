# APICenter Operational Trust Runbook

Use this page before production promotion, during incidents, and during audit preparation.

## Required Checks

1. Governance drift must be empty.
2. Runtime dependency map must show known consumers and providers.
3. Promotion evidence bundle must pass all sections.
4. Emergency controls must be inactive unless an incident is open.
5. Consumer scorecards must not show stale SDK, high quota pressure, or high error rate for the promoted tribe.
