# Tribe API Quotas

API Center supports configurable per-tribe API call limits. Operators can set a
quota for all calls, one namespace, or one target service. Policies start in
observe mode and can be switched to enforce mode after usage is reviewed.

When a tribe exceeds an enforced quota, API Center returns HTTP 429 with
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

API Center can assign a tribe plan tier to an owner tribe and generate
observe-mode quota proposals from that tier. The first tier defaults are:

| Plan         | Gateway calls/day | Kafka publishes/day | Notes                                                             |
| ------------ | ----------------: | ------------------: | ----------------------------------------------------------------- |
| `starter`    |             1,000 |                 100 | Standard retention; provider-impacting smoke stays test-only.     |
| `standard`   |            25,000 |               5,000 | Standard retention; live shared-service access after approval.    |
| `pro`        |           250,000 |              50,000 | Extended retention and priority support.                          |
| `enterprise` |            custom |              custom | Custom retention, dedicated onboarding, stricter approval policy. |

Plan assignment does not auto-enforce quotas. Operators review the generated
quota proposals, create observe-mode policies, and switch to enforce only after
usage is reviewed.
