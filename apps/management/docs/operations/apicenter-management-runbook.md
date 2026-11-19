# APICenter Management Runbook

This runbook covers the console in `apps/management`. The console is a client of the gateway's control-plane
API (`/api/v1/admin/control-plane/*`): it forwards the signed-in member's Google token, and the gateway decides
what each role may do. The console holds no business state and no provider credentials.

Pages, routes and design rules: [README](../../README.md) and [DESIGN.md](../../DESIGN.md).

## Runtime

- Console: Next.js app in `apps/management`, deployed to Cloud Run as `apicenter-management-test`
  (`asia-southeast1`) and served at `https://apicenter.itsandbox.site`. Build images with
  `gcloud builds submit --config infra/gcp/cloud-build/apicenter-workspace-images.json` and deploy with
  `gcloud run services update apicenter-management-test --image …`. Google sign-in in deployments
  (`MANAGEMENT_AUTH_MODE=google`); `local-dev` sign-in is refused on Cloud Run (`K_SERVICE` set) and outside local test
  development.
- Gateway: the APICenter Cloud Run gateway, called server-side with `API_CENTER_PLATFORM_ADMIN_SECRET`.
- Sign-in looks up the account's memberships at `GET /api/v1/admin/control-plane/memberships`. An account with
  no membership cannot sign in unless it is a platform operator (`PLATFORM_ADMIN_EMAILS`).

## Local checks

```powershell
npm install
npm run typecheck --workspace @apicenter/management
npm test --workspace @apicenter/management
npm run build --workspace @apicenter/management
```

For local UI work, set `MANAGEMENT_AUTH_MODE=local-dev` and point `API_CENTER_BASE_URL` at a local gateway in
`apps/management/.env.local`. Do not point a local console at the deployed gateway to try out changes: it acts
on production data.

## Onboarding a team

1. A platform operator provisions the organization and its first owner (the console does not create
   organizations).
2. The owner adds members on **People** with an organization role, and optionally groups them into teams.
3. A developer or above creates a project on **Projects**. It starts with a test environment.
4. In the project's **Settings**, give members or teams a project role (admin, developer, viewer). Organization
   owners and admins are implicitly admins of every project.
5. In test: enable capabilities on **Capabilities**, add an application on **Applications**, grant it actions on
   its **Access** tab, and issue a key on its **Keys** tab. The key (`ak_test_…`) is shown once; deliver it through
   the team's secret store.

## Going live

1. On the project's **Live** overview, create the live environment. Nothing is copied from test.
2. Assign a live-capable plan and meet the readiness checks shown on the overview.
3. Request activation with a reason. A different project admin approves it; the console disables approving your
   own request.
4. Activate. Then add live applications, grants and keys (`ak_live_…`) as in test.

## Routine operations

- **Rotate a key:** issue a new key, deploy it, then revoke the old one with a reason (kept in the audit log).
- **Webhooks:** on **Webhooks**, add a destination per application (payments must be enabled). The signing secret
  is shown once. Rotating keeps the previous secret signing for 24 hours. A destination created with status
  `failed` shows its provisioning error; fix the cause and add it again.
- **Published APIs:** on **APIs**, publish an API with a public https upstream and its operations. Another
  project's applications request access from their **Access** tab; a project admin of the publishing project
  approves or rejects it on the API's page.
- **Quotas:** create limits per environment on the project's **Quotas**, or shared ceilings on the organization
  **Quotas** page. Policies cannot be edited or deleted: disable one and create a replacement. Use observe mode
  before enforcing in live.
- **Suspend an environment:** on the project's **Settings**. A suspended environment refuses requests.
- **Look up a failed request:** platform operators use **Requests** with the correlation ID from the response.

## Known gaps

These are gateway limitations; the console states them where they apply.

- Only email and Google sign-in have capability settings. The email sender cannot be read back.
- Webhooks have no event-type filter; a destination receives every payment event for its application.
- Quota usage is not reported, and policies cannot be edited or deleted.
- A project cannot list the API access requests it has sent; rejecting a request records no reason.
- Allowed workload-identity audiences are not discoverable, and a workload binding conflict can come from
  another organization.
- Nothing stops removing a project's last explicit admin; the console warns first.

## Related sources

- `docs/architecture/current-architecture.md`
- `docs/operations/control-plane-operations.md`
- `docs/payments-platform-current.md`
- `apps/docs/content/docs/management/`
