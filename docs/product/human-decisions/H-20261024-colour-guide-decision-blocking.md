# H-20261024-colour-guide-decision-blocking: The colour-guide decision blocking the two remaining WCAG contrast token fixes: light-mode --success on…

- **Status:** Implemented
- **Human owner:** Product owner

## Current outcome — 2026-11-10

The palette blocker is lifted. Fresh current-palette measurements and text fixes are implemented
in draft [#4224](https://github.com/AaronBuxbaum/diveday/pull/4224), tracked by
[#4211](https://github.com/AaronBuxbaum/diveday/issues/4211). The layer is unmerged; this records
implementation, not final CI, deployment or field validation. Historical 4.38/4.39 and placeholder
ratios are not current measurements; the earlier assertion that nothing checks contrast is
not a current coverage statement. See the implementation
[measurement record](../../design/text-contrast.md). This choice
does not establish WCAG conformance.

Source: [owner-account decision record on #4196](https://github.com/AaronBuxbaum/diveday/issues/4196#issuecomment-6759906171).
The sections below preserve the original question and rationale, not a second unresolved worklist.

## Original question

The colour-guide decision blocking the two remaining WCAG contrast token fixes: light-mode `--success` on `bg-success/10` computes 4.38:1 and `--warning` 4.39:1 against a 4.5:1 requirement, and placeholders sit at 3.35:1/3.07:1 (`comprehensive-review-20260802` HD-17, I18N-1 residue). The code for both fixes is written and waiting; see [roadmap §contrast](../features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision).

## Minimum outcome to record

A chosen palette direction for `--success`/`--warning`/placeholder tokens that doesn't fight the current color guide.

## Unblocks / follow-up

Until chosen, no claim of WCAG AA conformance in this repo is true. (The suite's axe scan, which kept `color-contrast` off for these tokens, was removed on 2026-10-24; nothing automated checks contrast now.)

Part of the [human decision log](README.md#decision-register).
