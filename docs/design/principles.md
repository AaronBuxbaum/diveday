# Delight-first design principles

Delight is this product's differentiator (see [product/vision.md](../product/vision.md)). These
principles are testable rules, not vibes. The `design-review` skill checks against them.

## 1. Speed is the first delight

Nothing charms like instant. Navigation feels immediate (prefetch, server components); mutations
are optimistic where safe; loading states are skeletons shaped like the content, not spinners.
If an interaction needs a spinner for more than a beat, redesign the interaction.

## 2. Pass the dock test

Primary flows work one-handed on a phone, in glare, with wet fingers: touch targets ≥ 44 px,
critical text ≥ 16 px, strong contrast (AA minimum, AAA for manifest/roll-call surfaces),
forgiving inputs (autocomplete, sensible defaults, no precision gestures). A 44 px target must
center its own label, and fields in a row must share one baseline no matter how their captions
wrap — both come free from the primitives in
[forms-and-controls.md](forms-and-controls.md). Roll call gets the
most extreme version of this. Live and offline boat surfaces use an explicit light `boat-mode`
with visible connectivity/freshness states, a sticky progress cue, and an accessible skip link so
device dark mode or deck glare cannot hide an operational state.

## 3. Calm surfaces, earned moments of joy

The everyday UI is quiet: generous whitespace, few borders, muted ink for secondary text. Joy is
concentrated where the user finishes something — booking confirmed, waiver signed, roll call
complete — as a small, fast, coral-accented moment (≤ 400 ms). Delight loses meaning if it's
everywhere; `--accent` is rationed on purpose.

## 4. Words sound like a good dive briefing

Microcopy is warm, plain, and brief — a competent divemaster, not a lawyer or a mascot. Empty
states teach ("No trips yet — schedule your first charter"); errors say what happened and what
to do next; buttons are verbs ("Add diver", not "Submit"). No jargon divers don't use; correct
use of the jargon they do (see [product/glossary.md](../product/glossary.md)).

## 5. Motion has a job

Animation exists to explain (where did it go, what changed), 150–250 ms, ease-out
(`--ease-out-soft`), transform/opacity only. Everything respects `prefers-reduced-motion` — the
kill-switch in `globals.css` stays.

## 6. Trustworthy by inspection

This app handles safety documents. Manifests and cert checks look exact: tabular numbers for
counts, unambiguous states (never color alone — icon + label), timestamps with timezone, print
output as considered as screen output.

## Tokens (the mechanics)

Defined in `src/app/globals.css`, bound to Tailwind — see
[ADR-0004](../architecture/decisions/0004-design-tokens.md) for the rules. Palette story: sunlit
sand (light) / open ocean at depth (dark); **lagoon** (`--primary`) is the action color;
**coral** (`--accent`) is rationed for earned moments; feedback colors (`--success`,
`--warning`, `--danger`) never carry meaning alone.

## Review checklist

- [ ] Semantic tokens only (no raw hex / palette-scale classes)
- [ ] Light **and** dark verified (screenshots)
- [ ] Dock test: targets ≥ 44 px, text ≥ 16 px, AA contrast
- [ ] Buttons and button-shaped links via `buttonClass()`; labels centered in the target
- [ ] Stacked form fields via `<Field>`/`<FieldGrid>`; controls aligned across columns
- [ ] Loading = content-shaped skeletons; no layout shift
- [ ] Motion ≤ 250 ms, transform/opacity, reduced-motion respected
- [ ] Copy: verbs on buttons, teaching empty state, actionable errors
- [ ] State never conveyed by color alone
- [ ] Keyboard reachable, focus visible, semantic HTML
