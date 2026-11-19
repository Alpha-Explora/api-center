# APICenter console design system

The console is a developer tool: neutral, dense, keyboard-friendly. Color carries meaning (status, and
marking the live environment) and nothing else. The public landing page keeps its own look until it is
redesigned; this document covers the signed-in console.

Tokens live in `src/app/globals.css`; components in `src/components/ui` (shadcn on Base UI) and
`src/components/patterns` (console patterns).

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

## Patterns

| Component | Use |
|---|---|
| `PageHeader` | Page title row and primary actions. |
| `Panel`, `DescriptionList` | Bordered sections; label/value properties. |
| `StatusBadge`, `statusTone` | Any control-plane status; unknown statuses read as neutral. |
| `EmptyState` | Empty lists, with the next step. |
| `ErrorPanel`, `Notice` | Failures with the gateway code; limitations and rules. |
| `GuardedButton` | Actions gated by role, with the reason. |
| `ConfirmDialog` | Destructive or live-affecting actions; optional required reason. |
| `SecretDialog` | One-time secrets (API keys, signing secrets). |
| `IdText`, `CopyButton` | Monospace identifiers with copy. |
| `FormRow`, `NativeSelect`, `Kbd` | Form rows, styled native selects, keyboard hints. |

## Writing

Short, specific sentences. Say what happens ("Requests with this key are refused immediately"), not what
the system is ("This is a destructive operation"). Use the control plane's words: project, environment,
application, capability, action, grant, key.
