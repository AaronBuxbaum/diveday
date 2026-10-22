# Visual triage: mapping a diff to its cause, and stability

Part of the **visual-triage** skill ([SKILL.md](SKILL.md)). Read it when a diff image does not obviously follow from the code, a capture flickers between runs, or one capture moved for two reasons.

## Mapping and stability

Visual specs are discovered from `e2e/visual*.spec.ts`; shared capture mechanics live in `e2e/visual-harness.ts`. First check the scoped manifest's build fingerprint, route/state assertion, browser and viewport. A stale or unasserted capture is missing evidence. If a diff appears without a relevant code change, check `DIVEDAY_CLOCK`, browser version, fonts, and the deterministic PGlite reset. Do not mask a moving element to make the diff disappear.

Read the *shape* of a no-code-change diff before assuming a baseline moved:

- **Glyphs everywhere, layout identical** (element positions and image heights unchanged) — a
  rendering-input change, not a code change. The browser is pinned to the lockfile now, so the
  suspects are, in order: a `@playwright/test` bump, a change to `DETERMINISTIC_RENDERING_ARGS` in
  `e2e/browser.ts`, or the runner image's emoji/fallback fonts (Geist is self-hosted and pinned).
- **Confined to one element, with everything around it identical** — a capture that shot too early.
  Wait on something the surface only renders when it is done, not a `@media` or a moving element.
- **A solid blank stripe, or a whole screenful of nothing** — the capture gave up on a wait rather
  than the page rendering wrong. `paintWholeDocument` bounds every wait it owns and shoots anyway,
  which is deliberate: a stall costs one capture's sharpness, not the run. Every bound that fires
  warns to the shard's log with the surface URL, so **read the `visual:` lines in the "Capture
  visual regression screenshots" job output before reading the pixels** — they name which wait gave
  up (frames, image decode, the whole scroll-through pass, the fonts) and, for a driver-side stall,
  whether the renderer answered a trivial `evaluate` afterwards. A stripe with a matching warning is
  a harness stall to re-run, never a baseline to bank; a stripe with *no* warning is a real finding.
- **Anything reflows** — a real layout change. Read it as a finding even if it arrived inside a
  larger rebaseline.

`regconfig.json` sets `enableAntialias`, so a diff that survives to the report is not "just
antialiasing". It deliberately does **not** set `matchingThreshold` — the comparison runs at
reg-cli's default of `0`, meaning any per-pixel difference counts. Loosening that is not triage: if
a diff is noise, the renderer is the thing to fix.

### A capture can have two causes at once

The trap is assuming one. A capture changes because the **baseline is stale** — somebody else's
merged work moved the surface and your branch inherited it — *and* because **your branch moved it
too**. Both at once is the ordinary case on a stack, and a name shared with a sibling pull request's
report proves only the first. It never explains the capture, and treating it as if it did is how
work gets filed as somebody else's noise: on PR #1484 six changed captures were reported as the
PR's own when twenty-two were, and sixteen of them carried the feature's own 121px block.

The geometry line is what separates the two. Identical growth across both reports points at the
shared baseline; growth that differs — or a delta where the sibling reads `unchanged` — is this
branch's own and yours to explain. `unchanged` on both sides means neither moved the box, so the
difference is pixel content: a colour, a glyph, a photo that decoded differently, never a reflow.
