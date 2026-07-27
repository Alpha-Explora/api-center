# API Center Management Action Inventory

This document classifies the management console operations that can read or mutate API Center state.

## Risk Levels

| Risk | Meaning | Live behavior |
| --- | --- | --- |
| read | Fetches state only | Allowed by observer, operator, and admin |
| low-write | Writes local or test-only state | Requires operator or admin |
| state-write | Creates or updates API Center platform state | Requires typed confirmation and reason in live |
| provider-write | Calls provider or infrastructure APIs | Requires preview or dry-run when available, typed confirmation, and reason in live |
| destructive | Deletes, deprovisions, rotates, restarts, or disables live state | Admin-only in live with typed confirmation and reason |

## Known Actions

| Surface | Action | Risk |
| --- | --- | --- |
| `/tribes/new` | Create tribe | state-write |
| `/tribes/[tribeId]/edit` | Update tribe manifest | state-write |
| Tribe detail | Deprovision tribe | destructive |
| Shared services setup | Provision shared-service secret or config | provider-write |
| Smoke tests | Run safe smoke test | low-write |
| Smoke tests | Run provider-impacting smoke test | provider-write |
| Confluent provisioning | Create topics or ACLs | provider-write |
| Deployment restart | Restart backend deployment | destructive |
| Manifest tools | Import manifest | state-write |
| Settings | Change environment or endpoint config | state-write |

## Implementation Rule

Every server route that performs a write must call the shared authorization guard introduced in this plan before contacting API Center, Secret Manager, Confluent, payment providers, or deployment APIs.


