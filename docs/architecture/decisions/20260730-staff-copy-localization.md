# 20260730-staff-copy-localization — Ratchet hard-coded copy down instead of declaring the app localized

- **Status:** Accepted
- **Date:** 2026-07-30

## Context

[20260729-diver-copy-localization](20260729-diver-copy-localization.md) localized the diver-facing
surface and named its own gap plainly: staff screens still have English prose compiled into them.
`pnpm check:locale` guarantees that every message *already in a bundle* is translated into every
locale — it cannot see copy that never reached a bundle, and its own header says so:

> Deliberately not checked: that no English string literal appears anywhere in a diver-facing
> component. That is not mechanically decidable […] so it stays a review expectation.

A review expectation does not hold. Scanning `src/app` and `src/components` finds roughly **1,000
hard-coded user-facing strings across 110 files**. The instruction driving this work was to make
sure copy is always defined with i18n and nowhere has hard-coded English left. Those are two
different asks with two very different costs, and conflating them is how a rule ends up either
unenforced or unsatisfiable:

- *No **new** hard-coded copy* is achievable today.
- *No hard-coded copy **at all*** is a mechanical migration of ~1,000 strings plus a Spanish
  translation pass for each, which is milestone-scale work.

## Decision

Ship the enforcement now and let it drive the migration, rather than blocking on the migration.

**1. A staff message bundle.** `src/i18n/locales/<locale>/staff.json` with `staffTranslator()`,
mirroring the diver bundle. It is **server-side only**: there is no `StaffIntlProvider`, and staff
Client Components receive their words as props. `useTranslations()` types against the single global
`AppConfig.Messages` augmentation, so a second client bundle would either widen every diver `t()`
call's key space or ship staff copy to anonymous visitors. Neither is worth a provider.

**2. `pnpm check:copy`, a ratchet.** `scripts/copy-baseline.json` records how much un-extracted copy
each file still holds. The build fails when:

- a file not in the baseline has any hard-coded copy (no new debt, anywhere);
- a file's count exceeds its baseline (no growth);
- a file's count is *below* its baseline (the entry must be lowered in the same change);
- a baseline entry names a file that is now clean or gone.

`node scripts/check-copy.mjs --write` rewrites the baseline but **refuses to raise any number or
add any file**. The number can only go down.

**3. Domain layers return codes, not sentences.** `getStaffingView` returned English gap strings
from `src/db/`, where no UI scanner could see them and no translator could reach them. It now
returns `StaffingGapCode` values the page renders. This is the general rule: `src/lib` and `src/db`
state facts, `src/app` and `src/components` choose words.

**4. Two surfaces migrated as proof**, not just as demonstration: the staffing page (17 strings) and
the new calendar-subscriptions feature (built clean). Both are fully translated into `es-ES`.

## Why a ratchet and not a gate

A gate on ~1,000 strings has exactly two outcomes: it gets an exemption so broad it stops meaning
anything, or it blocks unrelated work until someone finds a week. A ratchet is enforceable from the
first commit, makes the remaining debt a number in version control rather than a vague known issue,
and turns every touched file into an opportunity to lower it. The "must lower a shrinking count"
rule is what keeps it honest — without it the baseline drifts into a stale allowlist that passes
while describing nothing.

## Alternatives considered

- **Extract all ~1,000 strings now** — rejected for this change; it is milestone-scale, needs a
  Spanish pass per string, and would bury the calendar-sync and module-contract work in a diff
  nobody can review.
- **A plain allowlist of exempt files** — rejected. It never shrinks, and nothing detects a file
  that has quietly been cleaned up.
- **A Biome lint rule** — rejected: Biome 2.5.6 has no JSX-literal or i18n rule, and the repo's
  convention is a `check:*` script per invariant anyway.
- **A real TypeScript/JSX parse instead of a source scan** — rejected for now. The scan is tuned to
  under-report, and the baseline surfaces whatever it misses the moment someone looks at a file. A
  parser is the upgrade path if false negatives start mattering.
- **Widening `AppConfig.Messages` to `DiverMessages & StaffMessages`** — rejected; it would let a
  diver-side `t("staffing.…")` typecheck and then resolve to nothing at runtime.

## Consequences

- The remaining debt is **1,000 strings across 110 files**, recorded in `scripts/copy-baseline.json`.
  That number is the honest status of "no hard-coded English", and it is now impossible to increase.
- Marketing pages (`/`, `/product`, `/about`, `/switching/*`) are in the baseline like everything
  else. They are English-by-design today, but that is a decision to record, not a reason to hide
  them from the count.
- **Scope is `src/app` and `src/components` `.tsx` files.** Copy that originates in `src/lib` or
  `src/db` is invisible to the scan; rule 3 above is the mitigation, and it is a review
  expectation, not a machine-checked one. This is the known hole.
- The scan is a heuristic. `{/* i18n-exempt: reason */}` and `// i18n-exempt-file: reason` exist for
  false positives and both require a stated reason.
- Static `metadata.title` stays English — Next resolves it before locale negotiation, the same
  carve-out 20260729 documents. The waiver body and medical questionnaire stay English regardless,
  pending H-01/H-03.
- **Revisit when** the baseline reaches zero: `check:copy` then becomes a plain gate and the
  baseline file can be deleted.
