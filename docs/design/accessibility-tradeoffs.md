# Accessibility trade-offs

The register of places where DiveDay deliberately chose the more delightful experience for the
standard user over the more accessible one. It exists so those choices stay **visible and
revisitable** rather than becoming invisible defaults nobody can find later.

This is a decision the product owner has made explicitly: when a genuinely more accessible option
and a genuinely better standard experience conflict, build for the standard user, and write the
trade down here. It is **not** a follow-up — nothing here is an agent's to "fix" as a drive-by.
A human reads this register and decides.

## What belongs here

A row goes in this table when **all** of these are true:

- The two options genuinely conflict — one is measurably better for most users and measurably
  worse for someone using assistive technology, low vision, or reduced motion.
- We shipped the standard-user option.
- Something real was given up. Not "we thought about it": a named group loses something named.

## What does not belong here

- **A trade that costs nobody anything.** An `aria-label`, a `role`, a focus ring, semantic HTML,
  a live region — these are invisible to the sighted mouse user, so choosing them is free and
  choosing against them is not a trade, it is a defect. Ship them.
- **Safety surfaces.** Manifests, roll call, cert gating, medical flags. On a wet deck in glare
  the standard user *is* the edge case, so [principle 6](principles.md) holds without exception:
  never colour alone, states in words, timestamps with their zone. There is no delight worth a
  head count someone misread.
- **Keyboard reachability of any control that mutates data.** A staff member on a laptop
  navigating by keyboard is a standard user, not an accommodation.
- **Touch targets below 44 px on a primary flow.** The [dock test](principles.md) is an
  operating condition, not an accessibility nicety.
- **The known colour-contrast gaps.** Two light-palette contrast failures are open and deferred
  pending a colour-guide decision; they are tracked in
  [product/features/roadmap.md](../product/features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision).
  Those are a backlog, not a trade — do not move them here.

## How to add a row

In the same change that makes the trade. Each row names what a person loses, not just what we
chose, and what would let us take it back — a specific condition, so the register can actually be
worked through later rather than admired.

## Register

| Id | Surface | What we chose | What is given up, and by whom | What would reverse it |
| --- | --- | --- | --- | --- |
| A11Y-01 | Staff surfaces, app-wide (2026-08-20) | Deleted the explanatory sentence under section headings, legends, and controls whose meaning the surrounding structure already carries — see the [copy-restraint](../../.claude/skills/copy-restraint/SKILL.md) skill | A screen-reader or cognitive-load user who was served by having the rule spelled out beside the control now gets the heading and the control alone. Sighted scanning improves; explicit teaching is gone | A staffer reporting they could not tell what a control did. The fix then is an accessible name or a `<details>` on that one control, not the paragraph coming back |
| A11Y-02 | Waiver delivery, diver record + queues (2026-08-20) | The private waiver link is never printed on screen. "Copy link" writes it to the clipboard and says so; there is no visible URL to read, select, or dictate | Someone who cannot use the clipboard — a locked-down browser, a denied clipboard permission, or a workflow that involves reading the URL aloud — has no way to reach the link from this surface. The failed-copy path says the copy failed but can no longer offer "select it yourself" | A shop reporting they need to read a link out. The fix then is a deliberate reveal behind the copy control, not a URL on the surface at rest |
| A11Y-03 | Waiver delivery buttons, diver record (2026-08-20) | Each channel button carries its last known delivery outcome as an outline plus a small glyph, rather than a sentence under the row | The outline is the primary carrier and it is colour-led. The glyph and the button's accessible name carry the same state, so it is not colour alone — but it is smaller and quieter than prose was | A staffer misreading a failed send as a successful one. The fix then is a word on the button, not a paragraph under the row |
