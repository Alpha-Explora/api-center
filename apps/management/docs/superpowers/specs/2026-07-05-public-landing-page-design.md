# Public Landing Page Design

## Goal

Create a public APICenter landing page that appears before login and introduces APICenter as the control layer for tenant runtimes, shared services, gateway routing, OAuth, observability, and audit.

## Reference Direction

The page should use the same premium dark editorial rhythm the user pointed to in Meuze, but it must not copy Meuze branding, exact copy, images, or animation sequence. The APICenter version should feel cinematic and operational: dark first viewport, numbered sections, staggered reveals, runtime network visuals, and product-native panels.

## Route And Shell

- Public landing page owns `/`.
- Authenticated management pages stay behind the existing management shell.
- Existing command center moves to `/dashboard`.
- Existing protected URLs keep their route paths through a `(management)` route group.

## First Viewport

- Minimal public nav: APICenter, Platform, Solutions, Docs, Resources.
- Primary action: Request access.
- Secondary action: View runbook.
- H1: APICenter.
- Supporting line: The control layer beneath every tenant runtime.
- Hero visual: generated tenant runtime network image with live APICenter control panels.

## Sections

- `01 Control layer`: shared, dedicated, and future product operating model.
- `02 Workflows`: shared services, project Google sign-in settings, gateway routing, audit fabric.
- `03 Runtime day`: register, operate, reconcile.
- `04 Trust`: audit evidence and isolation state.
- Final CTA: Login to APICenter.

## Motion

- Hero visual drifts subtly.
- Content reveals with opacity and vertical movement.
- Workflow panels lift on hover.
- All motion is disabled under `prefers-reduced-motion`.

## Verification

- Typecheck.
- Lint.
- Local desktop and mobile screenshot checks.
