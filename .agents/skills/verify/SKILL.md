---
name: verify
description: Verify a change actually works before committing — run checks, exercise the app, look at UI changes. Use before every commit and whenever asked to confirm something works.
---

# Verify a change

Run the layers that your change touches. A change is verified when you've **observed** it
working, not when checks pass.

## 1. Always: static + unit

```bash
pnpm check        # biome lint + tsc + vitest
```

## 2. Flows changed: e2e

```bash
pnpm e2e          # config auto-detects the sandbox Chromium; no install needed
```

If new user-facing flows were added, extend `e2e/` with a smoke spec for them first.

## 3. UI changed: look at it

Never ship UI you haven't seen. Start the app and capture light + dark, desktop + phone:

```bash
pnpm dev &        # in background; wait for "Ready"
node scripts/screenshot.mjs / <changed-routes...>
```

Read the PNGs in `.screenshots/` and check them against the checklist at the bottom of
`docs/design/principles.md`. For significant UI work, also run the `design-review` skill.
Send the screenshots to the user when reporting completion.

## 4. Behavior changed: exercise it

For domain logic with no UI yet, drive it directly (a scratch script or `vitest run` on the new
tests) and confirm outputs on realistic inputs — including the failure paths (full boat,
uncertified diver, a nitrox request with no verified card).

## Report honestly

State what you ran and what you observed. If anything is red or unverified, say so plainly —
never mark work done with failing or skipped verification.
