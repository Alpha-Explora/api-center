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

## Deploy

Round-2 console work (#201–#205) needs five migrations, new secrets and a deploy order. Full steps are in
[control plane operations](../../../../docs/operations/control-plane-operations.md#console-round-2); in short:

1. Create the secrets `apicenter-sms-admin-token`, `apicenter-otp-admin-token`,
   `apicenter-webhooks-runtime-admin-token` and `apicenter-webhooks-runtime-database-url` (login user
   `webhooks_runtime_login`; see [shared-service database roles](../../../../docs/operations/shared-service-database-roles.md)).
2. Apply migrations `20261120001020`, `20261120001021` (a `CREATE INDEX CONCURRENTLY`, outside a transaction),
   `20261120001030`, `20261120001040` and `20261120001050`, in that order.
3. Redeploy email, SMS, OTP and webhooks, then the gateway, then the console.

## Onboarding a team

1. A platform operator creates the organization on **Organizations**, optionally with its first owner.
2. The owner adds members on **People** with an organization role, and optionally groups them into teams. Each
   new member gets an invite email; when it cannot be sent, the console shows an invite to copy and send another
   way. An invite to the same email and organization is sent at most once in 24 hours.
3. A developer or above creates a project on **Projects**. It starts with a test environment.
4. In the project's **Settings**, give members or teams a project role (admin, developer, viewer). Organization
   owners and admins are implicitly admins of every project.
5. In test: enable capabilities on **Capabilities**, add an application on **Applications**, grant it actions on
   its **Access** tab, and issue a key on its **Keys** tab. The key (`ak_test_…`) is shown once; deliver it through
   the team's secret store.

## Going live

1. On the project's **Live** overview, create the live environment. Nothing is copied from test.
2. Assign a live-capable plan and meet the readiness checks shown on the overview.
3. Request activation with a reason. A different project admin approves it; **Approvals** lists every request
   waiting for a decision. The console disables approving your own request.
4. Activate. Then add live applications, grants and keys (`ak_live_…`) as in test.

## Routine operations

- **Rotate a key:** issue a new key, deploy it, then revoke the old one with a reason (kept in the audit log). Keys
  that expire within 14 days are flagged on the Keys tab, the overview and the sidebar.
- **Webhooks:** on **Webhooks**, add a destination per application (payments must be enabled). The signing secret
  is shown once. Rotating keeps the previous secret signing for 24 hours. A destination created with status
  `failed` shows its provisioning error; fix the cause and add it again. **Edit events** limits a signed webhook
  to chosen payment event types. **Send test event** sends a `webhook.test` event (at most one every 10 seconds
  per destination), and the delivery history shows each attempt's status, latency and error.
- **Published APIs:** on **APIs**, publish an API with a public https upstream and its operations. Another
  project's applications request access from their **Access** tab, which also lists the requests the project has
  sent and any rejection reason. A project admin of the publishing project approves or rejects it, with an
  optional reason, on the API's page.
- **Quotas:** create limits per environment on the project's **Quotas**, or shared ceilings on the organization
  **Quotas** page. Each policy shows how much is used. Edit, disable or delete a policy from its row menu; a
  delete cannot be undone. Changing a policy's window length starts a new count. Use observe mode before
  enforcing in live. Geolocation and SMS have no daily limit of their own; cap their volume with a quota.
- **Capability settings:** on **Capabilities**, set the email sender, pin an SMS sender ID, and set the OTP code
  length, expiry, wrong-attempt limit and message template. Only a project admin can change the OTP template.
  For SMS and OTP, reset to defaults writes empty values.
- **Suspend an environment:** on the project's **Settings**. A suspended environment refuses requests.
- **Suspend an organization:** platform operators, on **Organizations**. Its applications are refused and it
  cannot create projects. Its members can still sign in and change settings, so they can fix the cause; nothing
  they change takes effect for applications until it is reactivated.
- **Investigate a failure:** open the environment's **Requests** page (or the application's Requests tab), filter
  by status and open the request for its failure stage and correlation ID. Platform operators can also look up
  any request on the organization **Requests** page with the correlation ID from the response.
- **See who changed something:** the **Audit log**, or the project overview's Activity. Invite outcomes are
  recorded as `control_plane.member.invite_sent` or `control_plane.member.invite_not_sent` with a reason code.

## Known gaps

These are gateway limitations; the console states them where they apply.

- Usage counts admitted requests only. Requests refused for quota show in the request log, not the usage chart.
  Requests with an unverified key are not attributed to a project. The enterprise plan keeps no daily counter.
- Older audit events are attributed to a project only where the migration could find it.
- Webhook event-type filters are applied in the webhooks service, within about 30 seconds of a change; filtered
  events still reach that service. Pub/Sub push destinations receive every event type. The application Webhook
  tab does not show the chosen types.
- Delivery history starts when the webhooks runtime has its database; earlier attempts are not recorded. Without
  its database secret the runtime still delivers, and the history answers 503. Pub/Sub push destinations have no
  history and cannot receive a test event.
- Invites are sent from the email runtime's default sender under the platform project `apicenter-platform`, which
  has one daily allowance for every invite.
- The cross-organization approvals queue reads at most 500 pending live activations.
- Expired keys keep the stored status `active`; the console marks them by their expiry date.
- The email sender has no reset to defaults; saving replaces it. SMS sender IDs are not checked against Twilio.
- A deleted quota policy cannot be restored.
- A workload binding conflict can come from another organization.
- Removing a project's last administrator is refused (`409 LAST_PROJECT_ADMIN`) only when the organization has no
  owner or admin left; otherwise the console warns first.

## Related sources

- `docs/architecture/current-architecture.md`
- `docs/operations/control-plane-operations.md`
- `docs/payments-platform-current.md`
- `apps/docs/content/docs/management/`
