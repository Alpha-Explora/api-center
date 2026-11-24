# APICenter console design system

The console is a developer tool: neutral, dense, keyboard-friendly. Color carries meaning (status, and
marking the live environment) and nothing else. The sign-in screens and the public landing page use the
same tokens, type and components; the landing page may use larger type for its headings but no other
palette.

Tokens live in `src/app/globals.css`; components in `src/components/ui` (shadcn on Base UI) and
`src/components/patterns` (console patterns). Render the logo with `BrandMark` (`src/components/brand-mark.tsx`),
an inline SVG whose lanes take the text color, so it needs no tile in dark mode.

## Principles

- Show the real state. A failed call renders `ErrorPanel` with the gateway's message and code; an empty
  list says what to do next. Never hide a failure behind an empty state.
- Test and live are separate, and live is always visible: a red top line, a "Live environment" badge, and
  a red Live segment in the environment switch.
- Let roles shape the UI, not errors. An action the person's role does not allow stays visible but disabled,
  with the reason in a tooltip (`GuardedButton`). Roles come from `model/access.ts`, which mirrors the
  gateway's console access policy.
- Confirm anything destructive or hard to undo with the object's name (`ConfirmDialog`), and ask for a
  reason when the gateway records one.
- Show a secret once, then require "I stored it" (`SecretDialog`).
- Show words, not stored values: statuses read "Active" and "Invite expired" (`StatusBadge` does this), counts
  use the right plural, and a detail page's breadcrumb ends in the object's name.

## Tokens

| Token | Use |
|---|---|
| `background`, `card`, `popover` | Page, panels, overlays. Neutral grays, light and dark. |
| `foreground`, `muted-foreground` | Primary and secondary text. |
| `border`, `input` | Hairlines and control borders. |
| `primary` | Primary buttons (near-black in light, near-white in dark). |
| `success`, `warning`, `danger`, `info` (+ `-soft`) | Status only: active/enabled, pending/provisioning, failed/revoked, informational. |
| `live` | The live environment marker. Never used for anything else. |

Type: Geist Sans for UI, Geist Mono for IDs, keys, actions, paths and JSON (`next/font`). Body 14px, dense
tables and helper text 13px, labels 12px, page titles 20px semibold. No display type inside the console.

Shape and density: radius 6px (`--radius: 0.375rem`); 1px borders; shadows only on overlays and a hairline
`shadow-xs` on inputs and outline buttons. Controls are 32px tall (`h-8`), small controls 28px, table rows
about 40px.

## Layout

- Shell (`components/shell`): 240px sidebar with the organization switcher, ⌘K search, organization pages,
  and, inside a project, the project switcher, Test/Live switch and project sections. A 48px top bar holds
  breadcrumbs and environment markers. Content max width 72rem with 24–32px gutters.
- Routes: `/projects/:projectId/:env/...`. Switching environment keeps the section but drops
  environment-specific objects (an application in test does not exist in live).
- Page: `PageHeader` (title, one-line description, meta, actions), then `Panel`s. Tables sit flush inside a
  panel. Create and edit happen in a right-hand `Sheet`; quick confirmations in a `Dialog`.
- Sidebar rows can carry a count badge (pending approvals, keys expiring soon).
- At 390px, a `Notice`'s action button moves inside its body.

## Patterns

| Component | Use |
|---|---|
| `PageHeader` | Page title row and primary actions. |
| `Panel`, `DescriptionList` | Bordered sections; label/value properties. |
| `StatusBadge`, `statusTone` | Any control-plane status; unknown statuses read as neutral. |
| `EmptyState` | Empty lists, with the next step. |
| `ErrorPanel`, `Notice` | Failures with the gateway code; limitations and rules that apply right now. |
| `ComingSoonBadge` | A feature that is built but not available yet. Pair it with a `Notice` saying what works today; never hide the feature or let it fail when used. The reason comes from the server (for example the payouts overview's `availability`). |
| `Explainer` | How a page works ("How quotas apply"), folded to one line until opened; remembers being opened. Use it instead of a permanent `Notice` for background reading. |
| `LinkRow` | A table row that opens its object; keep a real link on the name for keyboard users. |
| `GuardedButton` | Actions gated by role, with the reason. |
| `ConfirmDialog` | Destructive or live-affecting actions; optional required reason. |
| `SecretDialog` | One-time secrets (API keys, signing secrets). |
| `IdText`, `CopyButton` | Monospace identifiers with copy. |
| `RelativeTime` | Any timestamp: "16 minutes ago", with the exact time on hover. Never render `formatRelative` as text. |
| `ActorLabel` | Who made a change. `platform:<who>` reads as the person or script "via platform". |
| Button `quiet-destructive` | Row actions that take something away (Revoke, Remove, Delete, Suspend): neutral at rest, red on hover and focus. The confirmation that follows uses `destructive`. |
| `FormRow`, `NativeSelect`, `Kbd` | Form rows, styled native selects, keyboard hints. |
| `QuotaMeterBar` | How much of a quota is used: warns from 80%, turns `danger` when an enforced budget is full. |

## Sheets, lists and feedback

- A sheet that has a result to show (an invite, a created organization) replaces its form with the result and a
  Done button, with no toast.
- A server conflict on one field, such as a 409 on a slug, is shown under that field.
- A settings sheet shows the current values in a summary box above the form. Reset to defaults sits in its own
  section below the form, behind a confirmation. A capability with nothing to configure says why on its row.
- Editable lists use a row menu: Edit, Enable or Disable, Delete.
- An asynchronous action's progress, such as a test event, shows as an inline result banner: a full-width tinted
  strip (success, danger or muted) at the top of a flush `Panel`.
- Toasts sit top-center, so they never cover sheet or dialog footers.

## Charts

Charts are small inline SVGs (`views/overview/usage-chart.tsx`), not a chart library: one axis, thin bars with
rounded tops on a recessive grid, a hover and focus tooltip, a legend, and a table beside them.
Use `danger` only for failures.

## Writing

Short, specific sentences. Say what happens ("Requests with this key are refused immediately"), not what
the system is ("This is a destructive operation"). Use the control plane's words: project, environment,
application, capability, action, grant, key.
