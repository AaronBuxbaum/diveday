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

If new user-facing flows were added, extend `e2e/` with a smoke spec for them first, and add a
`@visual`-tagged capture for any new surface, in the spec file that already reaches it (see the
`e2e-and-visual` skill). `pnpm check` includes `check:clock`, which fails if domain/data code reads
the wall clock directly.

## 3. UI changed: look at it

Never ship UI you haven't seen. A `@visual`-tagged test asserts nothing — it writes PNGs at both
the phone and desktop widths, in light and dark — so a filtered run of the file (and test group)
that captures your surface is the capture step:

```bash
pnpm e2e:build
npx playwright test e2e/<spec-file>.spec.ts -g '<name of the capture group>' --reporter=line
```

Read the PNGs in `e2e/screenshots/` (gitignored) and check them against the checklist at the bottom of
`docs/design/principles.md`. For significant UI work, also run the `design-review` skill.
Send the screenshots to the user when reporting completion.

## 4. Behavior changed: exercise it

For domain logic with no UI yet, drive it directly (a scratch script or `vitest run` on the new
tests) and confirm outputs on realistic inputs — including the failure paths (full boat,
uncertified diver, a nitrox request with no verified card).

## Report honestly

State what you ran and what you observed. If anything is red or unverified, say so plainly —
never mark work done with failing or skipped verification. A red or flaky test doesn't get
skipped just because it's unrelated to your change — see the `debug` skill's Ownership section
before fixing it, so you don't duplicate a fix already in flight on another PR.
