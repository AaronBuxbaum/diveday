# H-37: The colour-guide decision blocking the two remaining WCAG contrast token fixes: light-mode --success on…

- **Status:** Ready
- **Human owner:** Product owner

## Decision or approval needed

The colour-guide decision blocking the two remaining WCAG contrast token fixes: light-mode `--success` on `bg-success/10` computes 4.38:1 and `--warning` 4.39:1 against a 4.5:1 requirement, and placeholders sit at 3.35:1/3.07:1 (`comprehensive-review-20260802` HD-17, I18N-1 residue). The code for both fixes is written and waiting; see [roadmap §contrast](../features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision).

## Minimum outcome to record

A chosen palette direction for `--success`/`--warning`/placeholder tokens that doesn't fight the current color guide.

## Unblocks / follow-up

Until chosen, no claim of WCAG AA conformance in this repo is true. (The suite's axe scan, which kept `color-contrast` off for these tokens, was removed on 2026-10-24; nothing automated checks contrast now.)

Part of the [human decision log](README.md#decision-register).
