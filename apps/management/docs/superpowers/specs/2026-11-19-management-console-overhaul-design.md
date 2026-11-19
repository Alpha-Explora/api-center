# Management console overhaul — design

Status: proposed, 2026-11-19. Replaces the visual direction in `apps/management/DESIGN.md` and the
2026-06-14 command-center redesign spec.

## Goals

1. A neutral, dense developer-tool console (Vercel/Linear register): monochrome, compact, keyboard-first,
   color reserved for status and for marking the live environment.
2. A navigation model built around how the control plane is shaped: organization → project → environment
   (test | live) → application.
3. Expose every control-plane feature the gateway already serves but the console did not: capability
   configuration, webhooks (event destinations), published APIs and access requests, API grants, workload
   bindings, project roles, environment status, quota policies.
4. Redesign sign-in and the public landing page to match.

Non-goals: new gateway features. Missing backend pieces are listed under "Gaps" and the UI states them
plainly instead of faking them.

## Information architecture

```
Organization switcher (sidebar header)                       ⌘K command palette everywhere
├─ Projects                /projects
│   └─ <project>           /projects/:projectId → redirects to /projects/:projectId/test
│       ├─ [Test | Live]   environment switch; live gets a persistent red marker in the chrome
│       ├─ Overview        /projects/:p/:env                  status, plan + usage, capabilities, go-live (live)
│       ├─ Applications    /projects/:p/:env/applications     list; detail at /applications/:applicationId
│       │                    detail tabs: Access (capability + API grants) · Keys · Workload identities · Webhook
│       ├─ Capabilities    /projects/:p/:env/capabilities     enable/disable + configuration (email sender, Google sign-in)
│       ├─ APIs            /projects/:p/:env/apis             published APIs, operations editor, incoming access requests
│       ├─ Webhooks        /projects/:p/:env/webhooks         event destinations, secret rotation, provisioning status
│       ├─ Quotas          /projects/:p/:env/quotas           project policies + shared ceilings that cover it
│       └─ Settings        /projects/:p/settings              project roles, environment status (suspend/resume)
├─ People                  /people                            members, teams
├─ API catalog             /apis                              every active API in the organization
├─ Quotas                  /quotas                            shared ceilings across projects (owner/admin)
├─ Requests                /requests                          gateway request diagnostics
└─ Settings                /settings                          console/gateway config (platform admin only)
```

Old `/control-plane/*` URLs redirect to the new ones.

Role awareness: navigation and actions read `GET organizations/:org/me`. Organization owner/admin are
effective project admins even when `projectRoles` is empty. Writes on live need project admin; on test,
developer. Actions the actor cannot take are hidden or disabled with the reason in a tooltip, never left to
fail with a 403.

## Design system

- Type: Geist Sans for UI, Geist Mono for IDs, keys, paths, JSON. 14px body, 13px dense tables and metadata,
  12px labels. No display type inside the console.
- Color: neutral gray scale in OKLCH, light and dark themes (system default, user toggle). Status hues only:
  green (active/healthy), amber (pending/provisioning/observe), red (failed/revoked/live marker), blue (info).
- Shape: 6px radius on controls and panels, 1px hairlines, no shadows except overlays.
- Density: 32px controls, 36px table rows, 12/16/24px spacing.
- Patterns: page header (title, one-line description, actions) · toolbar (search/filter) · table or
  description list · side sheet for create/edit · confirm dialog for destructive actions with the object
  name · one-time-secret dialog (copy, then explicit "I stored it") · empty states that say what to do next ·
  inline error panels with the gateway's error code.
- `DESIGN.md` is rewritten to this system in the first UI PR.

## Delivery

| PR | Contents |
|---|---|
| 0 | Gateway fix: scope published-API update and event-destination rotate/disable to the path's environment (today a test-only developer can change live APIs and webhooks). Tests. |
| 1 | Foundation: tokens, fonts, themes, primitives, app shell (org/project/env switchers, ⌘K), new routes with redirects; existing features ported (projects, project overview, plan/usage, capabilities toggle, applications, grants, keys, go-live, people, requests, settings). Drops the dead `migration/*` repository calls. |
| 2 | Capability configuration (email sender, Google sign-in) and Webhooks. |
| 3 | Published APIs + operations editor, incoming access requests, API grants on applications, org API catalog. |
| 4 | Project roles, environment suspend/resume, quota policies (project + shared), workload identities. |
| 5 | Sign-in and public landing page. |

Each PR builds, passes `npm run lint`, `typecheck`, `test` for `@apicenter/management`, and is checked in a
browser against the test gateway before review.

## Gateway contract notes

- Console calls go through `/api/local/control-plane/...`; the proxy forwards any GET/POST/PUT/DELETE under
  `capabilities`, `plans`, `organizations` — no allowlist changes needed. DELETE bodies are dropped.
- Error bodies are `{ error: { code, message } }` from the gateway but `{ error: "<string>" }` from the
  proxy itself; the client parses both.
- Event-destination create returns 200 with `status: "failed"` and `lastError` when provisioning fails; the
  UI must surface that as a failure.
- Capability configuration bodies are passed to the runtime unvalidated by the gateway; the console
  validates them (email: `fromAddress`, `dailyLimit`; gauth: `redirectUris`, `displayName`, `clientId`,
  write-only `clientSecret`).

## Gaps (backend, shown honestly in the UI; follow-up work)

- Capability configuration exists only for `email` (PUT only — current value cannot be read back) and
  `gauth`. Nothing for payments, sms, otp, geo.
- No event-type catalogue or per-type filter for webhooks: a destination receives every payment event for
  its application.
- Quota policies cannot be edited or deleted, only disabled.
- No list of outgoing API access requests for a consumer project; rejection takes no reason.
- Allowed workload-identity audiences are not discoverable; the form takes free text.
- Removing the last project admin is not prevented.
