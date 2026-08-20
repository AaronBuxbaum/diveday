# FU-20260820-the-copy-sweep-missed-seven-bundles — Finish the copy-restraint sweep over the six staff bundles it never opened

- **Status:** Open
- **Raised:** 2026-08-20 — the product owner asked why `gear.empty.body` survived the copy skill
- **Kind:** cleanup
- **Effort:** M
- **Touches:** `src/i18n/locales/en-US/staff/blockers.json`, `src/i18n/locales/en-US/staff/waiversStaff.json`, `src/i18n/locales/en-US/staff/manifest.json`, `src/i18n/locales/en-US/staff/incidentExport.json`, and their `es-ES` twins

## What I noticed

The product owner pointed at one string — the gear register's empty state, three sentences of
mechanism and reassurance — and asked why the copy skill had not caught it. The answer is two
separate gaps, and only the first is widely understood:

**No automated gate can catch it, by design.** `pnpm check:copy` is a *location* gate: it asks
whether a string sits in a message bundle or is hard-coded in a component, and nothing else. The
moment that sentence landed in `staff/gear.json` the check was fully satisfied. `check:domain-strings`
is the same question asked of `src/lib`/`src/db`. The only content-level rule applied to bundles is
`check-soft-delete.mjs`'s vocabulary regex. `.claude/skills/copy-restraint/SKILL.md` has no script,
no hook, and no `allowed-tools` — it is pure judgment, applied by whoever is reading.

**And the one pass that would have caught it skipped the file.** The app-wide sweep in commit
`e174e0a3` ("Sweep the app for copy that explains itself", 2026-08-20 07:17 UTC) touched
`diver.json` and 25 staff bundles. It did not touch seven: `blockers`, `feed`, **`gear`**,
`incidentExport`, `manifest`, `orderLine`, `waiversStaff`. `gear.json` was created at 03:44 UTC the
same day — three and a half hours *before* the sweep — so it existed and was skipped, not absent.
`FU-20260820-copy-restraint-rejected-findings.md` describes that sweep as having "read every key in
every message bundle"; that is not what happened, and the seven-bundle gap is worth knowing about
before anyone reads the refusal set as if it were exhaustive.

`gear.json` is handled — this change trimmed `empty.body`, `unit.status.deleteWarning` and
`prep.description`. The other six are untouched, and a scan for strings over 90 characters finds
candidates in five of them, for example:

- `blockers.emptyDescription` — "…New bookings show up here the moment something needs attention."
  (mechanism)
- `incidentExport.footerHashExplainer` — "Computed from this document's recorded facts. Re-generating
  from unchanged records reproduces the same code…" (mechanism, at length)
- `waiversStaff.signatures.description` — "…Signed waivers are tamper-evident; an altered record is
  flagged." (mechanism)

`feed` and `orderLine` are clean.

## Why it isn't already done

Scope, and one genuine judgment split that a sweep should not resolve mechanically.
`manifest.json` and `incidentExport.json` are **safety and legal surfaces** — a roll-call count, a
document that goes to an insurer — and the copy-restraint skill's licence explicitly stops at
safety surfaces. `manifest.notBackAboardDescription` ("After a dive, 'not back aboard' means this
diver has not returned to the boat. It keeps the count open.") is the kind of sentence that reads
as redundant to someone holding the model and is load-bearing for a new crew member at the rail.
`incidentExport.factsOnly` is there so the document cannot be read as a safety judgment, which is a
legal position, not decoration.

So this is not one sweep. It is a short sweep over `blockers` and `waiversStaff`, and a careful
read of `manifest` and `incidentExport` where the default answer is *keep*.

## Proposed change

Work the four non-clean bundles in two passes, in this order:

1. **`blockers.json` and `waiversStaff.json`** — ordinary staff surfaces, ordinary filter. Apply
   the five deletions from the skill and bank the result.
2. **`manifest.json` and `incidentExport.json`** — read each string at its render site and delete
   only what a crew member or a claims reader would not get wrong without it. Where restraint and
   safety genuinely conflict, keep the sentence and record the trade in
   `docs/design/accessibility-tradeoffs.md` rather than silently keeping it.

Do **not** run this as a bulk mechanical pass across all four. The 2026-08-20 sweep's own follow-up
records that an adversarial verifier refused 164 of 391 candidates, and the refusals clustered on
exactly this kind of surface.

## Prompt

```text
Read .claude/skills/copy-restraint/SKILL.md and docs/design/principles.md (principle 4) first.

The 2026-08-20 app-wide copy sweep (commit e174e0a3) touched diver.json and 25 staff bundles but
skipped seven: blockers, feed, gear, incidentExport, manifest, orderLine, waiversStaff. gear was
handled separately; feed and orderLine are clean. Four remain.

Pass 1 — src/i18n/locales/{en-US,es-ES}/staff/blockers.json and waiversStaff.json. Ordinary staff
surfaces. Apply the skill's five deletions. Start with blockers.emptyDescription and
waiversStaff.signatures.description, both of which explain a mechanism the reader already has.

Pass 2 — manifest.json and incidentExport.json. These are safety and legal surfaces and the skill's
licence stops at them. Read every string at its render site (src/app/shop/[shopSlug]/trips/[id]/
manifest/ and .../log/) and DEFAULT TO KEEPING. Delete only what a crew member at the rail or a
claims reader would not get wrong without it. incidentExport.factsOnly is a legal position, not
decoration — leave it.

Every key you touch changes in BOTH locales in the same change (read src/i18n/locales/es-ES/README.md
for register) or pnpm check:locale fails. Deleting a key is three edits: call site, en-US, es-ES.

Done when: pnpm check is green, and you have looked at the shop home's blockers view, the waiver
signature log, and a departure's manifest in light and dark (node scripts/screenshot.mjs, see the
verify skill). Expect visual diffs on those captures and say in the PR why each moved. Delete
docs/product/follow-ups/FU-20260820-the-copy-sweep-missed-seven-bundles.md as part of the change.
```
