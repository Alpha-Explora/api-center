# API Center Logo Script

## System Summary

API Center is the control plane and gateway for the platform.

It does four jobs:

1. Routes tribe-to-tribe calls through one governed gateway.
2. Routes tribe calls to shared platform services like payment, email, SMS, OTP, Google OAuth, and geo.
3. Owns registry, auth, scopes, consumes policy, rate limits, health, metrics, and audit trails.
4. Publishes governed platform and tribe events into Confluent Cloud, then into AWS S3 for the raw data lake.

The SDK is how tribes consume API Center. Tribes do not call shared services, provider APIs, or Confluent directly. They install `@implementsprint/sdk`, authenticate with API Center, and API Center enforces policy before proxying or publishing.

The management app is the local operator console for registration, readiness, shared-service setup, usage visibility, Confluent topic provisioning, secret provisioning, and deployment operations.

## Brand Idea

The logo should communicate:

- One trusted center for many teams.
- Controlled routing between services.
- A registry/control-plane feel, not a generic cloud logo.
- Secure internal platform infrastructure.
- Developer-grade polish, close to the current Mintlify-inspired UI direction.

Avoid making it look like a payment app, analytics chart, Kubernetes logo, Kafka logo, or generic network diagram.

## Primary Symbol Concept

Use a central rounded shield or hexagonal hub containing a small route node. Around it, show three to six connected service nodes or short routing paths that converge into the center.

The center represents API Center. The outer nodes represent tribes, shared services, and event topics. The paths should feel organized and intentional, not chaotic.

The mark should work as:

- A small sidebar icon.
- A favicon.
- A GitHub organization or repository avatar.
- A product mark beside the text `API Center`.
- A dark and light mode badge.

## Visual Direction

Use the current management UI language:

- Deep teal / near-black base.
- Mint green as the main accent.
- Clean white or off-white background variants.
- Rounded but not playful geometry.
- Simple vector style.
- No mascot.
- No 3D object.
- No excessive gradients.
- No tiny unreadable labels inside the logo.

Recommended colors:

```text
Deep teal: #043F3A
Near black: #050807
Mint: #22D3A6
Soft mint: #CFF8EA
Sky tint: #EAF7F5
White: #FFFFFF
Slate: #64748B
```

## Logo Generation Prompt

Use this prompt for an image generator or designer brief:

```text
Create a modern vector logo for a developer infrastructure product named "API Center".

The product is a centralized API gateway and control plane used by multiple internal teams called tribes. It handles service registry, secure routing, shared platform services, policy checks, observability, and governed event publishing to Kafka/Confluent and S3. The logo should show one trusted center that connects many services.

Design a simple, scalable icon: a central rounded shield or hexagonal hub with a small route node inside, connected to several minimal outer nodes by clean curved or angled paths. The center should feel like a secure gateway and registry. The outer nodes should suggest tribes, shared services, and event topics without using text labels.

Style: polished SaaS developer-tool brand, Mintlify-inspired, clean vector geometry, high contrast, refined, minimal, readable at favicon size. Use a deep teal or near-black base with a precise mint green accent. Keep the shape balanced and slightly technical, but not cold.

Color palette: deep teal #043F3A, near black #050807, mint #22D3A6, soft mint #CFF8EA, white #FFFFFF.

Create both:
1. A standalone icon mark.
2. A horizontal lockup with the icon and the wordmark "API Center".

The wordmark should use a clean Inter-like sans serif, medium or semibold weight, no italic, no decorative effects.
```

## Negative Prompt

```text
Do not create a mascot, cartoon, animal, robot, cloud-only icon, payment logo, generic analytics chart, Kubernetes wheel, Kafka logo, AWS logo, Google Cloud logo, literal database cylinder, lock-only icon, or globe-only icon.

Avoid cluttered network diagrams, too many nodes, tiny text, gradients that dominate the mark, overly playful rounded shapes, neon cyberpunk styling, 3D rendering, shadows that prevent favicon use, and thin lines that disappear at small sizes.
```

## Variant Prompts

### Favicon / App Icon

```text
Create a compact square app icon for "API Center": a deep teal rounded square with a centered mint gateway hub symbol. The symbol should be a minimal shield or hexagonal hub connected to three small nodes. High contrast, flat vector, readable at 16x16 and 32x32.
```

### Dark Header Logo

```text
Create a horizontal dark-mode logo for "API Center": mint and white icon on deep teal or near-black background, with a clean white wordmark. The icon is a central secure routing hub connected to three service nodes. Minimal vector, no gradients except a very subtle teal-to-mint depth if needed.
```

### Light Header Logo

```text
Create a horizontal light-mode logo for "API Center": deep teal wordmark, mint accent icon, white background. The icon is a central secure gateway hub connected to service nodes. Developer-tool style, precise, clean, scalable.
```

## Selection Checklist

Choose the logo that satisfies all of these:

- Still recognizable at 32x32.
- Does not need text to communicate central routing.
- Looks trustworthy beside API management and observability UI.
- Does not look like a provider logo.
- Works on both white and dark teal backgrounds.
- Can be redrawn as SVG with fewer than 12 main shapes.
- Does not overuse mint. Mint should be the accent, not the whole mark.

## Recommended Final Asset Set

```text
public/brand/logo-icon.svg
public/brand/logo-lockup-light.svg
public/brand/logo-lockup-dark.svg
public/brand/favicon.svg
apple-touch-icon.png
open-graph-logo.png
```

Implemented assets:

- `public/brand/logo-icon.svg`
- `public/brand/logo-lockup-light.svg`
- `public/brand/logo-lockup-dark.svg`
- `public/brand/favicon.svg`

## Suggested Use In The App

- Sidebar: use `logo-icon.svg` in a 32px rounded container.
- Top mobile header: use `logo-icon.svg` plus `API Center`.
- Login/admin screen later: use `logo-lockup-light.svg`.
- README and docs: use `logo-lockup-light.svg`.
- Dark hero sections: use `logo-lockup-dark.svg`.
