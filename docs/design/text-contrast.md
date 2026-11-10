# Text-contrast measurements — 2026-11-10

Issue #4211 remeasures Logbook's current colors. It does not reuse the former palette's ratios
and does not establish WCAG conformance.

## Method and scope

The starting source is `main` at `16c6aeb76`. `src/lib/text-contrast.test.ts` resolves both
schemes' current CSS tokens, including mixes, and checks reading/status inks on white/shell,
ground, sunken and relevant opaque tint fills, plus button ink and empty-field rules.
`e2e/text-contrast.spec.ts` measures computed text and placeholder colors against ancestor fills,
including alpha and ancestor opacity. Each test attaches its full JSON measurement list.
The probe itself is tested against solid, translucent and dimmed text and an unsupported gradient.

The rendered sample uses the isolated production build, seeded Blue Mantis shop, owner session,
default desktop viewport and local Chrome on macOS. It covers `/`, `/signin`, the Blue Mantis
storefront and registration, staff Today, Add diver, Reports, rental settings, profile/brand
settings, the activity log with empty date filters open, and the schedule Add panel, in light and
dark. The final focused run passes 23 tests with 2,816 text/placeholder measurements and four
unmeasured native date masks. These are named samples, not every route or state. Image/gradient backgrounds are reported
as unmeasured. Native date/time shadow text is also reported as unmeasured: Chromium's
`getComputedStyle` returns the host input's color for `::-webkit-datetime-edit`, which must not be
presented as the mask's painted ink. Its specified CSS color is checked by the token test and its
appearance is captured for visual inspection.

The local browser falls back to installed Chrome because pinned Chromium is absent. Its color
measurements and functional checks are useful; its screenshots are not compared to CI's Linux
baselines. CI's exact-head visual report remains the source of baseline diffs.

## Fresh findings and fixes

Ratios below are newly computed from the current tokens or measured in the browser, rounded to
three decimal places. Token mixing rounds RGB channels to integers; browser alpha compositing
retains fractional channels, explaining the small difference between the two placeholder values.

| Combination | Before | After |
| --- | --- | --- |
| Light placeholder, white surface, browser | 3.754 | 6.190 |
| Light placeholder, white surface, token calculation | 3.766 | 6.190 |
| Light placeholder, `#f4f6f4` ground, token calculation | 3.567 | 5.699 |
| Light placeholder, `#eaedea` sunken fill, token calculation | 3.375 | 5.247 |
| Dark placeholder, `#162129` shell, token calculation | 4.595 | 6.605 |
| Dark placeholder, `#0f171c` ground, token calculation | 4.899 | 7.311 |
| Dark placeholder, `#0b1216` sunken fill, token calculation | 5.039 | 7.622 |
| Unchecked rental price placeholder, light, browser | 1.794 | 5.247 |
| Unchecked rental price placeholder, dark, browser | 2.141 | 7.622 |

The existing semantic ink/fill matrix needed no token changes. The tightest light reading/status
pair on a plain fill is raw success on sunken, 4.899:1; the tightest corresponding dark pair is
muted on the shell, 6.605:1. The status/tint tables in
[forms-and-controls.md](forms-and-controls.md#which-tone-token-text-success-or-text-success-strong)
are recomputed from these same colors.

Placeholders and empty date/time masks now use full-strength `--muted`, while typed answers keep
`--foreground`. Unchecked rental price fields were still editable, not disabled, so dimming their
whole wrapper made useful text unreadable. They now use a sunken fill and muted ink, preserving
which items the shop offers without lowering the entire control's opacity. No form behavior or
user-facing copy changes.

## Expected visual changes

- Empty text fields and unfocused empty native date/time masks have stronger quiet ink in both
  schemes. Typed values, labels, layout, sizing and focus behavior stay unchanged.
- Unchecked rental price fields have a sunken fill, full-strength edge and muted text instead of
  a half-opacity white field. Checked rows retain their existing fill and reading ink.
- Local rental captures cover the light phone/desktop and dark desktop matrix. Native empty date
  masks are attached by the focused browser tests. Review the CI Linux comparisons separately;
  other layers in the stack must be attributed to their own changes.
