# API Center Management Design System

## Overview

API Center Management should feel closer to Mintlify than a default admin panel: polished, colorful, developer-grade, and dense where it needs to be. The app is still a local/private registry console, so it should not become a marketing page. The right direction is a vivid product workspace with atmospheric header bands, mint accent states, dense registry tables, and documentation-style detail pages.

The UI should combine two modes:

- A cinematic top-level dashboard that gives the API Center status at a glance.
- Dense operational pages for readiness, tribes, shared services, dependency maps, manifest tools, and settings.

The signature color is mint green. It should appear sparingly but decisively: primary CTAs, active navigation, success states, health indicators, and featured workflow panels. Black pill buttons remain the dominant action style on light backgrounds. Dark teal-to-mint bands can be used for dashboard headers and setup flows.

## Product Personality

- Developer tool, not consumer SaaS.
- Colorful and premium, not playful.
- Dense and readable, not cramped.
- Confident operational UI, not a generic CRUD scaffold.
- Local/private mode should be visible but quiet.

## Design Principles

### Do

- Use atmospheric gradients for top-level context areas, especially dashboard and shared-service setup.
- Reserve mint for important action and state signals.
- Keep registry data dense with 14px body type, clear dividers, and compact rows.
- Use Inter for prose and UI.
- Use Geist Mono or a monospace fallback for service IDs, endpoint paths, JSON, env vars, and manifests.
- Use black pill CTAs for primary actions.
- Use white pill CTAs on dark gradient bands.
- Prefer icons plus short labels for registry actions.
- Keep cards disciplined: 12px radius, 1px border, subtle shadow only when the panel is important.

### Don't

- Do not turn every card green.
- Do not use gradients behind every section.
- Do not use oversized marketing typography inside operational tables or forms.
- Do not use rounded blobs or decorative orbs.
- Do not introduce many accent colors. Use mint, tag blue, warning amber, error red, and one warm orange callout color.
- Do not put cards inside cards.
- Do not hide operational warnings behind pretty empty states.

## Tokens

### Colors

| Token | Value | Use |
|---|---:|---|
| `colors.brandGreen` | `#00D4A4` | Primary accent, active states, success marks |
| `colors.brandGreenDeep` | `#009B7A` | Pressed accent state, strong success labels |
| `colors.brandGreenSoft` | `#E8FFF8` | Success backgrounds, active sidebar tint |
| `colors.primary` | `#050505` | Primary buttons, strongest text |
| `colors.ink` | `#111111` | Headings and high-emphasis UI |
| `colors.charcoal` | `#2A2A2A` | Body copy |
| `colors.slate` | `#5E6470` | Secondary text |
| `colors.steel` | `#7A8190` | Tertiary text, table headers |
| `colors.muted` | `#A3A8B3` | Disabled labels, quiet metadata |
| `colors.canvas` | `#FFFFFF` | Page and card background |
| `colors.canvasTint` | `#F7FAF9` | App background |
| `colors.surface` | `#F2F6F5` | Sidebar active state, search, subtle panels |
| `colors.surfaceSoft` | `#FAFBFA` | Quieter section background |
| `colors.surfaceCode` | `#071B1B` | Code and manifest blocks |
| `colors.hairline` | `#DDE5E2` | Primary borders |
| `colors.hairlineSoft` | `#EEF2F0` | Table row and subtle dividers |
| `colors.heroSkyFrom` | `#DDFBFF` | Light hero gradient start |
| `colors.heroSkyTo` | `#FFF7E8` | Light hero gradient end |
| `colors.heroDarkFrom` | `#062B2D` | Dark hero gradient start |
| `colors.heroDarkTo` | `#00A884` | Dark hero gradient end |
| `colors.tagBlue` | `#3772CF` | Method tags, route references |
| `colors.warn` | `#F5A524` | Degraded readiness, missing optional setup |
| `colors.error` | `#E5484D` | Broken dependencies, failed health checks |
| `colors.orange` | `#FF7847` | Important human guidance or next-action callout |
| `colors.onDark` | `#FFFFFF` | Text on dark bands |
| `colors.onDarkMuted` | `rgba(255, 255, 255, 0.72)` | Secondary text on dark bands |

### Typography

Use Inter for all UI. Use Geist Mono where available, then `SF Mono`, Menlo, Consolas, monospace for developer values.

| Token | Size | Weight | Line height | Use |
|---|---:|---:|---:|---|
| `typography.heroDisplay` | 56px | 600 | 1.05 | Dashboard headline on large screens |
| `typography.heading1` | 40px | 600 | 1.10 | Page-level title |
| `typography.heading2` | 32px | 600 | 1.20 | Major sections |
| `typography.heading3` | 24px | 600 | 1.25 | Panel titles |
| `typography.heading4` | 18px | 600 | 1.35 | Card and form group titles |
| `typography.bodyMd` | 16px | 400 | 1.50 | Primary prose |
| `typography.bodySm` | 14px | 400 | 1.50 | Tables, nav, secondary copy |
| `typography.bodySmMedium` | 14px | 500 | 1.50 | Active nav, buttons, table emphasis |
| `typography.caption` | 13px | 400 | 1.40 | Helper text, metadata |
| `typography.micro` | 12px | 500 | 1.40 | Chips and compact labels |
| `typography.microUppercase` | 11px | 600 | 1.40 | Sidebar section headers |
| `typography.codeMd` | 14px | 400 | 1.50 | JSON and manifest blocks |
| `typography.codeInline` | 13px | 500 | 1.30 | Service IDs, paths, env vars |

Rules:

- Do not scale font size with viewport width.
- Use tight display leading only for real hero/header zones.
- Do not use negative letter spacing in compact panels or tables.
- Long-form docs and setup text should stay at 16px/1.5.

## Layout

### Shell

The app shell should use a fixed left rail and a top status bar on desktop.

- Sidebar width: `256px`.
- Content max width: `1480px`.
- Main background: `colors.canvasTint`.
- Sidebar background: `colors.canvas`.
- Sidebar border: `1px solid colors.hairlineSoft`.
- Main content padding: `32px` desktop, `20px` tablet, `16px` mobile.

### Top Status Bar

Use a slim top bar for:

- Local/private mode notice.
- Readiness shortcut.
- Connected API Center base URL.
- Optional last refresh timestamp.

This bar should feel like docs chrome: compact, useful, not promotional.

### Dashboard Header

The dashboard should get the strongest color treatment.

- Use a dark teal-to-mint atmospheric band.
- Include API Center status, service counts, missing health paths, broken dependencies, and the primary next action.
- Use white text on dark surfaces.
- Use one mint or white pill CTA.
- Include a subtle product mockup style panel showing registry/readiness data.

### Dense Pages

Tribes, dependencies, shared services, and manifest tools should use a documentation-like layout:

- Page header with compact title and action row.
- Search/filter row.
- Main table or list.
- Optional right-side detail/health summary on wide screens.

## Spacing

| Token | Value | Use |
|---|---:|---|
| `spacing.xxs` | 4px | Tiny gaps |
| `spacing.xs` | 8px | Control internals |
| `spacing.sm` | 12px | Compact groups |
| `spacing.md` | 16px | Form rows, table cells |
| `spacing.lg` | 20px | Panel internals |
| `spacing.xl` | 24px | Card padding |
| `spacing.xxl` | 32px | Page sections |
| `spacing.section` | 64px | Large top-level rhythm |
| `spacing.hero` | 96px | Dashboard hero band |

Operational pages should mostly use `16px`, `24px`, and `32px`. Avoid landing-page-style 96px gaps except inside the dashboard header.

## Radius

| Token | Value | Use |
|---|---:|---|
| `rounded.xs` | 4px | Inline code, micro tags |
| `rounded.sm` | 6px | Sidebar nav, small chips |
| `rounded.md` | 8px | Inputs, compact controls, code blocks |
| `rounded.lg` | 12px | Cards, tables, panels |
| `rounded.xl` | 16px | Large dashboard feature panel only |
| `rounded.full` | 9999px | Buttons, pills, status chips |

Use 12px for cards. Use full pills for buttons. Avoid random values between 12px and full.

## Elevation

| Level | Treatment | Use |
|---|---|---|
| Flat | `1px solid colors.hairline` | Default cards, tables, forms |
| Subtle | `0 1px 2px rgba(0,0,0,0.04)` | Raised toolbar or focused panel |
| Card | `0 8px 24px rgba(0,0,0,0.06)` | Dashboard hero mockup |
| Brand | `0 8px 24px rgba(0,212,164,0.10)` | Featured shared-service setup CTA |

Do not add heavy shadows to registry tables.

## Components

### Buttons

#### `button-primary`

Black pill primary CTA.

- Background: `colors.primary`.
- Text: `colors.onDark`.
- Radius: `rounded.full`.
- Height: 40px desktop, 44px mobile.
- Padding: `10px 20px`.
- Font: `bodySmMedium`.

Use for `Open registry`, `Register service`, `Apply manifest`, and destructive confirmation alternatives that are not destructive themselves.

#### `button-accent`

Mint pill CTA for the one action that should carry the viewport.

- Background: `colors.brandGreen`.
- Text: `colors.primary`.
- Radius: `rounded.full`.
- Height: 40px desktop, 44px mobile.

Use sparingly: dashboard "Check readiness", setup "Register shared services", or success-recovery CTAs.

#### `button-secondary`

Outlined pill.

- Background: `colors.canvas`.
- Border: `1px solid colors.hairline`.
- Text: `colors.ink`.
- Radius: `rounded.full`.

#### `button-ghost`

Compact utility button.

- Background: transparent.
- Radius: `rounded.md`.
- Text: `colors.charcoal`.

Use inside rows and detail panes.

### Sidebar Nav

#### `sidebar-nav-item`

- Height: 40px.
- Radius: `rounded.md`.
- Text: `colors.slate`.
- Icon: 18px, 1.75px stroke.
- Gap: 10px.

#### `sidebar-nav-item-active`

- Background: `colors.brandGreenSoft`.
- Text: `colors.ink`.
- Icon: `colors.brandGreenDeep`.
- Optional left indicator: 3px mint bar.

### Cards

#### `card-base`

- Background: `colors.canvas`.
- Border: `1px solid colors.hairline`.
- Radius: `rounded.lg`.
- Padding: `spacing.xl`.

Use for summary cards, setup cards, and readiness checks.

#### `card-alert`

- Background: `#FFF8E7` for warning, `#FFF1F1` for error.
- Border color should match semantic tone at 30 percent opacity.
- Use only when action is needed.

#### `card-featured`

- Background: `colors.canvas`.
- Border: `2px solid colors.brandGreen`.
- Shadow: brand elevation.
- Use for the recommended next action or primary setup step.

### Tables

#### `registry-table`

- Background: `colors.canvas`.
- Border: `1px solid colors.hairline`.
- Radius: `rounded.lg`.
- Header text: `typography.microUppercase`, `colors.steel`.
- Row text: `typography.bodySm`.
- Row height: 52px minimum.
- Cell padding: `12px 16px`.
- Service IDs and paths use `typography.codeInline`.

Tables should expose useful operational state without forcing users into detail pages.

Columns for services:

- Service ID.
- Type.
- Owner.
- Base URL.
- Health path.
- Lifecycle.
- Last checked.
- Actions.

### Status Chips

#### `status-healthy`

- Background: `colors.brandGreenSoft`.
- Text: `colors.brandGreenDeep`.
- Dot: `colors.brandGreen`.

#### `status-warning`

- Background: `#FFF8E7`.
- Text: `#9A5B00`.
- Dot: `colors.warn`.

#### `status-error`

- Background: `#FFF1F1`.
- Text: `#B42318`.
- Dot: `colors.error`.

#### `status-neutral`

- Background: `colors.surface`.
- Text: `colors.slate`.
- Dot: `colors.muted`.

### Code And Manifest Blocks

Use dark code blocks for JSON, manifests, curl commands, and env examples.

- Background: `colors.surfaceCode`.
- Text: `colors.onDark`.
- Radius: `rounded.md`.
- Padding: `spacing.md`.
- Font: `typography.codeMd`.
- Header text: `colors.onDarkMuted`.
- Copy button: circular or small pill on the right.

Inline code should be light:

- Background: `colors.surface`.
- Border: `1px solid colors.hairline`.
- Text: `colors.charcoal`.
- Radius: `rounded.xs`.
- Padding: `2px 6px`.

### Forms

Inputs should be compact and precise.

- Height: 40px desktop, 44px mobile.
- Radius: `rounded.md`.
- Border: `1px solid colors.hairline`.
- Focus border: `2px solid colors.brandGreen`.
- Labels: `bodySmMedium`.
- Help text: `caption`, `colors.slate`.
- Required label: red uppercase micro chip only when needed.

## Page Patterns

### Dashboard

The dashboard should open with a colored operational hero:

- Left: headline, local mode copy, readiness CTA.
- Right: compact registry preview panel.
- Below: summary metrics as cards.
- Below metrics: workflow cards for readiness, registry, shared-service setup, and manifest import/export.
- Right rail on wide screens: current state and warnings.

Use the mint accent for healthy readiness and the primary next action. Use orange for human guidance like "before making public, add auth".

### Readiness

Readiness should feel like a checklist, not a plain endpoint response.

- Header shows readiness result and checked base URL.
- Group checks into Environment, API Center, Registry Auth, Shared Services, and Optional Integrations.
- Each check row has icon, label, result chip, and details.
- Failed checks should include a direct fix hint.

### Tribes

Tribes is the core registry browser.

- Use a dense table.
- Add filter chips for `tribe`, `shared`, `active`, `deprecated`, `retired`, and `missing health`.
- Show service IDs in monospace.
- Highlight missing owner or health path with warning chips.
- Primary action: `Register service`.

### Service Detail

Service detail should resemble an API documentation page.

- Left/main: metadata, routes, health, dependencies, lifecycle.
- Right rail: owner, current status, quick actions.
- Endpoint paths and proxy routes use monospace code styling.
- Destructive lifecycle actions should be visually separated.

### Shared Services

Shared services should feel like a setup workspace.

- Use a dark teal-to-mint hero band for "Shared services".
- Show the six expected services: `gauth`, `geo`, `paymongo`, `email`, `sms`, `otp`.
- Each card shows required secrets, routes, health path, and registration status.
- The recommended action card can use `card-featured`.

### Dependencies

Dependency map should use a network/product metaphor without becoming decorative.

- Main content: table or graph toggle.
- Warning rows for broken or unknown dependencies.
- Use tag blue for route and dependency labels.
- Use error red only for actually broken dependency edges.

### Manifest Tools

Manifest tools should feel like a developer docs tool.

- Use dark code blocks for generated manifests.
- Use segmented tabs for Import, Export, Validate, and Dry Run.
- Validation result should be a checklist with errors grouped by service.

### Settings

Settings should be quiet and dense.

- Use section groups.
- Show local env status without exposing secret values.
- Use copyable env var names.
- Do not add atmospheric gradients here.

## Responsive Behavior

| Breakpoint | Width | Behavior |
|---|---:|---|
| Mobile small | `< 480px` | Single column, sidebar becomes drawer, cards stack |
| Mobile large | `480-767px` | Single column, larger touch targets |
| Tablet | `768-1023px` | Two-column summary grids, sidebar drawer |
| Desktop | `1024-1279px` | Fixed sidebar, main content full width |
| Wide desktop | `>= 1280px` | Optional right rail and wider dashboard layout |

Mobile rules:

- Buttons and inputs must be at least 44px tall.
- Avoid horizontal overflow except for explicit tables.
- Tables can become cards only if the card preserves service ID, type, owner, health, and action.
- Sidebar nav should move to a drawer below 1024px.

## Accessibility

- Text on dark gradient bands must meet contrast.
- Mint text on white is not enough for body text; use mint mainly as background, border, icon, or dot.
- Focus states should be visible and mint-accented.
- Link-rendered buttons must preserve correct anchor semantics.
- Do not rely on color alone; status chips need text and/or icons.

## Implementation Notes

### CSS Variables

Map the tokens into `src/app/globals.css` through the existing shadcn variables:

- `--background`: `colors.canvasTint`.
- `--foreground`: `colors.ink`.
- `--card`: `colors.canvas`.
- `--border`: `colors.hairline`.
- `--primary`: `colors.primary`.
- `--accent`: `colors.brandGreenSoft`.
- `--ring`: `colors.brandGreen`.
- Add app-level custom variables for mint, hero gradients, code surface, and semantic tones.

### Component Direction

Use the existing shadcn/base-ui primitives and keep component ownership local:

- `app-shell.tsx` owns navigation, sidebar, and top status bar.
- `dashboard-client.tsx` owns the dashboard hero and workflow panels.
- Shared table, status chip, and code block components should be extracted only after the second repeated use.

### First Implementation Phase

1. Add full token variables in `globals.css`.
2. Upgrade the app shell with mint active states and a richer top status bar.
3. Replace the dashboard flat header with a dark teal-to-mint hero band.
4. Restyle summary cards and workflow cards using `card-base`, `card-featured`, and status chips.
5. Keep existing API behavior unchanged.

### Second Implementation Phase

1. Restyle readiness into grouped checklist panels.
2. Restyle tribe registry as a dense operational table.
3. Add service status chips.
4. Apply monospace treatment to service IDs, routes, env vars, and manifest JSON.

### Third Implementation Phase

1. Restyle shared services setup with the six-service grid.
2. Add dark code blocks for manifest outputs.
3. Improve dependency map density and warning states.
4. Add responsive drawer behavior for the sidebar.

## Design QA Checklist

- The first viewport has visible color and a clear API Center product signal.
- Mint appears in important actions and active states, not everywhere.
- Primary actions are black or mint pill buttons.
- Tables remain dense and scannable.
- Code and manifest values use monospace.
- No cards are nested inside cards.
- No text overlaps at mobile width.
- Dashboard, readiness, tribes, and shared services look related but not identical.
- The app still feels private/local until auth is implemented.
