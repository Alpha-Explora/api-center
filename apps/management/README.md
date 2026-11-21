# APICenter Management

The console in `apps/management`: organizations, projects, their test and live environments,
applications, grants and keys, people and teams, and going live. Every change goes through the gateway's
control-plane API (`/api/v1/admin/control-plane/*`) via the console's proxy, which passes the signed-in
member's token so the gateway enforces their role. It does not hold PayMongo, Resend or other provider
credentials.

Design rules and components are in [DESIGN.md](DESIGN.md).

## Routes

| Path | Page |
|---|---|
| `/projects` | Projects in the current organization |
| `/projects/:projectId/:env` | Environment overview: status, plan, usage over time, daily limit, activity, getting-started checklist, SDK snippet, expiring keys, going live (`env` is `test` or `live`) |
| `/projects/:projectId/:env/applications[/:applicationId]` | Applications: capability grants, API access and outgoing requests with rejection reasons, keys, workload identities (audiences from the gateway's list), webhook with delivery history and test events, the application's requests; the sidebar counts keys expiring within 14 days |
| `/projects/:projectId/:env/capabilities` | Capabilities enabled in the environment; settings for the email sender (current sender and daily limit), SMS pinned sender, OTP code length, expiry, attempts and message template, and Google sign-in; the payments merchant binding |
| `/projects/:projectId/:env/apis[/:apiId]` | Published APIs: publish, edit operations, enable or disable, approve or reject incoming access requests with a reason |
| `/projects/:projectId/:env/webhooks` | Payment event destinations: signed webhooks or Pub/Sub push, event-type filters, delivery history, send test event, secret rotation, disable |
| `/projects/:projectId/:env/payouts` | Payouts: the payout wallet balance and low-float threshold, the next weekly payout and cash-out limits, payouts that need a person (resolve as paid or failed with a note), recent payouts, payees with masked destinations and earnings, and the payout settings |
| `/projects/:projectId/:env/requests` | Request log: recent requests, filters, details, correlation IDs |
| `/projects/:projectId/:env/quotas` | Quota policies for the environment and the shared ceilings that cover it, how much of each is used; edit, disable, delete |
| `/projects/:projectId/settings` | Project roles and environment status (both environments) |
| `/apis` | API catalog: every active API in the organization |
| `/quotas` | Shared quota ceilings across projects, with usage; edit, disable, delete (organization owners and admins) |
| `/approvals` | Pending live activations and API access requests: every organization's for platform operators, the ones the person can decide for everyone else |
| `/audit` | Audit log by project, actor, action and time (owners, admins, and project admins for their own projects); platform operators can show every organization |
| `/organizations` | Platform operators only: list, create (optional first owner), rename, suspend and reactivate organizations |
| `/people` | Members, organization roles, teams; new members get an invite email or a copyable invite |
| `/requests`, `/settings` | Platform operators only: request lookup and console configuration |

Old `/control-plane/*` links redirect.

## Local checks

```powershell
npm install
npm run typecheck --workspace @apicenter/management
npm test --workspace @apicenter/management
npm run build --workspace @apicenter/management
```

## Current operator sources

- `docs/operations/apicenter-management-runbook.md`
- `docs/apicenter-platform-setup.md`
- `docs/payments-platform-current.md`
