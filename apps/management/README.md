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
| `/projects/:projectId/:env` | Environment overview: status, plan, usage, going live (`env` is `test` or `live`) |
| `/projects/:projectId/:env/applications[/:applicationId]` | Applications: capability grants, keys, workload identities, webhook |
| `/projects/:projectId/:env/capabilities` | Capabilities enabled in the environment, and email and Google sign-in settings |
| `/projects/:projectId/:env/webhooks` | Payment event destinations: signed webhooks or Pub/Sub push, secret rotation, disable |
| `/projects/:projectId/:env/quotas` | Quota policies for the environment, and the shared ceilings that cover it |
| `/projects/:projectId/settings` | Project roles and environment status (both environments) |
| `/quotas` | Shared quota ceilings across projects (organization owners and admins) |
| `/people` | Members, organization roles, teams |
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
