# Public Landing Page Implementation Plan

1. Split routing so `/` is public and existing management pages stay authenticated through a `(management)` route group.
2. Move the existing command center to `/dashboard` and update shell navigation to point there.
3. Add a generated APICenter runtime-network image under `public/landing`.
4. Build a responsive public landing component with APICenter-specific copy, CTAs, operational panels, and reduced-motion-safe animations.
5. Verify with typecheck, lint, and rendered desktop/mobile screenshots.
