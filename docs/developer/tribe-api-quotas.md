# Tribe API Quotas

API Center supports project API budgets and optional tribe-wide quota ceilings.
Operators can scope policies to a project, namespace, or target service.
Policies start in observe mode and can be switched to enforce mode after usage
is reviewed. When both a project budget and a tribe ceiling apply, both are
enforced.

When an enforced quota is exceeded, API Center returns HTTP 429 with
`code=TRIBE_API_QUOTA_EXCEEDED`. The SDK raises `RateLimitError` and includes
retry/quota metadata when the gateway provides it.

Quota policy is enforced only in API Center. Shared-service manifests may include
`quotaHints` to help operators pick starting values:

```json
{
  "quotaHints": {
    "recommendedWindowSeconds": 60,
    "recommendedMaxRequests": 100,
    "providerCostSensitive": true,
    "notes": "Payment calls should be lower than read-only lookup calls."
  }
}
```

These hints are advisory. They do not grant access, block traffic, or override
an API Center quota policy.

## Plan Tiers

API Center assigns plan tiers per project and can generate observe-mode quota
proposals from that tier. The first tier defaults are:

| Plan         | Gateway calls/day | Kafka publishes/day | Notes                                                             |
| ------------ | ----------------: | ------------------: | ----------------------------------------------------------------- |
| `starter`    |             1,000 |                 100 | Standard retention; provider-impacting smoke stays test-only.     |
| `standard`   |            25,000 |               5,000 | Standard retention; live shared-service access after approval.    |
| `pro`        |           250,000 |              50,000 | Extended retention and priority support.                          |
| `enterprise` |            custom |              custom | Custom retention, dedicated onboarding, stricter approval policy. |

Plan assignment does not auto-enforce quotas. Operators review the generated
quota proposals, create observe-mode policies, and switch to enforce only after
usage is reviewed.

## CI Smoke Requirements

The deployed quota smoke requires:

- `APICENTER_SMOKE_BASE_URL`
- `APICENTER_SMOKE_TRIBE_TOKEN`
- `APICENTER_SMOKE_APPROVER_TOKEN`
- `API_CENTER_PLATFORM_ADMIN_SECRET`

Create `APICENTER_SMOKE_APPROVER_TOKEN` from a dedicated operator identity in the identity provider configured for the deployed API Center. Grant that identity the `platform:admin` scope, authenticate it to obtain a JWT, and save the JWT as a repository Actions secret named `APICENTER_SMOKE_APPROVER_TOKEN`. Keep it separate from the identity represented by `APICENTER_SMOKE_TRIBE_TOKEN`: approvals reject a requester's own identity, and `API_CENTER_PLATFORM_ADMIN_SECRET` is a separate credential rather than an approver JWT. Use a token with sufficient lifetime for the manual smoke run and replace it when it expires or is rotated.

The manual workflow passes the approver token to the smoke when all three smoke tokens/settings are present. If the base URL and tribe token exist but the approver token is absent, it emits a warning naming the missing repository secret and skips the deployed quota smoke.

The smoke creates and approves a short-window enforced tribe ceiling for
`APICENTER_SMOKE_TRIBE_ID`, sends three calls through a shared-service route,
and expects `200`, `200`, then `429` with `TRIBE_API_QUOTA_EXCEEDED`.
